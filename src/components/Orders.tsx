import { hasAdminRole } from '../lib/staffPermissions';
import { useStaffAccess } from '../hooks/useStaffAccess';
import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../lib/supabaseAdapter';
import { collection, onSnapshot, query, orderBy, where, getDocs } from '../lib/supabaseAdapter';
import { Order, OrderStatus, Product, InventoryItem, OrderItem } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  ShoppingCart,
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
  User as UserIcon,
  Upload,
  X as XIcon,
  XCircle,
  ImageIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { OrderEntry } from './OrderEntry';
import { DeliveryReceipt } from './DeliveryReceipt';
import { supabase } from '../lib/supabase';
import { type ReceiptOrder, type ReceiptItem, money } from '../lib/orderEntry';

export function Orders() {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const canCreate = permissions.orders === 'create';
  const canManageOrders = canCreate && profile?.role !== 'agent';
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [orderEntryKey, setOrderEntryKey] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [isOrderDetailsOpen, setIsOrderDetailsOpen] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDispatchDialogOpen, setIsDispatchDialogOpen] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [receiptOrder, setReceiptOrder] = useState<ReceiptOrder | null>(null);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const statusLock = useRef(false);

  const [activeTab, setActiveTab] = useState<'items' | 'history'>('items');

  const filteredOrders = orders.filter(order => {
    const queryStr = searchQuery.toLowerCase();
    const matchesSku = order.skus?.some(sku => sku.toLowerCase().includes(queryStr));
    const matchesOrderNumber = order.orderNumber.toLowerCase().includes(queryStr);
    const matchesClient = order.clientName.toLowerCase().includes(queryStr);
    const matchesCity = order.deliveryCity?.toLowerCase().includes(queryStr);
    const matchesRegion = order.deliveryRegion?.toLowerCase().includes(queryStr);
    return matchesSku || matchesOrderNumber || matchesClient || matchesCity || matchesRegion;
  });

  useEffect(() => {
    const isAdminOrSecretary = hasAdminRole(profile) || profile?.role === 'secretary' || profile?.role === 'staff';
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

  const updateOrderStatus = async (order: Order, newStatus: OrderStatus) => {
    if (!canManageOrders) return;
    if (statusLock.current) return;
    if (newStatus === 'out_for_delivery' && !order.photoValidationUrl) {
      setDispatchOrder(order);
      setPhotoFile(null);
      setPhotoPreview(null);
      setIsDispatchDialogOpen(true);
      return;
    }
    statusLock.current = true;
    try {
      const { data, error } = await supabase.rpc('transition_order_entry', { p_order_id: order.id, p_status: newStatus });
      if (error) throw error;
      setOrders(current => current.map(item => item.id === order.id ? data : item));
      setSelectedOrder(current => current?.id === order.id ? data : current);
      toast.success(`Order ${order.orderNumber}: ${newStatus.replaceAll('_', ' ')}`, {
        description: ['cancelled', 'escalated'].includes(newStatus) ? 'Status and inventory restoration saved successfully.' : undefined,
      });
    } catch (error: any) {
      toast.error('Order update failed', { description: error?.message || 'Please retry.' });
    } finally { statusLock.current = false; }
  };

  const handleViewDetails = async (order: Order) => {
    setSelectedOrder(order);
    setIsOrderDetailsOpen(true);
    setOrderItems([]);
    setIsLoadingItems(true);
    try {
      const itemsSnap = await getDocs(collection(db, 'orders', order.id, 'items'));
      const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReceiptItem)).sort((a, b) => (a.entryDetails?.position ?? 0) - (b.entryDetails?.position ?? 0));
      setOrderItems(items);
    } catch (err) {
      handleSupabaseError(err, OperationType.GET, `orders/${order.id}/items`);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleDispatch = async () => {
    if (!dispatchOrder || !photoFile || statusLock.current) return;
    statusLock.current = true;
    setIsUploading(true);
    try {
      // Upload dispatch proof to the existing asset bucket.
      const { ref, uploadBytes, getDownloadURL } = await import('../lib/supabaseAdapter');
      const filePath = `dispatch-proofs/${dispatchOrder.id}_${Date.now()}_${photoFile.name}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, photoFile);
      const downloadUrl = await getDownloadURL(storageRef);

      const { data, error } = await supabase.rpc('transition_order_entry', {
        p_order_id: dispatchOrder.id, p_status: 'out_for_delivery', p_photo_url: downloadUrl,
      });
      if (error) throw error;
      setOrders(current => current.map(item => item.id === dispatchOrder.id ? data : item));
      setSelectedOrder(current => current?.id === dispatchOrder.id ? data : current);
      setIsDispatchDialogOpen(false);
      setDispatchOrder(null);
      setPhotoFile(null);
      setPhotoPreview(null);
      toast.success('Inventory dispatched for delivery');
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `orders/${dispatchOrder.id}`);
    } finally {
      setIsUploading(false);
      statusLock.current = false;
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
        <h2 className="text-xl font-bold tracking-tight text-zinc-900">Order Entry</h2>
        {canCreate && <Button onClick={() => setIsNewOrderOpen(true)}><Plus className="size-4" />Create Order</Button>}
        {profile && canCreate && <OrderEntry key={`${profile.uid}:${orderEntryKey}`} open={isNewOrderOpen} onClose={() => setIsNewOrderOpen(false)} orders={orders} products={products} inventory={inventory} profile={profile} onSaved={(order, items) => {
          setOrders(current => [order, ...current.filter(item => item.id !== order.id)]);
          setIsNewOrderOpen(false);
          setOrderEntryKey(value => value + 1);
          setReceiptItems(items);
          setReceiptOrder(order);
        }} />}
        <DeliveryReceipt order={receiptOrder} items={receiptItems} onClose={() => setReceiptOrder(null)} />

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
                Order items, delivery details, and status history.
              </DialogDescription>
            </DialogHeader>

            <Button variant="outline" className="self-start" disabled={isLoadingItems || !orderItems.length} onClick={() => { setIsOrderDetailsOpen(false); setReceiptItems(orderItems); setReceiptOrder(selectedOrder); }}><FileText className="size-4" />View Delivery Receipt</Button>
            <div className="flex items-center gap-4 border-b border-border px-6 -mx-6">
              <button
                className={`pb-3 text-xs font-black uppercase tracking-widest transition-all relative ${activeTab === 'items' ? 'text-primary border-b-2 border-primary' : 'text-zinc-500 hover:text-foreground'
                  }`}
                onClick={() => setActiveTab('items')}
              >
                Line Items
              </button>
              <button
                className={`pb-3 text-xs font-black uppercase tracking-widest transition-all relative ${activeTab === 'history' ? 'text-primary border-b-2 border-primary' : 'text-zinc-500 hover:text-foreground'
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
                        <div className={`absolute left-[-9px] top-0 w-4 h-4 rounded-full border-2 border-background ${entry.status === 'delivered' ? 'bg-emerald-500' :
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
                      <p className="text-xs font-bold text-zinc-900 dark:text-white">{selectedOrder?.clientName}</p>
                      <p className="text-[10px] text-zinc-500 font-medium">
                        {selectedOrder?.deliveryRegion} Region{selectedOrder?.deliveryCity ? ` • ${selectedOrder.deliveryCity}` : ''}
                      </p>
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
                    {(selectedOrder as ReceiptOrder)?.receiptDetails && <div className="mt-2 space-y-1 text-xs text-muted-foreground"><p>Subtotal: {money((selectedOrder as ReceiptOrder).receiptDetails!.subtotal)}</p><p>Order discount: {money((selectedOrder as ReceiptOrder).receiptDetails!.discount)}</p><p>Payment terms: {(selectedOrder as ReceiptOrder).receiptDetails!.paymentTerms}</p></div>}
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

                  {selectedOrder && canManageOrders && !['delivered', 'completed', 'cancelled', 'escalated'].includes(selectedOrder.status) && (
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
          if (isUploading) return;
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

      </div >

      <div className="flex items-center gap-2 bg-card p-3 border border-border rounded-xl">
        <ShoppingCart className="w-4 h-4 text-zinc-400 ml-1" />
        <Input
          placeholder="Search order number, customer, or SKU…"
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
          const deadlineDate = typeof order.deliveryDeadline?.toDate === 'function' ? order.deliveryDeadline.toDate() : order.deliveryDeadline ? new Date(order.deliveryDeadline) : null;
          const isOverdue = deadlineDate && deadlineDate < new Date() && !['delivered', 'completed', 'cancelled', 'escalated'].includes(order.status);
          return (
            <div key={order.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-zinc-400">{order.orderNumber}</p>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white mt-0.5">{order.clientName}</p>
                  <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-tighter">
                    {order.deliveryRegion}{order.deliveryCity ? ` • ${order.deliveryCity}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={`shrink-0 gap-1.5 h-6 capitalize text-[10px] font-bold ${order.status === 'delivered' || order.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
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
                {canManageOrders && (
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
                    {order.status === 'delivered' && <Button size="sm" variant="outline" onClick={() => updateOrderStatus(order, 'completed')}>Complete</Button>}
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
                const deadlineDate = typeof order.deliveryDeadline?.toDate === 'function' ? order.deliveryDeadline.toDate() : order.deliveryDeadline ? new Date(order.deliveryDeadline) : null;
                const isOverdue = deadlineDate && deadlineDate < new Date() && !['delivered', 'completed', 'cancelled', 'escalated'].includes(order.status);
                return (
                  <TableRow key={order.id} className="group transition-colors">
                    <TableCell className="font-mono text-xs text-zinc-400 font-medium">
                      {order.orderNumber}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-900 dark:text-white">{order.clientName}</span>
                        <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-tighter">
                          {order.deliveryRegion}{order.deliveryCity ? ` • ${order.deliveryCity}` : ''}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1.5 h-6 capitalize text-[10px] font-bold ${order.status === 'delivered' || order.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
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
                      {canManageOrders && (
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
                          {order.status === 'delivered' && <Button size="sm" variant="outline" onClick={() => updateOrderStatus(order, 'completed')}>Complete</Button>}
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
    </div >
  );
}
