import React, { useState } from 'react';
import {
  AlertTriangle,
  Package,
  Warehouse,
  Upload,
  Camera,
  FileText,
  Printer,
  Download,
  CheckCircle2,
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
import { compressImage } from '../lib/imageCompressor';
import { storage, ref, uploadBytes, getDownloadURL } from '../lib/supabaseAdapter';
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

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);

  // Available stock in the selected warehouse
  const availableInWarehouse = selectedProduct && selectedWarehouseId
    ? inventory.find((i) => i.productId === selectedProduct.id && i.warehouseId === selectedWarehouseId)?.quantity || 0
    : 0;

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find((p) => p.id === prodId);
    if (prod?.supplier && prod.supplier !== 'N/A') {
      setSupplierName(prod.supplier);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large (max 10MB)');
      return;
    }
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }
    try {
      const compressed = await compressImage(file, 1024, 768, 0.75);
      setPhotoFile(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
    } catch {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

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
      let resolvedPhotoUrl = '';
      if (photoFile) {
        try {
          const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, '');
          const nonce = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).substring(2, 8);
          const storagePath = `quarantine/${Date.now()}_${nonce}_${safeName}`;
          const fileRef = ref(storage, storagePath);
          await uploadBytes(fileRef, photoFile);
          resolvedPhotoUrl = await getDownloadURL(fileRef);
        } catch (uploadErr) {
          console.warn('Storage upload fallback:', uploadErr);
          resolvedPhotoUrl = '';
        }
      }

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
        photoUrl: resolvedPhotoUrl,
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
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }
    setSelectedProductId('');
    setSelectedWarehouseId('');
    setQuantity('1');
    setNotes('');
    setPhotoFile(null);
    setPhotoPreview('');
    setGeneratedTicket(null);
    onClose();
  };


  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleCloseAll()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        {!generatedTicket ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
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

            <div className="space-y-3 py-2 text-xs">
              {/* Product CI Selection */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Select Configuration Item (CI) *</Label>
                <Select value={selectedProductId} onValueChange={handleProductChange}>
                  <SelectTrigger className="h-10 text-xs">
                    <SelectValue placeholder="Search / choose product..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {products
                      .filter((p) => !p.hasVariations)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          {p.sku} · {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Warehouse Selection */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Warehouse Location *</Label>
                  <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                    <SelectTrigger className="h-10 text-xs">
                      <SelectValue placeholder="Choose warehouse..." />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id} className="text-xs">
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">
                    Defective Quantity *
                    {selectedWarehouseId && selectedProduct && (
                      <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                        (Avail: {availableInWarehouse})
                      </span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    max={availableInWarehouse || 9999}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="h-10 text-xs"
                    required
                  />
                </div>
              </div>

              {/* Defect Reason */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Defect Reason *</Label>
                  <Select
                    value={defectReason}
                    onValueChange={(val) => setDefectReason(val as DefectiveStockTicket['defectReason'])}
                  >
                    <SelectTrigger className="h-10 text-xs">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Damaged in Transit" className="text-xs">Damaged in Transit</SelectItem>
                      <SelectItem value="Manufacturer Defect" className="text-xs">Manufacturer Defect</SelectItem>
                      <SelectItem value="Handling Damage" className="text-xs">Handling Damage</SelectItem>
                      <SelectItem value="Missing Parts" className="text-xs">Missing Parts</SelectItem>
                      <SelectItem value="Expired / Degraded" className="text-xs">Expired / Degraded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Supplier Name</Label>
                  <Input
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="e.g., Shimano, Giant, Active Pro Supplier"
                    className="h-10 text-xs"
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
                    className="h-10 text-xs cursor-pointer"
                  />
                </div>
                {photoPreview && (
                  <div className="relative mt-2 rounded-lg overflow-hidden border max-w-xs h-28">
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
                  className="h-10 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="text-xs" onClick={handleCloseAll}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
                disabled={isSubmitting || !selectedProductId || !selectedWarehouseId || !quantity}
              >
                {isSubmitting ? 'Quarantining...' : 'Quarantine Stock & Create Slip'}
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

            <div className="p-4 rounded-xl border bg-card space-y-3 text-xs" id="supplier-return-slip">
              <div className="flex items-center justify-between border-b pb-2">
                <div>
                  <p className="font-bold text-sm text-foreground">SUPPLIER DEFECTIVE PRODUCT RETURN SLIP</p>
                  <p className="text-[10px] text-muted-foreground font-mono">ACTIVE PRO MARKETING CORP.</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-amber-600">{generatedTicket.ticketNumber}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(generatedTicket.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Product CI:</span>
                  <p className="font-bold">{generatedTicket.productName}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{generatedTicket.sku}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Supplier:</span>
                  <p className="font-semibold">{generatedTicket.supplierName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Warehouse:</span>
                  <p className="font-semibold">{generatedTicket.warehouseName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Quarantined Quantity:</span>
                  <p className="font-bold text-red-600 text-sm">{generatedTicket.quantity} units</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Defect Category:</span>
                  <p className="font-semibold text-amber-700">{generatedTicket.defectReason}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Inspector:</span>
                  <p className="font-semibold">{generatedTicket.loggedByName}</p>
                </div>
              </div>

              {generatedTicket.photoUrl && (
                <div className="border-t pt-2">
                  <span className="text-[10px] text-muted-foreground">Defect Photographic Proof:</span>
                  <div className="mt-1 h-28 rounded-lg overflow-hidden border max-w-xs">
                    <img src={generatedTicket.photoUrl} alt="Defect" className="w-full h-full object-cover" />
                  </div>
                </div>
              )}

              <div className="border-t pt-2 text-[10px] text-muted-foreground italic">
                Status: QUARANTINED in CMDB. Units deducted from active inventory balance.
              </div>
            </div>

            <DialogFooter className="flex-row justify-between sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
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
                  className="text-xs"
                  onClick={handlePrintSlip}
                >
                  <Printer className="size-3.5 mr-1" />
                  Print Slip
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="text-xs font-bold"
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
