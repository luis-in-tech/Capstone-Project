import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Search, Plus, QrCode, Filter, Package, Warehouse as WarehouseIcon, Tag, Check, Building2, ChevronDown, Layers } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

export function Inventory() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  
  // Warehouse Filter State (for filtering inventory view)
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [isWarehouseFilterOpen, setIsWarehouseFilterOpen] = useState(false);
  const [isAddWarehouseOpen, setIsAddWarehouseOpen] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState('');
  const [newWarehouseLocation, setNewWarehouseLocation] = useState('');
  const [isCreatingWarehouse, setIsCreatingWarehouse] = useState(false);

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
    const basePrice = Number(formData.get('basePrice')) || 0;
    const mmPrice = Number(formData.get('mmPrice')) || Number(formData.get('wholesalePrice')) || 0;
    const provincialPrice = Number(formData.get('provincialPrice')) || Number(formData.get('dealerPrice')) || 0;
    const costPrice = Number(formData.get('costPrice')) || 0;
    const supplier = (formData.get('supplier') as string)?.trim() || 'Supplier';

    const newProduct = {
      sku: formData.get('sku'),
      name: formData.get('name'),
      category: formData.get('category'),
      supplier,
      basePrice,
      wholesalePrice: mmPrice,
      dealerPrice: provincialPrice,
      mmPrice,
      provincialPrice,
      costPrice,
      minStockLevel: Number(formData.get('minStockLevel')) || 0,
      reorderPoint: Number(formData.get('reorderPoint')) || 0,
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

  const handleAddWarehouse = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newWarehouseName.trim()) return;
    setIsCreatingWarehouse(true);
    try {
      const newWh = {
        name: newWarehouseName.trim(),
        location: newWarehouseLocation.trim() || 'Warehouse Facility',
      };
      const docRef = await addDoc(collection(db, 'warehouses'), newWh);
      
      // Initialize inventory for all existing products in this new warehouse
      for (const p of products) {
        await addDoc(collection(db, 'inventory'), {
          productId: p.id,
          warehouseId: docRef.id,
          quantity: 0,
          lastUpdated: serverTimestamp()
        });
      }

      setWarehouseFilter(docRef.id);
      setIsAddWarehouseOpen(false);
      setIsWarehouseFilterOpen(false);
      setNewWarehouseName('');
      setNewWarehouseLocation('');
      toast.success(`Warehouse "${newWarehouseName}" added successfully`);
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'warehouses');
    } finally {
      setIsCreatingWarehouse(false);
    }
  };

  const updateStock = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const warehouseId = formData.get('warehouseId') as string;
    const quantity = Number(formData.get('quantity'));
    const reason = formData.get('reason') as string;

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

  // Filter products by Name, SKU, Category, and Supplier
  const filteredProducts = products.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    const nameMatch = p.name?.toLowerCase().includes(searchLower);
    const skuMatch = p.sku?.toLowerCase().includes(searchLower);
    const supplierMatch = (p.supplier || '').toLowerCase().includes(searchLower);
    const categoryMatch = (p.category || '').toLowerCase().includes(searchLower);
    return nameMatch || skuMatch || supplierMatch || categoryMatch;
  });

  const getStockCount = (productId: string, warehouseId?: string) => {
    const items = inventory.filter(i => i.productId === productId);
    if (warehouseId && warehouseId !== 'all') {
      return items.find(i => i.warehouseId === warehouseId)?.quantity || 0;
    }
    return items.reduce((sum, i) => sum + i.quantity, 0);
  };

  const getTotalWarehouseStock = (warehouseId?: string) => {
    if (!warehouseId || warehouseId === 'all') {
      return inventory.reduce((sum, i) => sum + i.quantity, 0);
    }
    return inventory.filter(i => i.warehouseId === warehouseId).reduce((sum, i) => sum + i.quantity, 0);
  };

  const activeWarehouseObj = warehouses.find(w => w.id === warehouseFilter);
  const activeWarehouseLabel = warehouseFilter === 'all' 
    ? 'All Warehouse' 
    : (activeWarehouseObj?.name || 'Warehouse Filter');

  return (
    <div className="space-y-6 pb-20">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Search Bar - searches by Name, SKU, Supplier */}
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input 
            placeholder="Search by Name..." 
            className="pl-9 h-10 border-border bg-background"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Top Right Action Buttons: +Pricelist and + Add Product */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* +Pricelist button */}
          <Button
            type="button"
            onClick={() => navigate('/pricelist')}
            className="h-10 bg-[#FF2D20] hover:bg-[#E02619] text-white font-bold rounded-lg px-4 flex items-center gap-1.5 shadow-md hover:shadow-lg transition-all"
          >
            +Pricelist
          </Button>

          {/* + Add Product button */}
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
                      <Label htmlFor="supplier">Supplier Name</Label>
                      <Input id="supplier" name="supplier" placeholder="e.g. Shimano Phils" defaultValue="Supplier" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="basePrice">Base Price / Retail (₱)</Label>
                      <Input id="basePrice" name="basePrice" type="number" step="0.01" required placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mmPrice">MM Price (₱)</Label>
                      <Input id="mmPrice" name="mmPrice" type="number" step="0.01" placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="provincialPrice">Provincial Price (₱)</Label>
                      <Input id="provincialPrice" name="provincialPrice" type="number" step="0.01" placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="costPrice">Cost (₱)</Label>
                      <Input id="costPrice" name="costPrice" type="number" step="0.01" placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minStockLevel">Min Stock Level</Label>
                      <Input id="minStockLevel" name="minStockLevel" type="number" defaultValue="0" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reorderPoint">Reorder Point</Label>
                      <Input id="reorderPoint" name="reorderPoint" type="number" required defaultValue="0" />
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

      {/* Active Warehouse Filter Banner / Indicator */}
      {warehouseFilter !== 'all' && activeWarehouseObj && (
        <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 text-xs text-red-500 font-semibold">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-red-500" />
            <span>Viewing inventory filtered by warehouse: <strong className="text-red-600 dark:text-red-400">{activeWarehouseObj.name}</strong></span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setWarehouseFilter('all')}
            className="h-7 text-[11px] font-bold text-red-600 hover:text-red-700 hover:bg-red-500/20"
          >
            Reset to All Warehouses
          </Button>
        </div>
      )}

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {filteredProducts.map((p) => {
          const stock = getStockCount(p.id, warehouseFilter);
          const isLow = stock <= (p.reorderPoint || 0);
          const mmVal = p.mmPrice ?? p.wholesalePrice ?? 0;
          const provVal = p.provincialPrice ?? p.dealerPrice ?? 0;
          const costVal = p.costPrice ?? 0;
          const supplierName = p.supplier || 'Supplier';

          return (
            <div
              key={p.id}
              className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-foreground/20 transition-all space-y-3"
              onClick={() => { setSelectedProduct(p); setIsDetailOpen(true); }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground leading-tight">{p.name}</p>
                  <p className="text-[10px] text-zinc-400 font-medium uppercase mt-0.5">{p.category || 'Accessories'}</p>
                  <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{p.sku}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge
                    variant="outline"
                    className={`h-6 font-bold text-[10px] ${isLow ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800' : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'}`}
                  >
                    {stock} units
                  </Badge>
                  <span className="bg-[#FF2D20] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm">
                    {supplierName}
                  </span>
                </div>
              </div>

              {/* 4 Price Points Grid */}
              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/60 text-center">
                <div>
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Price</p>
                  <p className="text-xs font-black text-foreground">₱{(p.basePrice || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">MM</p>
                  <p className="text-xs font-bold text-zinc-300">₱{mmVal.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Provincial</p>
                  <p className="text-xs font-bold text-zinc-300">₱{provVal.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Cost</p>
                  <p className="text-xs font-bold text-zinc-400">₱{costVal.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
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
                    <Package className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-xs italic">No products found.</div>
        )}
      </div>

      {/* Desktop Table View - 4 Price Columns, Stock, Supplier, Actions */}
      <div className="hidden lg:block bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto w-full">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[100px] text-[10px] font-bold uppercase tracking-widest min-w-[100px]">SKU</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-foreground min-w-[180px]">Item Details</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[110px]">Pricing (Base)</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[100px]">Price (MM)</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[110px]">Price (Provincial)</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[100px]">Cost</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-center min-w-[120px]">
                  {warehouseFilter === 'all' ? 'Total Stock' : `${activeWarehouseObj?.name || 'Warehouse'} Stock`}
                </TableHead>
                <TableHead className="text-center text-[10px] font-bold uppercase tracking-widest min-w-[110px]">Supplier</TableHead>
                <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest min-w-[90px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((p) => {
                const stock = getStockCount(p.id, warehouseFilter);
                const isLow = stock <= (p.reorderPoint || 0);
                const mmVal = p.mmPrice ?? p.wholesalePrice ?? 0;
                const provVal = p.provincialPrice ?? p.dealerPrice ?? 0;
                const costVal = p.costPrice ?? 0;
                const supplierName = p.supplier || 'Supplier';

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
                        <span className="text-[10px] text-zinc-400 font-medium uppercase">{p.category || 'Accessories'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-bold text-foreground">₱{(p.basePrice || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-sm font-medium text-zinc-300">₱{mmVal.toLocaleString()}</TableCell>
                    <TableCell className="text-sm font-medium text-zinc-300">₱{provVal.toLocaleString()}</TableCell>
                    <TableCell className="text-sm font-medium text-zinc-400">₱{costVal.toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <Badge 
                        variant="outline" 
                        className={`h-6 font-bold ${isLow ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800' : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'}`}
                      >
                        {stock} units
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <span className="inline-block bg-[#FF2D20] text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-sm">
                        {supplierName}
                      </span>
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
                          <Package className="w-4 h-4" />
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

      {/* Bottom Section: "All Warehouse" Filter Button with scalable popup/menu */}
      <div className="pt-2 flex items-center justify-between">
        <Popover open={isWarehouseFilterOpen} onOpenChange={setIsWarehouseFilterOpen}>
          <PopoverTrigger asChild>
            <Button 
              type="button"
              className="h-11 bg-[#FF2D20] hover:bg-[#E02619] text-white font-extrabold px-5 rounded-xl shadow-lg hover:shadow-xl flex items-center gap-2 text-xs uppercase tracking-wider transition-all"
            >
              <Building2 className="w-4 h-4" />
              <span>{activeWarehouseLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-80" />
            </Button>
          </PopoverTrigger>
          <PopoverContent 
            align="start" 
            side="top" 
            className="w-72 p-0 bg-[#FF2D20] text-white border-0 shadow-2xl rounded-2xl overflow-hidden"
          >
            {/* Filter Header */}
            <div className="p-3.5 border-b border-white/20">
              <p className="text-xs font-black uppercase tracking-widest text-white/90 text-center">Filter:</p>
            </div>

            {/* Warehouse List */}
            <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
              {/* Option 1: All Warehouses */}
              <button
                type="button"
                onClick={() => {
                  setWarehouseFilter('all');
                  setIsWarehouseFilterOpen(false);
                }}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${
                  warehouseFilter === 'all' 
                    ? 'bg-white text-[#FF2D20] shadow-sm' 
                    : 'text-white hover:bg-white/15'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5" />
                  <span>All Warehouses</span>
                </div>
                <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-full ${warehouseFilter === 'all' ? 'bg-[#FF2D20]/10 text-[#FF2D20]' : 'bg-black/20 text-white'}`}>
                  {getTotalWarehouseStock('all')} units
                </span>
              </button>

              {/* Dynamic Warehouses */}
              {warehouses.map((wh) => {
                const isSelected = warehouseFilter === wh.id;
                const whStock = getTotalWarehouseStock(wh.id);
                return (
                  <button
                    key={wh.id}
                    type="button"
                    onClick={() => {
                      setWarehouseFilter(wh.id);
                      setIsWarehouseFilterOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${
                      isSelected 
                        ? 'bg-white text-[#FF2D20] shadow-sm' 
                        : 'text-white hover:bg-white/15'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{wh.name}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-full shrink-0 ${isSelected ? 'bg-[#FF2D20]/10 text-[#FF2D20]' : 'bg-black/20 text-white'}`}>
                      {whStock} units
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Scalability Feature: + Add Warehouse Option */}
            <div className="p-2 border-t border-white/20 bg-black/10">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsWarehouseFilterOpen(false);
                  setIsAddWarehouseOpen(true);
                }}
                className="w-full text-white hover:text-white hover:bg-white/20 text-xs font-black uppercase tracking-wider h-9 rounded-xl flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> + Warehouse
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Scalability note indicator */}
        <p className="text-[11px] text-zinc-500 font-medium hidden sm:block">
          {warehouses.length} warehouse facility nodes active
        </p>
      </div>

      {/* Add New Warehouse Dialog (Scalability) */}
      <Dialog open={isAddWarehouseOpen} onOpenChange={setIsAddWarehouseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#FF2D20]" /> Add New Warehouse Facility
            </DialogTitle>
            <DialogDescription>
              Expand infrastructure by registering a new warehouse node. Inventory tracking will automatically initialize for all catalog items.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddWarehouse} className="space-y-4 pt-3">
            <div className="space-y-2">
              <Label htmlFor="warehouseName">Warehouse Name</Label>
              <Input 
                id="warehouseName" 
                name="warehouseName" 
                required 
                placeholder="e.g., Warehouse C (Cebu Hub)"
                value={newWarehouseName}
                onChange={(e) => setNewWarehouseName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warehouseLocation">Location / Address</Label>
              <Input 
                id="warehouseLocation" 
                name="warehouseLocation" 
                placeholder="e.g., Cebu City, Central Visayas"
                value={newWarehouseLocation}
                onChange={(e) => setNewWarehouseLocation(e.target.value)}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setIsAddWarehouseOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isCreatingWarehouse} className="bg-[#FF2D20] hover:bg-[#E02619] text-white">
                {isCreatingWarehouse ? 'Creating...' : 'Create Warehouse'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stock Update Dialog */}
      <Dialog open={isStockUpdateOpen} onOpenChange={setIsStockUpdateOpen}>
        <DialogContent>
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
              <Button type="submit" className="w-full">Commit Adjustment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Product Detail Dialog (Double-click / row click modal with per-warehouse breakdown) */}
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
                    <Badge variant="outline" className="font-black uppercase text-[9px] tracking-widest py-0 h-5">{selectedProduct?.category || 'Accessories'}</Badge>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Supplier</span>
                    <span className="font-bold text-foreground bg-[#FF2D20]/10 text-[#FF2D20] px-2.5 py-0.5 rounded-full text-xs">
                      {selectedProduct?.supplier || 'Supplier'}
                    </span>
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
                    <span className="text-muted-foreground font-medium">Base Price / Retail</span>
                    <span className="font-black">₱{(selectedProduct?.basePrice || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">MM Rate</span>
                    <span className="font-black text-emerald-400">₱{((selectedProduct?.mmPrice ?? selectedProduct?.wholesalePrice) || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Provincial Rate</span>
                    <span className="font-black text-blue-400">₱{((selectedProduct?.provincialPrice ?? selectedProduct?.dealerPrice) || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-medium">Cost</span>
                    <span className="font-black text-zinc-400">₱{(selectedProduct?.costPrice || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 block">Warehouse Deployment</Label>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
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
