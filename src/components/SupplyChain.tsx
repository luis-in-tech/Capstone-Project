import { getSupplyChainViews } from '../lib/staffPermissions';
import { useStaffAccess } from '../hooks/useStaffAccess';
import React, { useState, useEffect } from 'react';
import { CategoryWorkspace } from './CategoryWorkspace';
import { SupplyChainWorkspace } from './SupplyChainWorkspace';
import { db, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from '../lib/supabaseAdapter';
import { Product, InventoryItem, Warehouse } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, AlertTriangle, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface NamedOption { id: string; name: string; }

export function SupplyChain() {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const isAdmin = profile?.role === 'admin';
  const [sourceLoaded, setSourceLoaded] = useState<Record<string, boolean>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<string, boolean>>({});
  const [sourceReload, setSourceReload] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseActionId, setWarehouseActionId] = useState<string | null>(null);
  const [managedCategories, setManagedCategories] = useState<NamedOption[]>([]);
  const [managedSuppliers, setManagedSuppliers] = useState<NamedOption[]>([]);
  const [referenceManager, setReferenceManager] = useState<'category' | 'supplier' | null>(null);
  const [newReferenceName, setNewReferenceName] = useState('');
  const [editingReferenceName, setEditingReferenceName] = useState<string | null>(null);
  const [referenceDraft, setReferenceDraft] = useState('');
  const [referenceAction, setReferenceAction] = useState<string | null>(null);
  const [deletingReference, setDeletingReference] = useState<{
    name: string;
    type: 'category' | 'supplier';
    affectedCount: number;
    affectedItems: Product[];
  } | null>(null);

  useEffect(() => {
    setSourceLoaded({});
    setSourceErrors({});
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Product)));
      setSourceLoaded(current => ({ ...current, products: true }));
      setSourceErrors(current => ({ ...current, products: false }));
    }, (error) => {
      setSourceLoaded(current => ({ ...current, products: true }));
      setSourceErrors(current => ({ ...current, products: true }));
      handleSupabaseError(error, OperationType.GET, 'products');
    });
    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snap) => {
      setInventory(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as InventoryItem)));
      setSourceLoaded(current => ({ ...current, inventory: true }));
      setSourceErrors(current => ({ ...current, inventory: false }));
    }, (error) => {
      setSourceLoaded(current => ({ ...current, inventory: true }));
      setSourceErrors(current => ({ ...current, inventory: true }));
      handleSupabaseError(error, OperationType.GET, 'inventory');
    });
    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snap) => {
      setWarehouses(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Warehouse)));
      setSourceLoaded(current => ({ ...current, warehouses: true }));
      setSourceErrors(current => ({ ...current, warehouses: false }));
    }, (error) => {
      setSourceLoaded(current => ({ ...current, warehouses: true }));
      setSourceErrors(current => ({ ...current, warehouses: true }));
      handleSupabaseError(error, OperationType.GET, 'warehouses');
    });
    const unsubCategories = onSnapshot(collection(db, 'productCategories'), (snap) => {
      setManagedCategories(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, name: String(d.data().name || '') })).filter((item: NamedOption) => item.name));
    }, (error) => handleSupabaseError(error, OperationType.GET, 'productCategories'));
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snap) => {
      setManagedSuppliers(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, name: String(d.data().name || '') })).filter((item: NamedOption) => item.name));
      setSourceLoaded(current => ({ ...current, suppliers: true }));
      setSourceErrors(current => ({ ...current, suppliers: false }));
    }, (error) => { setSourceLoaded(current => ({ ...current, suppliers: true })); setSourceErrors(current => ({ ...current, suppliers: true })); handleSupabaseError(error, OperationType.GET, 'suppliers'); });

    return () => {
      unsubProducts();
      unsubInventory();
      unsubWarehouses();
      unsubCategories();
      unsubSuppliers();
    };
  }, [sourceReload]);

  const handleDeleteWarehouse = async (warehouse: Warehouse) => {
    if (warehouseActionId !== null) return;
    const warehouseInventory = inventory.filter(item => item.warehouseId === warehouse.id);
    const stockCount = warehouseInventory.reduce((sum, item) => sum + item.quantity, 0);
    const warning = stockCount > 0
      ? `This warehouse still contains ${stockCount.toLocaleString()} units. Deleting it will also remove those inventory records. Continue?`
      : `Delete "${warehouse.name}"? This will also remove its inventory records.`;
    if (!window.confirm(warning)) return;

    setWarehouseActionId(warehouse.id);
    try {
      for (const item of warehouseInventory) {
        await deleteDoc(doc(db, 'inventory', item.id));
      }
      await deleteDoc(doc(db, 'warehouses', warehouse.id));
      toast.success(`Warehouse "${warehouse.name}" deleted`);
    } catch (err) {
      handleSupabaseError(err, OperationType.DELETE, `warehouses/${warehouse.id}`);
    } finally {
      setWarehouseActionId(null);
    }
  };

  const handleAddReference = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!referenceManager || !newReferenceName.trim()) return;
    const name = newReferenceName.trim();
    const values = referenceManager === 'category' ? categories : suppliers;
    if (values.some(value => value.toLowerCase() === name.toLowerCase())) {
      toast.error(`That ${referenceManager} already exists.`);
      return;
    }
    setReferenceAction('new');
    try {
      await addDoc(collection(db, referenceManager === 'category' ? 'productCategories' : 'suppliers'), { name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setNewReferenceName('');
      toast.success(`${referenceManager === 'category' ? 'Category' : 'Supplier'} added`);
    } catch (error) {
      handleSupabaseError(error, OperationType.CREATE, referenceManager === 'category' ? 'productCategories' : 'suppliers');
    } finally { setReferenceAction(null); }
  };

  const handleUpdateReference = async (oldName: string) => {
    if (!referenceManager || !referenceDraft.trim()) return;
    const name = referenceDraft.trim();
    setReferenceAction(oldName);
    try {
      const records = referenceManager === 'category' ? managedCategories : managedSuppliers;
      const record = records.find(item => item.name === oldName);
      const collectionName = referenceManager === 'category' ? 'productCategories' : 'suppliers';
      if (record) await updateDoc(doc(db, collectionName, record.id), { name, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, collectionName), { name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      for (const product of products.filter(item => referenceManager === 'category' ? item.category === oldName : item.supplier === oldName)) {
        await updateDoc(doc(db, 'products', product.id), { [referenceManager === 'category' ? 'category' : 'supplier']: name, updatedAt: new Date() });
      }
      setEditingReferenceName(null);
      toast.success(`${referenceManager === 'category' ? 'Category' : 'Supplier'} updated`);
    } catch (error) {
      handleSupabaseError(error, OperationType.UPDATE, referenceManager === 'category' ? 'productCategories' : 'suppliers');
    } finally { setReferenceAction(null); }
  };

  const handleDeleteReference = (name: string) => {
    if (!referenceManager) return;
    const affected = products.filter(item => referenceManager === 'category' ? item.category === name : item.supplier === name);
    setDeletingReference({
      name,
      type: referenceManager,
      affectedCount: affected.length,
      affectedItems: affected
    });
  };

  const confirmDeleteReference = async () => {
    if (!deletingReference) return;
    const { name, type, affectedCount } = deletingReference;
    setReferenceAction(name);
    try {
      const records = type === 'category' ? managedCategories : managedSuppliers;
      const record = records.find(item => item.name === name);
      if (record) {
        await deleteDoc(doc(db, type === 'category' ? 'productCategories' : 'suppliers', record.id));
      }

      // Reassign all affected products to 'Uncategorized' (or 'N/A')
      for (const product of products.filter(item => type === 'category' ? item.category === name : item.supplier === name)) {
        await updateDoc(doc(db, 'products', product.id), {
          [type === 'category' ? 'category' : 'supplier']: type === 'category' ? 'Uncategorized' : 'N/A',
          updatedAt: new Date()
        });
      }

      toast.success(
        type === 'category'
          ? `Category "${name}" deleted. ${affectedCount} product(s) moved to Uncategorized.`
          : `Supplier "${name}" deleted. ${affectedCount} product(s) updated.`
      );
    } catch (error) {
      handleSupabaseError(error, OperationType.DELETE, type === 'category' ? 'productCategories' : 'suppliers');
    } finally {
      setReferenceAction(null);
      setDeletingReference(null);
    }
  };

  const categories = Array.from(new Set([...managedCategories.map(item => item.name), ...products.map(product => product.category).filter(Boolean)])).sort();
  const suppliers = Array.from(new Set([...managedSuppliers.map(item => item.name), ...products.map(product => product.supplier).filter(Boolean) as string[]])).sort();

  if (!getSupplyChainViews(permissions.supplyChain).length) return null;

  return (
    <div className="space-y-5 pb-20">
      <SupplyChainWorkspace
        sourceLoading={['products', 'inventory', 'warehouses', 'suppliers'].some(table => !sourceLoaded[table])}
        sourceError={Object.values(sourceErrors).some(Boolean)}
        onRetrySources={() => setSourceReload(value => value + 1)}
        products={products}
        inventory={inventory}
        warehouses={warehouses}
        suppliers={managedSuppliers}
        onRemoveWarehouse={handleDeleteWarehouse}
        onRemoveSupplier={(name) => {
          const affected = products.filter(product => product.supplier === name);
          setDeletingReference({ name, type: 'supplier', affectedCount: affected.length, affectedItems: affected });
        }}
        categoriesContent={<CategoryWorkspace products={products} inventory={inventory} warehouses={warehouses} suppliers={managedSuppliers} loading={['products', 'inventory', 'warehouses', 'suppliers'].some(table => !sourceLoaded[table])} error={Object.values(sourceErrors).some(Boolean)} onRetry={() => setSourceReload(value => value + 1)} />}
      />

      <Dialog open={referenceManager !== null} onOpenChange={(open) => { if (!open) { setReferenceManager(null); setNewReferenceName(''); setEditingReferenceName(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage {referenceManager === 'category' ? 'Categories' : 'Suppliers'}</DialogTitle>
            <DialogDescription>Add, rename, or remove {referenceManager === 'category' ? 'product categories' : 'preferred suppliers'} used by Inventory.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddReference} className="space-y-3 border-b border-border pb-4">
            <Label htmlFor="newReferenceName">Add {referenceManager === 'category' ? 'Category' : 'Supplier'}</Label>
            <div className="flex gap-2"><Input id="newReferenceName" value={newReferenceName} onChange={event => setNewReferenceName(event.target.value)} required placeholder={`Enter ${referenceManager || ''} name`} /><Button type="submit" disabled={!newReferenceName.trim() || referenceAction !== null}><Plus className="mr-2 h-4 w-4" />Add</Button></div>
          </form>
          <div className="max-h-72 space-y-2 overflow-y-auto py-2 pr-1">
            {(referenceManager === 'category' ? categories : suppliers.filter(name => name !== 'N/A')).map(name => (
              <div key={name} className="flex items-center gap-2 rounded-xl border border-border p-3">
                {editingReferenceName === name ? (
                  <>
                    <Input value={referenceDraft} onChange={event => setReferenceDraft(event.target.value)} autoFocus />
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingReferenceName(null)}>Cancel</Button>
                    <Button type="button" size="sm" disabled={!referenceDraft.trim() || referenceAction !== null} onClick={() => handleUpdateReference(name)}>Save</Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
                    <Button type="button" variant="ghost" size="icon" title={`Edit ${referenceManager}`} disabled={referenceAction !== null} onClick={() => { setEditingReferenceName(name); setReferenceDraft(name); }}><Pencil className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" title={`Delete ${referenceManager}`} disabled={referenceAction !== null} className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => handleDeleteReference(name)}><Trash2 className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
            ))}
            {(referenceManager === 'category' ? categories : suppliers.filter(name => name !== 'N/A')).length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No {referenceManager === 'category' ? 'categories' : 'suppliers'} added yet.</div>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Destructive Reference Deletion Confirmation Dialog */}
      <Dialog open={deletingReference !== null} onOpenChange={(open) => { if (!open && referenceAction === null) setDeletingReference(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Delete {deletingReference?.type === 'category' ? 'Category' : 'Supplier'}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <span className="font-bold text-foreground">"{deletingReference?.name}"</span> from the catalog?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {deletingReference && deletingReference.affectedCount > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      {deletingReference.affectedCount} Product{deletingReference.affectedCount > 1 ? 's' : ''} Will Be Affected
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Deleting this {deletingReference.type} will automatically wipe its assignment and reassign all affected products to <span className="font-mono font-bold">{deletingReference.type === 'category' ? 'Uncategorized' : 'N/A'}</span>.
                    </p>
                  </div>
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1.5 rounded-lg border border-amber-200/60 bg-white/80 p-2 dark:border-amber-900/30 dark:bg-zinc-900/80">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Affected Items:</p>
                  {deletingReference.affectedItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between text-xs py-0.5">
                      <span className="font-semibold truncate max-w-[200px]">{item.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{item.sku}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center gap-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <p className="text-xs text-emerald-800 dark:text-emerald-200">
                  No products are currently using this {deletingReference?.type}. It is safe to delete without reassigning any products.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingReference(null)}
              disabled={referenceAction !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeleteReference}
              disabled={referenceAction !== null}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {referenceAction !== null ? 'Deleting...' : deletingReference && deletingReference.affectedCount > 0 ? `Reassign ${deletingReference.affectedCount} & Delete` : `Delete ${deletingReference?.type === 'category' ? 'Category' : 'Supplier'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
