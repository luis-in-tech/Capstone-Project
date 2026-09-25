import { hasAdminRole } from '../lib/staffPermissions';
import React, { useState, useEffect } from 'react';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { permitsMovement } from '../lib/staffPermissions';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, serverTimestamp } from '../lib/supabaseAdapter';
import { Transfer, Product, Warehouse, InventoryItem, TransferStatus } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Truck, ArrowRightLeft, Clock, CheckCircle2, History, Plus, X, Search, AlertTriangle, XCircle, Ban, SlidersHorizontal, User, ShieldAlert, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

export function Transfers({ historyOnly = false }: { historyOnly?: boolean }) {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isAddTransferOpen, setIsAddTransferOpen] = useState(false);
  const [transferItems, setTransferItems] = useState([{ id: Date.now(), productName: '', quantity: 1 }]);
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

  // Action Loading State
  const [isProcessing, setIsProcessing] = useState(false);

  const canManageTransfer = permitsMovement(permissions.movementCreate, 'internal') && permissions.inventory === 'adjust' && (hasAdminRole(profile) || profile?.role === 'secretary' || profile?.role === 'staff');

  useEffect(() => {
    const unsubTransfers = onSnapshot(query(collection(db, 'transfers'), orderBy('createdAt', 'desc')), (snap) => {
      setTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transfer)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'transfers');
    });
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'products');
    });
    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snap) => {
      setWarehouses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Warehouse)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'warehouses');
    });
    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snap) => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'inventory');
    });
    return () => {
      unsubTransfers();
      unsubProducts();
      unsubWarehouses();
      unsubInventory();
    };
  }, []);

  const handleInitiateTransfer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const sourceWhName = formData.get('sourceWh') as string;
    const destWhName = formData.get('destWh') as string;

    const sourceWh = warehouses.find(w => w.name === sourceWhName)?.id || sourceWhName;
    const destWh = warehouses.find(w => w.name === destWhName)?.id || destWhName;

    if (sourceWh === destWh) {
      toast.error('Source and destination warehouses must be different');
      return;
    }

    const validItems = transferItems.filter(item => item.productName);
    if (validItems.length === 0) {
      toast.error('Please select at least one product to transfer');
      return;
    }

    // Check availability in source facility
    for (const item of validItems) {
      const prodId = products.find(p => p.name === item.productName)?.id || item.productName;
      const sourceInv = inventory.find(i => i.productId === prodId && i.warehouseId === sourceWh);
      if (!sourceInv || sourceInv.quantity < item.quantity) {
        toast.error(`Insufficient stock for ${item.productName} in source warehouse (Available: ${sourceInv?.quantity ?? 0})`);
        return;
      }
    }

    try {
      for (const item of validItems) {
        const prodId = products.find(p => p.name === item.productName)?.id || item.productName;
        const newTransfer: Omit<Transfer, 'id'> = {
          sourceWarehouseId: sourceWh,
          destinationWarehouseId: destWh,
          productId: prodId,
          quantity: item.quantity,
          status: 'pending',
          initiatedBy: profile?.uid || 'Unknown',
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'transfers'), newTransfer);
      }
      setIsAddTransferOpen(false);
      setTransferItems([{ id: Date.now(), productName: '', quantity: 1 }]);
      toast.success('Warehouse transport requests initiated');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'transfers');
    }
  };

  // 1. Dispatch Transfer (Eliminate Ghost Inventory by immediately deducting from origin warehouse)
  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchingTransfer) return;
    setIsProcessing(true);

    try {
      const sourceInv = inventory.find(
        i => i.productId === dispatchingTransfer.productId && i.warehouseId === dispatchingTransfer.sourceWarehouseId
      );

      if (!sourceInv || sourceInv.quantity < dispatchingTransfer.quantity) {
        toast.error(`Insufficient stock at source warehouse to dispatch transport. Available: ${sourceInv?.quantity ?? 0}`);
        setIsProcessing(false);
        return;
      }

      // 1. Immediately deduct from source warehouse (Eliminates Ghost Inventory!)
      await updateDoc(doc(db, 'inventory', sourceInv.id), {
        quantity: sourceInv.quantity - dispatchingTransfer.quantity,
        lastUpdated: serverTimestamp()
      });

      // 2. Audit log
      try {
        await addDoc(collection(db, 'stockAdjustments'), {
          productId: dispatchingTransfer.productId,
          warehouseId: dispatchingTransfer.sourceWarehouseId,
          adjustmentAmount: -dispatchingTransfer.quantity,
          reason: `Transport TFR-${dispatchingTransfer.id.slice(-6)} dispatched (in_transit)`,
          recordedBy: profile?.uid || 'system',
          timestamp: serverTimestamp()
        });
      } catch (logErr) {
        console.warn('Stock adjustment audit log write failed:', logErr);
      }

      // 3. Update transfer status (with graceful schema fallback if columns are unmigrated in Supabase)
      try {
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
          console.warn('Supabase transfers schema missing columns (PGRST204). Falling back to core status update:', colErr);
          await updateDoc(doc(db, 'transfers', dispatchingTransfer.id), {
            status: 'in_transit'
          });
        }
      } catch (transferErr) {
        // Rollback stock deduction on catastrophic transfer update failure
        await updateDoc(doc(db, 'inventory', sourceInv.id), {
          quantity: sourceInv.quantity,
          lastUpdated: serverTimestamp()
        }).catch(rbErr => console.error('Failed to rollback inventory quantity:', rbErr));
        throw transferErr;
      }

      toast.success(`Transport dispatched! ${dispatchingTransfer.quantity} unit(s) deducted from origin facility.`);
      setDispatchingTransfer(null);
      setDriverName('');
      setVehiclePlate('');
      if (selectedTransfer?.id === dispatchingTransfer.id) setSelectedTransfer(null);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `transfers/${dispatchingTransfer.id}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Confirm Arrival (Increment destination warehouse)
  const handleConfirmArrival = async (transfer: Transfer) => {
    setIsProcessing(true);
    try {
      const destInv = inventory.find(
        i => i.productId === transfer.productId && i.warehouseId === transfer.destinationWarehouseId
      );

      if (destInv) {
        await updateDoc(doc(db, 'inventory', destInv.id), {
          quantity: destInv.quantity + transfer.quantity,
          lastUpdated: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'inventory'), {
          productId: transfer.productId,
          warehouseId: transfer.destinationWarehouseId,
          quantity: transfer.quantity,
          lastUpdated: serverTimestamp()
        });
      }

      // Audit log
      try {
        await addDoc(collection(db, 'stockAdjustments'), {
          productId: transfer.productId,
          warehouseId: transfer.destinationWarehouseId,
          adjustmentAmount: transfer.quantity,
          reason: `Transport TFR-${transfer.id.slice(-6)} received at destination facility`,
          recordedBy: profile?.uid || 'system',
          timestamp: serverTimestamp()
        });
      } catch (logErr) {
        console.warn('Stock adjustment audit log write failed:', logErr);
      }

      // Update transfer status (with graceful schema fallback if columns are unmigrated in Supabase)
      try {
        await updateDoc(doc(db, 'transfers', transfer.id), {
          status: 'received',
          receivedAt: serverTimestamp(),
          receivedBy: profile?.uid,
          updatedAt: serverTimestamp()
        });
      } catch (colErr: any) {
        console.warn('Supabase transfers schema missing columns (PGRST204). Falling back to core status update:', colErr);
        await updateDoc(doc(db, 'transfers', transfer.id), {
          status: 'received'
        });
      }

      toast.success(`Transport arrival confirmed! ${transfer.quantity} unit(s) added to destination facility.`);
      if (selectedTransfer?.id === transfer.id) setSelectedTransfer(null);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `transfers/${transfer.id}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Cancel Transfer (Restore stock if in_transit)
  const handleCancelTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingTransfer) return;
    setIsProcessing(true);

    try {
      // If transfer was in_transit, stock was already deducted upon dispatch! We MUST restore it to source warehouse.
      if (cancellingTransfer.status === 'in_transit') {
        const sourceInv = inventory.find(
          i => i.productId === cancellingTransfer.productId && i.warehouseId === cancellingTransfer.sourceWarehouseId
        );

        if (sourceInv) {
          await updateDoc(doc(db, 'inventory', sourceInv.id), {
            quantity: sourceInv.quantity + cancellingTransfer.quantity,
            lastUpdated: serverTimestamp()
          });
        } else {
          await addDoc(collection(db, 'inventory'), {
            productId: cancellingTransfer.productId,
            warehouseId: cancellingTransfer.sourceWarehouseId,
            quantity: cancellingTransfer.quantity,
            lastUpdated: serverTimestamp()
          });
        }

        try {
          await addDoc(collection(db, 'stockAdjustments'), {
            productId: cancellingTransfer.productId,
            warehouseId: cancellingTransfer.sourceWarehouseId,
            adjustmentAmount: cancellingTransfer.quantity,
            reason: `Transport TFR-${cancellingTransfer.id.slice(-6)} cancelled: stock restored to origin facility`,
            recordedBy: profile?.uid || 'system',
            timestamp: serverTimestamp()
          });
        } catch (logErr) {
          console.warn('Stock adjustment audit log write failed:', logErr);
        }
      }

      // Update transfer record (with graceful schema fallback if columns are unmigrated in Supabase)
      try {
        await updateDoc(doc(db, 'transfers', cancellingTransfer.id), {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          cancelledBy: profile?.uid,
          cancellationReason: cancellationReason.trim() || 'Cancelled by operator',
          updatedAt: serverTimestamp()
        });
      } catch (colErr: any) {
        console.warn('Supabase transfers schema constraint or missing columns. Updating local state:', colErr);
        setTransfers(prev => prev.map(t => t.id === cancellingTransfer.id ? { ...t, status: 'cancelled' as any, cancellationReason } : t));
      }

      const sourceWhName = warehouses.find(w => w.id === cancellingTransfer.sourceWarehouseId)?.name || 'origin warehouse';
      toast.success(
        cancellingTransfer.status === 'in_transit'
          ? `Transport cancelled. ${cancellingTransfer.quantity} unit(s) restored to ${sourceWhName}.`
          : 'Transport request cancelled.'
      );

      setCancellingTransfer(null);
      setCancellationReason('');
      if (selectedTransfer?.id === cancellingTransfer.id) setSelectedTransfer(null);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `transfers/${cancellingTransfer.id}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Filter transfers
  const filteredTransfers = transfers.filter(t => {
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
      if (t.sourceWarehouseId !== warehouseFilter && t.destinationWarehouseId !== warehouseFilter) {
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
          if (!open) setTransferItems([{ id: Date.now(), productName: '', quantity: 1 }]);
        }}>
          <DialogTrigger hidden={historyOnly} className={historyOnly ? 'hidden' : "h-9 gap-2 px-4 bg-[#1A2332] text-white rounded-lg inline-flex items-center justify-center font-medium transition-all hover:bg-[#1A2332]/90"}>
            <ArrowRightLeft className="w-4 h-4" /> New Transport Request
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Initiate Stock Movement</DialogTitle>
              <DialogDescription>Request a transport of inventory items between warehouse locations.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInitiateTransfer} className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source Facility</Label>
                  <Select name="sourceWh" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Origin..." />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map(wh => (
                        <SelectItem key={wh.id} value={wh.name}>{wh.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Destination</Label>
                  <Select name="destWh" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Destination..." />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map(wh => (
                        <SelectItem key={wh.id} value={wh.name}>{wh.name}</SelectItem>
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
                        value={item.productName}
                        onValueChange={(val) => {
                          const newItems = [...transferItems];
                          newItems[index].productName = val;
                          setTransferItems(newItems);
                        }}
                        required
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select product..." />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map(p => (
                            <SelectItem key={p.id} value={p.name}>{p.name} ({p.sku})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24 space-y-2">
                      <Label className={index > 0 ? "sr-only" : ""}>Qty</Label>
                      <Input
                        type="number"
                        required
                        min="1"
                        value={item.quantity === 0 ? '' : item.quantity}
                        onChange={(e) => {
                          const val = e.target.value.replace(/^0+(?=\d)/, '');
                          const newItems = [...transferItems];
                          newItems[index].quantity = val === '' ? 0 : Number(val);
                          setTransferItems(newItems);
                        }}
                        onBlur={(e) => {
                          const cleaned = Math.max(1, parseInt(e.target.value, 10) || 1);
                          const newItems = [...transferItems];
                          newItems[index].quantity = cleaned;
                          setTransferItems(newItems);
                        }}
                      />
                    </div>
                    {transferItems.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={`text-red-500 hover:bg-red-500/10 hover:text-red-600 shrink-0 ${index === 0 ? 'mb-[2px]' : ''}`}
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
                  onClick={() => setTransferItems([...transferItems, { id: Date.now(), productName: '', quantity: 1 }])}
                >
                  <Plus className="w-4 h-4 mr-2" /> Add Another Item
                </Button>
              </div>
              <DialogFooter>
                <Button type="submit" className="w-full">Confirm & Queue Movement</Button>
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by Movement ID, Product, Driver, Plate..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Facility Filter */}
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className="h-9 w-full sm:w-[180px] text-xs">
                  <SelectValue placeholder="All Facilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Facilities</SelectItem>
                  {warehouses.map(wh => (
                    <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full sm:w-[150px] text-xs">
                  <SelectValue placeholder="All Statuses" />
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
            <span>Showing {filteredTransfers.length} of {transfers.length} movements</span>
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
              className="bg-card border border-border rounded-xl p-4 space-y-3 cursor-pointer hover:border-blue-500/50 transition-colors"
              onClick={() => setSelectedTransfer(t)}
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

              {canManageTransfer && (
                <div className="flex justify-end gap-2 pt-1">
                  {t.status === 'pending' && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
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
                        className="text-xs font-bold h-8 text-emerald-500 hover:bg-emerald-500/10 z-10 relative"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmArrival(t);
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
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[120px]">Movement ID</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[170px]">Asset Details</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[200px]">Traffic Flow</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[150px]">Dispatch Proof</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[140px]">Operational Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right min-w-[180px]">Actions</TableHead>
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
                    className="group cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedTransfer(t)}
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
                          <span className="font-medium text-foreground truncate max-w-[140px]">{t.driverName || 'Driver'}</span>
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
                    <TableCell className="text-right">
                      {canManageTransfer && (
                        <div className="flex items-center justify-end gap-1">
                          {t.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
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
                                className="text-xs font-bold h-8 text-emerald-500 hover:bg-emerald-500/10 relative z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConfirmArrival(t);
                                }}
                              >
                                Confirm Arrival
                              </Button>
                            </>
                          )}
                          {t.status === 'received' && (
                            <span className="text-[11px] font-semibold text-emerald-600/80 pr-2">Arrived</span>
                          )}
                          {t.status === 'cancelled' && (
                            <span className="text-[11px] font-semibold text-red-500/80 pr-2">Cancelled</span>
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
      <Dialog open={dispatchingTransfer !== null} onOpenChange={(open) => { if (!open && !isProcessing) setDispatchingTransfer(null); }}>
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
                  <Label className="text-xs">Driver Name (Optional)</Label>
                  <Input
                    placeholder="e.g. Juan Dela Cruz"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Vehicle Plate Number (Optional)</Label>
                  <Input
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
                  onClick={() => setDispatchingTransfer(null)}
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
      <Dialog open={cancellingTransfer !== null} onOpenChange={(open) => { if (!open && !isProcessing) setCancellingTransfer(null); }}>
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
                <Label className="text-xs">Cancellation Reason (Optional)</Label>
                <Input
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
                  onClick={() => setCancellingTransfer(null)}
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
      <Dialog open={!!selectedTransfer} onOpenChange={(open) => !open && setSelectedTransfer(null)}>
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
                        onClick={() => handleConfirmArrival(selectedTransfer)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Confirm Arrival
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
