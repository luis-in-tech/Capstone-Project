import { PageHeading } from './PageHeading';
import { ConfirmDialog } from './ConfirmDialog';
import { SearchBar } from '@/components/ui/search-bar';
import { previousOrderStatus, requiresStockReReservation, revertBlockReason } from '../lib/orderStatus';
import { hasAdminRole } from '../lib/staffPermissions';
import { useStaffAccess } from '../hooks/useStaffAccess';
import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../lib/supabaseAdapter';
import { collection, onSnapshot, query, orderBy, where, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc, serverTimestamp, addDoc, ref, uploadBytes, getDownloadURL, isMissingRpcError } from '../lib/supabaseAdapter';
import { Order, OrderStatus, Product, InventoryItem, OrderItem, UserProfile } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  ArrowUUpLeftIcon as Undo2,
  ShoppingCartIcon as ShoppingCart,
  PlusIcon as Plus,
  ClockIcon as Clock,
  TruckIcon as Truck,
  CheckCircleIcon as CheckCircle2,
  CameraIcon as Camera,
  WarningIcon as AlertTriangle,
  CaretRightIcon as ChevronRight,
  CaretUpIcon as ChevronUp,
  CaretDownIcon as ChevronDown,
  ArrowsDownUpIcon as ArrowUpDown,
  FileTextIcon as FileText,
  EyeIcon as Eye,
  CalendarIcon as Calendar,
  UserIcon,
  UploadSimpleIcon as Upload,
  XIcon,
  XCircleIcon as XCircle,
  ImageIcon,
  ShieldWarningIcon as ShieldAlert,
  FunnelSimpleIcon as ListFilter,
  PencilSimpleIcon as Pencil,
  TrashIcon as Trash2,
  DotsSixVerticalIcon as DotsSixVertical,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { OrderEntry } from './OrderEntry';
import { DeliveryReceipt } from './DeliveryReceipt';
import { supabase } from '../lib/supabase';
import { type ReceiptOrder, type ReceiptItem, type GroupDiscount, groupedOrderTotals, money, roundMoney } from '../lib/orderEntry';
import {
  evaluateAndSyncSLAIncidents,
  getLocalIncidents,
} from '../lib/itilService';
import { prioritizeOrderQueue } from '../lib/fifoQueueEngine';
import type { ITILIncident } from '../types';
import { compressImage } from '../lib/imageCompressor';

import { ITILIncidentConsole } from './ITILIncidentConsole';

type OrderSortKey = 'orderNumber' | 'clientName' | 'status' | 'deadline' | 'amount';
type SortDirection = 'asc' | 'desc';

const ORDER_SORT_COLUMNS: Array<{
  key: OrderSortKey;
  label: string;
  align: 'left' | 'center' | 'right';
  headClass: string;
}> = [
  { key: 'orderNumber', label: 'Order ID', align: 'left', headClass: 'min-w-30' },
  { key: 'clientName', label: 'Client Name', align: 'left', headClass: 'min-w-37.5' },
  { key: 'status', label: 'Status', align: 'left', headClass: 'min-w-30' },
  { key: 'deadline', label: 'Deadline', align: 'center', headClass: 'min-w-30 text-center' },
  { key: 'amount', label: 'Amount', align: 'right', headClass: 'min-w-25 text-right' },
];

const toTimeMs = (value: any): number => {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const openSafeExternalUrl = (rawUrl?: string) => {
  if (!rawUrl) return;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:') {
      window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
      return;
    }
  } catch {}
  toast.error('Blocked unsupported or insecure image URL. Only HTTPS URLs can be opened.');
};

