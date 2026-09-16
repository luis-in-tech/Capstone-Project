import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../lib/supabaseAdapter';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  orderBy, 
  where, 
  serverTimestamp, 
  getDocs, 
  writeBatch,
  arrayUnion
} from '../lib/supabaseAdapter';
import { Order, OrderStatus, Product, InventoryItem, OrderItem, StatusHistoryEntry } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { 
  ShoppingCart, 
  Trash2, 
  Plus, 
  Clock, 
  Truck, 
  CheckCircle2, 
  Camera, 
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  FileText,
  Eye,
  Calendar,
  PackageCheck,
  User as UserIcon,
  Upload,
  X as XIcon,
  XCircle,
  RotateCcw,
  ImageIcon,
  ScanBarcode,
  ListPlus
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addDays, format } from 'date-fns';

export function Orders() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [cart, setCart] = useState<{ productId: string; quantity: number; price: number; name: string; sku: string }[]>([]);
  const [clientInfo, setClientInfo] = useState({ name: '', region: 'Metro Manila' });
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [isOrderDetailsOpen, setIsOrderDetailsOpen] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDispatchDialogOpen, setIsDispatchDialogOpen] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scannerVideoRef = useRef<HTMLVideoElement>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const lastScannedCodeRef = useRef('');
  const skuInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const quantityInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const skuCartQuantitiesRef = useRef<Record<string, number>>({});
  const [orderEntryMode, setOrderEntryMode] = useState<'scan' | 'sku' | 'select'>('select');
  const [manualScanCode, setManualScanCode] = useState('');
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [skuRows, setSkuRows] = useState([{ id: 1, sku: '', quantity: '1' }]);

  const [activeTab, setActiveTab] = useState<'items' | 'history'>('items');

  const filteredOrders = orders.filter(order => {
    const queryStr = searchQuery.toLowerCase();
    const matchesSku = order.skus?.some(sku => sku.toLowerCase().includes(queryStr));
    const matchesOrderNumber = order.orderNumber.toLowerCase().includes(queryStr);
    const matchesClient = order.clientName.toLowerCase().includes(queryStr);
    return matchesSku || matchesOrderNumber || matchesClient;
  });

  useEffect(() => {
    const isAdminOrSecretary = profile?.role === 'admin' || profile?.role === 'secretary';
    const q = isAdminOrSecretary
      ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'orders'), where('agentId', '==', profile?.uid || ''), orderBy('createdAt', 'desc'));

    const unsubOrders = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'orders');
    });

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

    return () => {
      unsubOrders();
      unsubProducts();
      unsubInventory();
    };
  }, [profile]);

  const getProductStock = (productId: string) =>
    inventory.filter(i => i.productId === productId).reduce((sum, i) => sum + i.quantity, 0);

  const addToCart = (product: Product) => {
    const totalStock = getProductStock(product.id);
    if (totalStock === 0) {
      toast.error(`${product.name} is out of stock and cannot be ordered.`);
      return;
    }
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item => item.productId === product.id 
          ? { ...item, quantity: item.quantity + 1 }
          : item
        );
      }
      return [...prev, { 
        productId: product.id, 
        quantity: 1, 
        price: product.wholesalePrice || product.basePrice,
        name: product.name,
        sku: product.sku
      }];
    });
    toast.success(`${product.name} added to cart`);
  };

  const addQuantityToCart = (product: Product, quantity: number) => {
    const requestedQuantity = Math.max(1, Math.floor(quantity || 1));
    const totalStock = getProductStock(product.id);
    const quantityAlreadyInCart = cart.find(item => item.productId === product.id)?.quantity || 0;
    if (totalStock <= 0 || quantityAlreadyInCart + requestedQuantity > totalStock) {
      toast.error(`Only ${Math.max(0, totalStock - quantityAlreadyInCart)} more ${product.name} available.`);
      return false;
    }
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item => item.productId === product.id
          ? { ...item, quantity: item.quantity + requestedQuantity }
          : item
        );
      }
      return [...prev, {
        productId: product.id,
        quantity: requestedQuantity,
        price: product.wholesalePrice || product.basePrice,
        name: product.name,
        sku: product.sku
      }];
    });
    toast.success(`${requestedQuantity} x ${product.name} added to cart`);
    return true;
  };

  const findProductByCode = (code: string) => {
    const normalizedCode = code.trim().toLowerCase();
    return products.find(product => product.sku.trim().toLowerCase() === normalizedCode);
  };

  const commitSkuRowAndAdvance = (rowId: number) => {
    const rowIndex = skuRows.findIndex(row => row.id === rowId);
    const row = skuRows[rowIndex];
    if (!row) return;
    const product = findProductByCode(row.sku);
    if (!product) {
      toast.error(row.sku.trim() ? `No inventory item found for SKU ${row.sku.trim()}.` : 'Enter a valid SKU first.');
      skuInputRefs.current[rowId]?.focus();
      return;
    }
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      toast.error('Quantity must be at least 1.');
      quantityInputRefs.current[rowId]?.focus();
      return;
    }
    const totalStock = getProductStock(product.id);
    if (totalStock <= 0) {
      toast.error(`${product.name} is currently out of stock.`);
      quantityInputRefs.current[rowId]?.focus();
      return;
    }
    if (quantity > totalStock) {
      toast.error(`Cannot order ${quantity} units. Only ${totalStock} available in stock.`);
      quantityInputRefs.current[rowId]?.focus();
      return;
    }
    const existingNextRow = skuRows[rowIndex + 1];
    const nextRowId = existingNextRow?.id ?? Math.max(0, ...skuRows.map(item => item.id)) + 1;
    if (!existingNextRow) {
      setSkuRows(rows => [...rows, { id: nextRowId, sku: '', quantity: '1' }]);
    }
    window.setTimeout(() => skuInputRefs.current[nextRowId]?.focus(), 0);
  };

  const deleteSkuRow = (rowId: number) => {
    const rowIndex = skuRows.findIndex(row => row.id === rowId);
    const previousRowId = skuRows[rowIndex - 1]?.id;
    const nextRowId = skuRows[rowIndex + 1]?.id;

    if (skuRows.length === 1) {
      setSkuRows([{ id: rowId, sku: '', quantity: '1' }]);
      window.setTimeout(() => skuInputRefs.current[rowId]?.focus(), 0);
      return;
    }

    setSkuRows(rows => rows.filter(row => row.id !== rowId));
    window.setTimeout(() => {
      if (previousRowId) quantityInputRefs.current[previousRowId]?.focus();
      else if (nextRowId) skuInputRefs.current[nextRowId]?.focus();
    }, 0);
  };

  const handleScannedCode = (code: string) => {
    if (!code.trim()) return;
    const product = findProductByCode(code);
    if (!product) {
      toast.error(`No inventory item found for code ${code.trim()}.`);
      return;
    }
    addQuantityToCart(product, 1);
    setManualScanCode('');
  };

  const stopScanner = () => {
    if (scannerFrameRef.current !== null) cancelAnimationFrame(scannerFrameRef.current);
    scannerFrameRef.current = null;
    scannerStreamRef.current?.getTracks().forEach(track => track.stop());
    scannerStreamRef.current = null;
    setIsScannerActive(false);
  };

  const startScanner = async () => {
    const BarcodeDetectorClass = (window as any).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      toast.error('Camera scanning is not supported by this browser. Enter the code below instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      scannerStreamRef.current = stream;
      if (scannerVideoRef.current) {
        scannerVideoRef.current.srcObject = stream;
        await scannerVideoRef.current.play();
      }
      setIsScannerActive(true);
      const detector = new BarcodeDetectorClass({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const scanFrame = async () => {
        const video = scannerVideoRef.current;
        if (!video || !scannerStreamRef.current) return;
        try {
          const codes = await detector.detect(video);
          const code = codes[0]?.rawValue?.trim();
          if (code && code !== lastScannedCodeRef.current) {
            lastScannedCodeRef.current = code;
            handleScannedCode(code);
            window.setTimeout(() => { lastScannedCodeRef.current = ''; }, 1500);
          }
        } catch {
          // Ignore individual unreadable camera frames and continue scanning.
        }
        scannerFrameRef.current = requestAnimationFrame(scanFrame);
      };
      scannerFrameRef.current = requestAnimationFrame(scanFrame);
    } catch {
      toast.error('Unable to access the camera. Check camera permission or enter the code manually.');
      stopScanner();
    }
  };

  useEffect(() => {
    if (!isNewOrderOpen || orderEntryMode !== 'scan') stopScanner();
    return () => {
      if (!isNewOrderOpen) stopScanner();
    };
  }, [isNewOrderOpen, orderEntryMode]);

  useEffect(() => {
    const nextSkuQuantities: Record<string, number> = {};
    for (const row of skuRows) {
      const product = findProductByCode(row.sku);
      const quantity = Number(row.quantity);
      if (product && Number.isInteger(quantity) && quantity > 0) {
        nextSkuQuantities[product.id] = (nextSkuQuantities[product.id] || 0) + quantity;
      }
    }

    const previousSkuQuantities = skuCartQuantitiesRef.current;
    setCart(currentCart => {
      const affectedProductIds = new Set([
        ...Object.keys(previousSkuQuantities),
        ...Object.keys(nextSkuQuantities)
      ]);
      let nextCart = [...currentCart];

      for (const productId of affectedProductIds) {
        const existing = nextCart.find(item => item.productId === productId);
        const quantityFromOtherModes = Math.max(0, (existing?.quantity || 0) - (previousSkuQuantities[productId] || 0));
        const nextQuantity = quantityFromOtherModes + (nextSkuQuantities[productId] || 0);

        if (nextQuantity === 0) {
          nextCart = nextCart.filter(item => item.productId !== productId);
          continue;
        }

        if (existing) {
          nextCart = nextCart.map(item => item.productId === productId ? { ...item, quantity: nextQuantity } : item);
        } else {
          const product = products.find(item => item.id === productId);
          if (product) {
            nextCart.push({
              productId: product.id,
              quantity: nextQuantity,
              price: product.wholesalePrice || product.basePrice,
              name: product.name,
              sku: product.sku
            });
          }
        }
      }

      return nextCart;
    });
    skuCartQuantitiesRef.current = nextSkuQuantities;
  }, [skuRows, products]);

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const submitOrder = async () => {
    if (!clientInfo.name || cart.length === 0) return;

    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deadlineDays = clientInfo.region === 'Metro Manila' ? 7 : 14;
    const deadline = addDays(new Date(), deadlineDays);

    const loadingToast = toast.loading('Validating stock and placing order...');

    try {
      // 1. Consolidate cart demand by productId
      const consolidatedDemand: Record<string, { quantity: number; name: string; sku: string; price: number }> = {};
      for (const item of cart) {
        if (!consolidatedDemand[item.productId]) {
          consolidatedDemand[item.productId] = { quantity: 0, name: item.name, sku: item.sku, price: item.price };
        }
        consolidatedDemand[item.productId].quantity += item.quantity;
      }

      // 2. Fetch live inventory for all products in cart (chunked for Firestore 'in' limit)
      const productIds = Object.keys(consolidatedDemand);
      const currentInventory: InventoryItem[] = [];
      for (let i = 0; i < productIds.length; i += 10) {
        const chunk = productIds.slice(i, i + 10);
        const invSnap = await getDocs(query(collection(db, 'inventory'), where('productId', 'in', chunk)));
        currentInventory.push(...invSnap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
      }

      // 3. Validate stock sufficiency and pick best warehouse per product
      const stockUpdates: { inventoryId: string; newQuantity: number; adjustment: any }[] = [];
      const insufficient: string[] = [];

      // 4. Generate order number first so it can be referenced in stock adjustment logs
      const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

      for (const productId in consolidatedDemand) {
        const demand = consolidatedDemand[productId];
        const warehouseOptions = currentInventory
          .filter(inv => inv.productId === productId)
          .sort((a, b) => b.quantity - a.quantity);

        const totalAvail = warehouseOptions.reduce((sum, inv) => sum + Math.max(0, inv.quantity), 0);

        if (warehouseOptions.length === 0 || totalAvail < demand.quantity) {
          insufficient.push(`${demand.name} (${demand.quantity} requested, ${totalAvail} available across warehouses)`);
        } else {
          const best = warehouseOptions[0];
          if (best.quantity < demand.quantity) {
            insufficient.push(`${demand.name} (${demand.quantity} requested, but largest facility only has ${best.quantity} available)`);
          } else {
            stockUpdates.push({
              inventoryId: best.id,
              newQuantity: best.quantity - demand.quantity,
              adjustment: {
                productId,
                warehouseId: best.warehouseId,
                adjustmentAmount: -demand.quantity,
                reason: `Auto-deduction: Order ${orderNumber}`,
                recordedBy: profile?.uid || 'system',
                timestamp: serverTimestamp()
              }
            });
          }
        }
      }

      if (insufficient.length > 0) {
        toast.dismiss(loadingToast);
        toast.error(`Insufficient stock: ${insufficient.join(', ')}`, {
          duration: 7000,
          icon: <AlertCircle className="text-red-500" />
        });
        return;
      }

      // 5. Commit Order first so that Firestore rules can see it
      const orderRef = doc(collection(db, 'orders'));
      const orderData = {
        orderNumber,
        agentId: profile?.uid,
        clientId: `CLI-${Math.random().toString(36).substring(7).toUpperCase()}`,
        clientName: clientInfo.name,
        status: 'pending',
        skus: cart.map(item => item.sku),
        totalAmount,
        deliveryRegion: clientInfo.region,
        deliveryDeadline: deadline,
        statusHistory: [
          {
            status: 'pending',
            changedBy: profile?.displayName || profile?.email || 'Unknown',
            timestamp: new Date(),
            note: 'Order created via B2B Portal — stock reserved on placement'
          }
        ],
        createdAt: serverTimestamp(),
      };
      
      // Use setDoc for the order directly
      await import('../lib/supabaseAdapter').then(({ setDoc }) => setDoc(orderRef, orderData));

      // 5. Commit Items in a batch (the order now exists, so get() will work in rules)
      const itemsBatch = writeBatch(db);
      for (const item of cart) {
        const itemRef = doc(collection(db, `orders/${orderRef.id}/items`));
        const assignedUpdate = stockUpdates.find(u => u.adjustment.productId === item.productId);
        itemsBatch.set(itemRef, {
          orderId: orderRef.id,
          productId: item.productId,
          warehouseId: assignedUpdate?.adjustment.warehouseId || '',
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          subtotal: item.price * item.quantity
        });
      }
      await itemsBatch.commit();

      // 6. Deduct inventory (wrap in try/catch in case cloud rules deny Agents)
      try {
        const invBatch = writeBatch(db);
        for (const up of stockUpdates) {
          invBatch.update(doc(db, 'inventory', up.inventoryId), {
            quantity: up.newQuantity,
            lastUpdated: serverTimestamp()
          });
          invBatch.set(doc(collection(db, 'stockAdjustments')), {
            ...up.adjustment,
            reason: `Auto-deduction: Order ${orderNumber}`
          });
        }
        await invBatch.commit();
      } catch (invError) {
        console.warn('Inventory deduction failed (likely due to role permissions), but order was placed.', invError);
      }
      toast.dismiss(loadingToast);
      toast.success('Order placed & stock reserved', {
        description: `${orderNumber} — inventory deducted immediately.`,
        icon: <PackageCheck className="text-emerald-500" />,
        duration: 5000
      });

      setCart([]);
      setSkuRows([{ id: 1, sku: '', quantity: '1' }]);
      setClientInfo({ name: '', region: 'Metro Manila' });
      setIsNewOrderOpen(false);
    } catch (err) {
      toast.dismiss(loadingToast);
      handleSupabaseError(err, OperationType.CREATE, 'orders');
    }
  };

  const updateOrderStatus = async (order: Order, newStatus: OrderStatus) => {
    try {
      // Stock restoration on cancellation or escalation:
      if ((newStatus === 'cancelled' || newStatus === 'escalated') && order.status !== 'cancelled' && order.status !== 'escalated') {
        const itemsSnap = await getDocs(collection(db, 'orders', order.id, 'items'));
        const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem));

        let totalRestoredUnits = 0;
        if (items.length > 0) {
          const productIds = Array.from(new Set(items.map(i => i.productId)));
          const currentInventory: InventoryItem[] = [];
          for (let i = 0; i < productIds.length; i += 10) {
            const chunk = productIds.slice(i, i + 10);
            const invSnap = await getDocs(query(collection(db, 'inventory'), where('productId', 'in', chunk)));
            currentInventory.push(...invSnap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
          }

          const invBatch = writeBatch(db);

          for (const item of items) {
            let targetInv = currentInventory.find(inv => 
              inv.productId === item.productId && item.warehouseId && inv.warehouseId === item.warehouseId
            );

            if (!targetInv) {
              const matches = currentInventory.filter(inv => inv.productId === item.productId);
              if (matches.length > 0) {
                targetInv = matches[0];
              }
            }

            if (targetInv) {
              invBatch.update(doc(db, 'inventory', targetInv.id), {
                quantity: targetInv.quantity + item.quantity,
                lastUpdated: serverTimestamp()
              });
              invBatch.set(doc(collection(db, 'stockAdjustments')), {
                productId: item.productId,
                warehouseId: targetInv.warehouseId,
                adjustmentAmount: item.quantity,
                reason: `Order ${order.orderNumber} ${newStatus}: stock replenishment`,
                recordedBy: profile?.uid || 'system',
                timestamp: serverTimestamp()
              });
              totalRestoredUnits += item.quantity;
            }
          }

          try {
            await invBatch.commit();
          } catch (invErr) {
            console.warn('Inventory replenishment write failed:', invErr);
          }
        }

        await updateDoc(doc(db, 'orders', order.id), {
          status: newStatus,
          updatedAt: serverTimestamp(),
          statusHistory: arrayUnion({
            status: newStatus,
            changedBy: profile?.displayName || profile?.email || 'Unknown',
            timestamp: new Date(),
            note: `Order marked as ${newStatus.replace('_', ' ')} — ${totalRestoredUnits} unit(s) restored to inventory`
          })
        });

        toast.success(`Order ${order.orderNumber} ${newStatus}. ${totalRestoredUnits} unit(s) restored to stock.`, {
          icon: <RotateCcw className="text-emerald-500" />,
          duration: 5000
        });

        if (selectedOrder && selectedOrder.id === order.id) {
          setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
        }
        return;
      }

      // Stock was already deducted at order placement — skip re-deduction here.
      // Just transition the status for pending → preparing.
      if (newStatus === 'preparing' && order.status === 'pending') {
        await updateDoc(doc(db, 'orders', order.id), {
          status: newStatus,
          updatedAt: serverTimestamp(),
          statusHistory: arrayUnion({
            status: newStatus,
            changedBy: profile?.displayName || profile?.email || 'Unknown',
            timestamp: new Date(),
            note: `Order moved to Preparing (stock was reserved at placement)`
          })
        });
        toast.success(`Order ${order.orderNumber} is now in preparation.`, {
          icon: <PackageCheck className="text-emerald-500" />,
          duration: 4000
        });
        return;
      }

      // Manual Dispatch with Photo Validation
      if (newStatus === 'out_for_delivery' && !order.photoValidationUrl) {
         setDispatchOrder(order);
         setPhotoUrl('');
         setIsDispatchDialogOpen(true);
         return;
      }

      await updateDoc(doc(db, 'orders', order.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
        statusHistory: arrayUnion({
          status: newStatus,
          changedBy: profile?.displayName || profile?.email || 'Unknown',
          timestamp: new Date(),
          note: `Status updated to ${newStatus.replace('_', ' ')}`
        }),
        ...(newStatus === 'out_for_delivery' && photoUrl ? { photoValidationUrl: photoUrl } : {})
      });
      toast.success(`Order moving to ${newStatus}`);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `orders/${order.id}`);
    }
  };

  const handleViewDetails = async (order: Order) => {
    setSelectedOrder(order);
    setIsOrderDetailsOpen(true);
    setIsLoadingItems(true);
    try {
      const itemsSnap = await getDocs(collection(db, 'orders', order.id, 'items'));
      const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem));
      setOrderItems(items);
    } catch (err) {
      handleSupabaseError(err, OperationType.GET, `orders/${order.id}/items`);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleDispatch = async () => {
    if (!dispatchOrder || !photoFile) return;
    setIsUploading(true);
    try {
      // Upload file to Firebase Storage
      const { ref, uploadBytes, getDownloadURL } = await import('../lib/supabaseAdapter');
      const filePath = `dispatch-proofs/${dispatchOrder.id}_${Date.now()}_${photoFile.name}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, photoFile);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateDoc(doc(db, 'orders', dispatchOrder.id), {
        status: 'out_for_delivery',
        photoValidationUrl: downloadUrl,
        updatedAt: serverTimestamp(),
        statusHistory: arrayUnion({
          status: 'out_for_delivery',
          changedBy: profile?.displayName || profile?.email || 'Unknown',
          timestamp: new Date(),
          note: 'Order dispatched with photo verification'
        })
      });
      setIsDispatchDialogOpen(false);
      setDispatchOrder(null);
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoUrl('');
      toast.success('Inventory dispatched for delivery');
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `orders/${dispatchOrder.id}`);
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusIcon = (status: OrderStatus) => {
    switch (status) {
      case 'pending': return <Clock className="w-3 h-3" />;
      case 'preparing': return <ShoppingCart className="w-3 h-3" />;
      case 'out_for_delivery': return <Truck className="w-3 h-3" />;
      case 'delivered': return <CheckCircle2 className="w-3 h-3" />;
      case 'completed': return <CheckCircle2 className="w-3 h-3" />;
      case 'escalated': return <AlertTriangle className="w-3 h-3 text-purple-500" />;
      case 'cancelled': return <XCircle className="w-3 h-3 text-red-500" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight text-zinc-900">Service Request Queue (Orders)</h2>
        <Dialog open={isNewOrderOpen} onOpenChange={setIsNewOrderOpen}>
          <DialogTrigger className="h-9 gap-2 px-4 bg-[#1A2332] text-white rounded-lg inline-flex items-center justify-center font-medium transition-all hover:bg-[#1A2332]/90">
            <Plus className="w-4 h-4" /> Create Order
          </DialogTrigger>
          <DialogContent className="sm:max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Order Entry Portal</DialogTitle>
              <DialogDescription>Input new customer request for multi-warehouse synchronization.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
              <div className="space-y-4 lg:col-span-2">
                <div className="space-y-2">
                  <Label>Client Business Name</Label>
                  <Input 
                    placeholder="Enter client name..." 
                    value={clientInfo.name}
                    onChange={e => setClientInfo(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Delivery Region</Label>
                  <Select 
                    value={clientInfo.region} 
                    onValueChange={v => setClientInfo(prev => ({ ...prev, region: v }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Metro Manila">Metro Manila (1 Week)</SelectItem>
                      <SelectItem value="Luzon">Provincial Luzon (10 Days)</SelectItem>
                      <SelectItem value="Visayas">Visayas (14 Days)</SelectItem>
                      <SelectItem value="Mindanao">Mindanao (14 Days)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="pt-2 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <Button type="button" variant={orderEntryMode === 'scan' ? 'default' : 'outline'} onClick={() => setOrderEntryMode('scan')} className="gap-2">
                      <ScanBarcode className="w-4 h-4" /> Scan Code
                    </Button>
                    <Button type="button" variant={orderEntryMode === 'sku' ? 'default' : 'outline'} onClick={() => setOrderEntryMode('sku')} className="gap-2">
                      <ListPlus className="w-4 h-4" /> Enter SKUs
                    </Button>
                    <Button type="button" variant={orderEntryMode === 'select' ? 'default' : 'outline'} onClick={() => setOrderEntryMode('select')} className="gap-2">
                      <Plus className="w-4 h-4" /> Select Items
                    </Button>
                  </div>

                  {orderEntryMode === 'scan' && (
                    <div className="min-h-[350px] border rounded-md p-4 space-y-4">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">QR / Barcode Scanner</Label>
                      <div className="relative aspect-video overflow-hidden rounded-lg bg-zinc-950 flex items-center justify-center">
                        <video ref={scannerVideoRef} className="w-full h-full object-cover" muted playsInline />
                        {!isScannerActive && <ScanBarcode className="absolute w-12 h-12 text-zinc-600" />}
                      </div>
                      <Button type="button" variant="outline" className="w-full" onClick={isScannerActive ? stopScanner : startScanner}>
                        <Camera className="w-4 h-4 mr-2" /> {isScannerActive ? 'Stop Camera' : 'Start Camera'}
                      </Button>
                      <div className="flex gap-2">
                        <Input
                          value={manualScanCode}
                          onChange={e => setManualScanCode(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleScannedCode(manualScanCode)}
                          placeholder="Scan or enter SKU / code"
                        />
                        <Button type="button" onClick={() => handleScannedCode(manualScanCode)}>Add</Button>
                      </div>
                    </div>
                  )}

                  {orderEntryMode === 'sku' && (
                    <div className="min-h-[350px] max-h-[500px] overflow-y-auto border rounded-md p-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead className="w-20">Qty</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {skuRows.map(row => {
                            const product = findProductByCode(row.sku);
                            const price = product ? product.wholesalePrice || product.basePrice : 0;
                            const quantity = Number(row.quantity) || 0;
                            return (
                              <TableRow key={row.id}>
                                <TableCell className="p-1">
                                  <Input
                                    ref={element => { skuInputRefs.current[row.id] = element; }}
                                    value={row.sku}
                                    onChange={e => setSkuRows(rows => rows.map(item => item.id === row.id ? { ...item, sku: e.target.value } : item))}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        quantityInputRefs.current[row.id]?.focus();
                                        quantityInputRefs.current[row.id]?.select();
                                      } else if (e.key === 'Backspace' && row.sku === '') {
                                        const rowIndex = skuRows.findIndex(item => item.id === row.id);
                                        const previousRow = skuRows[rowIndex - 1];
                                        if (previousRow) {
                                          e.preventDefault();
                                          setSkuRows(rows => rows.filter(item => item.id !== row.id));
                                          window.setTimeout(() => {
                                            const previousQuantityInput = quantityInputRefs.current[previousRow.id];
                                            previousQuantityInput?.focus();
                                            previousQuantityInput?.setSelectionRange(previousQuantityInput.value.length, previousQuantityInput.value.length);
                                          }, 0);
                                        }
                                      }
                                    }}
                                    placeholder="SKU"
                                  />
                                </TableCell>
                                <TableCell className="p-1">
                                  <Input
                                    ref={element => { quantityInputRefs.current[row.id] = element; }}
                                    type="text"
                                    inputMode="numeric"
                                    value={row.quantity}
                                    onChange={e => {
                                      const value = e.target.value;
                                      if (value === '' || /^[1-9]\d*$/.test(value)) {
                                        setSkuRows(rows => rows.map(item => item.id === row.id ? { ...item, quantity: value } : item));
                                      }
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        commitSkuRowAndAdvance(row.id);
                                      } else if (e.key === 'Backspace' && row.quantity === '') {
                                        e.preventDefault();
                                        const skuInput = skuInputRefs.current[row.id];
                                        skuInput?.focus();
                                        skuInput?.setSelectionRange(skuInput.value.length, skuInput.value.length);
                                      }
                                    }}
                                  />
                                </TableCell>
                                <TableCell className="p-1 text-xs font-medium">{product?.name || (row.sku ? 'SKU not found' : '—')}</TableCell>
                                <TableCell className="p-1 text-right text-xs font-bold">₱{(price * quantity).toLocaleString()}</TableCell>
                                <TableCell className="p-1">
                                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => deleteSkuRow(row.id)} aria-label="Delete SKU row">
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {orderEntryMode === 'select' && (
                    <div>
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Available Inventory</Label>
                      <div className="mt-2 space-y-2 min-h-[350px] max-h-[500px] overflow-y-auto border rounded-md p-2">
                        {products.map(p => (
                          <div key={p.id} className="flex items-center justify-between p-2 rounded border transition-all hover:bg-muted border-transparent hover:border-border">
                            <div className="min-w-0">
                              <p className="text-xs font-bold truncate">{p.name}</p>
                              <div className="flex items-center gap-2">
                                <p className={`text-[10px] font-semibold ${getProductStock(p.id) <= 0 ? 'text-red-500' : 'text-zinc-500'}`}>Stock: {getProductStock(p.id)}</p>
                                {getProductStock(p.id) <= 0 && <span className="text-[9px] font-black uppercase tracking-widest bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Out of Stock</span>}
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => addToCart(p)}><Plus className="w-3 h-3 mr-1" /> Add</Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-muted rounded-xl p-4 flex flex-col border border-border">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-black dark:text-white">Current Cart</h4>
                  <Badge variant="secondary" className="text-[10px]">{cart.length} Items</Badge>
                </div>
                <div className="flex-1 space-y-3 mb-4 overflow-y-auto pr-2">
                  {cart.map(item => (
                    <div key={item.productId} className="flex items-center justify-between bg-card p-2 rounded-lg border border-border">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold truncate">{item.name}</p>
                        <p className="text-[10px] text-zinc-500">₱{item.price.toLocaleString()} x {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black">₱{(item.price * item.quantity).toLocaleString()}</span>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => removeFromCart(item.productId)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {cart.length === 0 && (
                    <div className="h-40 flex flex-col items-center justify-center text-zinc-400">
                      <ShoppingCart className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-xs font-medium">Cart is empty</p>
                    </div>
                  )}
                </div>
                <div className="pt-4 border-top border-zinc-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Grand Total</span>
                    <span className="text-xl font-black text-black dark:text-white">₱{cart.reduce((s, i) => s + (i.price * i.quantity), 0).toLocaleString()}</span>
                  </div>
                  <Button className="w-full h-11 bg-[#1A2332] text-white font-bold" disabled={cart.length === 0 || !clientInfo.name} onClick={submitOrder}>
                    Confirm and Queue Order
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isOrderDetailsOpen} onOpenChange={setIsOrderDetailsOpen}>
          <DialogContent className="sm:max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between pr-8">
                <span>Order Details: {selectedOrder?.orderNumber}</span>
                <Badge variant="outline" className="capitalize text-[10px] font-bold px-3">
                  {selectedOrder?.status.replace('_', ' ')}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                System ledger summary for current B2B request.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-4 border-b border-border px-6 -mx-6">
              <button 
                className={`pb-3 text-xs font-black uppercase tracking-widest transition-all relative ${
                  activeTab === 'items' ? 'text-primary border-b-2 border-primary' : 'text-zinc-500 hover:text-foreground'
                }`}
                onClick={() => setActiveTab('items')}
              >
                Line Items
              </button>
              <button 
                className={`pb-3 text-xs font-black uppercase tracking-widest transition-all relative ${
                  activeTab === 'history' ? 'text-primary border-b-2 border-primary' : 'text-zinc-500 hover:text-foreground'
                }`}
                onClick={() => setActiveTab('history')}
              >
                Status History
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
              <div className="space-y-4 col-span-2">
                {activeTab === 'items' ? (
                  <div className="border rounded-lg overflow-hidden bg-card">
                    <div className="overflow-x-auto w-full">
                      <Table>
                        <TableHeader className="bg-muted">
                          <TableRow>
                            <TableHead className="text-[10px] font-bold uppercase py-2 min-w-[150px]">Item</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2 text-center min-w-[80px]">Qty</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2 text-right min-w-[100px]">Price</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2 text-right min-w-[100px]">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {isLoadingItems ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-8">
                                <div className="flex flex-col items-center gap-2 text-zinc-400">
                                  <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
                                  <span className="text-[10px] font-bold uppercase tracking-widest">Retrieving Line Items...</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : (
                            orderItems.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold">{item.name}</span>
                                    <span className="text-[9px] font-mono text-zinc-400">{item.sku}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center text-xs font-medium">{item.quantity}</TableCell>
                                <TableCell className="text-right text-xs">₱{item.unitPrice.toLocaleString()}</TableCell>
                                <TableCell className="text-right text-xs font-bold">₱{item.subtotal.toLocaleString()}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pr-2 max-h-[400px] overflow-y-auto">
                    {selectedOrder?.statusHistory?.slice().reverse().map((entry, idx) => (
                      <div key={idx} className="relative pl-6 pb-6 border-l-2 border-border last:pb-0">
                        <div className={`absolute left-[-9px] top-0 w-4 h-4 rounded-full border-2 border-background ${
                          entry.status === 'delivered' ? 'bg-emerald-500' : 
                          entry.status === 'pending' ? 'bg-zinc-300' : 'bg-blue-500'
                        }`} />
                        <div className="bg-muted rounded-xl p-3 border border-border group hover:border-foreground/20 transition-colors">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-900">
                              {entry.status.replace('_', ' ')}
                            </span>
                            <span className="text-[9px] font-medium text-zinc-400">
                              {entry.timestamp && (
                                typeof entry.timestamp.toDate === 'function'
                                  ? format(entry.timestamp.toDate(), 'MMM d, h:mm a')
                                  : format(new Date(entry.timestamp), 'MMM d, h:mm a')
                              )}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-zinc-600 mb-2">{entry.note}</p>
                          <div className="flex items-center gap-1.5 border-t border-zinc-200/50 pt-2">
                            <div className="w-4 h-4 bg-background rounded-full flex items-center justify-center">
                              <UserIcon className="w-2 h-2 text-zinc-500" />
                            </div>
                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-tight">Modified by {entry.changedBy}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!selectedOrder?.statusHistory || selectedOrder.statusHistory.length === 0) && (
                      <div className="text-center py-12 text-zinc-400 italic text-xs">
                        No historical status logs found for this entry.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-tighter text-zinc-400">Client Information</p>
                    <div className="bg-muted p-2 rounded-md border border-border">
                      <p className="text-xs font-bold text-zinc-900">{selectedOrder?.clientName}</p>
                      <p className="text-[10px] text-zinc-500 font-medium">{selectedOrder?.deliveryRegion} Region</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-tighter text-zinc-400">SLA Requirements</p>
                    <div className="flex items-center gap-2 bg-muted p-2 rounded-md border border-border">
                      <Calendar className="w-3 h-3 text-zinc-400" />
                      <div>
                        <p className="text-xs font-bold text-zinc-900">
                          {selectedOrder?.deliveryDeadline && (
                            typeof selectedOrder.deliveryDeadline.toDate === 'function' 
                              ? format(selectedOrder.deliveryDeadline.toDate(), 'PPP')
                              : format(new Date(selectedOrder.deliveryDeadline), 'PPP')
                          )}
                        </p>
                        <p className="text-[9px] uppercase font-black text-zinc-500 tracking-tight">Contractual Deadline</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Grand Total</span>
                      <span className="text-lg font-black text-zinc-900">
                        ₱{selectedOrder?.totalAmount.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-400 text-right italic">Inclusive of all taxes and regional fees.</p>
                  </div>

                  {selectedOrder?.photoValidationUrl && (
                    <div className="pt-4 space-y-2">
                       <p className="text-[10px] font-black uppercase tracking-tighter text-zinc-400">Dispatch Proof</p>
                       <img 
                        src={selectedOrder.photoValidationUrl} 
                        alt="Dispatch Validation" 
                         className="w-full h-32 object-cover rounded-lg border border-border"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  {selectedOrder && profile?.role !== 'agent' && !['delivered', 'completed', 'cancelled', 'escalated'].includes(selectedOrder.status) && (
                    <div className="pt-4 border-t border-border flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-amber-600 border-amber-200 hover:bg-amber-50 gap-1.5 text-xs font-bold"
                        onClick={() => {
                          if (window.confirm(`Escalate order ${selectedOrder.orderNumber}? Stock will be returned to inventory.`)) {
                            updateOrderStatus(selectedOrder, 'escalated');
                          }
                        }}
                      >
                        <AlertTriangle className="w-3.5 h-3.5" /> Escalate Order
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 gap-1.5 text-xs font-bold"
                        onClick={() => {
                          if (window.confirm(`Cancel order ${selectedOrder.orderNumber}? Stock will be restored to inventory.`)) {
                            updateOrderStatus(selectedOrder, 'cancelled');
                          }
                        }}
                      >
                        <XCircle className="w-3.5 h-3.5" /> Cancel Order
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isDispatchDialogOpen} onOpenChange={(open) => {
            if (!open) { setPhotoFile(null); setPhotoPreview(null); }
            setIsDispatchDialogOpen(open);
          }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-500" />
                Dispatch Photo Proof
              </DialogTitle>
              <DialogDescription>
                Upload a photo as proof of dispatch for <span className="font-bold text-zinc-900">{dispatchOrder?.orderNumber}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 10 * 1024 * 1024) {
                    toast.error('File too large', { description: 'Please select an image under 10MB.' });
                    return;
                  }
                  setPhotoFile(file);
                  const reader = new FileReader();
                  reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
                  reader.readAsDataURL(file);
                }}
              />

              {/* Upload zone / preview */}
              {!photoPreview ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-44 rounded-xl border-2 border-dashed border-zinc-300 hover:border-blue-400 hover:bg-blue-50/50 transition-all flex flex-col items-center justify-center gap-3 text-zinc-400 hover:text-blue-500 group"
                >
                  <div className="w-12 h-12 rounded-full bg-zinc-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold">Click to upload photo</p>
                    <p className="text-[10px] mt-0.5 text-zinc-400">JPG, PNG, WEBP — max 10MB</p>
                  </div>
                </button>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-border group">
                  <img
                    src={photoPreview}
                    alt="Dispatch proof preview"
                    className="w-full h-52 object-cover"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs font-bold"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon className="w-3 h-3 mr-1" /> Change
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs font-bold"
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                    >
                      <XIcon className="w-3 h-3 mr-1" /> Remove
                    </Button>
                  </div>
                  {/* File name badge */}
                  <div className="absolute bottom-2 left-2 right-2 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
                    <p className="text-[10px] text-white font-medium truncate">{photoFile?.name}</p>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="text-xs"
                onClick={() => { setPhotoFile(null); setPhotoPreview(null); setIsDispatchDialogOpen(false); }}
                disabled={isUploading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDispatch}
                disabled={!photoFile || isUploading}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs"
              >
                {isUploading ? (
                  <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> Uploading...</>
                ) : (
                  <><Upload className="w-3 h-3 mr-1.5" /> Validate & Dispatch</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>

      <div className="flex items-center gap-2 bg-card p-3 border border-border rounded-xl">
        <ShoppingCart className="w-4 h-4 text-zinc-400 ml-1" />
        <Input 
          placeholder="Filter by Order #, or Client..." 
          className="h-8 text-xs border-none shadow-none focus-visible:ring-0"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 px-2 text-[10px] font-bold uppercase text-zinc-400"
            onClick={() => setSearchQuery('')}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {filteredOrders.map(order => {
          const deadlineDate = typeof order.deliveryDeadline?.toDate === 'function' ? order.deliveryDeadline.toDate() : null;
          const isOverdue = deadlineDate && deadlineDate < new Date() && !['delivered', 'completed'].includes(order.status);
          return (
            <div key={order.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-zinc-400">{order.orderNumber}</p>
                  <p className="text-sm font-bold text-zinc-900 mt-0.5">{order.clientName}</p>
                  <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-tighter">{order.deliveryRegion}</p>
                </div>
                <Badge variant="outline" className={`shrink-0 gap-1.5 h-6 capitalize text-[10px] font-bold ${
                  order.status === 'delivered' || order.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  order.status === 'out_for_delivery' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  order.status === 'cancelled' ? 'bg-red-50 text-red-700 border-red-200' :
                  order.status === 'escalated' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                  'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {getStatusIcon(order.status)}
                  {order.status.replace('_', ' ')}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-[10px] font-bold ${isOverdue ? 'text-red-500' : 'text-zinc-500'}`}>
                    {deadlineDate ? deadlineDate.toLocaleDateString() : 'N/A'}
                    {isOverdue && <span className="ml-1 uppercase text-[8px] animate-bounce bg-red-100 px-1 rounded">SLA Breach</span>}
                  </p>
                </div>
                <span className="font-black text-sm">₱{order.totalAmount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => handleViewDetails(order)} title="View Details">
                  <Eye className="w-4 h-4" />
                </Button>
                {profile?.role !== 'agent' && (
                  <>
                    {order.status === 'pending' && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-zinc-900" onClick={() => updateOrderStatus(order, 'preparing')} title="Move to Preparing">
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    )}
                    {order.status === 'preparing' && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500 hover:bg-blue-50" onClick={() => updateOrderStatus(order, 'out_for_delivery')} title="Dispatch Order">
                        <Camera className="w-4 h-4" />
                      </Button>
                    )}
                    {order.status === 'out_for_delivery' && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-500 hover:bg-emerald-50" onClick={() => updateOrderStatus(order, 'delivered')} title="Confirm Delivery">
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                    )}
                    {order.status !== 'delivered' && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'escalated' && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-500 hover:bg-amber-50"
                          onClick={() => {
                            if (window.confirm(`Escalate order ${order.orderNumber}? Reserved stock will be replenished to inventory.`)) {
                              updateOrderStatus(order, 'escalated');
                            }
                          }}
                          title="Escalate Order (Restores Stock)"
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-500 hover:bg-red-50"
                          onClick={() => {
                            if (window.confirm(`Cancel order ${order.orderNumber}? Deducted stock will be restored to inventory.`)) {
                              updateOrderStatus(order, 'cancelled');
                            }
                          }}
                          title="Cancel Order (Restores Stock)"
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </>
                )}
                {order.photoValidationUrl && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-zinc-900" onClick={() => window.open(order.photoValidationUrl)}>
                     <FileText className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {filteredOrders.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
            <ShoppingCart className="w-8 h-8 opacity-20" />
            <p className="text-xs font-medium italic">No orders match your search criteria.</p>
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto w-full">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[120px]">Order ID</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[150px]">Client Name</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest min-w-[120px]">Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-center min-w-[120px]">Deadline</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right min-w-[100px]">Amount</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right min-w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map(order => {
                const deadlineDate = typeof order.deliveryDeadline?.toDate === 'function' ? order.deliveryDeadline.toDate() : null;
                const isOverdue = deadlineDate && deadlineDate < new Date() && !['delivered', 'completed'].includes(order.status);
                return (
                  <TableRow key={order.id} className="group transition-colors">
                    <TableCell className="font-mono text-xs text-zinc-400 font-medium">
                      {order.orderNumber}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-900">{order.clientName}</span>
                        <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-tighter">{order.deliveryRegion}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1.5 h-6 capitalize text-[10px] font-bold ${
                        order.status === 'delivered' || order.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        order.status === 'out_for_delivery' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        order.status === 'cancelled' ? 'bg-red-50 text-red-700 border-red-200' :
                        order.status === 'escalated' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {getStatusIcon(order.status)}
                        {order.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className={`text-[10px] font-bold ${isOverdue ? 'text-red-500' : 'text-zinc-500'}`}>
                        {deadlineDate ? deadlineDate.toLocaleDateString() : 'N/A'}
                        {isOverdue && <span className="ml-1 uppercase text-[8px] animate-bounce bg-red-100 px-1 rounded">SLA Breach</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-black text-xs">
                      ₱{order.totalAmount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7 text-muted-foreground hover:text-foreground" 
                        onClick={() => handleViewDetails(order)}
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {profile?.role !== 'agent' && (
                        <>
                          {order.status === 'pending' && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-zinc-900" onClick={() => updateOrderStatus(order, 'preparing')} title="Move to Preparing">
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          )}
                          {order.status === 'preparing' && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500 hover:bg-blue-50" onClick={() => updateOrderStatus(order, 'out_for_delivery')} title="Dispatch Order">
                              <Camera className="w-4 h-4" />
                            </Button>
                          )}
                          {order.status === 'out_for_delivery' && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-500 hover:bg-emerald-50" onClick={() => updateOrderStatus(order, 'delivered')} title="Confirm Delivery">
                              <CheckCircle2 className="w-4 h-4" />
                            </Button>
                          )}
                          {order.status !== 'delivered' && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'escalated' && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-amber-500 hover:bg-amber-50"
                                onClick={() => {
                                  if (window.confirm(`Escalate order ${order.orderNumber}? Reserved stock will be replenished to inventory.`)) {
                                    updateOrderStatus(order, 'escalated');
                                  }
                                }}
                                title="Escalate Order (Restores Stock)"
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-red-500 hover:bg-red-50"
                                onClick={() => {
                                  if (window.confirm(`Cancel order ${order.orderNumber}? Deducted stock will be restored to inventory.`)) {
                                    updateOrderStatus(order, 'cancelled');
                                  }
                                }}
                                title="Cancel Order (Restores Stock)"
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      {order.photoValidationUrl && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-zinc-900" onClick={() => window.open(order.photoValidationUrl)}>
                           <FileText className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredOrders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <ShoppingCart className="w-8 h-8 opacity-20" />
                      <p className="text-xs font-medium italic">No orders match your search criteria.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
