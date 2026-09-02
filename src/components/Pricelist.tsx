import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, query, where, addDoc, getDocs, serverTimestamp, updateDoc, doc } from '../lib/supabaseAdapter';
import { Product } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Plus, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

export function Pricelist() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const { profile } = useAuth();
  const [hasDelegatedAccess, setHasDelegatedAccess] = useState(false);

  // Edit dialog state
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const canEditPricelist = isAdmin || hasDelegatedAccess;

  useEffect(() => {
    if (!profile || profile.role !== 'staff') return;
    const q = query(collection(db, 'delegations'), where('staffEmail', '==', profile.email.toLowerCase()));
    const unsub = onSnapshot(q, (snap) => {
      const hasAccess = snap.docs.some(d => d.data().canAdjustPricelist === true);
      setHasDelegatedAccess(hasAccess);
    });
    return () => unsub();
  }, [profile]);

  useEffect(() => {
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
      setLoading(false);
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'products');
      setLoading(false);
    });

    return () => unsubProducts();
  }, []);

  const handleAddProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newProduct = {
      sku: formData.get('code'),
      name: formData.get('name'),
      category: formData.get('category'),
      basePrice: Number(formData.get('basePrice')),
      wholesalePrice: Number(formData.get('wholesalePrice')),
      dealerPrice: Number(formData.get('dealerPrice')),
      minStockLevel: 0,
      reorderPoint: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const docRef = await addDoc(collection(db, 'products'), newProduct);
      const whSnap = await getDocs(collection(db, 'warehouses'));
      for (const d of whSnap.docs) {
        await addDoc(collection(db, 'inventory'), {
          productId: docRef.id,
          warehouseId: d.id,
          quantity: 0,
          lastUpdated: serverTimestamp()
        });
      }
      setIsAddProductOpen(false);
      toast.success('Product added to catalog');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'products');
    }
  };

  const handleEditProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editProduct) return;
    setIsSaving(true);
    const formData = new FormData(e.currentTarget);
    try {
      await updateDoc(doc(db, 'products', editProduct.id), {
        name: formData.get('editName'),
        category: formData.get('editCategory'),
        basePrice: Number(formData.get('editBasePrice')),
        wholesalePrice: Number(formData.get('editWholesalePrice')),
        dealerPrice: Number(formData.get('editDealerPrice')),
        updatedAt: new Date(),
      });
      toast.success('Product updated successfully.');
      setEditProduct(null);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, 'products');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const categories = useMemo(() => {
    const cats = new Set(filteredProducts.map(p => p.category || 'Uncategorized'));
    return ['All', ...Array.from(cats).sort()];
  }, [filteredProducts]);

  const defaultCategory = 'All';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-foreground uppercase">Pricelist</h2>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <Input 
              placeholder="Search by product name or Item Code..." 
              className="pl-9 h-10 border-border bg-background"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {canEditPricelist && (
            <Dialog open={isAddProductOpen} onOpenChange={setIsAddProductOpen}>
              <DialogTrigger className="h-10 gap-2 px-4 bg-[#1A2332] text-white rounded-lg inline-flex items-center justify-center font-medium transition-all hover:bg-[#1A2332]/90 flex-shrink-0">
                <Plus className="w-4 h-4" /> Add Product
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add New Product</DialogTitle>
                  <DialogDescription>Register a new product with pricing into the catalog.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddProduct} className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="code">Item Code</Label>
                      <Input id="code" name="code" required placeholder="AP-XYZ-123" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name">Item Name</Label>
                      <Input id="name" name="name" required placeholder="Product Name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input id="category" name="category" placeholder="Category" />
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
                  </div>
                  <DialogFooter>
                    <Button type="submit" className="w-full sm:w-auto">Save Product</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-xl border border-dashed border-border">
          No products found matching your search.
        </div>
      ) : (
        <Tabs defaultValue={defaultCategory} className="w-full">
          <TabsList className="mb-4 flex flex-wrap h-auto bg-muted/50 p-1 rounded-lg">
            {categories.map(category => (
              <TabsTrigger 
                key={category} 
                value={category}
                className="rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm px-4 py-2 font-medium text-sm transition-all"
              >
                {category}
              </TabsTrigger>
            ))}
          </TabsList>
          
          {categories.map(category => {
            const categoryProducts = category === 'All' 
              ? filteredProducts 
              : filteredProducts.filter(p => (p.category || 'Uncategorized') === category);
            
            return (
              <TabsContent key={category} value={category} className="mt-0">
                {/* Mobile Card View */}
                <div className="lg:hidden space-y-3">
                  {categoryProducts.map((p) => (
                    <div key={p.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-foreground">{p.name}</p>
                          <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{p.sku}</p>
                        </div>
                        {canEditPricelist && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditProduct(p)}
                            className="shrink-0 h-8 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="w-3 h-3 mr-1" /> Edit
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
                        <div className="text-center">
                          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Base</p>
                          <p className="text-xs font-bold">₱{p.basePrice?.toLocaleString() || '0'}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Wholesale</p>
                          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">₱{p.wholesalePrice?.toLocaleString() || '0'}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-1">Dealer</p>
                          <p className="text-xs font-bold text-blue-600 dark:text-blue-400">₱{p.dealerPrice?.toLocaleString() || '0'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {categoryProducts.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-xs italic">No products in this category.</div>
                  )}
                </div>

                {/* Desktop Table View */}
                <div className="hidden lg:block bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto w-full">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-[120px] text-[10px] font-bold uppercase tracking-widest min-w-[120px]">Item Code</TableHead>
                          <TableHead className="text-[10px] font-bold uppercase tracking-widest text-foreground min-w-[200px]">Product Name</TableHead>
                          <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest min-w-[100px]">Base Price</TableHead>
                          <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 min-w-[100px]">Wholesale</TableHead>
                          <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 min-w-[100px]">Dealer</TableHead>
                          {canEditPricelist && (
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest min-w-[80px]">Edit</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categoryProducts.map((p) => (
                          <TableRow key={p.id} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="font-mono text-xs text-zinc-500">{p.sku}</TableCell>
                            <TableCell className="font-bold text-sm text-foreground">{p.name}</TableCell>
                            <TableCell className="text-right font-medium">₱{p.basePrice?.toLocaleString() || '0'}</TableCell>
                            <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400">₱{p.wholesalePrice?.toLocaleString() || '0'}</TableCell>
                            <TableCell className="text-right font-bold text-blue-600 dark:text-blue-400">₱{p.dealerPrice?.toLocaleString() || '0'}</TableCell>
                            {canEditPricelist && (
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditProduct(p)}
                                  className="h-8 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                                >
                                  <Pencil className="w-3 h-3 mr-1" /> Edit
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {/* Edit Product Dialog */}
      <Dialog open={!!editProduct} onOpenChange={(open) => { if (!open) setEditProduct(null); }}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" /> Edit Product
            </DialogTitle>
            <DialogDescription>
              Update pricing and details for <span className="font-black text-foreground">{editProduct?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditProduct} className="space-y-4 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editName">Item Name</Label>
                <Input id="editName" name="editName" required defaultValue={editProduct?.name} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editCategory">Category</Label>
                <Input id="editCategory" name="editCategory" defaultValue={editProduct?.category} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editBasePrice">Base Cost (₱)</Label>
                <Input id="editBasePrice" name="editBasePrice" type="number" step="0.01" required defaultValue={editProduct?.basePrice} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editWholesalePrice">Wholesale (₱)</Label>
                <Input id="editWholesalePrice" name="editWholesalePrice" type="number" step="0.01" defaultValue={editProduct?.wholesalePrice} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDealerPrice">Dealer (₱)</Label>
                <Input id="editDealerPrice" name="editDealerPrice" type="number" step="0.01" defaultValue={editProduct?.dealerPrice} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditProduct(null)} className="font-black uppercase tracking-widest text-[10px]">
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving} className="font-black uppercase tracking-widest text-[10px]">
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
