import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Package,
  Warehouse,
  Printer,
  Download,
  CheckCircle2,
  Search,
  X,
  ChevronDown,
  ChevronsUpDown,
  ShieldAlert,
  AlertCircle,
  Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Product, InventoryItem, Warehouse as WarehouseType, UserProfile, DefectiveStockTicket } from '../types';
import { logDefectiveStockException, exportDefectiveProductsReportCSV } from '../lib/itilService';
import { toast } from 'sonner';

interface DefectiveStockModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  inventory: InventoryItem[];
  warehouses: WarehouseType[];
  profile?: UserProfile | null;
  onSuccess: (ticket: DefectiveStockTicket) => void;
}

export function DefectiveStockModal({
  open,
  onClose,
  products,
  inventory,
  warehouses,
  profile,
  onSuccess,
}: DefectiveStockModalProps) {
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [defectReason, setDefectReason] = useState<DefectiveStockTicket['defectReason']>('Damaged in Transit');
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedTicket, setGeneratedTicket] = useState<DefectiveStockTicket | null>(null);

  // Search & Combobox states for Product and Warehouse
  const [isProductOpen, setIsProductOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isWarehouseOpen, setIsWarehouseOpen] = useState(false);
  const [warehouseSearch, setWarehouseSearch] = useState('');

  const productDropdownRef = useRef<HTMLDivElement>(null);
  const warehouseDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(event.target as Node)) {
        setIsProductOpen(false);
      }
      if (warehouseDropdownRef.current && !warehouseDropdownRef.current.contains(event.target as Node)) {
        setIsWarehouseOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId),
    [products, selectedProductId]
  );

  const selectedWarehouse = useMemo(
    () => warehouses.find((w) => w.id === selectedWarehouseId),
    [warehouses, selectedWarehouseId]
  );

  // Available stock specifically in the selected warehouse
  const availableInWarehouse = useMemo(() => {
    if (!selectedProductId || !selectedWarehouseId) return 0;
    return inventory
      .filter((i) => i.productId === selectedProductId && i.warehouseId === selectedWarehouseId)
      .reduce((sum, i) => sum + Math.max(0, i.quantity), 0);
  }, [selectedProductId, selectedWarehouseId, inventory]);

  // Total stock across all warehouses for this product
  const totalStockAllWarehouses = useMemo(() => {
    if (!selectedProductId) return 0;
    return inventory
      .filter((i) => i.productId === selectedProductId)
      .reduce((sum, i) => sum + Math.max(0, i.quantity), 0);
  }, [selectedProductId, inventory]);

  // Filter products by SKU, name, brand, category, supplier
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    const leafProducts = products.filter((p) => !p.hasVariations);
    if (!query) return leafProducts;
    return leafProducts.filter((p) => {
      const matchSku = p.sku?.toLowerCase().includes(query);
      const matchName = p.name?.toLowerCase().includes(query);
      const matchBrand = (p as any).brand?.toLowerCase().includes(query);
      const matchCategory = p.category?.toLowerCase().includes(query);
      const matchSupplier = p.supplier?.toLowerCase().includes(query);
      return matchSku || matchName || matchBrand || matchCategory || matchSupplier;
    });
  }, [products, productSearch]);

  // Filter warehouses - sort facilities with positive stock to the top when a product is selected
  const filteredWarehouses = useMemo(() => {
    const query = warehouseSearch.trim().toLowerCase();
    const activeWarehouses = warehouses.filter((w) => w.active !== false);
    const list = !query
      ? activeWarehouses
      : activeWarehouses.filter((w) => {
          const matchName = w.name?.toLowerCase().includes(query);
          const matchCode = (w as any).code?.toLowerCase().includes(query);
          const matchAddress = (w as any).address?.toLowerCase().includes(query);
          return matchName || matchCode || matchAddress;
        });

    if (selectedProductId) {
      return [...list].sort((a, b) => {
        const stockA = inventory
          .filter((i) => i.productId === selectedProductId && i.warehouseId === a.id)
          .reduce((sum, i) => sum + Math.max(0, i.quantity), 0);
        const stockB = inventory
          .filter((i) => i.productId === selectedProductId && i.warehouseId === b.id)
          .reduce((sum, i) => sum + Math.max(0, i.quantity), 0);
        return stockB - stockA;
      });
    }

    return list;
  }, [warehouses, warehouseSearch, selectedProductId, inventory]);

  const handleSelectProduct = (prod: Product) => {
    setSelectedProductId(prod.id);
    if (prod?.supplier && prod.supplier !== 'N/A') {
      setSupplierName(prod.supplier);
    }

    // Smart warehouse resolution: Auto-select facility holding positive stock if current selection is empty or has 0 stock
    const currentStockInSelectedWh = selectedWarehouseId
      ? inventory
          .filter((i) => i.productId === prod.id && i.warehouseId === selectedWarehouseId)
          .reduce((sum, i) => sum + Math.max(0, i.quantity), 0)
      : 0;

    if (!selectedWarehouseId || currentStockInSelectedWh === 0) {
      const facilityWithStock = warehouses.find((w) => {
        const count = inventory
          .filter((i) => i.productId === prod.id && i.warehouseId === w.id)
          .reduce((sum, i) => sum + Math.max(0, i.quantity), 0);
        return count > 0;
      });
      if (facilityWithStock) {
        setSelectedWarehouseId(facilityWithStock.id);
      }
    }

    setIsProductOpen(false);
    setProductSearch('');
  };

  const handleSelectWarehouse = (wh: WarehouseType) => {
    setSelectedWarehouseId(wh.id);
    setIsWarehouseOpen(false);
    setWarehouseSearch('');
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large (max 10MB)');
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const qtyNumber = parseInt(quantity, 10);
  const hasWarehouseSelected = Boolean(selectedWarehouseId);
  // Zero-stock guardrail ONLY triggers when BOTH product AND warehouse are explicitly selected
  const isZeroStock = Boolean(selectedProductId) && hasWarehouseSelected && availableInWarehouse <= 0;
  // Quantity validation ONLY triggers after a warehouse has been selected
  const isQuantityExceeded = hasWarehouseSelected && !isNaN(qtyNumber) && qtyNumber > availableInWarehouse;
  const isSubmitDisabled =
    isSubmitting ||
    !selectedProductId ||
    !hasWarehouseSelected ||
    isZeroStock ||
    isNaN(qtyNumber) ||
    qtyNumber <= 0 ||
    isQuantityExceeded;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      toast.error('Please select a product CI.');
      return;
    }
    if (!selectedWarehouseId) {
      toast.error('Please select the originating warehouse.');
      return;
    }
    if (availableInWarehouse <= 0) {
      toast.error(`Zero stock available in ${selectedWarehouse?.name || 'warehouse'}. Cannot quarantine non-existent stock.`);
      return;
    }
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      toast.error('Enter a valid whole quantity of at least 1.');
      return;
    }
    if (qty > availableInWarehouse) {
      toast.error(`Cannot quarantine more than available stock (${availableInWarehouse} units).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const { ticket } = await logDefectiveStockException({
        productId: selectedProduct.id,
        sku: selectedProduct.sku,
        productName: selectedProduct.name,
        brand: (selectedProduct as any).brand || selectedProduct.category,
        warehouseId: selectedWarehouseId,
        warehouseName: selectedWarehouse?.name || 'Warehouse',
        quantity: qty,
        defectReason,
        loggedBy: profile?.uid || 'user',
        loggedByName: profile?.displayName || profile?.email || 'Warehouse Staff',
        photoUrl: photoPreview,
        supplierName: supplierName || selectedProduct.supplier || 'Primary Supplier',
        notes,
        inventory,
      });

      toast.success(`Segregated ${qty} unit(s) into Quarantine. Return slip generated.`);
      setGeneratedTicket(ticket);
      onSuccess(ticket);
    } catch {
      toast.error('Failed to log defective stock exception.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintSlip = () => {
    if (!generatedTicket) return;
    window.print();
  };

  const handleCloseAll = () => {
    setSelectedProductId('');
    setSelectedWarehouseId('');
    setQuantity('1');
    setNotes('');
    setPhotoFile(null);
    setPhotoPreview('');
    setGeneratedTicket(null);
    setIsProductOpen(false);
    setIsWarehouseOpen(false);
    setProductSearch('');
    setWarehouseSearch('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleCloseAll()}>
      <DialogContent className="sm:max-w-2xl md:max-w-3xl max-h-[90vh] overflow-y-auto">
        {!generatedTicket ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold">
                    Log Damaged / Defective Stock
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    Segregates damaged CIs into quarantine and issues an ITIL exception ticket for supplier return.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3.5 py-1 text-xs">
              {/* Product CI Selection (Searchable & Expanded) */}
              <div className="space-y-1.5 relative" ref={productDropdownRef}>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">
                    Select Configuration Item (CI) *
                  </Label>
                  {selectedProduct && (
                    <span className="text-[11px] text-muted-foreground">
                      Total Stock: <strong className="text-foreground">{totalStockAllWarehouses} units</strong>
                    </span>
                  )}
                </div>

                {/* Trigger Button */}
                <button
                  type="button"
                  id="select-ci-trigger"
                  onClick={() => setIsProductOpen((prev) => !prev)}
                  className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-all ${isProductOpen
                    ? 'border-amber-500 ring-2 ring-amber-500/20 bg-background'
                    : 'border-input bg-background/60 hover:bg-muted/40'
                    }`}
                >
                  {selectedProduct ? (
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Package className="size-4 text-amber-600 shrink-0" />
                      <span className="px-2 py-0.5 rounded bg-muted font-mono font-bold text-[11px] text-foreground shrink-0 border border-border/50">
                        {selectedProduct.sku}
                      </span>
                      <span className="font-semibold text-foreground text-xs leading-tight break-words flex-1">
                        {selectedProduct.name}
                      </span>
                      {selectedProduct.category && (
                        <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                          {selectedProduct.category}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Search className="size-4 shrink-0" />
                      <span>Search by SKU, product name, brand, or category...</span>
                    </div>
                  )}
                  <ChevronsUpDown className="size-4 text-muted-foreground shrink-0" />
                </button>

                {/* Searchable Dropdown Popup */}
                {isProductOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl border bg-popover shadow-xl ring-1 ring-foreground/10 overflow-hidden animate-in fade-in-0 zoom-in-95">
                    {/* Search Input */}
                    <div className="p-2.5 border-b bg-muted/40 flex items-center gap-2">
                      <Search className="size-4 text-muted-foreground shrink-0" />
                      <input
                        autoFocus
                        type="text"
                        placeholder="Search product name, SKU (e.g., SKU-2001), brand..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                      {productSearch && (
                        <button
                          type="button"
                          onClick={() => setProductSearch('')}
                          className="p-1 text-muted-foreground hover:text-foreground rounded"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Results List */}
                    <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
                      {filteredProducts.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground text-xs">
                          No configuration items matching "{productSearch}".
                        </div>
                      ) : (
                        filteredProducts.map((p) => {
                          const isCurrent = p.id === selectedProductId;
                          // Stock in selected warehouse if selected
                          const stockInWh = selectedWarehouseId
                            ? inventory
                              .filter((i) => i.productId === p.id && i.warehouseId === selectedWarehouseId)
                              .reduce((sum, i) => sum + Math.max(0, i.quantity), 0)
                            : null;
                          const totalStock = inventory
                            .filter((i) => i.productId === p.id)
                            .reduce((sum, i) => sum + Math.max(0, i.quantity), 0);

                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleSelectProduct(p)}
                              className={`w-full text-left p-2.5 flex items-start justify-between gap-3 transition-colors ${isCurrent
                                ? 'bg-amber-500/10 text-foreground font-medium'
                                : 'hover:bg-muted/60 text-foreground'
                                }`}
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border/50">
                                    {p.sku}
                                  </span>
                                  <span className="text-xs font-semibold leading-tight text-foreground break-words">
                                    {p.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                  <span>{p.category || 'General'}</span>
                                  {p.supplier && <span>· Supplier: {p.supplier}</span>}
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                {stockInWh !== null ? (
                                  <span
                                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${stockInWh > 0
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                      : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                      }`}
                                  >
                                    {stockInWh > 0 ? `${stockInWh} avail` : '0 in WH'}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground font-medium">
                                    {totalStock} in stock
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>

                    <div className="p-2 border-t bg-muted/20 text-[10px] text-muted-foreground text-center">
                      Showing {filteredProducts.length} of {products.filter((p) => !p.hasVariations).length} items
                    </div>
                  </div>
                )}
              </div>

              {/* Warehouse Selection (Searchable & Label Display) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5 relative" ref={warehouseDropdownRef}>
                  <Label className="text-xs font-semibold">Warehouse Location *</Label>
                  <button
                    type="button"
                    id="select-wh-trigger"
                    onClick={() => setIsWarehouseOpen((prev) => !prev)}
                    className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-all ${isWarehouseOpen
                      ? 'border-amber-500 ring-2 ring-amber-500/20 bg-background'
                      : 'border-input bg-background/60 hover:bg-muted/40'
                      }`}
                  >
                    {selectedWarehouse ? (
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Warehouse className="size-4 text-amber-600 shrink-0" />
                        <span className="font-semibold text-foreground text-xs truncate">
                          {selectedWarehouse.name}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Warehouse className="size-4 shrink-0" />
                        <span>Choose warehouse facility...</span>
                      </div>
                    )}
                    <ChevronsUpDown className="size-4 text-muted-foreground shrink-0" />
                  </button>

                  {/* Warehouse Dropdown Popup */}
                  {isWarehouseOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl border bg-popover shadow-xl ring-1 ring-foreground/10 overflow-hidden animate-in fade-in-0 zoom-in-95">
                      <div className="p-2 border-b bg-muted/40 flex items-center gap-2">
                        <Search className="size-3.5 text-muted-foreground shrink-0" />
                        <input
                          autoFocus
                          type="text"
                          placeholder="Filter warehouse name..."
                          value={warehouseSearch}
                          onChange={(e) => setWarehouseSearch(e.target.value)}
                          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
                        {filteredWarehouses.map((w) => {
                          const isCurrent = w.id === selectedWarehouseId;
                          const stockHere = selectedProductId
                            ? inventory
                              .filter((i) => i.productId === selectedProductId && i.warehouseId === w.id)
                              .reduce((sum, i) => sum + Math.max(0, i.quantity), 0)
                            : null;

                          return (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => handleSelectWarehouse(w)}
                              className={`w-full text-left p-2.5 flex items-center justify-between gap-2 transition-colors ${isCurrent
                                ? 'bg-amber-500/10 text-foreground font-semibold'
                                : 'hover:bg-muted/60 text-foreground'
                                }`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-foreground truncate">{w.name}</p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {(w as any).code || (w as any).address || 'Active Facility'}
                                </p>
                              </div>
                              {stockHere !== null && (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${stockHere > 0
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                    }`}
                                >
                                  {stockHere > 0 ? `${stockHere} units` : '0 (Empty)'}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Defective Quantity */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Defective Quantity *</Label>
                    {selectedProduct && (
                      <span
                        className={`text-[11px] font-semibold ${
                          !hasWarehouseSelected
                            ? 'text-muted-foreground font-normal'
                            : availableInWarehouse > 0
                            ? 'text-emerald-600'
                            : 'text-destructive font-bold'
                        }`}
                      >
                        {!hasWarehouseSelected
                          ? '(Select warehouse to view stock)'
                          : availableInWarehouse > 0
                          ? `(Avail: ${availableInWarehouse})`
                          : '(0 Available — Empty)'}
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    min="1"
                    max={hasWarehouseSelected && availableInWarehouse > 0 ? availableInWarehouse : 9999}
                    value={quantity}
                    disabled={isZeroStock}
                    onChange={(e) => setQuantity(e.target.value)}
                    className={`h-[42px] text-xs rounded-xl ${isZeroStock
                      ? 'opacity-50 cursor-not-allowed bg-muted/40'
                      : isQuantityExceeded
                        ? 'border-destructive ring-1 ring-destructive'
                        : ''
                      }`}
                    required
                  />
                  {isQuantityExceeded && (
                    <p className="text-[10px] text-destructive font-medium">
                      Quantity exceeds available stock of {availableInWarehouse} unit(s).
                    </p>
                  )}
                </div>
              </div>

              {/* Zero Stock Guardrail Banner */}
              {isZeroStock && (
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs animate-in fade-in-0 duration-200">
                  <ShieldAlert className="size-5 shrink-0 mt-0.5 text-destructive" />
                  <div className="space-y-1 flex-1">
                    <p className="font-bold text-sm tracking-tight text-destructive">
                      Zero Stock Guardrail Enforced
                    </p>
                    <p className="text-[11px] leading-relaxed text-destructive/90">
                      <strong>{selectedProduct.sku} · {selectedProduct.name}</strong> currently has{' '}
                      <strong>0 physical units</strong> in <strong>{selectedWarehouse?.name}</strong>. The ITIL governance policy prohibits logging damaged assets or deducting inventory from an empty location.
                    </p>
                    <p className="text-[10px] text-muted-foreground pt-0.5">
                      💡 Select another warehouse facility with available inventory to quarantine units.
                    </p>
                  </div>
                </div>
              )}

              {/* Defect Reason & Supplier Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Defect Reason *</Label>
                  <Select
                    value={defectReason}
                    onValueChange={(val) => setDefectReason(val as DefectiveStockTicket['defectReason'])}
                  >
                    <SelectTrigger className="h-[42px] text-xs rounded-xl">
                      <SelectValue>{defectReason}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Damaged in Transit" className="text-xs">
                        Damaged in Transit
                      </SelectItem>
                      <SelectItem value="Manufacturer Defect" className="text-xs">
                        Manufacturer Defect
                      </SelectItem>
                      <SelectItem value="Handling Damage" className="text-xs">
                        Handling Damage
                      </SelectItem>
                      <SelectItem value="Missing Parts" className="text-xs">
                        Missing Parts
                      </SelectItem>
                      <SelectItem value="Expired / Degraded" className="text-xs">
                        Expired / Degraded
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Supplier Name</Label>
                    {selectedProduct?.supplier && selectedProduct.supplier !== 'N/A' && (
                      <span className="text-[10px] text-emerald-600 font-medium">Auto-filled</span>
                    )}
                  </div>
                  <Input
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="e.g., Shimano, Giant, Active Pro Supplier"
                    className="h-[42px] text-xs rounded-xl"
                  />
                </div>
              </div>

              {/* Photo Evidence Upload */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Defect Photo Proof (Optional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="h-[42px] text-xs cursor-pointer rounded-xl"
                  />
                </div>
                {photoPreview && (
                  <div className="relative mt-2 rounded-xl overflow-hidden border max-w-xs h-28 shadow-sm">
                    <img src={photoPreview} alt="Defect proof" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Inspection Notes</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe crack, bent spoke, scratches, or missing hardware..."
                  className="h-[42px] text-xs rounded-xl"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button type="button" variant="outline" className="text-xs rounded-xl" onClick={handleCloseAll}>
                Cancel
              </Button>
              <Button
                type="submit"
                className={`font-bold text-xs rounded-xl transition-all ${isZeroStock
                  ? 'bg-muted text-muted-foreground hover:bg-muted cursor-not-allowed border'
                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm'
                  }`}
                disabled={isSubmitDisabled}
              >
                {isSubmitting
                  ? 'Quarantining...'
                  : !selectedProductId
                    ? 'Select Configuration Item'
                    : !hasWarehouseSelected
                      ? 'Select Warehouse Location'
                      : isZeroStock
                        ? 'Cannot Quarantine (Zero Stock in Warehouse)'
                        : 'Quarantine Stock & Create Slip'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          /* Printable Supplier Return Slip */
          <div className="space-y-4 py-2">
            <DialogHeader>
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="size-5" />
                <DialogTitle className="text-base font-bold">
                  Defective Product Exception Registered
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs">
                Asset segregated into Quarantine. Supplier Return Slip issued.
              </DialogDescription>
            </DialogHeader>

            <div className="p-5 rounded-2xl border bg-card space-y-4 text-xs shadow-sm" id="supplier-return-slip">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <p className="font-bold text-sm text-foreground">SUPPLIER DEFECTIVE PRODUCT RETURN SLIP</p>
                  <p className="text-[10px] text-muted-foreground font-mono">ACTIVE PRO MARKETING CORP.</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-amber-600 text-base">{generatedTicket.ticketNumber}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(generatedTicket.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Product CI:</span>
                  <p className="font-bold text-foreground text-xs">{generatedTicket.productName}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{generatedTicket.sku}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Supplier:</span>
                  <p className="font-semibold text-foreground">{generatedTicket.supplierName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Warehouse:</span>
                  <p className="font-semibold text-foreground">{generatedTicket.warehouseName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Quarantined Quantity:</span>
                  <p className="font-bold text-red-600 text-sm">{generatedTicket.quantity} units</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Defect Category:</span>
                  <p className="font-semibold text-amber-700 dark:text-amber-400">{generatedTicket.defectReason}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Inspector:</span>
                  <p className="font-semibold text-foreground">{generatedTicket.loggedByName}</p>
                </div>
              </div>

              {generatedTicket.photoUrl && (
                <div className="border-t pt-3">
                  <span className="text-[10px] text-muted-foreground block mb-1">Defect Photographic Proof:</span>
                  <div className="h-28 rounded-xl overflow-hidden border max-w-xs shadow-sm">
                    <img src={generatedTicket.photoUrl} alt="Defect" className="w-full h-full object-cover" />
                  </div>
                </div>
              )}

              <div className="border-t pt-3 text-[10px] text-muted-foreground italic">
                Status: QUARANTINED in CMDB. Units deducted from active inventory balance.
              </div>
            </div>

            <DialogFooter className="flex-row justify-between sm:justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs rounded-xl"
                onClick={() => exportDefectiveProductsReportCSV([generatedTicket])}
              >
                <Download className="size-3.5 mr-1" />
                Export CSV
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs rounded-xl"
                  onClick={handlePrintSlip}
                >
                  <Printer className="size-3.5 mr-1" />
                  Print Slip
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="text-xs font-bold rounded-xl"
                  onClick={handleCloseAll}
                >
                  Done
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
