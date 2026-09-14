import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from '../lib/supabaseAdapter';
import { Product, InventoryItem, Warehouse } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, Plus, QrCode, Package, Warehouse as WarehouseIcon, Building2, AlertTriangle, Eye, CircleDollarSign, SlidersHorizontal, Tag, Pencil, Trash2, MapPin, ImagePlus, X, Download, Upload, FileSpreadsheet, FileText, BarChart3, Info, Printer, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

const PRODUCT_TEMPLATE_HEADERS = ['SKU Code', 'Item Name', 'Category', 'Supplier Name', 'Base Price / Retail Price', 'Metro Manila Price', 'Provincial Price', 'Cost', 'Minimum Stock Level', 'Reorder Point'];
type ImportRow = Record<string, string | number | undefined>;
interface ProductImportPreview { row: number; data: Omit<Product, 'id'>; errors: string[]; }
interface NamedOption { id: string; name: string; }

export function Inventory() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [hideZeroStock, setHideZeroStock] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ProductImportPreview[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState('');

  // Add Product form state for uniqueness and select tracking
  const [addSku, setAddSku] = useState('');
  const [addName, setAddName] = useState('');
  const [addCategory, setAddCategory] = useState('Uncategorized');
  const [addSupplier, setAddSupplier] = useState('N/A');

  // Edit Product form state for uniqueness and select tracking
  const [editSku, setEditSku] = useState('');
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('Uncategorized');
  const [editSupplier, setEditSupplier] = useState('N/A');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  // Warehouse Filter State (for filtering inventory view)
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [isWarehouseManagerOpen, setIsWarehouseManagerOpen] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState('');
  const [newWarehouseLocation, setNewWarehouseLocation] = useState('');
  const [isCreatingWarehouse, setIsCreatingWarehouse] = useState(false);
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);
  const [editingWarehouseName, setEditingWarehouseName] = useState('');
  const [editingWarehouseLocation, setEditingWarehouseLocation] = useState('');
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

  const [hasDelegatedAccess, setHasDelegatedAccess] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const canAdjustStock = isAdmin || hasDelegatedAccess;

  useEffect(() => {
    if (!productImage) {
      setProductImagePreview('');
      return;
    }

    const previewUrl = URL.createObjectURL(productImage);
    setProductImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [productImage]);

  useEffect(() => {
    if (editingProduct) {
      setEditSku(editingProduct.sku || '');
      setEditName(editingProduct.name || '');
      setEditCategory(editingProduct.category || 'Uncategorized');
      setEditSupplier(editingProduct.supplier || 'N/A');
    }
  }, [editingProduct]);

  useEffect(() => {
    if (!isAddProductOpen) {
      setAddSku('');
      setAddName('');
      setAddCategory('Uncategorized');
      setAddSupplier('N/A');
    }
  }, [isAddProductOpen]);

  useEffect(() => {
    if (!profile || profile.role !== 'staff') return;
    const q = query(collection(db, 'delegations'), where('staffEmail', '==', profile.email.toLowerCase()));
    const unsub = onSnapshot(q, (snap) => {
      const hasAccess = snap.docs.some((d: { data: () => Record<string, unknown> }) => d.data().canAdjustInventory === true);
      setHasDelegatedAccess(hasAccess);
    });
    return () => unsub();
  }, [profile]);

  useEffect(() => {
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Product)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'products');
    });
    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snap) => {
      setInventory(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'inventory');
    });
    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snap) => {
      setWarehouses(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Warehouse)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'warehouses');
    });
    const unsubCategories = onSnapshot(collection(db, 'productCategories'), (snap) => {
      setManagedCategories(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, name: String(d.data().name || '') })).filter((item: NamedOption) => item.name));
    }, (error) => handleSupabaseError(error, OperationType.GET, 'productCategories'));
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snap) => {
      setManagedSuppliers(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, name: String(d.data().name || '') })).filter((item: NamedOption) => item.name));
    }, (error) => handleSupabaseError(error, OperationType.GET, 'suppliers'));

    return () => {
      unsubProducts();
      unsubInventory();
      unsubWarehouses();
      unsubCategories();
      unsubSuppliers();
    };
  }, []);

  const handleAddProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const sku = String(formData.get('sku') || addSku || '').trim();
    const name = String(formData.get('name') || addName || '').trim();
    const category = String(addCategory || formData.get('category') || 'Uncategorized').trim() || 'Uncategorized';
    const supplier = String(addSupplier || formData.get('supplier') || 'N/A').trim() || 'N/A';

    if (!sku) {
      toast.error('SKU Code is required.');
      return;
    }
    if (products.some(p => p.sku.trim().toLowerCase() === sku.toLowerCase())) {
      toast.error(`SKU Code must be unique. A product with SKU "${sku}" already exists.`);
      return;
    }
    if (!name) {
      toast.error('Item Name is required.');
      return;
    }
    if (products.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(`Item Name must be unique. A product named "${name}" already exists.`);
      return;
    }

    const basePrice = Number(formData.get('basePrice')) || 0;
    const mmPrice = Number(formData.get('mmPrice')) || Number(formData.get('wholesalePrice')) || 0;
    const provincialPrice = Number(formData.get('provincialPrice')) || Number(formData.get('dealerPrice')) || 0;
    const costPrice = Number(formData.get('costPrice')) || 0;
    const promoPriceValue = formData.get('promoPrice');

    const newProduct = {
      sku,
      name,
      category,
      supplier,
      basePrice,
      wholesalePrice: mmPrice,
      dealerPrice: provincialPrice,
      mmPrice,
      provincialPrice,
      costPrice,
      promoPrice: promoPriceValue ? Number(promoPriceValue) : undefined,
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
      setProductImage(null);
      setIsAddProductOpen(false);
      toast.success('Product added to CI catalog');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'products');
    }
  };

  const handleDownloadProductTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([PRODUCT_TEMPLATE_HEADERS]);
    sheet['!cols'] = PRODUCT_TEMPLATE_HEADERS.map((header) => ({ wch: Math.max(header.length + 2, 16) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
    XLSX.writeFile(workbook, 'inventory-product-import-template.xlsx');
  };

  const handleProductImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The workbook does not contain a worksheet.');
      const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: '' });
      const existingSkus = new Set(products.map((product) => product.sku.trim().toLowerCase()));
      const fileSkus = new Set<string>();
      const existingNames = new Set(products.map((product) => product.name.trim().toLowerCase()));
      const fileNames = new Set<string>();
      const preview = rows.map((row, index) => {
        const sku = String(row['SKU Code'] ?? '').trim();
        const name = String(row['Item Name'] ?? '').trim();
        const errors: string[] = [];
        if (!sku) errors.push('SKU Code is required');
        if (!name) errors.push('Item Name is required');
        const normalizedSku = sku.toLowerCase();
        if (sku && existingSkus.has(normalizedSku)) errors.push('SKU already exists in Inventory');
        if (sku && fileSkus.has(normalizedSku)) errors.push('Duplicate SKU in file');
        if (sku) fileSkus.add(normalizedSku);
        const normalizedName = name.toLowerCase();
        if (name && existingNames.has(normalizedName)) errors.push('Item Name already exists in Inventory');
        if (name && fileNames.has(normalizedName)) errors.push('Duplicate Item Name in file');
        if (name) fileNames.add(normalizedName);
        const numericHeaders = ['Base Price / Retail Price', 'Metro Manila Price', 'Provincial Price', 'Cost', 'Minimum Stock Level', 'Reorder Point'];
        numericHeaders.forEach((header) => {
          const value = row[header];
          if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) errors.push(`${header} must be a non-negative number`);
        });
        const now = new Date();
        return {
          row: index + 2,
          errors,
          data: {
            sku, name,
            category: String(row.Category || 'Uncategorized').trim() || 'Uncategorized',
            supplier: String(row['Supplier Name'] || 'Supplier').trim() || 'Supplier',
            basePrice: Number(row['Base Price / Retail Price']) || 0,
            mmPrice: Number(row['Metro Manila Price']) || 0,
            wholesalePrice: Number(row['Metro Manila Price']) || 0,
            provincialPrice: Number(row['Provincial Price']) || 0,
            dealerPrice: Number(row['Provincial Price']) || 0,
            costPrice: Number(row.Cost) || 0,
            minStockLevel: Number(row['Minimum Stock Level']) || 0,
            reorderPoint: Number(row['Reorder Point']) || 0,
            createdAt: now, updatedAt: now,
          },
        };
      });
      if (!preview.length) throw new Error('No product rows were found in the worksheet.');
      setImportPreview(preview);
      setImportFileName(file.name);
    } catch (error) {
      setImportPreview([]);
      setImportFileName('');
      event.target.value = '';
      toast.error(error instanceof Error ? error.message : 'Unable to read the Excel file.');
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview.length || importPreview.some((row) => row.errors.length)) return;
    setIsImporting(true);
    try {
      for (const row of importPreview) {
        const productRef = await addDoc(collection(db, 'products'), row.data);
        for (const warehouse of warehouses) await addDoc(collection(db, 'inventory'), { productId: productRef.id, warehouseId: warehouse.id, quantity: 0, lastUpdated: serverTimestamp() });
      }
      toast.success(`${importPreview.length} products added to Inventory`);
      setIsImportOpen(false); setImportPreview([]); setImportFileName('');
    } catch (error) {
      handleSupabaseError(error, OperationType.CREATE, 'products');
    } finally { setIsImporting(false); }
  };

  const handleEditProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProduct) return;
    const form = new FormData(event.currentTarget);
    const sku = String(editSku || form.get('sku') || '').trim();
    const name = String(editName || form.get('name') || '').trim();
    const category = String(editCategory || form.get('category') || 'Uncategorized').trim() || 'Uncategorized';
    const supplier = String(editSupplier || form.get('supplier') || 'N/A').trim() || 'N/A';

    if (!sku) {
      toast.error('SKU Code is required.');
      return;
    }
    if (products.some((product) => product.id !== editingProduct.id && product.sku.trim().toLowerCase() === sku.toLowerCase())) {
      toast.error(`SKU Code must be unique. A product with SKU "${sku}" already exists.`);
      return;
    }
    if (!name) {
      toast.error('Item Name is required.');
      return;
    }
    if (products.some((product) => product.id !== editingProduct.id && product.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(`Item Name must be unique. A product named "${name}" already exists.`);
      return;
    }
    try {
      const mmPrice = Number(form.get('mmPrice')) || 0;
      const provincialPrice = Number(form.get('provincialPrice')) || 0;
      await updateDoc(doc(db, 'products', editingProduct.id), {
        sku,
        name,
        category,
        supplier,
        basePrice: Number(form.get('basePrice')) || 0,
        mmPrice,
        wholesalePrice: mmPrice,
        provincialPrice,
        dealerPrice: provincialPrice,
        costPrice: Number(form.get('costPrice')) || 0,
        promoPrice: form.get('promoPrice') !== '' ? Number(form.get('promoPrice')) : null,
        minStockLevel: Number(form.get('minStockLevel')) || 0,
        reorderPoint: Number(form.get('reorderPoint')) || 0,
        updatedAt: new Date(),
      });
      setEditingProduct(null);
      toast.success('Product updated successfully');
    } catch (error) {
      handleSupabaseError(error, OperationType.UPDATE, `products/${editingProduct.id}`);
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
      setNewWarehouseName('');
      setNewWarehouseLocation('');
      toast.success(`Warehouse "${newWarehouseName}" added successfully`);
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'warehouses');
    } finally {
      setIsCreatingWarehouse(false);
    }
  };

  const startEditingWarehouse = (warehouse: Warehouse) => {
    setEditingWarehouseId(warehouse.id);
    setEditingWarehouseName(warehouse.name);
    setEditingWarehouseLocation(warehouse.location || '');
  };

  const handleUpdateWarehouse = async (warehouseId: string) => {
    if (!editingWarehouseName.trim()) return;
    setWarehouseActionId(warehouseId);
    try {
      await updateDoc(doc(db, 'warehouses', warehouseId), {
        name: editingWarehouseName.trim(),
        location: editingWarehouseLocation.trim() || 'Warehouse Facility',
      });
      setEditingWarehouseId(null);
      toast.success('Warehouse updated successfully');
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `warehouses/${warehouseId}`);
    } finally {
      setWarehouseActionId(null);
    }
  };

  const handleDeleteWarehouse = async (warehouse: Warehouse) => {
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
      if (warehouseFilter === warehouse.id) setWarehouseFilter('all');
      if (editingWarehouseId === warehouse.id) setEditingWarehouseId(null);
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

  const updateStock = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const warehouseId = formData.get('warehouseId') as string;
    const quantity = Number(formData.get('quantity'));
    const reason = formData.get('reason') as string;

    const item = inventory.find(i => i.productId === selectedProduct?.id && i.warehouseId === warehouseId);
    if (selectedProduct && profile) {
      try {
        if (item) {
          // 1a. Existing row — update the inventory level
          await updateDoc(doc(db, 'inventory', item.id), {
            quantity: item.quantity + quantity,
            lastUpdated: serverTimestamp()
          });
        } else {
          // 1b. No row for this product+warehouse yet — insert one
          await addDoc(collection(db, 'inventory'), {
            productId: selectedProduct.id,
            warehouseId,
            quantity,
            lastUpdated: serverTimestamp()
          });
        }

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
        handleSupabaseError(err, OperationType.UPDATE, `inventory/${item?.id || 'new'}`);
      }
    }
  };

  const getStockCount = (productId: string, warehouseId?: string) => {
    const items = inventory.filter(i => i.productId === productId);
    if (warehouseId && warehouseId !== 'all') {
      return items.find(i => i.warehouseId === warehouseId)?.quantity || 0;
    }
    // Clamp per-warehouse quantities at 0 to prevent negative stock in one
    // warehouse from masking deficits when aggregating across all warehouses.
    // e.g. Warehouse A: 10,050 + Warehouse B: -600 should show 10,050 not 9,450
    return items.reduce((sum, i) => sum + Math.max(0, i.quantity), 0);
  };

  // Check if any individual warehouse has stock at or below zero for a product
  const hasAnyWarehouseDeficit = (productId: string) => {
    return warehouses.some(wh => {
      const item = inventory.find(i => i.productId === productId && i.warehouseId === wh.id);
      return item !== undefined && item.quantity <= 0;
    });
  };

  // Check if any individual warehouse has low stock for a product
  const hasAnyWarehouseLowStock = (productId: string, product: Product) => {
    const threshold = product.reorderPoint || product.minStockLevel || 0;
    return warehouses.some(wh => {
      const item = inventory.find(i => i.productId === productId && i.warehouseId === wh.id);
      const qty = item?.quantity || 0;
      return qty > 0 && qty <= threshold;
    });
  };

  const getWarehouseStock = (warehouseId: string) =>
    inventory
      .filter(item => item.warehouseId === warehouseId)
      .reduce((sum, item) => sum + item.quantity, 0);

  const activeWarehouseObj = warehouses.find(w => w.id === warehouseFilter);
  const activeWarehouseLabel = warehouseFilter === 'all'
    ? 'All Warehouses'
    : (activeWarehouseObj?.name || 'Warehouse Filter');

  const categories = Array.from(new Set([...managedCategories.map(item => item.name), ...products.map(product => product.category).filter(Boolean)])).sort();
  const suppliers = Array.from(new Set([...managedSuppliers.map(item => item.name), ...products.map(product => product.supplier).filter(Boolean) as string[]])).sort();
  const categoryOptions = Array.from(new Set(['Uncategorized', ...categories])).filter(Boolean).sort();
  const supplierOptions = Array.from(new Set(['N/A', ...suppliers])).filter(Boolean).sort();

  const isAddSkuDuplicate = Boolean(
    addSku.trim() && products.some(p => p.sku.trim().toLowerCase() === addSku.trim().toLowerCase())
  );
  const isAddNameDuplicate = Boolean(
    addName.trim() && products.some(p => p.name.trim().toLowerCase() === addName.trim().toLowerCase())
  );

  const isEditSkuDuplicate = Boolean(
    editingProduct && editSku.trim() &&
    products.some(p => p.id !== editingProduct.id && p.sku.trim().toLowerCase() === editSku.trim().toLowerCase())
  );
  const isEditNameDuplicate = Boolean(
    editingProduct && editName.trim() &&
    products.some(p => p.id !== editingProduct.id && p.name.trim().toLowerCase() === editName.trim().toLowerCase())
  );
  const getProductStatus = (product: Product, stock: number, _checkWarehouseId?: string) => {
    if (stock <= 0) return 'out';
    const threshold = product.reorderPoint || product.minStockLevel || 0;
    if (stock <= threshold) return 'low';
    return 'in';
  };
  const filteredProducts = products.filter(product => {
    const term = searchTerm.trim().toLowerCase();
    const stock = getStockCount(product.id, warehouseFilter);
    const matchesSearch = [product.name, product.sku, product.category, product.supplier]
      .some(value => (value || '').toLowerCase().includes(term));
    return matchesSearch
      && (categoryFilter === 'all' || product.category === categoryFilter)
      && (supplierFilter === 'all' || product.supplier === supplierFilter)
      && (stockFilter === 'all' || getProductStatus(product, stock, warehouseFilter) === stockFilter)
      && (!hideZeroStock || stock > 0);
  });

  const totalProducts = products.length;
  const lowStockProducts = products.filter(product => {
    const stock = getStockCount(product.id, warehouseFilter);
    return getProductStatus(product, stock, warehouseFilter) === 'low';
  }).length;

  const outOfStockProducts = products.filter(product => {
    const stock = getStockCount(product.id, warehouseFilter);
    return getProductStatus(product, stock, warehouseFilter) === 'out';
  }).length;

  const inventoryValue = products.reduce((total, product) => {
    const unitVal = (product.costPrice && product.costPrice > 0) ? product.costPrice : (product.basePrice || 0);
    return total + unitVal * Math.max(0, getStockCount(product.id, warehouseFilter));
  }, 0);

  const printThermalLabel = (product: Product, svgContainerId?: string) => {
    let svgHtml = '';
    if (svgContainerId) {
      const container = document.getElementById(svgContainerId);
      const svg = container?.querySelector('svg');
      if (svg) svgHtml = svg.outerHTML;
    }
    if (!svgHtml) {
      const anySvg = document.querySelector('[role="dialog"] svg');
      if (anySvg) svgHtml = anySvg.outerHTML;
    }

    const priceFormatted = (product.wholesalePrice || product.basePrice || 0).toLocaleString();
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Label - ${product.sku}</title>
          <style>
            @page {
              size: 50mm 30mm;
              margin: 0;
            }
            @media print {
              html, body {
                width: 50mm;
                height: 30mm;
                margin: 0;
                padding: 0;
              }
            }
            body {
              margin: 0;
              padding: 2mm 3mm;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              width: 50mm;
              height: 30mm;
              box-sizing: border-box;
              display: flex;
              align-items: center;
              justify-content: space-between;
              background: #fff;
              color: #000;
              overflow: hidden;
            }
            .qr-side {
              width: 22mm;
              height: 22mm;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
            }
            .qr-side svg {
              width: 100% !important;
              height: 100% !important;
              display: block;
            }
            .info-side {
              flex: 1;
              display: flex;
              flex-direction: column;
              justify-content: center;
              padding-left: 2mm;
              overflow: hidden;
            }
            .brand {
              font-size: 5.5pt;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #555;
              margin-bottom: 0.5mm;
            }
            .prod-name {
              font-size: 7.5pt;
              font-weight: 800;
              line-height: 1.15;
              color: #000;
              margin-bottom: 1mm;
              word-break: break-word;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }
            .prod-sku {
              font-family: "Courier New", Courier, monospace;
              font-size: 6.5pt;
              font-weight: 700;
              color: #222;
            }
            .prod-price {
              font-size: 7.5pt;
              font-weight: 800;
              color: #000;
              margin-top: 1mm;
            }
          </style>
        </head>
        <body>
          <div class="qr-side">${svgHtml}</div>
          <div class="info-side">
            <div class="brand">ActivePro Asset</div>
            <div class="prod-name">${product.name}</div>
            <div class="prod-sku">${product.sku}</div>
            <div class="prod-price">₱${priceFormatted}</div>
          </div>
        </body>
      </html>
    `;

    const frameDoc = printFrame.contentWindow?.document || printFrame.contentDocument;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(htmlContent);
      frameDoc.close();
      setTimeout(() => {
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
        setTimeout(() => {
          if (document.body.contains(printFrame)) {
            document.body.removeChild(printFrame);
          }
        }, 1500);
      }, 250);
    }
  };


  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage products, stock levels, suppliers, and warehouse inventory.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/pricelist')} className="h-11 gap-3 rounded-xl border-zinc-200 bg-white px-5 text-base font-semibold text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700">
            <Tag className="h-5 w-5 text-zinc-500" strokeWidth={2.25} /> Pricelist
          </Button>
          {isAdmin && <Select value="" onValueChange={(value) => { if (value === 'warehouses') setIsWarehouseManagerOpen(true); if (value === 'categories') setReferenceManager('category'); if (value === 'suppliers') setReferenceManager('supplier'); }}><SelectTrigger className="h-11! w-auto gap-2 rounded-xl px-5 font-bold shadow-sm"><Building2 className="h-4 w-4" /><SelectValue placeholder="Manage" /></SelectTrigger><SelectContent><SelectItem value="warehouses">Warehouses</SelectItem><SelectItem value="categories">Categories</SelectItem><SelectItem value="suppliers">Suppliers</SelectItem></SelectContent></Select>}
          {isAdmin && <Button type="button" variant="outline" onClick={() => setIsImportOpen(true)} className="h-11 gap-2 rounded-xl px-5 font-bold shadow-sm"><Upload className="h-4 w-4" /> Import Products</Button>}
          {isAdmin && <Button type="button" onClick={() => setIsAddProductOpen(true)} className="h-11 gap-2 rounded-xl bg-[#101d33] px-5 font-bold text-white shadow-lg hover:bg-[#172842]"><Plus className="h-4 w-4" /> Add Product</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Products', value: totalProducts.toLocaleString(), helper: 'All active products', icon: Package, tone: 'bg-blue-500/10 text-blue-500' },
          { label: 'Low Stock', value: lowStockProducts.toLocaleString(), helper: 'Products low on stock', icon: AlertTriangle, tone: 'bg-amber-500/10 text-amber-500' },
          { label: 'Out of Stock', value: outOfStockProducts.toLocaleString(), helper: 'Products out of stock', icon: Package, tone: 'bg-red-500/10 text-red-500' },
          { label: 'Inventory Value', value: '₱' + inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 2 }), helper: 'Across ' + activeWarehouseLabel, icon: CircleDollarSign, tone: 'bg-emerald-500/10 text-emerald-600' },
        ].map(metric => (
          <Card key={metric.label} className="rounded-2xl border-border/70 shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <div className={'flex h-14 w-14 shrink-0 items-center justify-center rounded-full ' + metric.tone}><metric.icon className="h-7 w-7" /></div>
              <div className="min-w-0"><p className="text-xs font-semibold text-muted-foreground">{metric.label}</p><p className="truncate text-2xl font-black tracking-tight">{metric.value}</p><p className="truncate text-xs text-muted-foreground">{metric.helper}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-border p-4">
            <div className="relative max-w-xl">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search products, SKU, category, or supplier..." className="h-11 rounded-xl bg-background pl-10" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Warehouse</Label><Select value={warehouseFilter} onValueChange={(value) => setWarehouseFilter(value ?? 'all')}><SelectTrigger className="h-10 rounded-xl"><SelectValue>{warehouseFilter === 'all' ? 'All Warehouses' : activeWarehouseObj?.name}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All Warehouses</SelectItem>{warehouses.map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Category</Label><Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value ?? 'all')}><SelectTrigger className="h-10 rounded-xl"><SelectValue>{categoryFilter === 'all' ? 'All Categories' : categoryFilter}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Supplier</Label><Select value={supplierFilter} onValueChange={(value) => setSupplierFilter(value ?? 'all')}><SelectTrigger className="h-10 rounded-xl"><SelectValue>{supplierFilter === 'all' ? 'All Suppliers' : supplierFilter}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All Suppliers</SelectItem>{suppliers.map(supplier => <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Stock Status</Label><Select value={stockFilter} onValueChange={(value) => setStockFilter(value ?? 'all')}><SelectTrigger className="h-10 rounded-xl"><SelectValue>{stockFilter === 'all' ? 'All Statuses' : stockFilter === 'in' ? 'In Stock' : stockFilter === 'low' ? 'Low Stock' : 'Out of Stock'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="in">In Stock</SelectItem><SelectItem value="low">Low Stock</SelectItem><SelectItem value="out">Out of Stock</SelectItem></SelectContent></Select></div>
            <label className="flex h-10 cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-xl border border-border px-3 text-xs font-medium">Hide zero-stock<input type="checkbox" checked={hideZeroStock} onChange={(event) => setHideZeroStock(event.target.checked)} className="h-4 w-4 accent-[#101d33]" /></label>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40"><TableRow><TableHead className="min-w-28 text-[10px] font-bold uppercase">SKU</TableHead><TableHead className="min-w-64 text-[10px] font-bold uppercase">Product</TableHead><TableHead className="min-w-36 text-[10px] font-bold uppercase">Pricing (₱)</TableHead><TableHead className="min-w-24 text-[10px] font-bold uppercase">Cost (₱)</TableHead><TableHead className="min-w-28 text-center text-[10px] font-bold uppercase">Stock</TableHead><TableHead className="min-w-32 text-[10px] font-bold uppercase">Stock Levels</TableHead><TableHead className="min-w-40 text-[10px] font-bold uppercase">Supplier</TableHead><TableHead className="min-w-32 text-center text-[10px] font-bold uppercase">Status</TableHead><TableHead className="min-w-28 text-right text-[10px] font-bold uppercase">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {filteredProducts.map(product => {
                const stock = getStockCount(product.id, warehouseFilter);
                const status = getProductStatus(product, stock, warehouseFilter);
                const statusClass = status === 'out' ? 'border-red-200 bg-red-50 text-red-600' : status === 'low' ? 'border-amber-200 bg-amber-50 text-amber-600' : 'border-emerald-200 bg-emerald-50 text-emerald-600';
                return (
                  <TableRow key={product.id} className="cursor-pointer hover:bg-muted/30" onClick={() => { setSelectedProduct(product); setIsDetailOpen(true); }}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{product.sku}</TableCell>
                    <TableCell><div className="flex items-center gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">{product.photoUrl ? <img src={product.photoUrl} alt="" className="h-full w-full object-contain" /> : <Package className="h-5 w-5 text-muted-foreground" />}</div><div className="min-w-0"><p className="truncate text-sm font-bold">{product.name}</p><p className="truncate text-xs text-muted-foreground">{product.category || 'Uncategorized'}</p></div></div></TableCell>
                    <TableCell><div className="grid grid-cols-[2.75rem_auto] text-xs"><span className="text-muted-foreground">Retail:</span><strong>₱{(product.basePrice || 0).toLocaleString()}</strong><span className="text-muted-foreground">MM:</span><strong>₱{(product.mmPrice ?? product.wholesalePrice ?? 0).toLocaleString()}</strong><span className="text-muted-foreground">Prov.:</span><strong>₱{(product.provincialPrice ?? product.dealerPrice ?? 0).toLocaleString()}</strong></div></TableCell>
                    <TableCell className="text-sm font-semibold">₱{(product.costPrice || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline" className={'rounded-full px-3 ' + statusClass}>{stock.toLocaleString()} units</Badge></TableCell>
                    <TableCell><div className="text-xs"><p><span className="text-muted-foreground">Minimum:</span> <strong>{product.minStockLevel || 0}</strong></p><p><span className="text-muted-foreground">Reorder:</span> <strong>{product.reorderPoint || 0}</strong></p></div></TableCell>
                    <TableCell><p className="text-sm font-bold">{product.supplier || 'Supplier'}</p><p className="text-xs text-muted-foreground">Main Supplier</p></TableCell>
                    <TableCell className="text-center"><Badge variant="outline" className={'rounded-full ' + statusClass}>{status === 'out' ? '● Out of Stock' : status === 'low' ? '● Low Stock' : '● In Stock'}</Badge></TableCell>
                    <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="icon" className="h-9 w-9" title="View product" onClick={() => { setSelectedProduct(product); setIsDetailOpen(true); }}><Eye className="h-4 w-4" /></Button>
                        {isAdmin && <Button variant="outline" size="icon" className="h-9 w-9" title="Edit product" onClick={() => setEditingProduct(product)}><Pencil className="h-4 w-4" /></Button>}
                        <Dialog><DialogTrigger className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted"><QrCode className="h-4 w-4" /></DialogTrigger><DialogContent className="text-center sm:max-w-xs"><DialogHeader><DialogTitle className="text-center">Asset QR Label</DialogTitle></DialogHeader><div className="flex flex-col items-center gap-4 py-8"><div id={`qr-svg-table-${product.id}`} className="rounded-2xl border-2 border-primary p-4"><QRCodeSVG value={product.id} size={180} /></div><div><p className="font-black">{product.name}</p><p className="font-mono text-xs text-muted-foreground">{product.sku}</p></div></div><Button variant="outline" onClick={() => printThermalLabel(product, `qr-svg-table-${product.id}`)}><Printer className="mr-2 h-4 w-4" />Print Label</Button></DialogContent></Dialog>
                        {canAdjustStock && <Button variant="outline" size="icon" className="h-9 w-9" title="Adjust stock" onClick={() => { setSelectedProduct(product); setIsStockUpdateOpen(true); }}><SlidersHorizontal className="h-4 w-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredProducts.length === 0 && <TableRow><TableCell colSpan={9} className="h-40 text-center text-sm text-muted-foreground">No products match the current filters.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground"><span>Showing {filteredProducts.length.toLocaleString()} of {products.length.toLocaleString()} products</span><span>{warehouses.length.toLocaleString()} warehouse{warehouses.length === 1 ? '' : 's'} connected</span></div>
      </div>

      <Dialog open={isAddProductOpen} onOpenChange={(open) => { setIsAddProductOpen(open); if (!open) setProductImage(null); }}>
        <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>New Configuration Item (Product)</DialogTitle><DialogDescription>Register a new bicycle component into the service catalog.</DialogDescription></DialogHeader>
          <form onSubmit={handleAddProduct} className="space-y-5 pt-2">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <section className="space-y-3 rounded-xl border border-border p-4">
                <h3 className="border-b border-border pb-2 text-sm font-bold">Product Image</h3>
                <div className="space-y-2">
                  <Label htmlFor="productImage">Product Image</Label>
                  <div className="space-y-3 rounded-xl border border-dashed border-border p-3">
                    {productImagePreview ? <img src={productImagePreview} alt="Product preview" className="aspect-square w-full rounded-lg border border-border object-cover" /> : <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted"><ImagePlus className="h-10 w-10 text-muted-foreground" /></div>}
                    <div className="flex items-center gap-2">
                      <Input id="productImage" name="productImage" type="file" accept="image/*" onChange={(event) => setProductImage(event.target.files?.[0] ?? null)} className="min-w-0 cursor-pointer" />
                      {productImage && <Button type="button" variant="ghost" size="icon" title="Remove image" onClick={() => setProductImage(null)}><X className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                </div>
              </section>
              <section className="space-y-3 rounded-xl border border-border p-4 md:col-span-2">
                <h3 className="border-b border-border pb-2 text-sm font-bold">Product Information</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="sku">SKU Code</Label>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Must be unique</span>
                    </div>
                    <Input
                      id="sku"
                      name="sku"
                      required
                      placeholder="e.g. AP-XYZ-123"
                      value={addSku}
                      onChange={(e) => setAddSku(e.target.value)}
                      className={isAddSkuDuplicate ? 'border-red-500 focus-visible:ring-red-500' : ''}
                    />
                    {isAddSkuDuplicate && (
                      <p className="text-xs font-semibold text-red-500">⚠️ SKU Code is already in use by another product.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="name">Item Name</Label>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Must be unique</span>
                    </div>
                    <Input
                      id="name"
                      name="name"
                      required
                      placeholder="e.g. Mountain Bike"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      className={isAddNameDuplicate ? 'border-red-500 focus-visible:ring-red-500' : ''}
                    />
                    {isAddNameDuplicate && (
                      <p className="text-xs font-semibold text-red-500">⚠️ Item Name is already in use by another product.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select name="category" value={addCategory} onValueChange={setAddCategory}>
                      <SelectTrigger id="category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 overflow-y-auto">
                        {categoryOptions.map(category => (
                          <SelectItem key={category} value={category}>{category}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supplier">Preferred Supplier</Label>
                    <Select name="supplier" value={addSupplier} onValueChange={setAddSupplier}>
                      <SelectTrigger id="supplier">
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 overflow-y-auto">
                        {supplierOptions.map(supplier => (
                          <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>
            </div>
            <section className="space-y-3">
              <h3 className="border-b border-border pb-2 text-sm font-bold">Pricing</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="basePrice">Price (₱)</Label><Input id="basePrice" name="basePrice" type="number" min="0" step="0.01" required /></div>
                <div className="space-y-2"><Label htmlFor="costPrice">Cost (₱)</Label><Input id="costPrice" name="costPrice" type="number" min="0" step="0.01" /></div>
                <div className="space-y-2"><Label htmlFor="promoPrice">Promo Price (₱)</Label><Input id="promoPrice" name="promoPrice" type="number" min="0" step="0.01" /></div>
                <div className="space-y-2"><Label htmlFor="mmPrice">Metro Manila Wholesale (₱)</Label><Input id="mmPrice" name="mmPrice" type="number" min="0" step="0.01" /></div>
                <div className="space-y-2"><Label htmlFor="provincialPrice">Provincial Wholesale (₱)</Label><Input id="provincialPrice" name="provincialPrice" type="number" min="0" step="0.01" /></div>
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="border-b border-border pb-2 text-sm font-bold">Stock Controls</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="minStockLevel">Critical Stock Level</Label><Input id="minStockLevel" name="minStockLevel" type="number" min="0" defaultValue="0" /></div>
                <div className="space-y-2"><Label htmlFor="reorderPoint">Restock Level</Label><Input id="reorderPoint" name="reorderPoint" type="number" min="0" defaultValue="0" /></div>
              </div>
            </section>
            <DialogFooter><Button type="submit" disabled={isAddSkuDuplicate || isAddNameDuplicate}>Add Product</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportOpen} onOpenChange={(open) => { setIsImportOpen(open); if (!open) { setImportPreview([]); setImportFileName(''); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader><DialogTitle>Import Products</DialogTitle><DialogDescription>Download the template, upload the completed Excel file, review validation results, then confirm to add products to Inventory.</DialogDescription></DialogHeader>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={handleDownloadProductTemplate}><Download className="mr-2 h-4 w-4" />Download Excel Template</Button><label htmlFor="inventoryImportFile" className="inline-flex h-10 cursor-pointer items-center rounded-md bg-[#101d33] px-4 text-sm font-medium text-white"><Upload className="mr-2 h-4 w-4" />Upload Excel File</label><Input id="inventoryImportFile" type="file" accept=".xlsx,.xls" onChange={handleProductImportFile} className="sr-only" /></div>
          {importFileName && <p className="text-sm text-muted-foreground"><FileSpreadsheet className="mr-2 inline h-4 w-4" />{importFileName} — {importPreview.length} records</p>}
          {importPreview.length > 0 && <div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>SKU Code</TableHead><TableHead>Item Name</TableHead><TableHead>Category</TableHead><TableHead>Supplier</TableHead><TableHead>Base Price</TableHead><TableHead>Validation</TableHead></TableRow></TableHeader><TableBody>{importPreview.map((item) => <TableRow key={item.row}><TableCell>{item.row}</TableCell><TableCell>{item.data.sku || '—'}</TableCell><TableCell>{item.data.name || '—'}</TableCell><TableCell>{item.data.category}</TableCell><TableCell>{item.data.supplier}</TableCell><TableCell>₱{item.data.basePrice.toLocaleString()}</TableCell><TableCell>{item.errors.length ? <div className="space-y-1 text-xs text-red-600">{item.errors.map(error => <p key={error}>• {error}</p>)}</div> : <Badge className="bg-emerald-600">Valid</Badge>}</TableCell></TableRow>)}</TableBody></Table></div>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setIsImportOpen(false)}>Cancel</Button><Button type="button" onClick={handleConfirmImport} disabled={isImporting || !importPreview.length || importPreview.some(row => row.errors.length > 0)}>{isImporting ? 'Importing...' : `Confirm Import${importPreview.length ? ` (${importPreview.length})` : ''}`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingProduct)} onOpenChange={(open) => { if (!open) setEditingProduct(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Updates will be used by future pricelists. Existing saved pricelists remain unchanged.</DialogDescription>
          </DialogHeader>
          {editingProduct && (
            <form onSubmit={handleEditProduct} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-sku">SKU Code</Label>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Must be unique</span>
                  </div>
                  <Input
                    id="edit-sku"
                    name="sku"
                    value={editSku}
                    onChange={(e) => setEditSku(e.target.value)}
                    required
                    className={isEditSkuDuplicate ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  />
                  {isEditSkuDuplicate && (
                    <p className="text-xs font-semibold text-red-500">⚠️ SKU Code is already in use by another product.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-name">Item Name</Label>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Must be unique</span>
                  </div>
                  <Input
                    id="edit-name"
                    name="name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    className={isEditNameDuplicate ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  />
                  {isEditNameDuplicate && (
                    <p className="text-xs font-semibold text-red-500">⚠️ Item Name is already in use by another product.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-category">Category</Label>
                  <Select name="category" value={editCategory} onValueChange={setEditCategory}>
                    <SelectTrigger id="edit-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {Array.from(new Set([...categoryOptions, editCategory])).filter(Boolean).sort().map(category => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-supplier">Supplier Name</Label>
                  <Select name="supplier" value={editSupplier} onValueChange={setEditSupplier}>
                    <SelectTrigger id="edit-supplier">
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {Array.from(new Set([...supplierOptions, editSupplier])).filter(Boolean).sort().map(supplier => (
                        <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-basePrice">Base Price / Retail Price</Label>
                  <Input id="edit-basePrice" name="basePrice" type="number" step="0.01" min="0" defaultValue={editingProduct.basePrice} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-mmPrice">Metro Manila Price</Label>
                  <Input id="edit-mmPrice" name="mmPrice" type="number" step="0.01" min="0" defaultValue={editingProduct.mmPrice ?? editingProduct.wholesalePrice ?? 0} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-provincialPrice">Provincial Price</Label>
                  <Input id="edit-provincialPrice" name="provincialPrice" type="number" step="0.01" min="0" defaultValue={editingProduct.provincialPrice ?? editingProduct.dealerPrice ?? 0} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-costPrice">Cost</Label>
                  <Input id="edit-costPrice" name="costPrice" type="number" step="0.01" min="0" defaultValue={editingProduct.costPrice || 0} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-promoPrice">Promo Price (optional)</Label>
                  <Input id="edit-promoPrice" name="promoPrice" type="number" step="0.01" min="0" defaultValue={editingProduct.promoPrice ?? ''} placeholder="Leave blank to clear" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-minStockLevel">Minimum Stock Level</Label>
                  <Input id="edit-minStockLevel" name="minStockLevel" type="number" min="0" defaultValue={editingProduct.minStockLevel} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-reorderPoint">Reorder Point</Label>
                  <Input id="edit-reorderPoint" name="reorderPoint" type="number" min="0" defaultValue={editingProduct.reorderPoint} />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingProduct(null)}>Cancel</Button>
                <Button type="submit" disabled={isEditSkuDuplicate || isEditNameDuplicate || !editSku.trim() || !editName.trim()}>Save Changes</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Warehouse Manager */}
      <Dialog open={isWarehouseManagerOpen} onOpenChange={setIsWarehouseManagerOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[#FF2D20]" /> Manage Warehouses
            </DialogTitle>
            <DialogDescription>
              Add new facilities or update your existing warehouse network.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Existing Warehouses</Label>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {warehouses.map(warehouse => (
                <div key={warehouse.id} className="rounded-xl border border-border p-3">
                  {editingWarehouseId === warehouse.id ? (
                    <div className="space-y-3">
                      <Input value={editingWarehouseName} onChange={event => setEditingWarehouseName(event.target.value)} placeholder="Warehouse name" autoFocus />
                      <Input value={editingWarehouseLocation} onChange={event => setEditingWarehouseLocation(event.target.value)} placeholder="Location / address" />
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditingWarehouseId(null)}>Cancel</Button>
                        <Button type="button" size="sm" disabled={!editingWarehouseName.trim() || warehouseActionId === warehouse.id} onClick={() => handleUpdateWarehouse(warehouse.id)}>
                          {warehouseActionId === warehouse.id ? 'Saving...' : 'Save Changes'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted"><WarehouseIcon className="h-5 w-5 text-muted-foreground" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{warehouse.name}</p>
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" />{warehouse.location || 'Warehouse Facility'}</p>
                      </div>
                      <Badge variant="secondary" className="hidden sm:inline-flex">{getWarehouseStock(warehouse.id).toLocaleString()} units</Badge>
                      <Button type="button" variant="ghost" size="icon" title="Edit warehouse" disabled={warehouseActionId !== null} onClick={() => startEditingWarehouse(warehouse)}><Pencil className="h-4 w-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" title="Delete warehouse" disabled={warehouseActionId !== null} className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => handleDeleteWarehouse(warehouse)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
              ))}
              {warehouses.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No warehouses have been added yet.</div>}
            </div>
          </div>
          <form onSubmit={handleAddWarehouse} className="space-y-4 border-t border-border pt-4">
            <div><p className="text-sm font-bold">Add a Warehouse</p><p className="text-xs text-muted-foreground">Inventory tracking will initialize automatically for all products.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="warehouseName">Warehouse Name</Label><Input id="warehouseName" required placeholder="e.g., Cebu Hub" value={newWarehouseName} onChange={event => setNewWarehouseName(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="warehouseLocation">Location / Address</Label><Input id="warehouseLocation" placeholder="e.g., Cebu City" value={newWarehouseLocation} onChange={event => setNewWarehouseLocation(event.target.value)} /></div>
            </div>
            <DialogFooter><Button type="submit" disabled={isCreatingWarehouse || !newWarehouseName.trim()} className="bg-[#FF2D20] text-white hover:bg-[#E02619]"><Plus className="mr-2 h-4 w-4" />{isCreatingWarehouse ? 'Creating...' : 'Add Warehouse'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
              <Select name="warehouseId" required value={selectedWarehouseId} onValueChange={(value) => value !== null && setSelectedWarehouseId(value)}>
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

      {/* Redesigned product detail dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-h-[95vh] w-[96vw] max-w-[96vw] overflow-y-auto rounded-2xl p-0 sm:max-w-7xl">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-5 text-left">
            <DialogTitle className="text-2xl font-black tracking-tight">Configuration Item</DialogTitle>
            <DialogDescription>Service catalog specification and inventory node status.</DialogDescription>
          </DialogHeader>
          {selectedProduct && (() => {
            const totalStock = getStockCount(selectedProduct.id);
            const stockStatus = getProductStatus(selectedProduct, totalStock);
            const statusLabel = stockStatus === 'out' ? 'Out of Stock' : stockStatus === 'low' ? 'Low Stock' : 'In Stock';
            const statusTone = stockStatus === 'out' ? 'text-red-600' : stockStatus === 'low' ? 'text-amber-600' : 'text-emerald-600';
            return <div className="space-y-3 px-4 pb-5 sm:px-6">
              <section className="flex flex-col gap-5 px-2 py-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-border bg-muted" aria-label="Product image placeholder">
                    <Package className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2"><Badge className="rounded-md border border-emerald-200 bg-emerald-50 px-3 uppercase text-emerald-700 hover:bg-emerald-50"><span className="mr-2 h-2 w-2 rounded-full bg-emerald-500" />Active</Badge><Badge variant="outline" className="rounded-md px-3">{selectedProduct.category || 'Uncategorized'}</Badge></div>
                    <h2 className="truncate text-4xl font-black tracking-tight">{selectedProduct.name}</h2>
                    <div className="mt-1 text-sm font-semibold tracking-wide text-muted-foreground">{selectedProduct.sku}</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
                  <div className="text-left sm:text-right"><p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Total Stock</p><p className="text-4xl font-black">{totalStock.toLocaleString()}</p><p className="text-xs text-muted-foreground">units across {warehouses.length} warehouses</p></div>
                  <div className="flex flex-wrap gap-2">{isAdmin && <Button variant="outline" className="h-10 rounded-lg px-4 font-bold" onClick={() => { setIsDetailOpen(false); setEditingProduct(selectedProduct); }}><Pencil className="mr-2 h-4 w-4" />Edit Product</Button>}{canAdjustStock && <Button className="h-10 rounded-lg bg-[#101d33] px-4 font-bold text-white hover:bg-[#172842]" onClick={() => { setIsDetailOpen(false); setIsStockUpdateOpen(true); }}><Package className="mr-2 h-4 w-4" />Adjust Stock</Button>}</div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <section className="rounded-xl border border-border/80 p-4 shadow-sm">
                  <div className="flex items-center gap-3 border-b border-border pb-3"><span className="font-mono text-sm font-black text-muted-foreground">01</span><FileText className="h-5 w-5" /><h3 className="text-base font-bold uppercase tracking-wider">Product Information</h3></div>
                  <dl className="grid grid-cols-[minmax(8rem,1fr)_minmax(0,1fr)] gap-x-5 gap-y-3 py-3 text-sm">
                    <dt className="text-muted-foreground">SKU Code</dt><dd className="font-medium">{selectedProduct.sku}</dd>
                    <dt className="text-muted-foreground">Item Name</dt><dd className="font-medium">{selectedProduct.name}</dd>
                    <dt className="text-muted-foreground">Category</dt><dd className="font-medium">{selectedProduct.category || 'Uncategorized'}</dd>
                    <dt className="text-muted-foreground">Preferred Supplier</dt><dd className="font-medium">{selectedProduct.supplier || 'N/A'}</dd>
                  </dl>
                  <div className="mt-2 flex items-center gap-3 border-y border-border py-3"><span className="font-mono text-sm font-black text-muted-foreground">02</span><Tag className="h-5 w-5" /><h3 className="text-base font-bold uppercase tracking-wider">Pricing (₱)</h3></div>
                  <dl className="grid grid-cols-[minmax(8rem,1fr)_minmax(0,1fr)] gap-x-5 gap-y-3 pt-3 text-sm">
                    <dt className="text-muted-foreground">Base Price / Retail</dt><dd className="font-medium">{(selectedProduct.basePrice || 0).toLocaleString()}</dd>
                    <dt className="text-muted-foreground">Cost</dt><dd className="font-medium">{(selectedProduct.costPrice || 0).toLocaleString()}</dd>
                    <dt className="text-muted-foreground">Promo Price</dt><dd className="font-medium">{selectedProduct.promoPrice != null ? selectedProduct.promoPrice.toLocaleString() : '—'}</dd>
                    <dt className="text-muted-foreground">Metro Manila Wholesale</dt><dd className="font-medium">{(selectedProduct.mmPrice ?? selectedProduct.wholesalePrice ?? 0).toLocaleString()}</dd>
                    <dt className="text-muted-foreground">Provincial Wholesale</dt><dd className="font-medium">{(selectedProduct.provincialPrice ?? selectedProduct.dealerPrice ?? 0).toLocaleString()}</dd>
                  </dl>
                </section>

                <section className="rounded-xl border border-border/80 p-4 shadow-sm">
                  <div className="flex items-center gap-3 border-b border-border pb-3"><span className="font-mono text-sm font-black text-muted-foreground">03</span><Package className="h-5 w-5" /><h3 className="text-base font-bold uppercase tracking-wider">Inventory</h3></div>
                  <div className="flex items-center justify-between py-3"><h4 className="font-bold">Warehouse Stock</h4><span className="text-xs font-semibold text-muted-foreground">All Warehouses</span></div>
                  <div className="overflow-hidden rounded-lg border border-border">
                    {warehouses.map((warehouse, index) => { const count = getStockCount(selectedProduct.id, warehouse.id); return <div key={warehouse.id} className={`flex items-center justify-between px-4 py-3 text-sm ${index ? 'border-t border-border' : ''}`}><div className="flex items-center gap-3"><WarehouseIcon className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{warehouse.name}</span></div><span className={`font-bold ${count < 0 ? 'text-red-600' : ''}`}>{count.toLocaleString()} units</span></div>; })}
                    <div className="flex items-center justify-between border-t border-border bg-emerald-50 px-4 py-3 text-sm"><span className="font-bold">Total Stock (All Warehouses)</span><span className="font-black">{totalStock.toLocaleString()} units</span></div>
                  </div>
                  <div className="mt-4 flex items-center gap-3 border-y border-border py-3"><span className="font-mono text-sm font-black text-muted-foreground">04</span><BarChart3 className="h-5 w-5" /><h3 className="text-base font-bold uppercase tracking-wider">Stock Controls</h3></div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-3 pt-3 text-sm">
                    <dt className="text-muted-foreground">Critical Stock Level</dt><dd className="font-medium">{selectedProduct.minStockLevel || 0} units</dd>
                    <dt className="text-muted-foreground">Reorder Point</dt><dd className="font-medium">{selectedProduct.reorderPoint || 0} units</dd>
                    <dt className="text-muted-foreground">Stock Status</dt><dd className={`flex items-center gap-2 font-bold ${statusTone}`}><span className="h-2.5 w-2.5 rounded-full bg-current" />{statusLabel}</dd>
                  </dl>
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Info className="h-4 w-4 shrink-0" />Current stock is {totalStock > (selectedProduct.minStockLevel || 0) ? 'above' : 'at or below'} the critical level.</p>
                </section>

                <section className="flex flex-col rounded-xl border border-border/80 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3"><span className="font-mono text-sm font-black text-muted-foreground">05</span><QrCode className="mt-0.5 h-5 w-5" /><div><h3 className="text-base font-bold uppercase tracking-wider">Asset Traceability</h3></div></div>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">Scan or print the product identity record associated with this item.</p>
                  <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-border p-5">
                    <div id={`qr-svg-detail-${selectedProduct.id}`} className="rounded-lg bg-white p-2"><QRCodeSVG value={selectedProduct.id} size={150} /></div>
                    <div className="text-center"><p className="text-xs uppercase tracking-wider text-muted-foreground">SKU</p><p className="font-bold">{selectedProduct.sku}</p><p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Unique node ID</p><p className="mt-1 break-all font-mono text-xs">{selectedProduct.id}</p></div>
                  </div>
                  <Button variant="outline" className="mt-4 h-11" onClick={() => printThermalLabel(selectedProduct, `qr-svg-detail-${selectedProduct.id}`)}><Printer className="mr-2 h-4 w-4" />Print Label</Button>
                </section>
              </div>
            </div>;
          })()}
          <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4"><Button variant="outline" onClick={() => setIsDetailOpen(false)} className="h-11 min-w-28 rounded-lg px-8 font-bold">Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Previous product detail layout retained temporarily for reference */}
      {false && (
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
                      <span className="font-bold bg-[#FF2D20]/10 text-[#FF2D20] px-2.5 py-0.5 rounded-full text-xs">
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
                      {getStockCount(selectedProduct?.id || '')} UNITS TOTAL
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
        </Dialog>)}
    </div>
  );
}