export function Orders() {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const canCreate = permissions.orders === 'create';
  const canManageOrders = canCreate && profile?.role !== 'agent';
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
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
  const [isReverting, setIsReverting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // ITIL 4 Incident Management & SLA Tracking (FR-06)
  const [incidents, setIncidents] = useState<ITILIncident[]>(() => getLocalIncidents());
  const [isIncidentsDialogOpen, setIsIncidentsDialogOpen] = useState(false);
  const [orderViewMode, setOrderViewMode] = useState<'all' | 'fifo_queue'>('all');
  const [sortKey, setSortKey] = useState<OrderSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [customOrderIds, setCustomOrderIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('activepro_custom_order_ids');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [dragOverOrderId, setDragOverOrderId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'items' | 'history'>('items');

  const computeEditedOrderTotals = (order: ReceiptOrder | null, items: ReceiptItem[]) => {
    const subtotal = roundMoney(items.reduce((sum, it) => sum + roundMoney(Number(it.quantity) * Number(it.unitPrice || 0)), 0));
    const rawGroups = Array.isArray(order?.receiptDetails?.groupDiscounts) ? order.receiptDetails.groupDiscounts as GroupDiscount[] : [];
    const remainingIds = new Set(items.map(it => it.id));
    const keptGroups = rawGroups.filter((g: GroupDiscount) => remainingIds.has(g.afterLineId));
    if (keptGroups.length === 0) {
      const rawDiscount = Number(order?.receiptDetails?.orderDiscount ?? order?.receiptDetails?.discount ?? 0);
      const safeDiscount = Math.min(subtotal, Math.max(0, roundMoney(Number.isFinite(rawDiscount) ? rawDiscount : 0)));
      return {
        subtotal,
        discount: safeDiscount,
        orderDiscount: safeDiscount,
        total: Math.max(0, roundMoney(subtotal - safeDiscount)),
        groups: [],
      };
    }
    const cartLines = items.map(it => ({
      id: it.id,
      productId: it.productId,
      sku: it.sku,
      name: it.name,
      variation: it.entryDetails?.variation || '',
      unit: it.unit || 'pc',
      quantity: Number(it.quantity),
      warehouseId: it.warehouseId || '',
      priceType: it.entryDetails?.priceType || 'regular',
      unitPrice: Number(it.unitPrice || 0),
      prices: it.entryDetails?.prices || { regular: Number(it.unitPrice || 0), mm: null, provincial: null, promo: null, cost: null },
    }));
    let start = 0;
    const clampedDiscounts: GroupDiscount[] = [];
    items.forEach((it, idx) => {
      const g = keptGroups.find((d: GroupDiscount) => d.afterLineId === it.id);
      if (!g) return;
      const base = roundMoney(items.slice(start, idx + 1).reduce((s, r) => s + roundMoney(Number(r.quantity) * Number(r.unitPrice || 0)), 0));
      const clampedValue = g.type === 'percent' ? Math.min(100, Math.max(0, Number(g.value || 0))) : Math.min(base, Math.max(0, roundMoney(Number(g.value || 0))));
      clampedDiscounts.push({ afterLineId: g.afterLineId, type: g.type, value: clampedValue });
      start = idx + 1;
    });
    const preliminary = groupedOrderTotals(cartLines, clampedDiscounts, 0);
    const remainingAfterGroups = Math.max(0, roundMoney(subtotal - preliminary.discount));
    const rawOrderDiscount = Number(order?.receiptDetails?.orderDiscount ?? 0);
    const safeOrderDiscount = Math.min(remainingAfterGroups, Math.max(0, roundMoney(Number.isFinite(rawOrderDiscount) ? rawOrderDiscount : 0)));
    const finalTotals = groupedOrderTotals(cartLines, clampedDiscounts, safeOrderDiscount);
    return {
      subtotal: finalTotals.subtotal,
      discount: finalTotals.discount,
      orderDiscount: safeOrderDiscount,
      total: Math.max(0, finalTotals.total),
      groups: finalTotals.groups,
    };
  };

  // Pending Order Editing State (Client Feedback Page 19)
  const [editingPendingOrder, setEditingPendingOrder] = useState<ReceiptOrder | null>(null);
  const [editOrderItems, setEditOrderItems] = useState<ReceiptItem[]>([]);
  const [editQtyInputs, setEditQtyInputs] = useState<Record<string, string>>({});
  const [isSavingEditOrder, setIsSavingEditOrder] = useState(false);

  const filteredOrders = orders.filter(order => {
    const queryStr = searchQuery.toLowerCase();
    const matchesSku = order.skus?.some(sku => sku.toLowerCase().includes(queryStr));
    const matchesOrderNumber = order.orderNumber.toLowerCase().includes(queryStr);
    const matchesClient = order.clientName.toLowerCase().includes(queryStr);
    const matchesCity = order.deliveryCity?.toLowerCase().includes(queryStr);
    const matchesRegion = order.deliveryRegion?.toLowerCase().includes(queryStr);
    return matchesSku || matchesOrderNumber || matchesClient || matchesCity || matchesRegion;
  });

  // Chronological Status Priority Sorting (Client Feedback Page 18)
  const statusGroupRank = (st: OrderStatus): number => {
    switch (st) {
      case 'pending': return 0;
      case 'preparing': return 1;
      case 'out_for_delivery': return 2;
      case 'delivered': return 3;
      case 'completed': return 4;
      case 'cancelled': return 5;
      case 'escalated': return 6;
      default: return 7;
    }
  };

  const toggleSort = (key: OrderSortKey) => {
    setOrderViewMode('all');
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const statusChronologicalOrders = React.useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      const rankA = statusGroupRank(a.status);
      const rankB = statusGroupRank(b.status);
      if (rankA !== rankB) return rankA - rankB;
      return toTimeMs(b.createdAt) - toTimeMs(a.createdAt);
    });
  }, [filteredOrders]);

  const [fulfillmentStrategy, setFulfillmentStrategy] = useState<'FIFO' | 'LIFO'>(() => {
    try {
      return localStorage.getItem('activepro.fulfillment_strategy') === 'LIFO' ? 'LIFO' : 'FIFO';
    } catch {
      return 'FIFO';
    }
  });

  useEffect(() => {
    const syncStrategy = () => {
      try {
        setFulfillmentStrategy(localStorage.getItem('activepro.fulfillment_strategy') === 'LIFO' ? 'LIFO' : 'FIFO');
      } catch {
        setFulfillmentStrategy('FIFO');
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'activepro.fulfillment_strategy') syncStrategy();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('activepro_fulfillment_strategy_changed', syncStrategy);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('activepro_fulfillment_strategy_changed', syncStrategy);
    };
  }, []);

  // System-wide unified ordering: Supports column sorting, Status Grouping, In-place Row Stability, and Manual Drag & Drop
  const displayOrders = React.useMemo(() => {
    if (orderViewMode === 'fifo_queue') {
      return prioritizeOrderQueue(filteredOrders, fulfillmentStrategy);
    }

    if (sortKey) {
      const dir = sortDirection === 'asc' ? 1 : -1;
      return [...filteredOrders].sort((a, b) => {
        let diff = 0;
        if (sortKey === 'orderNumber') {
          diff = (a.orderNumber || '').localeCompare(b.orderNumber || '', undefined, { numeric: true, sensitivity: 'base' }) * dir;
        } else if (sortKey === 'clientName') {
          diff = (a.clientName || '').localeCompare(b.clientName || '', undefined, { sensitivity: 'base' }) * dir;
        } else if (sortKey === 'status') {
          diff = (statusGroupRank(a.status) - statusGroupRank(b.status)) * dir;
        } else if (sortKey === 'deadline') {
          const dA = toTimeMs(a.deliveryDeadline);
          const dB = toTimeMs(b.deliveryDeadline);
          if (dA === 0 && dB === 0) diff = 0;
          else if (dA === 0) return 1;
          else if (dB === 0) return -1;
          else diff = (dA - dB) * dir;
        } else if (sortKey === 'amount') {
          diff = (Number(a.totalAmount || 0) - Number(b.totalAmount || 0)) * dir;
        }
        if (diff !== 0) return diff;
        return toTimeMs(b.createdAt) - toTimeMs(a.createdAt);
      });
    }

    if (!customOrderIds.length) {
      return statusChronologicalOrders;
    }

    // Preserve custom drag-and-drop / in-place stability while placing newly created orders on top
    const orderMap = new Map(filteredOrders.map(o => [o.id, o]));
    const arranged: Order[] = [];
    for (const id of customOrderIds) {
      const found = orderMap.get(id);
      if (found) {
        arranged.push(found);
        orderMap.delete(id);
      }
    }
    const unarranged: Order[] = [];
    for (const order of statusChronologicalOrders) {
      if (orderMap.has(order.id)) {
        unarranged.push(order);
        orderMap.delete(order.id);
      }
    }
    return [...unarranged, ...arranged];
  }, [filteredOrders, customOrderIds, statusChronologicalOrders, orderViewMode, fulfillmentStrategy, sortKey, sortDirection]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedOrderId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverOrderId !== targetId) {
      setDragOverOrderId(targetId);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverOrderId(null);
    if (!draggedOrderId || draggedOrderId === targetId) {
      setDraggedOrderId(null);
      return;
    }
    const currentList = displayOrders.map(o => o.id);
    const fromIndex = currentList.indexOf(draggedOrderId);
    const toIndex = currentList.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedOrderId(null);
      return;
    }

    const updated = [...currentList];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    setSortKey(null);
    setCustomOrderIds(updated);
    localStorage.setItem('activepro_custom_order_ids', JSON.stringify(updated));
    setDraggedOrderId(null);
    toast.success('Order arrangement updated.');
  };

  const handleDragEnd = () => {
    setDraggedOrderId(null);
    setDragOverOrderId(null);
  };

  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');

  const resolveUserName = (changedBy?: string): string => {
    if (!changedBy) return 'Staff';
    if (changedBy === profile?.uid) {
      return profile?.displayName || profile?.email || profile?.role || 'Admin';
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(changedBy);
    if (isUuid) {
      const matched = users.find(u => u.uid === changedBy || (u as any).id === changedBy);
      return matched?.displayName || matched?.email || matched?.role || 'Staff';
    }
    return changedBy;
  };

  useEffect(() => {
    const handleIncidentsChanged = () => setIncidents(getLocalIncidents());
    window.addEventListener('activepro_incidents_changed', handleIncidentsChanged);
    window.addEventListener('storage', handleIncidentsChanged);
    return () => {
      window.removeEventListener('activepro_incidents_changed', handleIncidentsChanged);
      window.removeEventListener('storage', handleIncidentsChanged);
    };
  }, []);

  useEffect(() => {
    const isAdminOrSecretary = hasAdminRole(profile) || profile?.role === 'secretary';
    const q = isAdminOrSecretary
      ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'orders'), where('agentId', '==', profile?.uid || ''), orderBy('createdAt', 'desc'));

    const unsubOrders = onSnapshot(q, (snap) => {
      const fetchedOrders = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Order));
      setOrders(fetchedOrders);
      // Auto-evaluate continuous SLAs & generate ITIL incident tickets (FR-06)
      evaluateAndSyncSLAIncidents(fetchedOrders, profile).then(synced => setIncidents(synced));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'orders');
    });

    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Product)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'products');
    });

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snap) => {
      setInventory(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'inventory');
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as UserProfile)));
    }, () => {
    });

    return () => {
      unsubOrders();
      unsubProducts();
      unsubInventory();
      unsubUsers();
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

    // Optimistic concurrency check: ensure order wasn't modified concurrently by another staff member
    try {
      const { data: latestOrder, error: checkError } = await supabase
        .from('orders')
        .select('status')
        .eq('id', order.id)
        .maybeSingle();

      if (!checkError && latestOrder && latestOrder.status !== order.status) {
        toast.error(`Order status was modified by another staff member to "${latestOrder.status.replaceAll('_', ' ')}". Refreshing order.`);
        setOrders(current => current.map(item => item.id === order.id ? { ...item, status: latestOrder.status } : item));
        setSelectedOrder(current => current?.id === order.id ? { ...current, status: latestOrder.status } : current);
        statusLock.current = false;
        return;
      }
    } catch (checkErr) {
      console.warn('Could not verify concurrent order status:', checkErr);
    }

    // Freeze current row order in place so the row does not jump
    if (!customOrderIds.length && displayOrders.length > 0) {
      const currentSequence = displayOrders.map(o => o.id);
      setCustomOrderIds(currentSequence);
      try {
        localStorage.setItem('activepro_custom_order_ids', JSON.stringify(currentSequence));
      } catch {}
    }
    const authorName = profile?.displayName || profile?.email || profile?.role || 'Staff';
    const statusHistory = [...(order.statusHistory || [])];
    if (statusHistory.at(-1)?.status !== order.status) {
      statusHistory.push({ status: order.status, changedBy: authorName, timestamp: new Date().toISOString() });
    }
    statusHistory.push({ status: newStatus, changedBy: authorName, timestamp: new Date().toISOString() });
    const restoredInventory: Array<{ id: string; prevQty: number }> = [];
    const createdAdjustmentIds: string[] = [];
    try {
      let updatedData: any = null;
      const { data, error } = await supabase.rpc('transition_order_entry', { p_order_id: order.id, p_status: newStatus });
      if (error) {
        if (!isMissingRpcError(error)) {
          throw error;
        }
        console.warn('Supabase transition_order_entry RPC missing, falling back to client adapter:', error);
      }
      if (error || !data || data.id !== order.id || data.status !== newStatus) {
        const shouldRestore = ['cancelled', 'escalated'].includes(newStatus) && (order as any).stockReserved !== false;
        const nextReserved = ['cancelled', 'escalated'].includes(newStatus) ? false : (order as any).stockReserved;

        if (shouldRestore) {
          const itemsSnap = await getDocs(query(collection(db, 'order_items'), where('orderId', '==', order.id)));
          const invSnap = await getDocs(collection(db, 'inventory'));
          const invList = invSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          for (const itemDoc of itemsSnap.docs) {
            const it = itemDoc.data();
            const restoreQty = Number(it.quantity || 0);
            if (!it.productId || restoreQty <= 0) continue;
            const match = invList.find((inv: any) => inv.productId === it.productId && (!it.warehouseId || inv.warehouseId === it.warehouseId));
            if (match) {
              const prevQty = Number(match.quantity || 0);
              const nextQty = prevQty + restoreQty;
              restoredInventory.push({ id: match.id, prevQty });
              match.quantity = nextQty;
              await updateDoc(doc(db, 'inventory', match.id), {
                quantity: nextQty,
                lastUpdated: new Date().toISOString()
              });
              const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
                productId: it.productId,
                warehouseId: match.warehouseId || it.warehouseId,
                adjustmentAmount: restoreQty,
                reason: `Order ${order.orderNumber} ${newStatus}: stock restored`,
                recordedBy: profile?.uid || 'staff',
                timestamp: serverTimestamp(),
              });
              if (adjRef?.id) createdAdjustmentIds.push(adjRef.id);
            }
          }
        }

        await updateDoc(doc(db, 'orders', order.id), { status: newStatus, statusHistory, stockReserved: nextReserved });
        updatedData = { ...order, status: newStatus, statusHistory, stockReserved: nextReserved };
      } else {
        updatedData = data;
      }
      setOrders(current => current.map(item => item.id === order.id ? updatedData : item));
      setSelectedOrder(current => current?.id === order.id ? updatedData : current);
      toast.success(`Order ${order.orderNumber}: ${newStatus.replaceAll('_', ' ')}`, {
        description: ['cancelled', 'escalated'].includes(newStatus) ? 'Status and inventory restoration saved successfully.' : undefined,
      });
    } catch (error: any) {
      for (const adjId of [...createdAdjustmentIds].reverse()) {
        await deleteDoc(doc(db, 'stockAdjustments', adjId)).catch(() => {});
      }
      for (const entry of [...restoredInventory].reverse()) {
        await updateDoc(doc(db, 'inventory', entry.id), {
          quantity: entry.prevQty,
          lastUpdated: new Date().toISOString(),
        }).catch(() => {});
      }
      handleSupabaseError(error, OperationType.UPDATE, `orders/${order.id}`);
    } finally { statusLock.current = false; }
  };

  const revertOrderStatus = (order: Order) => {
    const target = previousOrderStatus(order);
    if (!canManageOrders || statusLock.current) return;
    const blockReason = revertBlockReason(order, target);
    if (blockReason || !target) {
      if (blockReason) toast.error(blockReason);
      return;
    }
    setConfirmAction({
      title: `Revert order ${order.orderNumber}`,
      description: `Revert order ${order.orderNumber} to ${target.replaceAll('_', ' ')}?`,
      confirmLabel: 'Revert order',
      onConfirm: () => executeRevertOrderStatus(order, target),
    });
  };

  const executeRevertOrderStatus = async (order: Order, target: OrderStatus) => {
    if (!canManageOrders || statusLock.current) return;
    statusLock.current = true;
    setIsReverting(true);

    const now = new Date().toISOString();
    const statusHistory = Array.isArray(order.statusHistory) ? [...order.statusHistory] : [];
    if (statusHistory.at(-1)?.status !== order.status) {
      statusHistory.push({
        status: order.status,
        changedBy: profile?.displayName || profile?.email || profile?.uid || 'User',
        timestamp: now,
      });
    }
    statusHistory.push({
      status: target,
      changedBy: profile?.displayName || profile?.email || profile?.uid || 'User',
      timestamp: now,
      note: `Reverted to ${target.replaceAll('_', ' ')}`,
    });

    if (!customOrderIds.length && displayOrders.length > 0) {
      const currentSequence = displayOrders.map(o => o.id);
      setCustomOrderIds(currentSequence);
      try {
        localStorage.setItem('activepro_custom_order_ids', JSON.stringify(currentSequence));
      } catch {}
    }

    const rolledBackStock: Array<{ invId: string; prevQty: number; adjId?: string }> = [];
    try {
      const { data: latestOrder, error: latestError } = await supabase
        .from('orders')
        .select('status, stockReserved')
        .eq('id', order.id)
        .maybeSingle();
      if (latestError) throw latestError;
      if (latestOrder && latestOrder.status !== order.status) {
        toast.error(`Order was already modified to "${String(latestOrder.status).replaceAll('_', ' ')}" by another staff member.`);
        setOrders(current => current.map(item => item.id === order.id ? { ...item, status: latestOrder.status } : item));
        setSelectedOrder(current => current?.id === order.id ? { ...current, status: latestOrder.status } : current);
        return;
      }

      let updatedData: any = null;
      let rpcSucceeded = false;
      const { data, error } = await supabase.rpc('transition_order_entry', {
        p_order_id: order.id,
        p_status: target,
        ...(target === 'out_for_delivery' && order.photoValidationUrl
          ? { p_photo_url: order.photoValidationUrl } : {}),
      });
      if (error) {
        if (!isMissingRpcError(error)) {
          throw error;
        }
        console.warn('Supabase transition_order_entry RPC missing in revertOrderStatus, using fallback:', error);
      } else if (data && data.id === order.id && data.status === target) {
        updatedData = data;
        rpcSucceeded = true;
      }

      if (!rpcSucceeded) {
        const needsReDeduct =
          requiresStockReReservation(order.status, target) &&
          (latestOrder?.stockReserved ?? (order as any).stockReserved) === false;

        if (needsReDeduct) {
          const itemsSnap = await getDocs(query(collection(db, 'order_items'), where('orderId', '==', order.id)));
          const invSnap = await getDocs(collection(db, 'inventory'));
          const invList = invSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          const requiredMap = new Map<string, { productId: string; warehouseId?: string; qty: number }>();

          for (const itemDoc of itemsSnap.docs) {
            const it = itemDoc.data();
            const qty = Number(it.quantity || 0);
            if (!it.productId || qty <= 0) continue;
            const key = `${it.productId}::${it.warehouseId || ''}`;
            const prev = requiredMap.get(key);
            requiredMap.set(key, {
              productId: it.productId,
              warehouseId: it.warehouseId,
              qty: (prev?.qty || 0) + qty,
            });
          }

          for (const reqItem of requiredMap.values()) {
            const matchingRows = invList.filter(
              (inv: any) =>
                inv.productId === reqItem.productId &&
                (!reqItem.warehouseId || inv.warehouseId === reqItem.warehouseId)
            );
            const totalAvail = matchingRows.reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);
            if (!matchingRows.length || totalAvail < reqItem.qty) {
              throw new Error(`Insufficient stock to restore order (${reqItem.productId}: needed ${reqItem.qty}, available ${totalAvail}).`);
            }
          }

          for (const reqItem of requiredMap.values()) {
            let remaining = reqItem.qty;
            const matchingRows = invList.filter(
              (inv: any) =>
                inv.productId === reqItem.productId &&
                (!reqItem.warehouseId || inv.warehouseId === reqItem.warehouseId) &&
                Number(inv.quantity || 0) > 0
            );
            for (const row of matchingRows) {
              if (remaining <= 0) break;
              const liveSnap = await getDoc(doc(db, 'inventory', row.id));
              const liveQty = Number((liveSnap.exists() ? liveSnap.data()?.quantity : row.quantity) || 0);
              const take = Math.min(remaining, liveQty);
              if (take <= 0) continue;
              const nextQty = liveQty - take;
              row.quantity = nextQty;
              await updateDoc(doc(db, 'inventory', row.id), {
                quantity: nextQty,
                lastUpdated: new Date().toISOString(),
              });
              rolledBackStock.push({ invId: row.id, prevQty: liveQty });
              const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
                productId: reqItem.productId,
                warehouseId: row.warehouseId,
                adjustmentAmount: -take,
                reason: `Order Restored: ${order.orderNumber} reverted from ${order.status}`,
                recordedBy: profile?.uid || 'staff',
                timestamp: serverTimestamp(),
              });
              if (adjRef?.id) {
                rolledBackStock[rolledBackStock.length - 1].adjId = adjRef.id;
              }
              remaining -= take;
            }
            if (remaining > 0) {
              throw new Error(`Stock changed concurrently while restoring order ${order.orderNumber}.`);
            }
          }
        }

        const nextReserved = requiresStockReReservation(order.status, target)
          ? true
          : (order as any).stockReserved;
        await updateDoc(doc(db, 'orders', order.id), { status: target, statusHistory, stockReserved: nextReserved });
        updatedData = { ...order, status: target, statusHistory, stockReserved: nextReserved };
      }

      const finalOrder = updatedData;
      setOrders(current => current.map(item => item.id === order.id ? finalOrder : item));
      setSelectedOrder(current => current?.id === order.id ? finalOrder : current);
      toast.success(`Order reverted to ${target.replaceAll('_', ' ')}`);
    } catch (error: any) {
      for (const entry of [...rolledBackStock].reverse()) {
        try {
          if (entry.adjId) await deleteDoc(doc(db, 'stockAdjustments', entry.adjId));
          await updateDoc(doc(db, 'inventory', entry.invId), { quantity: entry.prevQty, lastUpdated: new Date().toISOString() });
        } catch (rbErr) {
          console.error('Rollback failed during revertOrderStatus:', rbErr);
        }
      }
      handleSupabaseError(error, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      statusLock.current = false;
      setIsReverting(false);
    }
  };

  const revertButton = (order: Order) => {
    const target = previousOrderStatus(order);
    return canManageOrders && target ? (
      <Button size="icon" variant="outline" disabled={isReverting}
        onClick={() => revertOrderStatus(order)}
        aria-label={`Revert to ${target.replaceAll('_', ' ')}`}
        title={`Revert to ${target.replaceAll('_', ' ')}`}>
        <Undo2 className="w-3 h-3" />
      </Button>
    ) : null;
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

  const handleStartEditPendingOrder = async (order: Order) => {
    setEditingPendingOrder(order as ReceiptOrder);
    setEditOrderItems([]);
    setEditQtyInputs({});
    setIsLoadingItems(true);
    try {
      const itemsSnap = await getDocs(collection(db, 'orders', order.id, 'items'));
      const items = itemsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as ReceiptItem))
        .sort((a, b) => (a.entryDetails?.position ?? 0) - (b.entryDetails?.position ?? 0));
      setEditOrderItems(items);
      setEditQtyInputs(Object.fromEntries(items.map((it, i) => [it.id || String(i), String(it.quantity)])));
    } catch (err) {
      handleSupabaseError(err, OperationType.GET, `orders/${order.id}/items`);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleSavePendingOrderEdit = async () => {
    if (!canManageOrders || !editingPendingOrder || isSavingEditOrder || statusLock.current) return;
    if (editOrderItems.length === 0) {
      toast.error('An order must have at least one item. Cancel the order instead if all items are unavailable.');
      return;
    }
    const normalizedItems = editOrderItems.map((item, idx) => {
      const rowKey = item.id || String(idx);
      const rawQty = editQtyInputs[rowKey];
      const parsedQty = rawQty !== undefined ? Number(rawQty.trim()) : Number(item.quantity);
      return { ...item, quantity: parsedQty };
    });
    for (const item of normalizedItems) {
      if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
        toast.error(`Invalid quantity for ${item.name}. Must be an integer of at least 1.`);
        return;
      }
    }

    statusLock.current = true;
    setIsSavingEditOrder(true);
    const modifiedInventory: Array<{ id: string; prevQty: number }> = [];
    const createdAdjustmentIds: string[] = [];
    const deletedOrderItems: ReceiptItem[] = [];
    const updatedOrderItems: ReceiptItem[] = [];

    try {
      // 0. Re-verify live order status so concurrently advanced orders cannot be edited
      const liveOrderSnap = await getDoc(doc(db, 'orders', editingPendingOrder.id));
      const liveStatus = liveOrderSnap?.exists() ? liveOrderSnap.data()?.status : null;
      if (liveStatus !== 'pending') {
        toast.error(`Order can no longer be edited because its live status is "${String(liveStatus || 'unknown').replaceAll('_', ' ')}".`);
        if (liveStatus) {
          setOrders(prev => prev.map(o => o.id === editingPendingOrder.id ? { ...o, status: liveStatus } : o));
          setSelectedOrder(prev => prev?.id === editingPendingOrder.id ? { ...prev, status: liveStatus } : prev);
        }
        setEditingPendingOrder(null);
        return;
      }

      const origSnap = await getDocs(collection(db, 'orders', editingPendingOrder.id, 'items'));
      const origItems = origSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReceiptItem));

      const liveInventorySnap = await getDocs(collection(db, 'inventory'));
      const liveInventoryRows = liveInventorySnap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem));

      const matchWarehouse = (invRow: InventoryItem, targetProductId: string, targetWarehouseId?: string) =>
        invRow.productId === targetProductId && (!targetWarehouseId || invRow.warehouseId === targetWarehouseId);

      // Compute net delta per (productId, warehouseKey) to validate aggregated availability before mutating
      const netDeltaByKey = new Map<string, { productId: string; warehouseId?: string; netDelta: number; name: string }>();
      for (const orig of origItems) {
        const stillPresent = normalizedItems.find(item => item.id === orig.id);
        if (!stillPresent) {
          const key = `${orig.productId}::${orig.warehouseId || ''}`;
          const cur = netDeltaByKey.get(key) || { productId: orig.productId, warehouseId: orig.warehouseId, netDelta: 0, name: orig.name };
          cur.netDelta -= Number(orig.quantity);
          netDeltaByKey.set(key, cur);
        }
      }
      for (const item of normalizedItems) {
        const orig = origItems.find(o => o.id === item.id);
        const oldQty = orig ? Number(orig.quantity) : 0;
        const delta = Number(item.quantity) - oldQty;
        if (delta !== 0) {
          const key = `${item.productId}::${item.warehouseId || ''}`;
          const cur = netDeltaByKey.get(key) || { productId: item.productId, warehouseId: item.warehouseId, netDelta: 0, name: item.name };
          cur.netDelta += delta;
          netDeltaByKey.set(key, cur);
        }
      }

      for (const entry of netDeltaByKey.values()) {
        if (entry.netDelta > 0) {
          const matchingRows = liveInventoryRows.filter(r => matchWarehouse(r, entry.productId, entry.warehouseId));
          const available = matchingRows.reduce((sum, r) => sum + Math.max(0, Number(r.quantity || 0)), 0);
          if (matchingRows.length === 0 || available < entry.netDelta) {
            toast.error(`Insufficient stock for ${entry.name}. Available: ${available}, needed addition: ${entry.netDelta}`);
            return;
          }
        }
      }

      const trackInventoryChange = async (productId: string, warehouseId: string | undefined, delta: number, reason: string) => {
        if (delta === 0) return;
        const matchingRows = liveInventoryRows.filter(r => matchWarehouse(r, productId, warehouseId));
        if (matchingRows.length === 0) {
          throw new Error(`No inventory record found for product ${productId} at warehouse ${warehouseId || 'default'}.`);
        }
        if (delta > 0) {
          // Consume additional stock across matching rows
          let remaining = delta;
          for (const row of matchingRows) {
            if (remaining <= 0) break;
            const curQty = Number(row.quantity || 0);
            if (curQty <= 0) continue;
            const take = Math.min(curQty, remaining);
            modifiedInventory.push({ id: row.id, prevQty: curQty });
            const nextQty = curQty - take;
            row.quantity = nextQty;
            await updateDoc(doc(db, 'inventory', row.id), {
              quantity: nextQty,
              lastUpdated: serverTimestamp(),
            });
            remaining -= take;
          }
          if (remaining > 0) {
            throw new Error('Concurrent inventory modification reduced available stock below requested delta.');
          }
        } else {
          // Return stock to primary matching row
          const primary = matchingRows[0];
          const curQty = Number(primary.quantity || 0);
          modifiedInventory.push({ id: primary.id, prevQty: curQty });
          const nextQty = curQty + Math.abs(delta);
          primary.quantity = nextQty;
          await updateDoc(doc(db, 'inventory', primary.id), {
            quantity: nextQty,
            lastUpdated: serverTimestamp(),
          });
        }

        const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
          productId,
          warehouseId: warehouseId || matchingRows[0].warehouseId,
          adjustmentAmount: -delta,
          reason,
          recordedBy: profile?.uid || 'staff',
          timestamp: serverTimestamp(),
        });
        if (adjRef?.id) createdAdjustmentIds.push(adjRef.id);
      };

      // 1. Process removed items: reinstate stock & delete line item
      for (const orig of origItems) {
        const stillPresent = normalizedItems.find(item => item.id === orig.id);
        if (!stillPresent) {
          await trackInventoryChange(
            orig.productId,
            orig.warehouseId,
            -Number(orig.quantity),
            `Order ${editingPendingOrder.orderNumber} edited: removed ${orig.name}`,
          );
          deletedOrderItems.push(orig);
          await deleteDoc(doc(db, 'order_items', orig.id));
        }
      }

      // 2. Process modified items (decreases first so released stock is available before increases consume it)
      const modifiedEntries = normalizedItems
        .map(item => {
          const orig = origItems.find(o => o.id === item.id);
          const oldQty = orig ? Number(orig.quantity) : 0;
          return { item, orig, oldQty, delta: Number(item.quantity) - oldQty };
        })
        .sort((a, b) => a.delta - b.delta);

      for (const { item, orig, oldQty, delta } of modifiedEntries) {
        if (delta !== 0) {
          await trackInventoryChange(
            item.productId,
            item.warehouseId,
            delta,
            `Order ${editingPendingOrder.orderNumber} edited: ${item.name} qty changed from ${oldQty} to ${item.quantity}`,
          );
        }
        if (orig && Number(item.quantity) !== oldQty) {
          updatedOrderItems.push(orig);
          const newSubtotal = roundMoney(Number(item.quantity) * Number(item.unitPrice || 0));
          await updateDoc(doc(db, 'order_items', item.id), {
            quantity: Number(item.quantity),
            subtotal: newSubtotal,
            updatedAt: serverTimestamp(),
          });
        }
      }

      // 3. Recalculate order totals (including groupDiscounts)
      const recalculated = computeEditedOrderTotals(editingPendingOrder, normalizedItems);
      const newSkus = Array.from(new Set(normalizedItems.map(it => it.sku).filter(Boolean)));

      const updatedOrder: Partial<Order> = {
        totalAmount: recalculated.total,
        skus: newSkus,
        receiptDetails: {
          ...(editingPendingOrder.receiptDetails || { address: '', paymentTerms: '', preparedBy: '' }),
          subtotal: recalculated.subtotal,
          discount: recalculated.discount,
          orderDiscount: recalculated.orderDiscount,
          groupDiscounts: recalculated.groups,
        },
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'orders', editingPendingOrder.id), updatedOrder);

      // Update local states
      const savedItemsSnapshot = normalizedItems.map(it => ({
        ...it,
        quantity: Number(it.quantity),
        subtotal: roundMoney(Number(it.quantity) * Number(it.unitPrice || 0)),
      }));
      setOrders(prev => prev.map(o => o.id === editingPendingOrder.id ? { ...o, ...updatedOrder } : o));
      if (selectedOrder?.id === editingPendingOrder.id) {
        setSelectedOrder(prev => prev ? { ...prev, ...updatedOrder } : null);
        setOrderItems(savedItemsSnapshot);
      }

      toast.success(`Order ${editingPendingOrder.orderNumber} updated successfully.`);
      setEditingPendingOrder(null);
    } catch (err) {
      // Compensation rollback in reverse order
      for (const roll of [...modifiedInventory].reverse()) {
        try {
          await updateDoc(doc(db, 'inventory', roll.id), {
            quantity: roll.prevQty,
            lastUpdated: serverTimestamp(),
          });
        } catch (rollErr) {
          console.warn('Pending order edit rollback inventory failed:', rollErr);
        }
      }
      for (const adjId of [...createdAdjustmentIds].reverse()) {
        try {
          await deleteDoc(doc(db, 'stockAdjustments', adjId));
        } catch (adjErr) {
          console.warn('Pending order edit rollback stockAdjustment failed:', adjErr);
        }
      }
      for (const deleted of [...deletedOrderItems].reverse()) {
        try {
          await setDoc(doc(db, 'order_items', deleted.id), deleted);
        } catch (itemErr) {
          console.warn('Pending order edit rollback restore item failed:', itemErr);
        }
      }
      for (const prevItem of [...updatedOrderItems].reverse()) {
        try {
          await updateDoc(doc(db, 'order_items', prevItem.id), {
            quantity: prevItem.quantity,
            subtotal: prevItem.subtotal,
            updatedAt: serverTimestamp(),
          });
        } catch (itemUpdErr) {
          console.warn('Pending order edit rollback revert item failed:', itemUpdErr);
        }
      }
      handleSupabaseError(err, OperationType.UPDATE, `orders/${editingPendingOrder.id}`);
    } finally {
      statusLock.current = false;
      setIsSavingEditOrder(false);
    }
  };

  const handleDispatch = async () => {
    if (!canManageOrders || !dispatchOrder || !photoFile || statusLock.current) return;
    statusLock.current = true;
    setIsUploading(true);

    // Optimistic concurrency check before dispatching
    try {
      const { data: latestOrder, error: checkError } = await supabase
        .from('orders')
        .select('status')
        .eq('id', dispatchOrder.id)
        .maybeSingle();

      if (!checkError && latestOrder && ['out_for_delivery', 'cancelled', 'escalated', 'delivered', 'completed'].includes(latestOrder.status)) {
        toast.error(`Order was already modified to "${latestOrder.status.replaceAll('_', ' ')}" by another staff member.`);
        setOrders(current => current.map(item => item.id === dispatchOrder.id ? { ...item, status: latestOrder.status } : item));
        setSelectedOrder(current => current?.id === dispatchOrder.id ? { ...current, status: latestOrder.status } : current);
        setIsDispatchDialogOpen(false);
        setDispatchOrder(null);
        setPhotoFile(null);
        setPhotoPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        statusLock.current = false;
        setIsUploading(false);
        return;
      }
    } catch (checkErr) {
      console.warn('Could not verify concurrent dispatch order status:', checkErr);
    }

    try {
      let downloadUrl = '';
      try {
        const compressedFile = await compressImage(photoFile);
        const filePath = `dispatch-proofs/${dispatchOrder.id}_${Date.now()}_${compressedFile.name}`;
        const storageRef = ref(storage, filePath);
        await uploadBytes(storageRef, compressedFile);
        downloadUrl = await getDownloadURL(storageRef);
      } catch (storageErr) {
        console.warn('Storage upload warning, attempting compressed data URL fallback:', storageErr);
        const fallbackCompressed = await compressImage(photoFile, 800, 800, 0.65);
        if (fallbackCompressed.size > 512 * 1024) {
          throw new Error('Could not upload dispatch proof image and compressed fallback exceeds 512 KB.');
        }
        downloadUrl = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => (typeof reader.result === 'string' ? res(reader.result) : rej(new Error('Invalid image encoding')));
          reader.onerror = () => rej(new Error('Failed to encode compressed image'));
          reader.readAsDataURL(fallbackCompressed);
        });
      }

      const authorName = profile?.displayName || profile?.email || profile?.role || 'Staff';
      const statusHistory = [...(dispatchOrder.statusHistory || [])];
      if (statusHistory.at(-1)?.status !== dispatchOrder.status) {
        statusHistory.push({ status: dispatchOrder.status, changedBy: authorName, timestamp: new Date().toISOString() });
      }
      statusHistory.push({ status: 'out_for_delivery', changedBy: authorName, timestamp: new Date().toISOString() });

      let updatedData: any = null;
      const { data, error } = await supabase.rpc('transition_order_entry', {
        p_order_id: dispatchOrder.id, p_status: 'out_for_delivery', p_photo_url: downloadUrl,
      });

      if (error) {
        if (!isMissingRpcError(error)) {
          throw error;
        }
        console.warn('Supabase transition_order_entry RPC missing in handleDispatch, falling back to client adapter:', error);
      }

      if (error || !data || data.id !== dispatchOrder.id || data.status !== 'out_for_delivery') {
        await updateDoc(doc(db, 'orders', dispatchOrder.id), {
          status: 'out_for_delivery',
          photoValidationUrl: downloadUrl,
          statusHistory,
        });
        updatedData = {
          ...dispatchOrder,
          status: 'out_for_delivery',
          photoValidationUrl: downloadUrl,
          statusHistory,
        };
      } else {
        updatedData = data;
      }

      setOrders(current => current.map(item => item.id === dispatchOrder.id ? updatedData : item));
      setSelectedOrder(current => current?.id === dispatchOrder.id ? updatedData : current);
      setIsDispatchDialogOpen(false);
      setDispatchOrder(null);
      setPhotoFile(null);
      setPhotoPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        <PageHeading title="Order Entry" subtitle="Create orders and track items, deliveries, and fulfillment status." />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className={`gap-1.5 text-xs font-semibold ${
              activeIncidents.length > 0
                ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                : 'text-zinc-600'
            }`}
            onClick={() => setIsIncidentsDialogOpen(true)}
          >
            <ShieldAlert className="size-4 shrink-0 text-red-500" />
            <span>ITIL Incidents</span>
            {activeIncidents.length > 0 && (
              <Badge variant="destructive" className="h-5 px-1.5 text-[10px] font-bold">
                {activeIncidents.length}
              </Badge>
            )}
          </Button>
          {canCreate && <Button onClick={() => setIsNewOrderOpen(true)}><Plus className="size-4" />Create Order</Button>}
        </div>
        {profile && canCreate && <OrderEntry key={`${profile.uid}:${orderEntryKey}`} open={isNewOrderOpen} onClose={() => setIsNewOrderOpen(false)} orders={orders} products={products} inventory={inventory} profile={profile} onSaved={(order, items) => {
          setOrders(current => [order, ...current.filter(item => item.id !== order.id)]);
          setSortKey(null);
          setOrderViewMode('all');
          if (customOrderIds.length > 0) {
            const nextIds = [order.id, ...customOrderIds.filter(id => id !== order.id)];
            setCustomOrderIds(nextIds);
            localStorage.setItem('activepro_custom_order_ids', JSON.stringify(nextIds));
          }
          setIsNewOrderOpen(false);
          setOrderEntryKey(value => value + 1);
          setReceiptItems(items);
          setReceiptOrder(order);
        }} />}
        <DeliveryReceipt order={receiptOrder} items={receiptItems} onClose={() => setReceiptOrder(null)} />

        <ITILIncidentConsole
          open={isIncidentsDialogOpen}
          onClose={() => setIsIncidentsDialogOpen(false)}
          incidents={incidents}
          onRefresh={() => setIncidents(getLocalIncidents())}
          profile={profile}
        />

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

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="self-start" disabled={isLoadingItems || !orderItems.length} onClick={() => {
                const enrichedItems = orderItems.map(item => {
                  const prod = products.find(p => p.id === item.productId);
                  const unit = item.entryDetails?.unit || (item as any).entry_details?.unit || item.unit || (item as any).units || (prod?.units != null ? String(prod.units) : prod?.unit) || 'pc';
                  return {
                    ...item,
                    unit,
                    entryDetails: {
                      ...(item.entryDetails || {}),
                      unit,
                    }
                  };
                });
                setIsOrderDetailsOpen(false);
                setReceiptItems(enrichedItems);
                setReceiptOrder(selectedOrder);
              }}><FileText className="size-4" />View Delivery Receipt</Button>
              {selectedOrder?.status === 'pending' && canManageOrders && (
                <Button variant="outline" className="self-start" onClick={() => {
                  if (selectedOrder) {
                    setIsOrderDetailsOpen(false);
                    handleStartEditPendingOrder(selectedOrder);
                  }
                }}>
                  <Pencil className="size-4" />Edit Pending Order
                </Button>
              )}
            </div>
            <div role="tablist" aria-label="Order details sections" className="flex items-center gap-4 border-b border-border px-6 -mx-6">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'items'}
                className={`pb-3 text-xs font-black uppercase tracking-widest transition-all relative ${activeTab === 'items' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                onClick={() => setActiveTab('items')}
              >
                Line Items
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'history'}
                className={`pb-3 text-xs font-black uppercase tracking-widest transition-all relative ${activeTab === 'history' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
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
                            <TableHead className="text-[10px] font-bold uppercase py-2 min-w-37.5">Item</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2 text-center min-w-20">Qty</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2 text-right min-w-25">Price</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2 text-right min-w-25">Total</TableHead>
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
                  <div className="space-y-4 pr-2 max-h-100 overflow-y-auto">
                    {selectedOrder?.statusHistory?.slice().reverse().map((entry, idx) => (
                      <div key={idx} className="relative pl-6 pb-6 border-l-2 border-border last:pb-0">
                        <div className={`absolute -left-2.25 top-0 w-4 h-4 rounded-full border-2 border-background ${entry.status === 'delivered' ? 'bg-emerald-500' :
                          entry.status === 'pending' ? 'bg-zinc-300' : 'bg-blue-500'
                          }`} />
                        <div className="bg-muted rounded-xl p-3 border border-border group hover:border-foreground/20 transition-colors">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-foreground">
                              {entry.status.replace('_', ' ')}
                            </span>
                            <span className="text-[9px] font-medium text-muted-foreground">
                              {entry.timestamp && (
                                typeof entry.timestamp.toDate === 'function'
                                  ? format(entry.timestamp.toDate(), 'MMM d, h:mm a')
                                  : format(new Date(entry.timestamp), 'MMM d, h:mm a')
                              )}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">{entry.note}</p>
                          <div className="flex items-center gap-1.5 border-t border-border/60 pt-2">
                            <div className="w-4 h-4 bg-background rounded-full flex items-center justify-center">
                              <UserIcon className="w-2 h-2 text-muted-foreground" />
                            </div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight">Modified by {resolveUserName(entry.changedBy)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!selectedOrder?.statusHistory || selectedOrder.statusHistory.length === 0) && (
                      <div className="text-center py-12 text-muted-foreground italic text-xs">
                        No historical status logs found for this entry.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Client Information</p>
                    <div className="bg-muted p-2 rounded-md border border-border">
                      <p className="text-xs font-bold text-foreground">{selectedOrder?.clientName}</p>
                      <p className="text-[10px] text-muted-foreground font-medium">
                        {selectedOrder?.deliveryRegion} Region{selectedOrder?.deliveryCity ? ` • ${selectedOrder.deliveryCity}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">ITIL SLA & Queueing Policy</p>
                    <div className="space-y-1.5 bg-muted p-2.5 rounded-md border border-border">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                        <div>
                          <p className="text-xs font-bold text-foreground">
                            {selectedOrder?.deliveryDeadline && (
                              typeof selectedOrder.deliveryDeadline.toDate === 'function'
                                ? format(selectedOrder.deliveryDeadline.toDate(), 'PPP')
                                : format(new Date(selectedOrder.deliveryDeadline), 'PPP')
                            )}
                          </p>
                          <p className="text-[9px] uppercase font-black text-muted-foreground tracking-tight">
                            {selectedOrder?.deliveryRegion === 'Metro Manila' ? '7-Day SLA Baseline (Metro Manila)' : '14-Day SLA Baseline (Mindanao / Provincial)'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[10px]">
                        <span className="text-muted-foreground font-medium">Batch Queue:</span>
                        <Badge variant="outline" className="text-[9px] font-bold bg-background">
                          {(selectedOrder?.allocationStrategy || 'FIFO') === 'LIFO'
                            ? 'LIFO (Newest Batch First)'
                            : 'FIFO (Oldest Batch First)'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Grand Total</span>
                      <span className="text-lg font-black text-foreground">
                        ₱{selectedOrder?.totalAmount.toLocaleString()}
                      </span>
                    </div>
                    {(selectedOrder as ReceiptOrder)?.receiptDetails && <div className="mt-2 space-y-1 text-xs text-muted-foreground"><p>Subtotal: {money((selectedOrder as ReceiptOrder).receiptDetails!.subtotal)}</p><p>Order discount: {money((selectedOrder as ReceiptOrder).receiptDetails!.discount)}</p><p>Payment terms: {(selectedOrder as ReceiptOrder).receiptDetails!.paymentTerms}</p></div>}
                  </div>

                  {selectedOrder?.photoValidationUrl && (
                    <div className="pt-4 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Dispatch Photo Proof (Click to view full image)</p>
                      <button
                        type="button"
                        onClick={() => openSafeExternalUrl(selectedOrder.photoValidationUrl)}
                        className="block w-full rounded-lg border border-border overflow-hidden hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title="Click to view full photo proof"
                        aria-label="View full dispatch photo proof"
                      >
                        <img
                          src={selectedOrder.photoValidationUrl}
                          alt="Dispatch Validation"
                          className="w-full h-32 object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </button>
                    </div>
                  )}

                  {selectedOrder && revertButton(selectedOrder)}
                  {selectedOrder && canManageOrders && !['delivered', 'completed', 'cancelled', 'escalated'].includes(selectedOrder.status) && (
                    <div className="pt-4 border-t border-border flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-amber-600 border-amber-200 hover:bg-amber-50 gap-1.5 text-xs font-bold"
                        onClick={() => {
                          const targetOrder = selectedOrder;
                          setConfirmAction({
                            title: `Escalate order ${targetOrder.orderNumber}`,
                            description: `Escalate order ${targetOrder.orderNumber}? Stock will be returned to inventory.`,
                            confirmLabel: 'Escalate order',
                            onConfirm: () => updateOrderStatus(targetOrder, 'escalated'),
                          });
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
                          const targetOrder = selectedOrder;
                          setConfirmAction({
                            title: `Cancel order ${targetOrder.orderNumber}`,
                            description: `Cancel order ${targetOrder.orderNumber}? Stock will be restored to inventory.`,
                            confirmLabel: 'Cancel order',
                            destructive: true,
                            onConfirm: () => updateOrderStatus(targetOrder, 'cancelled'),
                          });
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
          if (!open) {
            setPhotoFile(null);
            setPhotoPreview(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
          setIsDispatchDialogOpen(open);
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-500" />
                Dispatch Photo Proof
              </DialogTitle>
              <DialogDescription>
                Upload a photo as proof of dispatch for <span className="font-bold text-foreground">{dispatchOrder?.orderNumber}</span>.
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
                  e.target.value = '';
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
                  className="w-full h-44 rounded-xl border-2 border-dashed border-border hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-all flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-blue-500 group"
                >
                  <div className="w-12 h-12 rounded-full bg-muted group-hover:bg-blue-100 dark:group-hover:bg-blue-950 flex items-center justify-center transition-colors">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold">Click to upload photo</p>
                    <p className="text-[10px] mt-0.5 text-muted-foreground">JPG, PNG, WEBP — max 10MB</p>
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
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
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
                onClick={() => {
                  setPhotoFile(null);
                  setPhotoPreview(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                  setIsDispatchDialogOpen(false);
                }}
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

        {/* Edit Pending Order Dialog (Client Feedback Page 19) */}
        <Dialog open={!!editingPendingOrder} onOpenChange={(open) => {
          if (!open && !isSavingEditOrder) setEditingPendingOrder(null);
        }}>
          <DialogContent className="sm:max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-primary" />
                Edit Pending Order: {editingPendingOrder?.orderNumber}
              </DialogTitle>
              <DialogDescription>
                Modify quantities or remove unavailable/damaged items before order preparation. Stock reservations are automatically reconciled.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Customer: </span>
                    <span className="font-bold">{editingPendingOrder?.clientName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Delivery City: </span>
                    <span className="font-medium">{editingPendingOrder?.deliveryCity || editingPendingOrder?.deliveryRegion || 'Metro Manila'}</span>
                  </div>
                </div>
              </div>

              {isLoadingItems ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Loading order items...
                </div>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted">
                      <TableRow>
                        <TableHead className="text-xs font-bold">Item Description</TableHead>
                        <TableHead className="text-xs font-bold text-center w-28">Quantity</TableHead>
                        <TableHead className="text-xs font-bold text-right w-28">Unit Price</TableHead>
                        <TableHead className="text-xs font-bold text-right w-28">Subtotal</TableHead>
                        <TableHead className="w-12 text-center" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editOrderItems.map((item, idx) => {
                        const rowKey = item.id || String(idx);
                        return (
                        <TableRow key={rowKey}>
                          <TableCell>
                            <p className="font-semibold text-xs">{item.name}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{item.sku}</p>
                          </TableCell>
                          <TableCell className="text-center">
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              className="h-8 w-20 mx-auto text-center font-bold text-xs"
                              value={editQtyInputs[rowKey] ?? String(item.quantity)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setEditQtyInputs(prev => ({ ...prev, [rowKey]: raw }));
                                const parsed = Number(raw);
                                if (Number.isInteger(parsed) && parsed >= 1) {
                                  setEditOrderItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: parsed, subtotal: roundMoney(parsed * Number(it.unitPrice || 0)) } : it));
                                }
                              }}
                              onBlur={() => {
                                const parsed = parseInt((editQtyInputs[rowKey] ?? '').trim(), 10);
                                const safeQty = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
                                setEditQtyInputs(prev => ({ ...prev, [rowKey]: String(safeQty) }));
                                setEditOrderItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: safeQty, subtotal: roundMoney(safeQty * Number(it.unitPrice || 0)) } : it));
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium">
                            {money(Number(item.unitPrice || 0))}
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold">
                            {money(roundMoney(Number(item.quantity) * Number(item.unitPrice || 0)))}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              disabled={editOrderItems.length <= 1}
                              onClick={() => {
                                setEditOrderItems(prev => prev.filter((_, i) => i !== idx));
                                setEditQtyInputs(prev => {
                                  const next = { ...prev };
                                  delete next[rowKey];
                                  return next;
                                });
                              }}
                              title={editOrderItems.length <= 1 ? "Order must have at least one item" : "Remove item"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {(() => {
                const editedPreview = computeEditedOrderTotals(editingPendingOrder, editOrderItems);
                return (
                  <div className="flex flex-col items-end gap-1 pt-2 border-t">
                    <div className="text-xs text-muted-foreground flex gap-4">
                      <span>Subtotal:</span>
                      <span className="font-semibold text-foreground">
                        {money(editedPreview.subtotal)}
                      </span>
                    </div>
                    {editedPreview.discount > 0 && (
                      <div className="text-xs text-muted-foreground flex gap-4">
                        <span>Discount:</span>
                        <span className="font-semibold text-emerald-600">
                          -{money(editedPreview.discount)}
                        </span>
                      </div>
                    )}
                    <div className="text-sm font-bold flex gap-4 pt-1">
                      <span>New Total:</span>
                      <span className="text-base text-primary font-black">
                        {money(editedPreview.total)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={isSavingEditOrder}
                onClick={() => setEditingPendingOrder(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={isSavingEditOrder || isLoadingItems || editOrderItems.length === 0}
                onClick={handleSavePendingOrderEdit}
              >
                {isSavingEditOrder ? 'Saving...' : 'Save Order Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div >

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex-1 bg-card p-3 border border-border rounded-xl">
          <SearchBar
            placeholder="Search order number, customer, or SKU…"
            className="h-8 text-xs border-none shadow-none focus-visible:ring-0"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sortKey && orderViewMode === 'all' && (
            <button
              type="button"
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted transition-colors shadow-xs"
              onClick={() => setSortKey(null)}
              title="Clear column sort and return to newest / status order"
            >
              Clear Sort
            </button>
          )}
          {customOrderIds.length > 0 && orderViewMode === 'all' && (
            <button
              type="button"
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted transition-colors shadow-xs"
              onClick={() => {
                setCustomOrderIds([]);
                setSortKey(null);
                try {
                  localStorage.removeItem('activepro_custom_order_ids');
                } catch {}
                toast.info('Orders reset to default status grouping.');
              }}
              title="Reset custom row order back to default status grouping"
            >
              Reset to Status Grouping
            </button>
          )}
          <div role="tablist" aria-label="Order queue view" className="flex items-center gap-1.5 bg-muted p-1 rounded-xl shrink-0">
            <button
              type="button"
              role="tab"
              aria-selected={orderViewMode === 'all'}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                orderViewMode === 'all'
                  ? 'bg-background shadow-xs text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setOrderViewMode('all')}
            >
              All Orders ({filteredOrders.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={orderViewMode === 'fifo_queue'}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                orderViewMode === 'fifo_queue'
                  ? 'bg-background shadow-xs text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setOrderViewMode('fifo_queue')}
              title="Sort orders by ITIL FIFO fulfillment priority (oldest & overdue first)"
            >
              <ListFilter className="size-3.5" />
              <span>FIFO Queue</span>
              <Badge variant="secondary" className="h-4 px-1 text-[9px] font-bold">FR-09</Badge>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Sort by</span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {ORDER_SORT_COLUMNS.map(col => {
              const active = orderViewMode === 'all' && sortKey === col.key;
              return (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground font-semibold'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{col.label}</span>
                  {active ? (sortDirection === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
                </button>
              );
            })}
          </div>
        </div>
        {displayOrders.map(order => {
          const deadlineDate = typeof order.deliveryDeadline?.toDate === 'function' ? order.deliveryDeadline.toDate() : order.deliveryDeadline ? new Date(order.deliveryDeadline) : null;
          const isOverdue = deadlineDate && deadlineDate < new Date() && !['delivered', 'completed', 'cancelled', 'escalated'].includes(order.status);
          return (
            <div
              key={order.id}
              draggable
              onDragStart={(e) => handleDragStart(e, order.id)}
              onDragOver={(e) => handleDragOver(e, order.id)}
              onDrop={(e) => handleDrop(e, order.id)}
              onDragEnd={handleDragEnd}
              className={`bg-card border border-border rounded-xl p-4 space-y-3 transition-colors ${
                draggedOrderId === order.id ? 'opacity-30 bg-muted/70' : ''
              } ${
                dragOverOrderId === order.id ? 'border-t-2 border-blue-500 bg-blue-50/20 dark:bg-blue-950/20' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <div className="pt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground" title="Drag to reorder">
                    <DotsSixVertical className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-muted-foreground">{order.orderNumber}</p>
                    <p className="text-sm font-bold text-foreground mt-0.5">{order.clientName}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">
                    {order.deliveryRegion}{order.deliveryCity ? ` • ${order.deliveryCity}` : ''}
                  </p>
                </div>
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
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => handleViewDetails(order)} title="View Details" aria-label={`View details for order ${order.orderNumber}`}>
                  <Eye className="w-4 h-4" />
                </Button>
                {revertButton(order)}
                {canManageOrders && (
                  <>
                    {order.status === 'pending' && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30" onClick={() => handleStartEditPendingOrder(order)} title="Edit Pending Order" aria-label={`Edit pending order ${order.orderNumber}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => updateOrderStatus(order, 'preparing')} title="Move to Preparing" aria-label={`Move order ${order.orderNumber} to preparing`}>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    {order.status === 'preparing' && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30" onClick={() => updateOrderStatus(order, 'out_for_delivery')} title="Dispatch Order" aria-label={`Dispatch order ${order.orderNumber}`}>
                        <Camera className="w-4 h-4" />
                      </Button>
                    )}
                    {order.status === 'out_for_delivery' && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30" onClick={() => updateOrderStatus(order, 'delivered')} title="Confirm Delivery" aria-label={`Confirm delivery for order ${order.orderNumber}`}>
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                    )}
                    {order.status === 'delivered' && <Button size="sm" variant="outline" onClick={() => updateOrderStatus(order, 'completed')}>Complete</Button>}
                    {order.status !== 'delivered' && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'escalated' && (
                      <>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-500 hover:bg-amber-50"
                          onClick={() => setConfirmAction({
                            title: `Escalate order ${order.orderNumber}`,
                            description: `Escalate order ${order.orderNumber}? Reserved stock will be replenished to inventory.`,
                            confirmLabel: 'Escalate order',
                            onConfirm: () => updateOrderStatus(order, 'escalated'),
                          })}
                          title="Escalate Order (Restores Stock)"
                          aria-label={`Escalate order ${order.orderNumber}`}
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-500 hover:bg-red-50"
                          onClick={() => setConfirmAction({
                            title: `Cancel order ${order.orderNumber}`,
                            description: `Cancel order ${order.orderNumber}? Deducted stock will be restored to inventory.`,
                            confirmLabel: 'Cancel order',
                            destructive: true,
                            onConfirm: () => updateOrderStatus(order, 'cancelled'),
                          })}
                          title="Cancel Order (Restores Stock)"
                          aria-label={`Cancel order ${order.orderNumber}`}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </>
                )}
                {order.photoValidationUrl && (
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50" title="View Dispatch Photo Proof" aria-label={`View dispatch photo proof for ${order.orderNumber}`} onClick={() => openSafeExternalUrl(order.photoValidationUrl)}>
                    <ImageIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {displayOrders.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
            <ShoppingCart className="w-8 h-8 opacity-20" />
            <p className="text-xs font-medium italic">
              {orderViewMode === 'fifo_queue'
                ? 'No pending orders currently in the FIFO fulfillment queue.'
                : 'No orders match your search criteria.'}
            </p>
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto w-full">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-9 px-2 text-center"><span className="sr-only">Reorder</span></TableHead>
                {ORDER_SORT_COLUMNS.map(col => {
                  const active = orderViewMode === 'all' && sortKey === col.key;
                  const justifyClass = col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start';
                  return (
                    <TableHead
                      key={col.key}
                      aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`text-[10px] font-bold uppercase tracking-widest p-0 ${col.headClass}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={`flex w-full items-center gap-1 px-2 py-2.5 hover:bg-muted/80 hover:text-foreground transition-colors cursor-pointer ${justifyClass} ${active ? 'text-foreground' : ''}`}
                      >
                        <span>{col.label}</span>
                        {active ? (
                          sortDirection === 'asc' ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />
                        ) : (
                          <ArrowUpDown className="size-3 shrink-0 opacity-40" />
                        )}
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-center min-w-35">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayOrders.map(order => {
                const deadlineDate = typeof order.deliveryDeadline?.toDate === 'function' ? order.deliveryDeadline.toDate() : order.deliveryDeadline ? new Date(order.deliveryDeadline) : null;
                const isOverdue = deadlineDate && deadlineDate < new Date() && !['delivered', 'completed', 'cancelled', 'escalated'].includes(order.status);
                return (
                  <TableRow
                    key={order.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, order.id)}
                    onDragOver={(e) => handleDragOver(e, order.id)}
                    onDrop={(e) => handleDrop(e, order.id)}
                    onDragEnd={handleDragEnd}
                    className={`group transition-colors select-none ${
                      draggedOrderId === order.id ? 'opacity-30 bg-muted/70' : ''
                    } ${
                      dragOverOrderId === order.id ? 'border-t-2 border-blue-500 bg-blue-50/20 dark:bg-blue-950/20' : ''
                    }`}
                  >
                    <TableCell className="w-9 px-2 py-3 text-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                      <div className="flex items-center justify-center p-1 rounded hover:bg-muted" title="Drag to reorder row">
                        <DotsSixVertical className="w-4 h-4" />
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground font-medium">
                      {order.orderNumber}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-foreground">{order.clientName}</span>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">
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
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => handleViewDetails(order)}
                          title="View Details"
                          aria-label={`View details for order ${order.orderNumber}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {revertButton(order)}
                        {canManageOrders && (
                          <>
                            {order.status === 'pending' && (
                              <>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30" onClick={() => handleStartEditPendingOrder(order)} title="Edit Pending Order" aria-label={`Edit pending order ${order.orderNumber}`}>
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => updateOrderStatus(order, 'preparing')} title="Move to Preparing" aria-label={`Move order ${order.orderNumber} to preparing`}>
                                  <ChevronRight className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {order.status === 'preparing' && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30" onClick={() => updateOrderStatus(order, 'out_for_delivery')} title="Dispatch Order" aria-label={`Dispatch order ${order.orderNumber}`}>
                                <Camera className="w-4 h-4" />
                              </Button>
                            )}
                            {order.status === 'out_for_delivery' && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30" onClick={() => updateOrderStatus(order, 'delivered')} title="Confirm Delivery" aria-label={`Confirm delivery for order ${order.orderNumber}`}>
                                <CheckCircle2 className="w-4 h-4" />
                              </Button>
                            )}
                            {order.status === 'delivered' && <Button size="sm" variant="outline" onClick={() => updateOrderStatus(order, 'completed')}>Complete</Button>}
                            {order.status !== 'delivered' && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'escalated' && (
                              <>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-amber-500 hover:bg-amber-50"
                                  onClick={() => setConfirmAction({
                                    title: `Escalate order ${order.orderNumber}`,
                                    description: `Escalate order ${order.orderNumber}? Reserved stock will be replenished to inventory.`,
                                    confirmLabel: 'Escalate order',
                                    onConfirm: () => updateOrderStatus(order, 'escalated'),
                                  })}
                                  title="Escalate Order (Restores Stock)"
                                  aria-label={`Escalate order ${order.orderNumber}`}
                                >
                                  <AlertTriangle className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-red-500 hover:bg-red-50"
                                  onClick={() => setConfirmAction({
                                    title: `Cancel order ${order.orderNumber}`,
                                    description: `Cancel order ${order.orderNumber}? Deducted stock will be restored to inventory.`,
                                    confirmLabel: 'Cancel order',
                                    destructive: true,
                                    onConfirm: () => updateOrderStatus(order, 'cancelled'),
                                  })}
                                  title="Cancel Order (Restores Stock)"
                                  aria-label={`Cancel order ${order.orderNumber}`}
                                >
                                  <XCircle className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </>
                        )}
                        {order.photoValidationUrl && (
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50" title="View Dispatch Photo Proof" aria-label={`View dispatch photo proof for ${order.orderNumber}`} onClick={() => openSafeExternalUrl(order.photoValidationUrl)}>
                            <ImageIcon className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {displayOrders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ShoppingCart className="w-8 h-8 opacity-20" />
                      <p className="text-xs font-medium italic">
                        {orderViewMode === 'fifo_queue'
                          ? 'No pending orders currently in the FIFO fulfillment queue.'
                          : 'No orders match your search criteria.'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title ?? ''}
        description={confirmAction?.description ?? ''}
        confirmLabel={confirmAction?.confirmLabel ?? 'Confirm'}
        destructive={confirmAction?.destructive}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        onConfirm={async () => {
          if (confirmAction) await confirmAction.onConfirm();
        }}
      />
    </div>
  );
}
