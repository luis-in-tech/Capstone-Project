import { SearchBar } from '@/components/ui/search-bar';
import { hasAdminRole } from '../lib/staffPermissions';
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { permitsMovement } from '../lib/staffPermissions';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, query, orderBy, serverTimestamp } from '../lib/supabaseAdapter';
import { Transfer, Product, Warehouse, InventoryItem } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TruckIcon as Truck, ArrowsLeftRightIcon as ArrowRightLeft, ClockIcon as Clock, CheckCircleIcon as CheckCircle2, ClockCounterClockwiseIcon as History, PlusIcon as Plus, XIcon as X, WarningIcon as AlertTriangle, XCircleIcon as XCircle, ProhibitIcon as Ban, ShieldWarningIcon as ShieldAlert } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../hooks/useAuth';
import { ConfirmDialog } from './ConfirmDialog';
import { toast } from 'sonner';

export function Transfers({ historyOnly = false }: { historyOnly?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const transferIdParam = searchParams.get('transferId');
  const lastAppliedTransferParamRef = useRef<string | null>(null);
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isAddTransferOpen, setIsAddTransferOpen] = useState(false);
  const [sourceWhId, setSourceWhId] = useState('');
  const [destWhId, setDestWhId] = useState('');
  const [transferItems, setTransferItems] = useState<Array<{ id: string; productId: string; quantity: number }>>([
    { id: crypto.randomUUID(), productId: '', quantity: 1 },
  ]);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Dispatch Dialog State (Driver Assignment & Plate)
  const [dispatchingTransfer, setDispatchingTransfer] = useState<Transfer | null>(null);
  const [driverName, setDriverName] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');

  // Cancellation Dialog State
  const [cancellingTransfer, setCancellingTransfer] = useState<Transfer | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [arrivalConfirmTarget, setArrivalConfirmTarget] = useState<Transfer | null>(null);

  // Action Loading State
  const [isProcessing, setIsProcessing] = useState(false);
  const actionLockRef = useRef(false);

  const hasAllWarehouseAccess = hasAdminRole(profile) || permissions.warehouseAccess === 'all';
  const scopedWarehouses = warehouses.filter(w => hasAllWarehouseAccess || permissions.warehouseIds.includes(w.id));
  const canAccessWarehouse = (warehouseId?: string) => !warehouseId ? false : (hasAllWarehouseAccess || permissions.warehouseIds.includes(warehouseId));
  const canManageTransfer = permitsMovement(permissions.movementCreate, 'internal') && permissions.inventory === 'adjust' && (hasAdminRole(profile) || profile?.role === 'secretary' || profile?.role === 'staff');

  useEffect(() => {
    const unsubTransfers = onSnapshot(query(collection(db, 'transfers'), orderBy('createdAt', 'desc')), (snap) => {
      setTransfers(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Transfer)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'transfers');
    });
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Product)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'products');
    });
    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snap) => {
      setWarehouses(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Warehouse)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'warehouses');
    });
    return () => {
      unsubTransfers();
      unsubProducts();
      unsubWarehouses();
    };
  }, []);

  useEffect(() => {
    if (!transferIdParam) {
      lastAppliedTransferParamRef.current = null;
      return;
    }
    if (lastAppliedTransferParamRef.current === transferIdParam || !transfers.length) return;
    const match = transfers.find(t => t.id === transferIdParam);
    if (match) {
      lastAppliedTransferParamRef.current = transferIdParam;
      setSelectedTransfer(match);
    }
  }, [transferIdParam, transfers]);

  const orderableProducts = products.filter(p => !p.hasVariations && p.variantEnabled !== false);

  const handleInitiateTransfer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageTransfer || actionLockRef.current) return;
    if (!sourceWhId || !destWhId) {
      toast.error('Select both source and destination warehouses.');
      return;
    }
    if (!canAccessWarehouse(sourceWhId) || !canAccessWarehouse(destWhId)) {
      toast.error('You do not have permission for the selected warehouse.');
      return;
    }
    if (sourceWhId === destWhId) {
      toast.error('Source and destination warehouses must be different.');
      return;
    }

    const validItems = transferItems.filter(item => item.productId);
    if (validItems.length === 0) {
      toast.error('Please select at least one product to transfer.');
      return;
    }

    // Check availability in source facility and enforce strictly positive integer quantity
    const aggregatedReq = new Map<string, { productName: string; totalQty: number }>();
    for (const item of validItems) {
      const qty = Number(item.quantity);
      const product = products.find(p => p.id === item.productId);
      const prodLabel = product?.name || item.productId;
      if (!product) {
        toast.error('Select a valid product for every line.');
        return;
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        toast.error(`Invalid quantity for ${prodLabel}. Quantity must be a positive whole number.`);
        return;
      }
      const current = aggregatedReq.get(item.productId) || { productName: prodLabel, totalQty: 0 };
      current.totalQty += qty;
      aggregatedReq.set(item.productId, current);
    }

    actionLockRef.current = true;
    setIsProcessing(true);
    try {
      const liveInventorySnap = await getDocs(collection(db, 'inventory'));
      const liveInventory = liveInventorySnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as InventoryItem));

      for (const [prodId, data] of aggregatedReq.entries()) {
        const available = liveInventory
          .filter(i => i.productId === prodId && i.warehouseId === sourceWhId)
          .reduce((sum, i) => sum + Math.max(0, Number(i.quantity || 0)), 0);
        if (available < data.totalQty) {
          toast.error(`Insufficient stock for ${data.productName} in source warehouse (Available: ${available}, Requested: ${data.totalQty})`);
          return;
        }
      }

      const createdIds: string[] = [];
      try {
        for (const item of validItems) {
          const newTransfer: Omit<Transfer, 'id'> = {
            sourceWarehouseId: sourceWhId,
            destinationWarehouseId: destWhId,
            productId: item.productId,
            quantity: Number(item.quantity),
            status: 'pending',
            initiatedBy: profile?.uid || 'Unknown',
            createdAt: serverTimestamp(),
          };
          const refDoc = await addDoc(collection(db, 'transfers'), newTransfer);
          if (refDoc?.id) createdIds.push(refDoc.id);
        }
      } catch (createErr) {
        for (const id of createdIds) {
          await deleteDoc(doc(db, 'transfers', id)).catch(() => {});
        }
        throw createErr;
      }

      setIsAddTransferOpen(false);
      setSourceWhId('');
      setDestWhId('');
      setTransferItems([{ id: crypto.randomUUID(), productId: '', quantity: 1 }]);
      toast.success('Warehouse transport requests initiated');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'transfers');
    } finally {
      actionLockRef.current = false;
      setIsProcessing(false);
    }
  };

  // 1. Dispatch Transfer (Eliminate Ghost Inventory by immediately deducting from origin warehouse)
  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTransfer || !dispatchingTransfer || actionLockRef.current) return;
    if (!canAccessWarehouse(dispatchingTransfer.sourceWarehouseId) || !canAccessWarehouse(dispatchingTransfer.destinationWarehouseId)) {
      toast.error('You do not have permission to dispatch this warehouse transfer.');
      return;
    }
    actionLockRef.current = true;
    setIsProcessing(true);

    const modifiedInventory: Array<{ id: string; prevQty: number }> = [];
    let createdAdjId: string | null = null;
    try {
      const liveTransferSnap = await getDoc(doc(db, 'transfers', dispatchingTransfer.id));
      if (!liveTransferSnap?.exists()) {
        toast.error('Transfer record could not be found.');
        setDispatchingTransfer(null);
        return;
      }
      const liveStatus = liveTransferSnap.data()?.status;
      if (liveStatus !== 'pending') {
        toast.error(`Transfer cannot be dispatched because live status is "${String(liveStatus || 'unknown').replace('_', ' ')}".`);
        setDispatchingTransfer(null);
        return;
      }

      const liveInvSnap = await getDocs(collection(db, 'inventory'));
      const matchingRows = liveInvSnap.docs
        .map((d: any) => ({ id: d.id, ...d.data() } as InventoryItem))
        .filter(i => i.productId === dispatchingTransfer.productId && i.warehouseId === dispatchingTransfer.sourceWarehouseId);

      const available = matchingRows.reduce((s, r) => s + Math.max(0, Number(r.quantity || 0)), 0);
      if (matchingRows.length === 0 || available < dispatchingTransfer.quantity) {
        toast.error(`Insufficient stock at source warehouse to dispatch transport. Available: ${available}`);
        return;
      }

      // 1. Immediately deduct from source warehouse (Eliminates Ghost Inventory!)
      let remaining = dispatchingTransfer.quantity;
      for (const row of matchingRows) {
        if (remaining <= 0) break;
        const curQty = Number(row.quantity || 0);
        if (curQty <= 0) continue;
        const take = Math.min(curQty, remaining);
        modifiedInventory.push({ id: row.id, prevQty: curQty });
        await updateDoc(doc(db, 'inventory', row.id), {
          quantity: curQty - take,
          lastUpdated: serverTimestamp(),
        });
        remaining -= take;
      }

      // 2. Audit log
      const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
        productId: dispatchingTransfer.productId,
        warehouseId: dispatchingTransfer.sourceWarehouseId,
        adjustmentAmount: -dispatchingTransfer.quantity,
        reason: `Transport TFR-${dispatchingTransfer.id.slice(-6)} dispatched (in_transit)`,
        recordedBy: profile?.uid || 'system',
        timestamp: serverTimestamp()
      });
      createdAdjId = adjRef?.id || null;

      // 3. Update transfer status
      try {
        await updateDoc(doc(db, 'transfers', dispatchingTransfer.id), {
          status: 'in_transit',
          driverName: driverName.trim() || undefined,
          vehiclePlate: vehiclePlate.trim().toUpperCase() || undefined,
          dispatchedAt: serverTimestamp(),
          dispatchedBy: profile?.uid,
          updatedAt: serverTimestamp()
        });
      } catch (colErr: any) {
        const isMissingCol = colErr?.code === 'PGRST204' || colErr?.code === '42703' || String(colErr?.message || '').toLowerCase().includes('column');
        if (!isMissingCol) throw colErr;
        console.warn('Supabase transfers schema missing columns; falling back to core status update:', colErr);
        await updateDoc(doc(db, 'transfers', dispatchingTransfer.id), {
          status: 'in_transit'
        });
      }

      toast.success(`Transport dispatched! ${dispatchingTransfer.quantity} unit(s) deducted from origin facility.`);
      setDispatchingTransfer(null);
      setDriverName('');
      setVehiclePlate('');
      if (selectedTransfer?.id === dispatchingTransfer.id) setSelectedTransfer(null);
    } catch (err) {
      for (const roll of [...modifiedInventory].reverse()) {
        await updateDoc(doc(db, 'inventory', roll.id), {
          quantity: roll.prevQty,
          lastUpdated: serverTimestamp(),
        }).catch(rbErr => console.error('Failed to rollback inventory quantity:', rbErr));
      }
      if (createdAdjId) {
        await deleteDoc(doc(db, 'stockAdjustments', createdAdjId)).catch(() => {});
      }
      handleSupabaseError(err, OperationType.UPDATE, `transfers/${dispatchingTransfer.id}`);
    } finally {
      actionLockRef.current = false;
      setIsProcessing(false);
    }
  };

  // 2. Confirm Arrival (Increment destination warehouse)
  const handleConfirmArrival = async (transfer: Transfer) => {
    if (!canManageTransfer || actionLockRef.current) return;
    if (!canAccessWarehouse(transfer.destinationWarehouseId)) {
      toast.error('You do not have permission to receive inventory at this warehouse.');
      return;
    }
    actionLockRef.current = true;
    setIsProcessing(true);

    let updatedDestRow: { id: string; prevQty: number } | null = null;
    let createdDestRowId: string | null = null;
    let createdAdjId: string | null = null;
    try {
      const liveTransferSnap = await getDoc(doc(db, 'transfers', transfer.id));
      if (!liveTransferSnap?.exists()) {
        toast.error('Transfer record could not be found.');
        return;
      }
      const liveStatus = liveTransferSnap.data()?.status;
      if (liveStatus !== 'in_transit') {
        toast.error(`Transfer cannot be confirmed because live status is "${String(liveStatus || 'unknown').replace('_', ' ')}".`);
        return;
      }

      const liveInvSnap = await getDocs(collection(db, 'inventory'));
      const destInv = liveInvSnap.docs
        .map((d: any) => ({ id: d.id, ...d.data() } as InventoryItem))
        .find(i => i.productId === transfer.productId && i.warehouseId === transfer.destinationWarehouseId);

      if (destInv) {
        const curQty = Number(destInv.quantity || 0);
        updatedDestRow = { id: destInv.id, prevQty: curQty };
        await updateDoc(doc(db, 'inventory', destInv.id), {
          quantity: curQty + transfer.quantity,
          lastUpdated: serverTimestamp()
        });
      } else {
        const createdRef = await addDoc(collection(db, 'inventory'), {
          productId: transfer.productId,
          warehouseId: transfer.destinationWarehouseId,
          quantity: transfer.quantity,
          lastUpdated: serverTimestamp()
        });
        createdDestRowId = createdRef?.id || null;
      }

      // Audit log
      const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
        productId: transfer.productId,
        warehouseId: transfer.destinationWarehouseId,
        adjustmentAmount: transfer.quantity,
        reason: `Transport TFR-${transfer.id.slice(-6)} received at destination facility`,
        recordedBy: profile?.uid || 'system',
        timestamp: serverTimestamp()
      });
      createdAdjId = adjRef?.id || null;

      // Update transfer status
      try {
        await updateDoc(doc(db, 'transfers', transfer.id), {
          status: 'received',
          receivedAt: serverTimestamp(),
          receivedBy: profile?.uid,
          updatedAt: serverTimestamp()
        });
      } catch (colErr: any) {
        const isMissingCol = colErr?.code === 'PGRST204' || colErr?.code === '42703' || String(colErr?.message || '').toLowerCase().includes('column');
        if (!isMissingCol) throw colErr;
        console.warn('Supabase transfers schema missing columns; falling back to core status update:', colErr);
        await updateDoc(doc(db, 'transfers', transfer.id), {
          status: 'received'
        });
      }

      toast.success(`Transport arrival confirmed! ${transfer.quantity} unit(s) added to destination facility.`);
      if (selectedTransfer?.id === transfer.id) setSelectedTransfer(null);
    } catch (err) {
      if (updatedDestRow) {
        await updateDoc(doc(db, 'inventory', updatedDestRow.id), {
          quantity: updatedDestRow.prevQty,
          lastUpdated: serverTimestamp(),
        }).catch(() => {});
      }
      if (createdDestRowId) {
        await deleteDoc(doc(db, 'inventory', createdDestRowId)).catch(() => {});
      }
      if (createdAdjId) {
        await deleteDoc(doc(db, 'stockAdjustments', createdAdjId)).catch(() => {});
      }
      handleSupabaseError(err, OperationType.UPDATE, `transfers/${transfer.id}`);
    } finally {
      actionLockRef.current = false;
      setIsProcessing(false);
    }
  };

  // 3. Cancel Transfer (Restore stock if in_transit)
  const handleCancelTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTransfer || !cancellingTransfer || actionLockRef.current) return;
    if (!canAccessWarehouse(cancellingTransfer.sourceWarehouseId) || !canAccessWarehouse(cancellingTransfer.destinationWarehouseId)) {
      toast.error('You do not have permission to cancel this warehouse transfer.');
      return;
    }
    actionLockRef.current = true;
    setIsProcessing(true);

    let updatedSourceRow: { id: string; prevQty: number } | null = null;
    let createdSourceRowId: string | null = null;
    let createdAdjId: string | null = null;
    try {
      const liveTransferSnap = await getDoc(doc(db, 'transfers', cancellingTransfer.id));
      if (!liveTransferSnap?.exists()) {
        toast.error('Transfer record could not be found.');
        setCancellingTransfer(null);
        return;
      }
      const liveStatus = liveTransferSnap.data()?.status;
      if (liveStatus !== 'pending' && liveStatus !== 'in_transit') {
        toast.error(`Transfer cannot be cancelled because live status is "${String(liveStatus).replace('_', ' ')}".`);
        setCancellingTransfer(null);
        return;
      }

      // If transfer was in_transit, stock was already deducted upon dispatch! We MUST restore it to source warehouse.
      if (liveStatus === 'in_transit') {
        const liveInvSnap = await getDocs(collection(db, 'inventory'));
        const sourceInv = liveInvSnap.docs
          .map((d: any) => ({ id: d.id, ...d.data() } as InventoryItem))
          .find(i => i.productId === cancellingTransfer.productId && i.warehouseId === cancellingTransfer.sourceWarehouseId);

        if (sourceInv) {
          const curQty = Number(sourceInv.quantity || 0);
          updatedSourceRow = { id: sourceInv.id, prevQty: curQty };
          await updateDoc(doc(db, 'inventory', sourceInv.id), {
            quantity: curQty + cancellingTransfer.quantity,
            lastUpdated: serverTimestamp()
          });
        } else {
          const createdRef = await addDoc(collection(db, 'inventory'), {
            productId: cancellingTransfer.productId,
            warehouseId: cancellingTransfer.sourceWarehouseId,
            quantity: cancellingTransfer.quantity,
            lastUpdated: serverTimestamp()
          });
          createdSourceRowId = createdRef?.id || null;
        }

        const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
          productId: cancellingTransfer.productId,
          warehouseId: cancellingTransfer.sourceWarehouseId,
          adjustmentAmount: cancellingTransfer.quantity,
          reason: `Transport TFR-${cancellingTransfer.id.slice(-6)} cancelled: stock restored to origin facility`,
          recordedBy: profile?.uid || 'system',
          timestamp: serverTimestamp()
        });
        createdAdjId = adjRef?.id || null;
      }

      // Update transfer record (persist core status cleanly only if extended columns fail)
      try {
        await updateDoc(doc(db, 'transfers', cancellingTransfer.id), {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          cancelledBy: profile?.uid,
          cancellationReason: cancellationReason.trim() || 'Cancelled by operator',
          updatedAt: serverTimestamp()
        });
      } catch (colErr: any) {
        const isMissingCol = colErr?.code === 'PGRST204' || colErr?.code === '42703' || String(colErr?.message || '').toLowerCase().includes('column');
        if (!isMissingCol) throw colErr;
        console.warn('Supabase transfers schema missing columns; falling back to core status update:', colErr);
        await updateDoc(doc(db, 'transfers', cancellingTransfer.id), {
          status: 'cancelled',
        });
      }

      const sourceWhName = warehouses.find(w => w.id === cancellingTransfer.sourceWarehouseId)?.name || 'origin warehouse';
      toast.success(
        liveStatus === 'in_transit'
          ? `Transport cancelled. ${cancellingTransfer.quantity} unit(s) restored to ${sourceWhName}.`
          : 'Transport request cancelled.'
      );

      setCancellingTransfer(null);
      setCancellationReason('');
      if (selectedTransfer?.id === cancellingTransfer.id) setSelectedTransfer(null);
    } catch (err) {
      if (updatedSourceRow) {
        await updateDoc(doc(db, 'inventory', updatedSourceRow.id), {
          quantity: updatedSourceRow.prevQty,
          lastUpdated: serverTimestamp(),
        }).catch(() => {});
      }
      if (createdSourceRowId) {
        await deleteDoc(doc(db, 'inventory', createdSourceRowId)).catch(() => {});
      }
      if (createdAdjId) {
        await deleteDoc(doc(db, 'stockAdjustments', createdAdjId)).catch(() => {});
      }
      handleSupabaseError(err, OperationType.UPDATE, `transfers/${cancellingTransfer.id}`);
    } finally {
      actionLockRef.current = false;
      setIsProcessing(false);
    }
  };

  // Filter transfers
  const scopedTransfers = transfers.filter(
    t => hasAllWarehouseAccess || canAccessWarehouse(t.sourceWarehouseId) || canAccessWarehouse(t.destinationWarehouseId)
  );
  const filteredTransfers = scopedTransfers.filter(t => {
    const product = products.find(p => p.id === t.productId);

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const idMatch = `tfr-${t.id.slice(-6)}`.toLowerCase().includes(term) || t.id.toLowerCase().includes(term);
      const prodMatch = (product?.name || '').toLowerCase().includes(term) || (product?.sku || '').toLowerCase().includes(term);
      const driverMatch = (t.driverName || '').toLowerCase().includes(term);
      const plateMatch = (t.vehiclePlate || '').toLowerCase().includes(term);
      if (!idMatch && !prodMatch && !driverMatch && !plateMatch) return false;
    }

    // Warehouse filter
    if (warehouseFilter !== 'all') {
      const selectedWh = warehouses.find(w => w.id === warehouseFilter || w.name === warehouseFilter);
      const matchId = t.sourceWarehouseId === warehouseFilter || t.destinationWarehouseId === warehouseFilter;
      const matchName = selectedWh && (
        (t as any).sourceWarehouseName === selectedWh.name ||
        (t as any).destinationWarehouseName === selectedWh.name ||
        t.sourceWarehouseId === selectedWh.name ||
        t.destinationWarehouseId === selectedWh.name
      );
      if (!matchId && !matchName) {
        return false;
      }
    }

    // Status filter
    if (statusFilter !== 'all') {
      if (t.status !== statusFilter) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="flex flex-col">

          <p className="text-xs text-muted-foreground font-medium tracking-tight">Managing stock movement between facilities</p>
        </div>
        <Dialog open={isAddTransferOpen} onOpenChange={(open) => {
          setIsAddTransferOpen(open);
          if (!open) {
            setSourceWhId('');
            setDestWhId('');
            setTransferItems([{ id: crypto.randomUUID(), productId: '', quantity: 1 }]);
          }
        }}>
          {!historyOnly && canManageTransfer && (
            <DialogTrigger className="h-9 gap-2 px-4 bg-primary text-primary-foreground rounded-lg inline-flex items-center justify-center font-medium transition-all hover:bg-primary/90">
              <ArrowRightLeft className="w-4 h-4" /> New Transport Request
            </DialogTrigger>
          )}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Initiate Stock Movement</DialogTitle>
              <DialogDescription>Request a transport of inventory items between warehouse locations.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInitiateTransfer} className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="transfer-source-wh">Source Facility</Label>
                  <Select value={sourceWhId} onValueChange={(v) => setSourceWhId(v || '')} required>
                    <SelectTrigger id="transfer-source-wh">
                      <SelectValue placeholder="Origin...">
                        {scopedWarehouses.find(w => w.id === sourceWhId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {scopedWarehouses.map(wh => (
                        <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transfer-dest-wh">Destination</Label>
                  <Select value={destWhId} onValueChange={(v) => setDestWhId(v || '')} required>
                    <SelectTrigger id="transfer-dest-wh">
                      <SelectValue placeholder="Destination...">
                        {scopedWarehouses.find(w => w.id === destWhId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {scopedWarehouses.map(wh => (
                        <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-4">
                <Label>Configuration Items (Products)</Label>
                {transferItems.map((item, index) => (
                  <div key={item.id} className="flex gap-2 items-end">
                    <div className="flex-1 space-y-2">
                      <Select
                        value={item.productId}
                        onValueChange={(val) => {
                          if (val === null) return;
                          setTransferItems(prev => prev.map((entry, idx) => idx === index ? { ...entry, productId: val } : entry));
                        }}
                        required
                      >
                        <SelectTrigger aria-label={`Product ${index + 1}`} className="w-full">
                          <SelectValue placeholder="Select product...">
                            {(() => {
                              const p = orderableProducts.find(pr => pr.id === item.productId);
                              return p ? `${p.name} (${p.sku})` : undefined;
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {orderableProducts.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24 space-y-2">
                      <Label htmlFor={`transfer-qty-${item.id}`} className={index > 0 ? "sr-only" : ""}>Qty</Label>
                      <Input
                        id={`transfer-qty-${item.id}`}
                        type="number"
                        required
                        min="1"
                        value={item.quantity === 0 ? '' : item.quantity}
                        onChange={(e) => {
                          const val = e.target.value.replace(/^0+(?=\d)/, '');
                          const nextQty = val === '' ? 0 : Number(val);
                          setTransferItems(prev => prev.map((entry, idx) => idx === index ? { ...entry, quantity: nextQty } : entry));
                        }}
                        onBlur={(e) => {
                          const cleaned = Math.max(1, parseInt(e.target.value, 10) || 1);
                          setTransferItems(prev => prev.map((entry, idx) => idx === index ? { ...entry, quantity: cleaned } : entry));
                        }}
                      />
                    </div>
                    {transferItems.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove item ${index + 1}`}
                        className={`text-red-500 hover:bg-red-500/10 hover:text-red-600 shrink-0 ${index === 0 ? 'mb-0.5' : ''}`}
                        onClick={() => setTransferItems(transferItems.filter((_, i) => i !== index))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs border-dashed"
                  onClick={() => setTransferItems([...transferItems, { id: crypto.randomUUID(), productId: '', quantity: 1 }])}
                >
                  <Plus className="w-4 h-4 mr-2" /> Add Another Item
                </Button>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isProcessing} className="w-full">
                  {isProcessing ? 'Submitting...' : 'Confirm & Queue Movement'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search & Filter Controls (Canva Page 34 Item 2) */}
      <Card className="border-border bg-card/60 backdrop-blur-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative flex-1">
              <SearchBar
                placeholder="Search by Movement ID, Product, Driver, Plate..."
                value={searchTerm}
                onValueChange={setSearchTerm}
                className="pl-9 h-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Facility Filter */}
              <Select value={warehouseFilter} onValueChange={(val) => { if (val !== null) setWarehouseFilter(val); }}>
                <SelectTrigger className="h-9 w-full sm:w-45 text-xs">
                  <SelectValue placeholder="All Facilities">
                    {warehouseFilter === 'all'
                      ? 'All Facilities'
                      : (warehouses.find(wh => wh.id === warehouseFilter)?.name || warehouseFilter)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Facilities</SelectItem>
                  {scopedWarehouses.map(wh => (
                    <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={(val) => { if (val !== null) setStatusFilter(val); }}>
                <SelectTrigger className="h-9 w-full sm:w-37.5 text-xs">
                  <SelectValue placeholder="All Statuses">
                    {statusFilter === 'all'
                      ? 'All Statuses'
                      : statusFilter === 'pending'
                        ? 'Pending'
                        : statusFilter === 'in_transit'
                          ? 'In Transit'
                          : statusFilter === 'received'
                            ? 'Received'
                            : statusFilter === 'cancelled'
                              ? 'Cancelled'
                              : statusFilter}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>

              {(searchTerm || warehouseFilter !== 'all' || statusFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm('');
                    setWarehouseFilter('all');
                    setStatusFilter('all');
                  }}
                  className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          <div className="mt-2 text-[11px] text-muted-foreground font-medium flex items-center justify-between">
            <span>Showing {filteredTransfers.length} of {scopedTransfers.length} movements</span>
          </div>
        </CardContent>
      </Card>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {filteredTransfers.map((t) => {
          const product = products.find(p => p.id === t.productId);
          const source = warehouses.find(w => w.id === t.sourceWarehouseId);
          const dest = warehouses.find(w => w.id === t.destinationWarehouseId);
          return (
            <div
              key={t.id}
              className="bg-card border border-border rounded-xl p-4 space-y-3 hover:border-blue-500/50 transition-colors"
            >
              <button
                type="button"
                onClick={() => setSelectedTransfer(t)}
                className="w-full text-left space-y-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`View transport details for ${product?.name || 'Unknown'} TFR-${t.id.slice(-6)}`}
              >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black text-foreground">{product?.name || 'Unknown'}</p>
                  <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-tighter">
                    TFR-{t.id.slice(-6)}
                  </p>
                </div>
                <Badge variant="outline" className={`shrink-0 gap-1.5 h-6 capitalize text-[10px] font-black ${t.status === 'received' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
                    t.status === 'in_transit' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                      t.status === 'cancelled' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                        'bg-amber-500/10 text-amber-500 border-amber-500/30'
                  }`}>
                  {t.status === 'pending' && <Clock className="w-3 h-3" />}
                  {t.status === 'in_transit' && <Truck className="w-3 h-3" />}
                  {t.status === 'received' && <CheckCircle2 className="w-3 h-3" />}
                  {t.status === 'cancelled' && <XCircle className="w-3 h-3" />}
                  {t.status.replace('_', ' ')}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-[10px] font-bold text-foreground">
                <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{source?.name}</span>
                <ArrowRightLeft className="w-3 h-3 text-muted-foreground/40" />
                <span className="bg-[#1A2332] text-white px-1.5 py-0.5 rounded">{dest?.name}</span>
                <span className="ml-auto text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Qty: {t.quantity}</span>
              </div>

              {(t.driverName || t.vehiclePlate) && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-2 bg-muted/40 px-2 py-1 rounded">
                  <Truck className="w-3 h-3 text-blue-500 shrink-0" />
                  <span className="truncate">{t.driverName || 'Assigned Driver'} {t.vehiclePlate && `(${t.vehiclePlate})`}</span>
                </div>
              )}
              </button>

              {canManageTransfer && (
                <div className="flex justify-end gap-2 pt-1">
                  {t.status === 'pending' && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isProcessing}
                        className="text-xs font-bold h-8 text-red-500 hover:bg-red-500/10 hover:text-red-600 z-10 relative"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancellingTransfer(t);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isProcessing}
                        className="text-xs font-bold h-8 text-blue-600 hover:bg-blue-500/10 z-10 relative"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDispatchingTransfer(t);
                        }}
                      >
                        Dispatch
                      </Button>
                    </>
                  )}
                  {t.status === 'in_transit' && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isProcessing}
                        className="text-xs font-bold h-8 text-red-500 hover:bg-red-500/10 hover:text-red-600 z-10 relative"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancellingTransfer(t);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isProcessing}
                        className="text-xs font-bold h-8 text-emerald-500 hover:bg-emerald-500/10 z-10 relative"
                        onClick={(e) => {
                          e.stopPropagation();
                          setArrivalConfirmTarget(t);
                        }}
                      >
                        Confirm Arrival
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filteredTransfers.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <History className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-xs font-medium text-muted-foreground">No matching movements found</p>
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto w-full">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-30">Movement ID</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-42.5">Asset Details</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-50">Traffic Flow</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-37.5">Dispatch Proof</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-35">Operational Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-center min-w-45">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransfers.map((t) => {
                const product = products.find(p => p.id === t.productId);
                const source = warehouses.find(w => w.id === t.sourceWarehouseId);
                const dest = warehouses.find(w => w.id === t.destinationWarehouseId);
                return (
                  <TableRow
                    key={t.id}
                    tabIndex={0}
                    className="group cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => setSelectedTransfer(t)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedTransfer(t);
                      }
                    }}
                  >
                    <TableCell className="font-mono text-[10px] text-zinc-400 font-bold uppercase tracking-tighter">
                      TFR-{t.id.slice(-6)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-foreground">{product?.name || 'Unknown'}</span>
                        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Qty: {t.quantity}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-[10px] font-bold text-foreground">
                        <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{source?.name}</span>
                        <ArrowRightLeft className="w-3 h-3 text-muted-foreground/40" />
                        <span className="bg-[#1A2332] text-white px-1.5 py-0.5 rounded">{dest?.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {t.driverName || t.vehiclePlate ? (
                        <div className="flex flex-col text-[11px]">
                          <span className="font-medium text-foreground truncate max-w-35">{t.driverName || 'Driver'}</span>
                          {t.vehiclePlate && <span className="font-mono text-[10px] text-muted-foreground">{t.vehiclePlate}</span>}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60 italic">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1.5 h-6 capitalize text-[10px] font-black ${t.status === 'received' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
                          t.status === 'in_transit' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                            t.status === 'cancelled' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                              'bg-amber-500/10 text-amber-500 border-amber-500/30'
                        }`}>
                        {t.status === 'pending' && <Clock className="w-3 h-3" />}
                        {t.status === 'in_transit' && <Truck className="w-3 h-3" />}
                        {t.status === 'received' && <CheckCircle2 className="w-3 h-3" />}
                        {t.status === 'cancelled' && <XCircle className="w-3 h-3" />}
                        {t.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {canManageTransfer && (
                        <div className="flex items-center justify-center gap-1">
                          {t.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isProcessing}
                                className="text-xs font-bold h-8 text-red-500 hover:bg-red-500/10 hover:text-red-600 relative z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancellingTransfer(t);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isProcessing}
                                className="text-xs font-bold h-8 text-blue-600 hover:bg-blue-500/10 relative z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDispatchingTransfer(t);
                                }}
                              >
                                Dispatch
                              </Button>
                            </>
                          )}
                          {t.status === 'in_transit' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isProcessing}
                                className="text-xs font-bold h-8 text-red-500 hover:bg-red-500/10 hover:text-red-600 relative z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancellingTransfer(t);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isProcessing}
                                className="text-xs font-bold h-8 text-emerald-500 hover:bg-emerald-500/10 relative z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setArrivalConfirmTarget(t);
                                }}
                              >
                                Confirm Arrival
                              </Button>
                            </>
                          )}
                          {t.status === 'received' && (
                            <span className="text-[11px] font-semibold text-emerald-600/80">Arrived</span>
                          )}
                          {t.status === 'cancelled' && (
                            <span className="text-[11px] font-semibold text-red-500/80">Cancelled</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredTransfers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <History className="w-8 h-8 text-muted-foreground/30" />
                      <p className="text-xs font-medium text-muted-foreground">No matching transports found</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Dispatch Modal: Driver Assignment & Vehicle Plate Proof (Canva Page 34 Item 3) */}
      <Dialog open={dispatchingTransfer !== null} onOpenChange={(open) => {
        if (!open && !isProcessing) {
          setDispatchingTransfer(null);
          setDriverName('');
          setVehiclePlate('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <Truck className="h-5 w-5" />
              Dispatch Transport
            </DialogTitle>
            <DialogDescription>
              Assign logistics driver and confirm dispatch for movement <span className="font-mono font-bold text-foreground">TFR-{dispatchingTransfer?.id.slice(-6)}</span>.
            </DialogDescription>
          </DialogHeader>

          {dispatchingTransfer && (
            <form onSubmit={handleDispatch} className="space-y-4 pt-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-1 dark:border-blue-900/50 dark:bg-blue-950/20 text-xs">
                <div className="flex items-center justify-between font-bold text-blue-900 dark:text-blue-200">
                  <span>{products.find(p => p.id === dispatchingTransfer.productId)?.name || 'Product'}</span>
                  <span>Qty: {dispatchingTransfer.quantity}</span>
                </div>
                <p className="text-blue-700 dark:text-blue-300 text-[11px]">
                  Origin: <span className="font-semibold">{warehouses.find(w => w.id === dispatchingTransfer.sourceWarehouseId)?.name}</span> → Destination: <span className="font-semibold">{warehouses.find(w => w.id === dispatchingTransfer.destinationWarehouseId)?.name}</span>
                </p>
                <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-900/40 flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span>{dispatchingTransfer.quantity} unit(s) will immediately be deducted from source warehouse stock.</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-driver-name" className="text-xs">Driver Name (Optional)</Label>
                  <Input
                    id="transfer-driver-name"
                    placeholder="e.g. Juan Dela Cruz"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-vehicle-plate" className="text-xs">Vehicle Plate Number (Optional)</Label>
                  <Input
                    id="transfer-vehicle-plate"
                    placeholder="e.g. ABC-1234"
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value)}
                    className="h-9 text-xs uppercase"
                  />
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setDispatchingTransfer(null); setDriverName(''); setVehiclePlate(''); }}
                  disabled={isProcessing}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isProcessing}
                  className="bg-blue-600 hover:bg-blue-700 gap-2"
                >
                  <Truck className="w-4 h-4" />
                  {isProcessing ? 'Dispatching...' : 'Dispatch & Deduct Stock'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancellation Confirmation Dialog (Canva Page 34 Item 1) */}
      <Dialog open={cancellingTransfer !== null} onOpenChange={(open) => {
        if (!open && !isProcessing) {
          setCancellingTransfer(null);
          setCancellationReason('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Cancel Transport Movement
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel movement <span className="font-mono font-bold text-foreground">TFR-{cancellingTransfer?.id.slice(-6)}</span>?
            </DialogDescription>
          </DialogHeader>

          {cancellingTransfer && (
            <form onSubmit={handleCancelTransfer} className="space-y-4 pt-2">
              {cancellingTransfer.status === 'in_transit' ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-1.5 dark:border-amber-900/50 dark:bg-amber-950/20 text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>In-Transit Stock Restoration</span>
                  </div>
                  <p className="text-amber-800 dark:text-amber-300 leading-relaxed text-[11px]">
                    This shipment was already dispatched. Cancelling it will immediately <span className="font-bold underline">restore {cancellingTransfer.quantity} unit(s)</span> back to <span className="font-bold">{warehouses.find(w => w.id === cancellingTransfer.sourceWarehouseId)?.name || 'origin warehouse'}</span> inventory.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
                  This transport request has not been dispatched yet. Cancelling will close the request with zero stock adjustments.
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="transfer-cancel-reason" className="text-xs">Cancellation Reason (Optional)</Label>
                <Input
                  id="transfer-cancel-reason"
                  placeholder="e.g. Truck breakdown, cancelled by manager, wrong destination"
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setCancellingTransfer(null); setCancellationReason(''); }}
                  disabled={isProcessing}
                >
                  Keep Transport
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isProcessing}
                  className="gap-2"
                >
                  <Ban className="w-4 h-4" />
                  {isProcessing ? 'Cancelling...' : cancellingTransfer.status === 'in_transit' ? `Restore ${cancellingTransfer.quantity} & Cancel` : 'Confirm Cancellation'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Transport Details Modal */}
      <Dialog
        open={!!selectedTransfer}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTransfer(null);
            lastAppliedTransferParamRef.current = null;
            if (searchParams.has('transferId')) {
              const next = new URLSearchParams(searchParams);
              next.delete('transferId');
              setSearchParams(next, { replace: true });
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Transport Details</DialogTitle>
            <DialogDescription>
              Movement ID: TFR-{selectedTransfer?.id.slice(-6)}
            </DialogDescription>
          </DialogHeader>
          {selectedTransfer && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3 text-sm bg-muted/30 p-3 rounded-xl border border-border/60">
                <div>
                  <span className="text-muted-foreground block text-xs font-medium">Product</span>
                  <span className="font-bold text-foreground">{products.find(p => p.id === selectedTransfer.productId)?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs font-medium">Quantity</span>
                  <span className="font-bold text-foreground">{selectedTransfer.quantity} units</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs font-medium">Source Facility</span>
                  <span className="font-bold text-foreground">{warehouses.find(w => w.id === selectedTransfer.sourceWarehouseId)?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs font-medium">Destination Facility</span>
                  <span className="font-bold text-foreground">{warehouses.find(w => w.id === selectedTransfer.destinationWarehouseId)?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs font-medium">Operational Status</span>
                  <Badge variant="outline" className={`mt-1 capitalize text-[10px] font-black ${selectedTransfer.status === 'received' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
                      selectedTransfer.status === 'in_transit' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                        selectedTransfer.status === 'cancelled' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                          'bg-amber-500/10 text-amber-500 border-amber-500/30'
                    }`}>
                    {selectedTransfer.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs font-medium">Initiated By</span>
                  <span className="font-bold truncate max-w-full block text-foreground" title={selectedTransfer.initiatedBy}>{selectedTransfer.initiatedBy || 'Unknown'}</span>
                </div>
              </div>

              {(selectedTransfer.driverName || selectedTransfer.vehiclePlate) && (
                <div className="bg-blue-50/50 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-200/60 dark:border-blue-900/40 text-xs space-y-1">
                  <p className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-blue-600" /> Logistics Assignment
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-blue-800 dark:text-blue-300">
                    <div>Driver: <span className="font-semibold">{selectedTransfer.driverName || 'N/A'}</span></div>
                    <div>Plate: <span className="font-semibold">{selectedTransfer.vehiclePlate || 'N/A'}</span></div>
                  </div>
                </div>
              )}

              {selectedTransfer.status === 'cancelled' && (
                <div className="bg-red-50/50 dark:bg-red-950/20 p-3 rounded-xl border border-red-200/60 dark:border-red-900/40 text-xs space-y-1">
                  <p className="font-bold text-red-900 dark:text-red-200 flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 text-red-600" /> Cancellation Details
                  </p>
                  <p className="text-[11px] text-red-800 dark:text-red-300">
                    Reason: <span className="font-semibold">{selectedTransfer.cancellationReason || 'Cancelled by operator'}</span>
                  </p>
                </div>
              )}

              {canManageTransfer && (selectedTransfer.status === 'pending' || selectedTransfer.status === 'in_transit') && (
                <div className="flex justify-between items-center gap-2 pt-4 border-t border-border mt-4">
                  <Button
                    variant="outline"
                    disabled={isProcessing}
                    className="text-red-500 hover:bg-red-500/10 hover:text-red-600 gap-1.5 text-xs"
                    onClick={() => {
                      const t = selectedTransfer;
                      setSelectedTransfer(null);
                      setCancellingTransfer(t);
                    }}
                  >
                    <Ban className="w-4 h-4" /> Cancel Transport
                  </Button>

                  <div className="flex gap-2">
                    {selectedTransfer.status === 'pending' && (
                      <Button
                        disabled={isProcessing}
                        className="bg-blue-600 hover:bg-blue-700 text-xs gap-1.5"
                        onClick={() => {
                          const t = selectedTransfer;
                          setSelectedTransfer(null);
                          setDispatchingTransfer(t);
                        }}
                      >
                        <Truck className="w-4 h-4" /> Dispatch Transport
                      </Button>
                    )}
                    {selectedTransfer.status === 'in_transit' && (
                      <Button
                        disabled={isProcessing}
                        onClick={() => setArrivalConfirmTarget(selectedTransfer)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" /> {isProcessing ? 'Confirming...' : 'Confirm Arrival'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={arrivalConfirmTarget !== null}
        title="Confirm transport arrival"
        description={
          arrivalConfirmTarget
            ? `Confirm that ${arrivalConfirmTarget.quantity} unit(s) arrived at ${warehouses.find(w => w.id === arrivalConfirmTarget.destinationWarehouseId)?.name || 'destination warehouse'}?`
            : ''
        }
        confirmLabel="Confirm Arrival"
        onOpenChange={(open) => { if (!open && !isProcessing) setArrivalConfirmTarget(null); }}
        onConfirm={async () => {
          if (arrivalConfirmTarget) await handleConfirmArrival(arrivalConfirmTarget);
        }}
      />
    </div>
  );
}
