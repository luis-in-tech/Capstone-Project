import { useRef, useState } from 'react';
import {
  DownloadIcon as Download,
  PlusIcon as Plus,
  TruckIcon as Truck,
  CheckCircleIcon as CheckCircle2,
  XCircleIcon as XCircle,
} from '@phosphor-icons/react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { DefectiveStockTicket, UserProfile, InventoryItem } from '../types';
import {
  updateDefectiveTicketStatus,
  exportDefectiveProductsReportCSV,
} from '../lib/itilService';
import { db, doc, getDoc, getDocs, updateDoc, deleteDoc, collection, addDoc, serverTimestamp } from '../lib/supabaseAdapter';
import { hasAdminRole } from '../lib/staffPermissions';
import { ConfirmDialog } from './ConfirmDialog';
import { toast } from 'sonner';

interface QuarantineLedgerProps {
  tickets: DefectiveStockTicket[];
  inventory: InventoryItem[];
  profile?: UserProfile | null;
  canAdjustStock?: boolean;
  allowedWarehouseIds?: string[] | null;
  onOpenLogModal: () => void;
  onRefresh: () => void;
}

export function QuarantineLedger({
  tickets,
  inventory: _inventory,
  profile,
  canAdjustStock,
  allowedWarehouseIds,
  onOpenLogModal,
  onRefresh,
}: QuarantineLedgerProps) {
  const canAdjust = canAdjustStock ?? hasAdminRole(profile ?? null);
  const scopedTickets = allowedWarehouseIds
    ? tickets.filter((t) => allowedWarehouseIds.includes(t.warehouseId))
    : tickets;
  const [filter, setFilter] = useState<'all' | 'QUARANTINED' | 'RETURN_IN_PROGRESS' | 'REPLACED' | 'WRITTEN_OFF'>('all');
  const [writeOffTarget, setWriteOffTarget] = useState<DefectiveStockTicket | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const processingTicketsRef = useRef<Set<string>>(new Set());

  const filteredTickets = scopedTickets.filter((t) => (filter === 'all' ? true : t.status === filter));

  const totalQuarantinedUnits = scopedTickets
    .filter((t) => t.status === 'QUARANTINED')
    .reduce((sum, t) => sum + t.quantity, 0);

  const totalInReturnUnits = scopedTickets
    .filter((t) => t.status === 'RETURN_IN_PROGRESS')
    .reduce((sum, t) => sum + t.quantity, 0);

  const totalReplacedUnits = scopedTickets
    .filter((t) => t.status === 'REPLACED')
    .reduce((sum, t) => sum + t.quantity, 0);

  const handleStatusChange = async (ticket: DefectiveStockTicket, newStatus: DefectiveStockTicket['status']) => {
    if (!canAdjust) {
      toast.error('You do not have permission to modify quarantine or inventory status.');
      return;
    }
    if (allowedWarehouseIds && !allowedWarehouseIds.includes(ticket.warehouseId)) {
      toast.error('This ticket belongs to a warehouse outside your assigned scope.');
      return;
    }
    if (newStatus === ticket.status) return;
    if (ticket.status === 'REPLACED' || ticket.status === 'WRITTEN_OFF') {
      toast.error('This ticket has already been finalized.');
      return;
    }
    if (processingTicketsRef.current.has(ticket.id)) return;
    processingTicketsRef.current.add(ticket.id);
    setProcessingId(ticket.id);

    const modifiedInventory: Array<{ id: string; prevQuantity: number; prevQuarantine: number }> = [];
    let createdAdjustmentId: string | null = null;
    let ticketStatusUpdatedTo: DefectiveStockTicket['status'] | null = null;
    const prevTicketStatus = ticket.status;

    try {
      const ticketSnap = await getDoc(doc(db, 'defective_tickets', ticket.id));
      if (!ticketSnap?.exists()) {
        throw new Error('Defective ticket record not found in database.');
      }
      const liveStatus = (ticketSnap.data() as any)?.status;
      if (liveStatus === 'REPLACED' || liveStatus === 'WRITTEN_OFF') {
        throw new Error('This ticket has already been finalized.');
      }

      if (newStatus === 'REPLACED' || newStatus === 'WRITTEN_OFF') {
        const liveInvSnap = await getDocs(collection(db, 'inventory'));
        const matchingRows = liveInvSnap.docs
          .map((d: any) => ({ ...(d.data() as InventoryItem), id: d.id }))
          .filter((i: InventoryItem) => i.productId === ticket.productId && i.warehouseId === ticket.warehouseId);

        if (matchingRows.length === 0) {
          throw new Error(`No inventory record found for ${ticket.productName} in ${ticket.warehouseName || ticket.warehouseId}.`);
        }

        const totalQuarantine = matchingRows.reduce((sum: number, row: InventoryItem) => sum + Number(row.quarantineQuantity || 0), 0);
        if (totalQuarantine < ticket.quantity) {
          throw new Error(`Insufficient quarantined stock (${totalQuarantine}) to settle ${ticket.quantity} unit(s).`);
        }

        // Transition ticket status first so concurrent finalization or ticket permission failures reject before mutating stock
        const updatedTicket = await updateDefectiveTicketStatus(ticket.id, newStatus);
        if (!updatedTicket) {
          throw new Error('Defective ticket record not found.');
        }
        ticketStatusUpdatedTo = newStatus;

        let remainingQuarantine = ticket.quantity;
        let restockedApplied = false;
        for (const row of matchingRows) {
          const prevQuantity = Number(row.quantity || 0);
          const prevQuarantine = Number(row.quarantineQuantity || 0);
          const deductQuarantine = Math.min(prevQuarantine, remainingQuarantine);
          if (deductQuarantine === 0) continue;

          const addAvailable = newStatus === 'REPLACED' && !restockedApplied ? ticket.quantity : 0;
          if (addAvailable > 0) restockedApplied = true;

          modifiedInventory.push({ id: row.id, prevQuantity, prevQuarantine });
          await updateDoc(doc(db, 'inventory', row.id), {
            quantity: prevQuantity + addAvailable,
            quarantineQuantity: prevQuarantine - deductQuarantine,
            lastUpdated: serverTimestamp(),
          });
          remainingQuarantine -= deductQuarantine;
          if (remainingQuarantine <= 0) break;
        }

        const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
          productId: ticket.productId,
          warehouseId: ticket.warehouseId,
          adjustmentAmount: newStatus === 'REPLACED' ? ticket.quantity : -ticket.quantity,
          reason:
            newStatus === 'REPLACED'
              ? `Quarantine Restocked: Replacement Ticket ${ticket.ticketNumber || ticket.id}`
              : `Quarantine Write-Off: Defective Ticket ${ticket.ticketNumber || ticket.id}`,
          recordedBy: profile?.uid || 'system',
          timestamp: serverTimestamp(),
        });
        createdAdjustmentId = adjRef?.id || null;
      } else {
        const updatedTicket = await updateDefectiveTicketStatus(ticket.id, newStatus);
        if (!updatedTicket) {
          throw new Error('Defective ticket record not found.');
        }
        ticketStatusUpdatedTo = newStatus;
      }

      if (newStatus === 'REPLACED') {
        toast.success(`Replacement confirmed: ${ticket.quantity} units restocked to available inventory.`);
      } else if (newStatus === 'WRITTEN_OFF') {
        toast.success(`Asset written off: removed from quarantine.`);
      } else {
        toast.success(`Ticket ${ticket.ticketNumber} status updated to ${newStatus.replaceAll('_', ' ')}.`);
      }

      onRefresh();
    } catch (err: any) {
      for (const prev of [...modifiedInventory].reverse()) {
        await updateDoc(doc(db, 'inventory', prev.id), {
          quantity: prev.prevQuantity,
          quarantineQuantity: prev.prevQuarantine,
          lastUpdated: serverTimestamp(),
        }).catch((rbErr) => console.error('Failed to rollback quarantine inventory:', rbErr));
      }
      if (createdAdjustmentId) {
        await deleteDoc(doc(db, 'stockAdjustments', createdAdjustmentId)).catch((rbErr) =>
          console.error('Failed to rollback stock adjustment:', rbErr)
        );
      }
      if (ticketStatusUpdatedTo) {
        await updateDefectiveTicketStatus(ticket.id, prevTicketStatus).catch((rbErr) =>
          console.error('Failed to rollback defective ticket status:', rbErr)
        );
      }
      console.error('Failed to process defective stock status change:', err);
      toast.error('Could not update defective ticket: ' + (err?.message || 'Database error'));
    } finally {
      processingTicketsRef.current.delete(ticket.id);
      setProcessingId(current => (current === ticket.id ? null : current));
    }
  };

  const getStatusBadge = (status: DefectiveStockTicket['status']) => {
    switch (status) {
      case 'QUARANTINED':
        return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[10px] font-bold">Quarantined</Badge>;
      case 'RETURN_IN_PROGRESS':
        return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-[10px] font-bold">Return In Progress</Badge>;
      case 'REPLACED':
        return <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 text-[10px] font-bold">Replacement Restocked</Badge>;
      case 'WRITTEN_OFF':
        return <Badge variant="outline" className="border-zinc-300 text-zinc-600 bg-zinc-100 text-[10px] font-bold">Written Off</Badge>;
    }
  };

  return (
    <div className="space-y-5">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            Quarantine & Defective Asset Governance
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track damaged stock, manage supplier returns, and restore inventory upon replacement.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="text-xs font-semibold gap-1.5"
            onClick={() => exportDefectiveProductsReportCSV(scopedTickets)}
            disabled={!scopedTickets.length}
          >
            <Download className="size-3.5" />
            Export Defective Report (CSV)
          </Button>

          {canAdjust && (
            <Button
              type="button"
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold gap-1.5 shadow-sm"
              onClick={onOpenLogModal}
            >
              <Plus className="size-4" />
              Log Damaged Stock
            </Button>
          )}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="rounded-xl border shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">In Quarantine</p>
            <p className="text-2xl font-black mt-1 text-amber-600">{totalQuarantinedUnits} <span className="text-xs font-normal text-muted-foreground">units</span></p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Returns in Progress</p>
            <p className="text-2xl font-black mt-1 text-blue-600">{totalInReturnUnits} <span className="text-xs font-normal text-muted-foreground">units</span></p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Restocked Replaced</p>
            <p className="text-2xl font-black mt-1 text-emerald-600">{totalReplacedUnits} <span className="text-xs font-normal text-muted-foreground">units</span></p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Tickets Logged</p>
            <p className="text-2xl font-black mt-1">{scopedTickets.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-3">
        <Button
          size="sm"
          variant={filter === 'all' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('all')}
        >
          All Tickets ({scopedTickets.length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'QUARANTINED' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('QUARANTINED')}
        >
          Quarantined ({scopedTickets.filter((t) => t.status === 'QUARANTINED').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'RETURN_IN_PROGRESS' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('RETURN_IN_PROGRESS')}
        >
          Return in Progress ({scopedTickets.filter((t) => t.status === 'RETURN_IN_PROGRESS').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'REPLACED' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('REPLACED')}
        >
          Replaced & Restocked ({scopedTickets.filter((t) => t.status === 'REPLACED').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'WRITTEN_OFF' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('WRITTEN_OFF')}
        >
          Written Off ({scopedTickets.filter((t) => t.status === 'WRITTEN_OFF').length})
        </Button>
      </div>

      {/* Tickets Table */}
      <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Ticket #</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Product CI</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Warehouse</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider text-center">Defective Qty</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Defect Reason</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Supplier</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTickets.map((ticket) => (
                <TableRow key={ticket.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs font-semibold">
                    {ticket.ticketNumber}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">{ticket.productName}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{ticket.sku}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-medium">
                    {ticket.warehouseName}
                  </TableCell>
                  <TableCell className="text-center font-black text-xs text-red-600">
                    {ticket.quantity}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-amber-700">{ticket.defectReason}</span>
                      {ticket.resolutionNotes && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-37.5">
                          {ticket.resolutionNotes}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-medium">
                    {ticket.supplierName}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(ticket.status)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canAdjust && (
                    <div className="flex items-center justify-end gap-1">
                      {ticket.status === 'QUARANTINED' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={processingId === ticket.id}
                          className="text-xs h-7 gap-1"
                          onClick={() => handleStatusChange(ticket, 'RETURN_IN_PROGRESS')}
                          title="Mark as shipped back to supplier"
                        >
                          <Truck className="size-3" />
                          Return
                        </Button>
                      )}
                      {ticket.status === 'RETURN_IN_PROGRESS' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={processingId === ticket.id}
                          className="text-xs h-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950 gap-1 font-semibold"
                          onClick={() => handleStatusChange(ticket, 'REPLACED')}
                          title="Supplier sent replacement, restock into warehouse inventory"
                        >
                          <CheckCircle2 className="size-3" />
                          Restock
                        </Button>
                      )}
                      {ticket.status !== 'WRITTEN_OFF' && ticket.status !== 'REPLACED' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={processingId === ticket.id}
                          className="text-xs h-7 text-zinc-400 hover:text-zinc-600"
                          onClick={() => setWriteOffTarget(ticket)}
                          title="Write off asset"
                          aria-label={`Write off ticket ${ticket.ticketNumber}`}
                        >
                          <XCircle className="size-3" />
                        </Button>
                      )}
                    </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!filteredTickets.length && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-xs italic">
                    No defective stock tickets in this category.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ConfirmDialog
        open={!!writeOffTarget}
        title="Write off quarantined stock"
        description={`Write off ticket ${writeOffTarget?.ticketNumber ?? ''}? This will permanently remove stock from quarantine.`}
        confirmLabel="Write off"
        destructive
        onOpenChange={(open) => { if (!open) setWriteOffTarget(null); }}
        onConfirm={async () => {
          if (writeOffTarget) await handleStatusChange(writeOffTarget, 'WRITTEN_OFF');
        }}
      />
    </div>
  );
}
