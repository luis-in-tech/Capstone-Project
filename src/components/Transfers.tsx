import React, { useState, useEffect } from 'react';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, serverTimestamp } from '../lib/supabaseAdapter';
import { Transfer, Product, Warehouse, InventoryItem } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Truck, ArrowRightLeft, Clock, CheckCircle2, History, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

export function Transfers() {
  const { profile } = useAuth();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isAddTransferOpen, setIsAddTransferOpen] = useState(false);
  const [transferItems, setTransferItems] = useState([{ id: Date.now(), productName: '', quantity: 1 }]);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);

  const canManageTransfer = profile?.role === 'admin' || profile?.role === 'secretary' || profile?.role === 'staff';

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

    // Check availability
    for (const item of validItems) {
      const prodId = products.find(p => p.name === item.productName)?.id || item.productName;
      const sourceInv = inventory.find(i => i.productId === prodId && i.warehouseId === sourceWh);
      if (!sourceInv || sourceInv.quantity < item.quantity) {
        toast.error(`Insufficient stock for ${item.productName} in source warehouse`);
        return;
      }
    }

    try {
      for (const item of validItems) {
        const prodId = products.find(p => p.name === item.productName)?.id || item.productName;
        const newTransfer = {
          sourceWarehouseId: sourceWh,
          destinationWarehouseId: destWh,
          productId: prodId,
          quantity: item.quantity,
          status: 'pending',
          initiatedBy: profile?.uid,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'transfers'), newTransfer);
      }
      setIsAddTransferOpen(false);
      setTransferItems([{ id: Date.now(), productName: '', quantity: 1 }]);
      toast.success('Warehouse transfer requests initiated');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'transfers');
    }
  };

  const updateStatus = async (transfer: Transfer, newStatus: 'in_transit' | 'received') => {
    try {
      if (newStatus === 'received') {
        const sourceInv = inventory.find(i => i.productId === transfer.productId && i.warehouseId === transfer.sourceWarehouseId);
        const destInv = inventory.find(i => i.productId === transfer.productId && i.warehouseId === transfer.destinationWarehouseId);

        if (sourceInv && destInv) {
          // Deduct from source
          await updateDoc(doc(db, 'inventory', sourceInv.id), {
             quantity: sourceInv.quantity - transfer.quantity,
             lastUpdated: serverTimestamp()
          });
          // Add to dest
          await updateDoc(doc(db, 'inventory', destInv.id), {
             quantity: destInv.quantity + transfer.quantity,
             lastUpdated: serverTimestamp()
          });
        }
      }

      await updateDoc(doc(db, 'transfers', transfer.id), {
         status: newStatus,
         updatedAt: serverTimestamp()
      });
      toast.success(`Transfer status updated to ${newStatus}`);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `transfers/${transfer.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Warehouse Transfer Log</h2>
          <p className="text-xs text-muted-foreground font-medium tracking-tight">Managing stock movement between Valenzuela facilities</p>
        </div>
        <Dialog open={isAddTransferOpen} onOpenChange={(open) => {
          setIsAddTransferOpen(open);
          if (!open) setTransferItems([{ id: Date.now(), productName: '', quantity: 1 }]);
        }}>
          <DialogTrigger className="h-9 gap-2 px-4 bg-[#1A2332] text-white rounded-lg inline-flex items-center justify-center font-medium transition-all hover:bg-[#1A2332]/90">
            <ArrowRightLeft className="w-4 h-4" /> New Transfer Request
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Initiate Stock Movement</DialogTitle>
              <DialogDescription>Request a transfer of inventory items between warehouse locations.</DialogDescription>
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
                        <SelectTrigger>
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
                        value={item.quantity}
                        onChange={(e) => {
                          const newItems = [...transferItems];
                          newItems[index].quantity = Number(e.target.value);
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
                <Button type="submit" className="w-full">Confirm</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {transfers.map((t) => {
          const product = products.find(p => p.id === t.productId);
          const source = warehouses.find(w => w.id === t.sourceWarehouseId);
          const dest = warehouses.find(w => w.id === t.destinationWarehouseId);
          return (
            <div key={t.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black text-foreground">{product?.name || 'Unknown'}</p>
                  <p 
                    className="text-[10px] font-mono text-blue-500 hover:text-blue-600 hover:underline cursor-pointer uppercase tracking-tighter"
                    onClick={() => setSelectedTransfer(t)}
                  >
                    TFR-{t.id.slice(-6)}
                  </p>
                </div>
                <Badge variant="outline" className={`shrink-0 gap-1.5 h-6 capitalize text-[10px] font-black ${
                  t.status === 'received' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
                  t.status === 'in_transit' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                  'bg-amber-500/10 text-amber-500 border-amber-500/30'
                }`}>
                  {t.status === 'pending' && <Clock className="w-3 h-3" />}
                  {t.status === 'in_transit' && <Truck className="w-3 h-3" />}
                  {t.status === 'received' && <CheckCircle2 className="w-3 h-3" />}
                  {t.status.replace('_', ' ')}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold text-foreground">
                <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{source?.name}</span>
                <ArrowRightLeft className="w-3 h-3 text-muted-foreground/40" />
                <span className="bg-[#1A2332] text-white px-1.5 py-0.5 rounded">{dest?.name}</span>
                <span className="ml-auto text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Qty: {t.quantity}</span>
              </div>
              <div className="flex justify-end gap-2">
                {t.status === 'pending' && (
                  <Button size="sm" variant="ghost" className="text-xs font-bold h-8" onClick={() => updateStatus(t, 'in_transit')}>
                    Dispatch
                  </Button>
                )}
                {t.status === 'in_transit' && (
                  <Button size="sm" variant="ghost" className="text-xs font-bold h-8 text-emerald-500 hover:bg-emerald-500/10" onClick={() => updateStatus(t, 'received')}>
                    Confirm Arrival
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {transfers.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <History className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-xs font-medium text-muted-foreground">No active transfers tracked</p>
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
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[150px]">Asset Details</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[200px]">Traffic Flow</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[150px]">Operational Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right min-w-[150px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((t) => {
                const product = products.find(p => p.id === t.productId);
                const source = warehouses.find(w => w.id === t.sourceWarehouseId);
                const dest = warehouses.find(w => w.id === t.destinationWarehouseId);
                return (
                  <TableRow key={t.id} className="group">
                    <TableCell className="font-mono text-[10px] text-zinc-400 font-bold uppercase tracking-tighter">
                      <span 
                        className="cursor-pointer text-blue-500 hover:text-blue-600 hover:underline"
                        onClick={() => setSelectedTransfer(t)}
                      >
                        TFR-{t.id.slice(-6)}
                      </span>
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
                      <Badge variant="outline" className={`gap-1.5 h-6 capitalize text-[10px] font-black ${
                        t.status === 'received' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
                        t.status === 'in_transit' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                        'bg-amber-500/10 text-amber-500 border-amber-500/30'
                      }`}>
                        {t.status === 'pending' && <Clock className="w-3 h-3" />}
                        {t.status === 'in_transit' && <Truck className="w-3 h-3" />}
                        {t.status === 'received' && <CheckCircle2 className="w-3 h-3" />}
                        {t.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {t.status === 'pending' && (
                        <Button size="sm" variant="ghost" className="text-xs font-bold h-8" onClick={() => updateStatus(t, 'in_transit')}>
                          Dispatch
                        </Button>
                      )}
                      {t.status === 'in_transit' && (
                        <Button size="sm" variant="ghost" className="text-xs font-bold h-8 text-emerald-500 hover:bg-emerald-500/10" onClick={() => updateStatus(t, 'received')}>
                          Confirm Arrival
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {transfers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-32">
                     <div className="flex flex-col items-center justify-center gap-2">
                       <History className="w-8 h-8 text-muted-foreground/30" />
                       <p className="text-xs font-medium text-muted-foreground">No active transfers tracked</p>
                     </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!selectedTransfer} onOpenChange={(open) => !open && setSelectedTransfer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Details</DialogTitle>
            <DialogDescription>
              Movement ID: TFR-{selectedTransfer?.id.slice(-6)}
            </DialogDescription>
          </DialogHeader>
          {selectedTransfer && (
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block text-xs">Product</span>
                  <span className="font-bold">{products.find(p => p.id === selectedTransfer.productId)?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Quantity</span>
                  <span className="font-bold">{selectedTransfer.quantity}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Source Warehouse</span>
                  <span className="font-bold">{warehouses.find(w => w.id === selectedTransfer.sourceWarehouseId)?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Destination Warehouse</span>
                  <span className="font-bold">{warehouses.find(w => w.id === selectedTransfer.destinationWarehouseId)?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Status</span>
                  <Badge variant="outline" className={`mt-1 capitalize text-[10px] font-black ${
                    selectedTransfer.status === 'received' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
                    selectedTransfer.status === 'in_transit' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                    'bg-amber-500/10 text-amber-500 border-amber-500/30'
                  }`}>
                    {selectedTransfer.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Initiated By</span>
                  <span className="font-bold truncate max-w-full block" title={selectedTransfer.initiatedBy}>{selectedTransfer.initiatedBy || 'Unknown'}</span>
                </div>
              </div>

              {canManageTransfer && selectedTransfer.status !== 'received' && (
                <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
                  {selectedTransfer.status === 'pending' && (
                    <Button onClick={() => { updateStatus(selectedTransfer, 'in_transit'); setSelectedTransfer(null); }}>
                      Dispatch Transfer
                    </Button>
                  )}
                  {selectedTransfer.status === 'in_transit' && (
                    <Button onClick={() => { updateStatus(selectedTransfer, 'received'); setSelectedTransfer(null); }} className="bg-emerald-600 hover:bg-emerald-700">
                      Confirm Arrival
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
