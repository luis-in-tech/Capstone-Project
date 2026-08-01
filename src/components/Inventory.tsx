import React, { useState, useEffect } from 'react';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, query, where, addDoc, updateDoc, doc, serverTimestamp } from '../lib/supabaseAdapter';
import { Product, InventoryItem, Warehouse, StaffDelegation } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, Plus, QrCode, Filter, Package, Warehouse as WarehouseIcon, PenLine } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

export function Inventory() {
  const { profile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  const [hasDelegatedAccess, setHasDelegatedAccess] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const canAdjustStock = isAdmin || hasDelegatedAccess;

  useEffect(() => {
    if (!profile || profile.role !== 'staff') return;
    const q = query(collection(db, 'delegations'), where('staffEmail', '==', profile.email.toLowerCase()));
    const unsub = onSnapshot(q, (snap) => {
      const hasAccess = snap.docs.some(d => d.data().canAdjustInventory === true);
      setHasDelegatedAccess(hasAccess);
    });
    return () => unsub();
  }, [profile]);

  useEffect(() => {
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'products');
    });
    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snap) => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'inventory');
    });
    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snap) => {
      setWarehouses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Warehouse)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'warehouses');
    });

    return () => {
      unsubProducts();
      unsubInventory();
      unsubWarehouses();
    };
  }, []);

  const handleAddProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newProduct = {
      sku: formData.get('sku'),
      name: formData.get('name'),
      category: formData.get('category'),
      basePrice: Number(formData.get('basePrice')),
      wholesalePrice: Number(formData.get('wholesalePrice')),
      dealerPrice: Number(formData.get('dealerPrice')),
      minStockLevel: Number(formData.get('minStockLevel')),
      reorderPoint: Number(formData.get('reorderPoint')),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const docRef = await addDoc(collection(db, 'products'), newProduct);
      // Initialize inventory for all warehouses
      for (const wh of warehouses) {
        await addDoc(collection(db, 'inventory'), {
          productId: docRef.id,
          warehouseId: wh.id,
          quantity: 0,
          lastUpdated: serverTimestamp()
        });
      }
      setIsAddProductOpen(false);
      toast.success('Product added to CI catalog');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'products');
    }
  };

  const getProductVariations = (product: Product | null) => {
    if (!product) return [];
    const seed = (product.name.charCodeAt(0) || 0) + product.name.length;
    if (product.category?.toLowerCase().includes('frame') || seed % 3 === 0) {
      return [
        { name: 'Color', values: ['Matte Black', 'Gloss Red', 'Titanium'] },
        { name: 'Size', values: ['SM (50)', 'MD (54)', 'LG (58)'] },
        { name: 'Finish', values: ['Matte', 'Glossy'] }
      ];
    } else if (product.category?.toLowerCase().includes('group') || seed % 3 === 1) {
      return [
        { name: 'Series', values: ['Base', 'Pro', 'Elite'] },
        { name: 'Spec', values: ['Standard', 'Lightweight'] },
        { name: 'Option', values: ['Mechanical', 'Di2'] }
      ];
    } else {
      return [
        { name: 'Color', values: ['Black', 'Silver', 'Carbon'] },
        { name: 'Model', values: ['Standard', '2024 Edition'] },
        { name: 'Type', values: ['Road', 'MTB', 'Gravel'] }
      ];
    }
  };

  const updateStock = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const warehouseId = formData.get('warehouseId') as string;
    const quantity = Number(formData.get('quantity'));
    let reason = formData.get('reason') as string;

    if (selectedProduct) {
      const variations = getProductVariations(selectedProduct);
      const selectedVars: string[] = [];
      variations.forEach(v => {
        const val = formData.get(`var_${v.name}`);
        if (val && val !== 'choose') {
          selectedVars.push(`${v.name}: ${val}`);
        }
      });
      if (selectedVars.length > 0) {
        reason = `[Variations: ${selectedVars.join(', ')}] ` + reason;
      }
    }

    const item = inventory.find(i => i.productId === selectedProduct?.id && i.warehouseId === warehouseId);
    if (item && selectedProduct && profile) {
      try {
        // 1. Update the inventory level
        await updateDoc(doc(db, 'inventory', item.id), {
          quantity: item.quantity + quantity,
          lastUpdated: serverTimestamp()
        });

        // 2. Log the adjustment for auditing
        await addDoc(collection(db, 'stockAdjustments'), {
          productId: selectedProduct.id,
          warehouseId,
          adjustmentAmount: quantity,
          reason,
          recordedBy: profile.uid,
          timestamp: serverTimestamp()
        });

        setIsStockUpdateOpen(false);
        toast.success('Inventory balance synchronized and adjustment logged');
      } catch (err) {
        handleSupabaseError(err, OperationType.UPDATE, `inventory/${item.id}`);
      }
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStockCount = (productId: string, warehouseId?: string) => {
    const items = inventory.filter(i => i.productId === productId);
    if (warehouseId) {
      return items.find(i => i.warehouseId === warehouseId)?.quantity || 0;
    }
    return items.reduce((sum, i) => sum + i.quantity, 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input 
            placeholder="Search by Name..." 
            className="pl-9 h-10 border-border bg-background"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {isAdmin && (
            <Dialog open={isAddProductOpen} onOpenChange={setIsAddProductOpen}>
              <DialogTrigger className="h-10 gap-2 px-4 bg-[#1A2332] text-white rounded-lg inline-flex items-center justify-center font-medium transition-all hover:bg-[#1A2332]/90">
                <Plus className="w-4 h-4" /> Add Product
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>New Configuration Item (Product)</DialogTitle>
                  <DialogDescription>Register a new bicycle component into the service catalog.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddProduct} className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sku">SKU Code</Label>
                      <Input id="sku" name="sku" required placeholder="AP-XYZ-123" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name">Item Name</Label>
                      <Input id="name" name="name" required placeholder="Shimano Sora R3000" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input id="category" name="category" placeholder="Groupsets" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="basePrice">Base Cost (₱)</Label>
                      <Input id="basePrice" name="basePrice" type="number" step="0.01" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="wholesalePrice">Wholesale (₱)</Label>
                      <Input id="wholesalePrice" name="wholesalePrice" type="number" step="0.01" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dealerPrice">Dealer (₱)</Label>
                      <Input id="dealerPrice" name="dealerPrice" type="number" step="0.01" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minStockLevel">Min Stock Level</Label>
                      <Input id="minStockLevel" name="minStockLevel" type="number" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reorderPoint">Reorder Point</Label>
                      <Input id="reorderPoint" name="reorderPoint" type="number" required />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" className="w-full sm:w-auto">Save to CMDB</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {filteredProducts.map((p) => {
          const totalStock = getStockCount(p.id);
          const isLow = totalStock <= p.reorderPoint;
          return (
            <div
              key={p.id}
              className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-foreground/20 transition-all"
              onClick={() => { setSelectedProduct(p); setIsDetailOpen(true); }}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground leading-tight">{p.name}</p>
                  <p className="text-[10px] text-zinc-400 font-medium uppercase mt-0.5">{p.category}</p>
                  <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{p.sku}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 h-6 font-bold text-[10px] ${isLow ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
                >
                  {totalStock} units
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-foreground">₱{p.basePrice.toLocaleString()}</span>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Dialog>
                    <DialogTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                      <QrCode className="w-4 h-4" />
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-xs text-center">
                      <DialogHeader>
                        <DialogTitle className="text-center">Asset QR Label</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col items-center gap-4 py-8">
                        <div className="p-4 bg-card border-2 border-primary rounded-2xl">
                          <QRCodeSVG value={p.id} size={180} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-black">{p.name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{p.sku}</p>
                        </div>
                      </div>
                      <Button className="w-full gap-2" variant="outline" onClick={() => window.print()}>
                        Print Label
                      </Button>
                    </DialogContent>
                  </Dialog>
                  {canAdjustStock && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => { setSelectedProduct(p); setIsStockUpdateOpen(true); }}
                    >
                      <PenLine className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-xs italic">No products found.</div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto w-full">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[100px] text-[10px] font-bold uppercase tracking-widest min-w-[100px]">SKU</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-foreground min-w-[200px]">Item Details</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[120px]">Pricing (Base)</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-center min-w-[120px]">Total Stock</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[150px]">Warehouse Sync</TableHead>
                <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest min-w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((p) => {
                const totalStock = getStockCount(p.id);
                const isLow = totalStock <= p.reorderPoint;
                return (
                  <TableRow 
                    key={p.id} 
                    className="group hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedProduct(p);
                      setIsDetailOpen(true);
                    }}
                  >
                    <TableCell className="font-mono text-xs text-zinc-500 font-medium">{p.sku}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">{p.name}</span>
                        <span className="text-[10px] text-zinc-400 font-medium uppercase">{p.category}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-medium">₱{p.basePrice.toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <Badge 
                        variant="outline" 
                        className={`h-6 font-bold ${isLow ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
                      >
                        {totalStock} units
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {warehouses.map(wh => (
                          <div key={wh.id} className="flex items-center justify-between text-[10px] font-medium text-zinc-500">
                            <span>{wh.name}:</span>
                            <span className="font-bold text-zinc-700">{getStockCount(p.id, wh.id)}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                      <Dialog>
                        <DialogTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                          <QrCode className="w-4 h-4" />
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-xs text-center">
                          <DialogHeader>
                            <DialogTitle className="text-center">Asset QR Label</DialogTitle>
                          </DialogHeader>
                          <div className="flex flex-col items-center gap-4 py-8">
                            <div className="p-4 bg-card border-2 border-primary rounded-2xl">
                              <QRCodeSVG value={p.id} size={180} />
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm font-black">{p.name}</p>
                              <p className="text-xs font-mono text-muted-foreground">{p.sku}</p>
                            </div>
                          </div>
                          <Button className="w-full gap-2" variant="outline" onClick={() => window.print()}>
                            Print Label
                          </Button>
                        </DialogContent>
                      </Dialog>

                      {canAdjustStock && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSelectedProduct(p);
                            setIsStockUpdateOpen(true);
                          }}
                        >
                          <PenLine className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Stock Update Dialog */}
      <Dialog open={isStockUpdateOpen} onOpenChange={setIsStockUpdateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Manual Stock Adjustment</DialogTitle>
            <DialogDescription>
              Adjust current counts for <span className="font-bold">{selectedProduct?.name}</span>. This action will be logged for auditing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={updateStock} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Target Warehouse</Label>
              <Select name="warehouseId" required value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse...">
                    {selectedWarehouseId ? warehouses.find(w => w.id === selectedWarehouseId)?.name : 'Select warehouse...'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map(wh => (
                    <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {selectedProduct && getProductVariations(selectedProduct).length > 0 && (
              <div className="space-y-3 py-3 border-y border-border">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Specify Variation (Optional)</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {getProductVariations(selectedProduct).map((variation, idx) => (
                    <div key={idx} className="space-y-1.5">
                      <Label className="text-[10px] font-bold text-foreground">{variation.name}</Label>
                      <Select name={`var_${variation.name}`} defaultValue="choose">
                        <SelectTrigger className="h-8 text-xs bg-muted/50 border-border">
                          <SelectValue placeholder="choose" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="choose">choose</SelectItem>
                          {variation.values.map(v => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Adjustment Qty</Label>
                <Input name="quantity" type="number" required placeholder="+/- units" />
              </div>
              <div className="space-y-2">
                <Label>Current System Total</Label>
                <div className="h-10 px-3 flex items-center bg-muted border border-border rounded-lg text-xs font-bold">
                  {selectedProduct ? getStockCount(selectedProduct.id) : 0} units
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason" className="flex items-center">
                Adjustment Reason <span className="text-red-500 ml-1.5 font-black uppercase text-[9px] tracking-widest">(Required)</span>
              </Label>
              <Input id="reason" name="reason" required placeholder="e.g., Damaged item, Physical count correction..." className="border-red-500/30 focus-visible:ring-red-500/20" />
              <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-2.5 rounded-lg text-xs font-medium">
                Mandatory for internal audit compliance.
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full bg-[#fdd001] text-zinc-900 font-bold hover:bg-[#fbcc0e]">Confirm</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Product Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-5xl w-full rounded-[2rem]">
          <DialogHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-primary rounded-xl">
                <Package className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Configuration Item: {selectedProduct?.name}</DialogTitle>
                <DialogDescription className="text-muted-foreground font-medium">Service catalog specification and inventory node status.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6">
            <div className="space-y-6">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 block">Technical Specifications</Label>
                <div className="bg-muted rounded-2xl p-4 border border-border space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">SKU Node</span>
                    <span className="font-mono font-bold text-foreground">{selectedProduct?.sku}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Classification</span>
                    <Badge variant="outline" className="font-black uppercase text-[9px] tracking-widest py-0 h-5">{selectedProduct?.category}</Badge>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Min Threshold</span>
                    <span className="font-bold text-foreground">{selectedProduct?.minStockLevel || 0} units</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Reorder Point</span>
                    <span className="font-bold text-foreground">{selectedProduct?.reorderPoint || 0} units</span>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 block">Pricing Tiers (₱)</Label>
                <div className="bg-muted rounded-2xl p-4 border border-border text-foreground space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Base Acquisition</span>
                    <span className="font-black">₱{selectedProduct?.basePrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Wholesale Rate</span>
                    <span className="font-black text-emerald-400">₱{selectedProduct?.wholesalePrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Dealer Agreement</span>
                    <span className="font-black text-blue-400">₱{selectedProduct?.dealerPrice.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 block">Warehouse Deployment</Label>
                <div className="space-y-2">
                  {warehouses.map(wh => {
                    const count = getStockCount(selectedProduct?.id || '', wh.id);
                    return (
                      <div key={wh.id} className="flex items-center justify-between p-3 bg-muted rounded-xl border border-border hover:border-foreground/20 transition-colors">
                        <div className="flex items-center gap-2">
                          <WarehouseIcon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs font-bold text-foreground">{wh.name}</span>
                        </div>
                        <Badge variant="secondary" className="font-black rounded-lg">{count} units</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-dashed border-border">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-black uppercase tracking-widest text-foreground">Aggregate Global Inventory</span>
                  <Badge className="bg-emerald-500 font-black h-8 px-4 rounded-xl">
                    {selectedProduct ? getStockCount(selectedProduct.id) : 0} UNITS TOTAL
                  </Badge>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-muted rounded-xl">
                     <QrCode className="w-8 h-8 text-zinc-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-black uppercase text-zinc-500 mb-1">Asset Traceability</p>
                    <p className="text-[10px] text-zinc-400 font-medium italic">Unique node ID: {selectedProduct?.id}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pb-6">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 block">Available Variations & Options</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(() => {
                if (!selectedProduct) return null;
                const variations = getProductVariations(selectedProduct);
                return variations.map((variation, idx) => (
                  <div key={idx} className="bg-muted/50 p-3 rounded-xl border border-border">
                    <span className="text-[10px] font-black uppercase text-foreground mb-2 block">{variation.name}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {variation.values.map((v, i) => (
                        <Badge key={i} variant="outline" className="text-[9px] font-bold bg-background text-muted-foreground border-border">
                          {v}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-border">
            <Button 
              variant="outline" 
              onClick={() => setIsDetailOpen(false)}
              className="h-12 px-8 rounded-xl font-black uppercase tracking-widest text-[10px]"
            >
              Close
            </Button>
            {canAdjustStock && (
              <Button 
                onClick={() => {
                  setIsDetailOpen(false);
                  setIsStockUpdateOpen(true);
                }}
                className="h-12 px-8 bg-[#1A2332] text-white rounded-xl font-black uppercase tracking-widest text-[10px]"
              >
                Adjust Stock <Plus className="ml-2 w-3 h-3" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
