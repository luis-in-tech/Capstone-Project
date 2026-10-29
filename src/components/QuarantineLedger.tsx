import React, { useState } from 'react';
import {
  WarningIcon as AlertTriangle,
  DownloadIcon as Download,
  PlusIcon as Plus,
  ArrowsClockwiseIcon as RefreshCw,
  PackageIcon as Package,
  TruckIcon as Truck,
  CheckCircleIcon as CheckCircle2,
  XCircleIcon as XCircle,
  PrinterIcon as Printer,
  CalendarIcon as Calendar,
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
import { db, doc, getDoc, updateDoc, collection, addDoc, serverTimestamp } from '../lib/supabaseAdapter';
import { toast } from 'sonner';

interface QuarantineLedgerProps {
  tickets: DefectiveStockTicket[];
  inventory: InventoryItem[];
  profile?: UserProfile | null;
  onOpenLogModal: () => void;
  onRefresh: () => void;
}

export function QuarantineLedger({
  tickets,
  inventory,
  profile,
  onOpenLogModal,
  onRefresh,
}: QuarantineLedgerProps) {
  const [filter, setFilter] = useState<'all' | 'QUARANTINED' | 'RETURN_IN_PROGRESS' | 'REPLACED' | 'WRITTEN_OFF'>('all');

  const filteredTickets = tickets.filter((t) => (filter === 'all' ? true : t.status === filter));

  const totalQuarantinedUnits = tickets
    .filter((t) => t.status === 'QUARANTINED')
    .reduce((sum, t) => sum + t.quantity, 0);

  const totalInReturnUnits = tickets
    .filter((t) => t.status === 'RETURN_IN_PROGRESS')
    .reduce((sum, t) => sum + t.quantity, 0);

  const totalReplacedUnits = tickets
    .filter((t) => t.status === 'REPLACED')
    .reduce((sum, t) => sum + t.quantity, 0);

  const handleStatusChange = async (ticket: DefectiveStockTicket, newStatus: DefectiveStockTicket['status']) => {
    try {
      await updateDefectiveTicketStatus(ticket.id, newStatus);

      // If supplier replacement arrived: restock items back into inventory!
      if (newStatus === 'REPLACED') {
        let item = inventory.find(
          (i) => i.productId === ticket.productId && i.warehouseId === ticket.warehouseId
        );
        if (item?.id) {
          try {
            const freshSnap = await getDoc(doc(db, 'inventory', item.id));
            if (freshSnap?.exists()) {
              item = { ...item, ...(freshSnap.data() as InventoryItem) };
            }
          } catch {}
        }
        if (item) {
          const newQty = item.quantity + ticket.quantity;
          const newQuarantine = Math.max(0, (item.quarantineQuantity || 0) - ticket.quantity);
          try {
            await updateDoc(doc(db, 'inventory', item.id), {
              quantity: newQty,
              quarantineQuantity: newQuarantine,
              lastUpdated: serverTimestamp(),
            });
          } catch {}
        }
        toast.success(`Replacement confirmed: ${ticket.quantity} units restocked to available inventory.`);
      } else if (newStatus === 'WRITTEN_OFF') {
        let item = inventory.find(
          (i) => i.productId === ticket.productId && i.warehouseId === ticket.warehouseId
        );
        if (item?.id) {
          try {
            const freshSnap = await getDoc(doc(db, 'inventory', item.id));
            if (freshSnap?.exists()) {
              item = { ...item, ...(freshSnap.data() as InventoryItem) };
            }
          } catch {}
        }
        if (item) {
          const newQuarantine = Math.max(0, (item.quarantineQuantity || 0) - ticket.quantity);
          try {
            await updateDoc(doc(db, 'inventory', item.id), {
              quarantineQuantity: newQuarantine,
              lastUpdated: serverTimestamp(),
            });
          } catch {}
        }
        try {
          await addDoc(collection(db, 'stockAdjustments'), {
            productId: ticket.productId,
            warehouseId: ticket.warehouseId,
            adjustmentAmount: -ticket.quantity,
            reason: `Quarantine Write-Off: Defective Ticket ${ticket.ticketNumber || ticket.id}`,
            recordedBy: profile?.uid || 'system',
            createdAt: serverTimestamp(),
          });
        } catch (adjErr) {
          console.warn('Could not record write-off stock adjustment:', adjErr);
        }
        toast.success(`Asset written off: removed from quarantine.`);
      } else {
        toast.success(`Ticket ${ticket.ticketNumber} status updated to ${newStatus.replace('_', ' ')}.`);
      }

      onRefresh();
    } catch {
      toast.error('Could not update defective ticket.');
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
            onClick={() => exportDefectiveProductsReportCSV(tickets)}
            disabled={!tickets.length}
          >
            <Download className="size-3.5" />
            Export Defective Report (CSV)
          </Button>

          <Button
            type="button"
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold gap-1.5 shadow-sm"
            onClick={onOpenLogModal}
          >
            <Plus className="size-4" />
            Log Damaged Stock
          </Button>
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
            <p className="text-2xl font-black mt-1">{tickets.length}</p>
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
          All Tickets ({tickets.length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'QUARANTINED' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('QUARANTINED')}
        >
          Quarantined ({tickets.filter((t) => t.status === 'QUARANTINED').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'RETURN_IN_PROGRESS' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('RETURN_IN_PROGRESS')}
        >
          Return in Progress ({tickets.filter((t) => t.status === 'RETURN_IN_PROGRESS').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'REPLACED' ? 'default' : 'ghost'}
          className="text-xs h-7"
          onClick={() => setFilter('REPLACED')}
        >
          Replaced & Restocked ({tickets.filter((t) => t.status === 'REPLACED').length})
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
                        <span className="text-[10px] text-muted-foreground truncate max-w-[150px]">
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
                    <div className="flex items-center justify-end gap-1">
                      {ticket.status === 'QUARANTINED' && (
                        <Button
                          size="sm"
                          variant="outline"
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
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 gap-1 font-semibold"
                          onClick={() => handleStatusChange(ticket, 'REPLACED')}
                          title="Supplier sent replacement, restock into warehouse inventory"
                        >
                          <CheckCircle2 className="size-3" />
                          Restock
                        </Button>
                      )}
                      {ticket.status !== 'WRITTEN_OFF' && ticket.status !== 'REPLACED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7 text-zinc-400 hover:text-zinc-600"
                          onClick={() => {
                            if (window.confirm(`Write off ticket ${ticket.ticketNumber}? This will permanently remove stock from quarantine.`)) {
                              handleStatusChange(ticket, 'WRITTEN_OFF');
                            }
                          }}
                          title="Write off asset"
                        >
                          <XCircle className="size-3" />
                        </Button>
                      )}
                    </div>
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
    </div>
  );
}
