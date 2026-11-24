import { PageHeading } from './PageHeading';
import { SearchBar } from '@/components/ui/search-bar';
import { getSupplyChainViews, hasAdminRole } from '../lib/staffPermissions';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UsersIcon as Users, TruckIcon as Truck, WarehouseIcon, PlusIcon as Plus, PencilIcon as Pencil, TrashIcon as Trash2, MapPinIcon as MapPin, PhoneIcon as Phone, UserIcon as UserRound, CalendarDotsIcon as CalendarDays, ArrowDownLeftIcon as ArrowDownLeft, ArrowUpRightIcon as ArrowUpRight, CreditCardIcon as CreditCard, ArrowCounterClockwiseIcon as RotateCcw, EyeIcon as Eye, PackageIcon as Package, SpinnerGapIcon as Loader2, WarningCircleIcon as AlertCircle, XIcon as X, EnvelopeSimpleIcon as Envelope, ChatCircleDotsIcon as ChatCircle, BankIcon as Bank, NotePencilIcon as Note, DeviceMobileIcon as DeviceMobile } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db, collection, onSnapshot, addDoc, updateDoc, setDoc, deleteDoc, doc, serverTimestamp } from '../lib/supabaseAdapter';
import type { InventoryItem, Order, OrderItem, Product, Transfer, Warehouse } from '../types';
import type { InventoryMovementRecord } from '../lib/inventoryMovement';
import { dateValue, isOverdue, orderBalance, supportsAction, type ChainTransaction, type SupplyView } from '../lib/supplyChain';
import { SupplyChainTransactionDialog, chainMoney, Field } from './SupplyChainTransactionDialog';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface Entity {
  id: string;
  name: string;
  address?: string;
  contact?: string;
  phone?: string;
  terms?: string;
  active?: boolean;
  draft?: boolean;
  viber?: string;
  messenger?: string;
  email?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  bankBranchAddress?: string;
  paymentNotes?: string;
}
interface Props {
  sourceLoading: boolean;
  sourceError: boolean;
  onRetrySources: () => void;
  products: Product[];
  inventory: InventoryItem[];
  warehouses: Warehouse[];
  suppliers: { id: string; name: string }[];
  onRemoveWarehouse: (warehouse: Warehouse) => void;
  onRemoveSupplier: (name: string) => void;
  categoriesContent: React.ReactNode;
}
type SourceOrder = Order & { dueDate?: string; remainingBalance?: number };
const views = [{ id: 'customers' as const, name: 'Customers', icon: Users }, { id: 'suppliers' as const, name: 'Suppliers', icon: Truck }, { id: 'warehouses' as const, name: 'Warehouses', icon: WarehouseIcon }];
const filters = { customers: ['All', 'Order', 'Payment', 'Refund'], suppliers: ['All', 'Purchase', 'Bill Payment', 'Purchase Refund'], warehouses: ['All', 'Purchase', 'Transfer In', 'Transfer Out', 'Order', 'Purchase Refund', 'Order Refund'] };
const HISTORY_PAGE_SIZE = 100;
const formatDate = (value?: string) => value && dateValue(value) ? new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const customerKey = (name: string) => `customer:${name.trim().toLowerCase()}`;

export const SupplyChainWorkspace = memo(function SupplyChainWorkspace({ sourceLoading, sourceError, onRetrySources, products, inventory, warehouses, suppliers, onRemoveWarehouse, onRemoveSupplier, categoriesContent }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingEntityIdRef = useRef<string | null>(null);
  const pendingAddRef = useRef(false);
  const lastAppliedSupplyKeyRef = useRef<string>('');
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const canManage = profile?.role === 'admin';
  const allowedViews = useMemo(
    () => views.filter(item => getSupplyChainViews(permissions.supplyChain).includes(item.id)),
    [permissions.supplyChain]
  );
  const canViewValuation = hasAdminRole(profile);
  const [showCategories, setShowCategories] = useState(false);
  const [view, setView] = useState<SupplyView>(() => {
    const param = searchParams.get('view') as SupplyView | null;
    return param && allowedViews.some(item => item.id === param) ? param : (allowedViews[0]?.id || 'customers');
  });
  const [entityId, setEntityId] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [orders, setOrders] = useState<SourceOrder[]>(() => {
    try {
      const stored = localStorage.getItem('activepro_supply_chain_orders') || localStorage.getItem('activepro_db_orders');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [reload, setReload] = useState(0);
  const [details, setDetails] = useState<ChainTransaction | null>(null);
  const [action, setAction] = useState<'payment' | 'refund' | null>(null);
  const [previews, setPreviews] = useState<ChainTransaction[]>([]);
  const [committedTransactions, setCommittedTransactions] = useState<ChainTransaction[]>(() => {
    try {
      const stored = localStorage.getItem('activepro_supply_chain_committed_transactions');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [orderBalanceOverrides, setOrderBalanceOverrides] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem('activepro_order_balances');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [customerDrafts, setCustomerDrafts] = useState<Entity[]>(() => {
    try {
      const stored = localStorage.getItem('activepro_supply_chain_customers');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [metadata, setMetadata] = useState<Record<string, Partial<Entity>>>(() => {
    try {
      const stored = localStorage.getItem('activepro_supply_chain_metadata');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [hiddenCustomers, setHiddenCustomers] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('activepro_supply_chain_hidden_customers');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [editor, setEditor] = useState<Entity | null>(null);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    const syncDirectory = () => {
      try {
        const stored = localStorage.getItem('activepro_supply_chain_customers');
        if (stored) setCustomerDrafts(JSON.parse(stored));
        const meta = localStorage.getItem('activepro_supply_chain_metadata');
        if (meta) setMetadata(JSON.parse(meta));
        const hidden = localStorage.getItem('activepro_supply_chain_hidden_customers');
        if (hidden) setHiddenCustomers(JSON.parse(hidden));
        const txs = localStorage.getItem('activepro_supply_chain_committed_transactions');
        if (txs) setCommittedTransactions(JSON.parse(txs));
        const balOverrides = localStorage.getItem('activepro_order_balances');
        if (balOverrides) setOrderBalanceOverrides(JSON.parse(balOverrides));
      } catch {}
    };
    window.addEventListener('activepro_customers_changed', syncDirectory);
    window.addEventListener('storage', syncDirectory);
    return () => {
      window.removeEventListener('activepro_customers_changed', syncDirectory);
      window.removeEventListener('storage', syncDirectory);
    };
  }, []);

  useEffect(() => {
    setLoaded({}); setErrors({});
    const watch = <T,>(table: string, update: (records: T[]) => void) => onSnapshot(collection(db, table), snap => {
      update(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as T)));
      setLoaded(current => ({ ...current, [table]: true }));
      setErrors(current => ({ ...current, [table]: false }));
    }, () => { setErrors(current => ({ ...current, [table]: true })); setLoaded(current => ({ ...current, [table]: true })); });
    const stops = [
      watch('orders', (records: SourceOrder[]) => {
        setOrders(records);
        setTimeout(() => {
          try {
            const json = JSON.stringify(records);
            localStorage.setItem('activepro_supply_chain_orders', json);
            localStorage.setItem('activepro_db_orders', json);
          } catch {}
        }, 0);
      }),
      watch('order_items', setOrderItems),
      watch('inventory_movements', setMovements),
      watch('transfers', setTransfers),
      watch('customers', (dbCustomers: Entity[]) => {
        if (Array.isArray(dbCustomers) && dbCustomers.length > 0) {
          setCustomerDrafts(dbCustomers);
          const activeIds = new Set(dbCustomers.map(c => c.id || `customer:${(c.name || '').trim().toLowerCase()}`));
          setHiddenCustomers(prev => {
            const next = prev.filter(id => !activeIds.has(id));
            setTimeout(() => {
              try {
                localStorage.setItem('activepro_supply_chain_customers', JSON.stringify(dbCustomers));
                localStorage.setItem('activepro_supply_chain_hidden_customers', JSON.stringify(next));
              } catch {}
            }, 0);
            return next;
          });
        }
      })
    ];
    return () => stops.forEach(stop => stop());
  }, [reload]);

  // Orders currently create a new clientId for each order. Group the directory by
  // normalized customer name and connect with persistent supply chain customers.
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);
  const supplierLookups = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    const byName = new Map<string, { id: string; name: string }>();
    for (const supplier of suppliers) {
      if (!byId.has(supplier.id)) byId.set(supplier.id, supplier);
      if (!byName.has(supplier.name)) byName.set(supplier.name, supplier);
    }
    return { byId, byName };
  }, [suppliers]);
  const orderItemsByOrderId = useMemo(() => {
    const map = new Map<string, OrderItem[]>();
    for (const item of orderItems) {
      let bucket = map.get(item.orderId);
      if (!bucket) {
        bucket = [];
        map.set(item.orderId, bucket);
      }
      bucket.push(item);
    }
    return map;
  }, [orderItems]);
  const hiddenCustomerSet = useMemo(() => new Set(hiddenCustomers), [hiddenCustomers]);

  const customers = useMemo(() => {
    const customerMap = new Map<string, Entity>();
    for (const order of orders) {
      if (order.clientName?.trim()) {
        const key = customerKey(order.clientName);
        if (!customerMap.has(key)) {
          customerMap.set(key, { id: key, name: order.clientName, address: order.deliveryRegion });
        }
      }
    }
    for (const draft of customerDrafts) {
      if (draft.name?.trim()) {
        const key = customerKey(draft.name);
        const existing = customerMap.get(key);
        if (!existing) {
          customerMap.set(key, { ...draft, id: draft.id || key });
        } else {
          customerMap.set(key, { ...existing, ...draft, id: existing.id || draft.id || key });
        }
      }
    }
    return Array.from(customerMap.values());
  }, [orders, customerDrafts]);

  const warehouse = view === 'warehouses';
  const customer = view === 'customers';
  const singular = warehouse ? 'warehouse' : customer ? 'customer' : 'supplier';
  const title = views.find(item => item.id === view)!.name;
  const requiredTables = customer ? ['orders', 'order_items', 'customers'] : warehouse ? ['orders', 'order_items', 'inventory_movements', 'transfers'] : ['inventory_movements'];
  const loading = sourceLoading || requiredTables.some(table => !loaded[table]);
  const loadError = sourceError || requiredTables.some(table => errors[table]);

  const entities = useMemo(() => {
    const baseEntities: Entity[] = customer
      ? customers.filter(c => !hiddenCustomerSet.has(c.id))
      : warehouse
        ? warehouses.map(w => ({ ...w, address: w.location }))
        : suppliers;
    return baseEntities
      .map(entity => (customer ? { ...metadata[`${view}:${entity.id}`], ...entity } : { ...entity, ...metadata[`${view}:${entity.id}`] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [view, customer, warehouse, customers, hiddenCustomerSet, warehouses, suppliers, metadata]);

  const visibleEntities = useMemo(() => {
    const query = directorySearch.toLowerCase();
    if (!query) return entities;
    return entities.filter(entity => `${entity.name} ${entity.address || ''} ${entity.contact || ''}`.toLowerCase().includes(query));
  }, [entities, directorySearch]);

  const current = useMemo(
    () => entities.find(entity => entity.id === entityId) ?? visibleEntities[0],
    [entities, entityId, visibleEntities]
  );

  const orderRows: ChainTransaction[] = useMemo(() => {
    if (!customer && !warehouse) return [];
    return orders.map(order => {
      const override = orderBalanceOverrides[order.id];
      const remaining = override !== undefined ? override : orderBalance(order);
      const rawItems = orderItemsByOrderId.get(order.id) || [];
      return {
        id: order.id,
        entityId: customerKey(order.clientName || ''),
        type: 'Order',
        date: dateValue(order.createdAt),
        reference: order.orderNumber,
        amount: Number(order.totalAmount),
        remaining,
        dueDate: dateValue(order.dueDate),
        status: order.status,
        items: rawItems.map(item => ({ ...item, unitPrice: Number(item.unitPrice), quantity: Number(item.quantity) })),
        direction: order.status === 'cancelled' ? undefined : 'out',
      };
    });
  }, [customer, warehouse, orders, orderBalanceOverrides, orderItemsByOrderId]);

  const customerOrders: ChainTransaction[] = useMemo(
    () => (customer ? orderRows.filter(row => !['cancelled', 'escalated'].includes(row.status)) : []),
    [customer, orderRows]
  );

  const paymentSumByParentId = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of committedTransactions) {
      if (t.parentId && (t.type === 'Bill Payment' || t.type === 'Payment')) {
        map.set(t.parentId, (map.get(t.parentId) || 0) + (t.amount || 0));
      }
    }
    return map;
  }, [committedTransactions]);

  const purchaseRows: ChainTransaction[] = useMemo(() => {
    if (warehouse || customer) return [];
    return movements.filter(m => m.type === 'external').map(movement => {
      const matchedSupplier =
        (movement.supplierId ? supplierLookups.byId.get(movement.supplierId) : undefined) ||
        (movement.supplierName ? supplierLookups.byName.get(movement.supplierName) : undefined) ||
        (movement.supplierId ? supplierLookups.byName.get(movement.supplierId) : undefined);
      const resolvedEntityId = matchedSupplier?.id || movement.supplierId || '';

      const originalAmount = movement.totalValue != null
        ? Number(movement.totalValue)
        : movement.items.reduce((sum, line) => sum + line.quantity * (line.unitCost || 0), 0);

      const paidAmount = (movement as any).amountPaid != null && Number((movement as any).amountPaid) > 0
        ? Number((movement as any).amountPaid)
        : (paymentSumByParentId.get(movement.id) || 0);
      const remaining = (movement as any).remainingBalance != null && Number.isFinite(Number((movement as any).remainingBalance))
        ? Number((movement as any).remainingBalance)
        : Math.max(0, originalAmount - paidAmount);

      return {
        id: movement.id, entityId: resolvedEntityId, type: 'Purchase', date: dateValue(movement.createdAt), reference: movement.invoiceNumber || movement.movementNumber,
        amount: originalAmount, remaining, dueDate: dateValue(movement.receivedDate || movement.createdAt),
        status: remaining <= 0 ? 'paid' : paidAmount > 0 ? 'partially_paid' : movement.status || 'confirmed',
        items: movement.items.map((line, i) => ({ ...line, id: `${movement.id}:${i}`, warehouseId: movement.destinationWarehouseId, unitPrice: Number(line.unitCost) })), direction: 'in',
        notes: `Receipt ${movement.movementNumber}. Supplier: ${movement.supplierName || matchedSupplier?.name || 'Supplier'}`,
      };
    });
  }, [warehouse, customer, movements, supplierLookups, paymentSumByParentId]);

  const warehouseHistoryById = useMemo(() => {
    const map = new Map<string, ChainTransaction[]>();
    if (!warehouse) return map;
    const pushRow = (wId: string, tx: ChainTransaction) => {
      let bucket = map.get(wId);
      if (!bucket) {
        bucket = [];
        map.set(wId, bucket);
      }
      bucket.push(tx);
    };
    for (const t of transfers) {
      const product = productById.get(t.productId);
      const srcName = warehouseById.get(t.sourceWarehouseId)?.name || 'Source warehouse';
      const dstName = warehouseById.get(t.destinationWarehouseId)?.name || 'Destination warehouse';
      const addTransfer = (wId: string, incoming: boolean) => {
        const moved = incoming ? t.status === 'received' : ['in_transit', 'received'].includes(t.status);
        pushRow(wId, {
          id: `transfer:${t.id}`,
          entityId: wId,
          type: incoming ? 'Transfer In' : 'Transfer Out',
          date: dateValue((incoming ? t.receivedAt : t.dispatchedAt) || t.createdAt),
          reference: t.id,
          amount: null,
          remaining: null,
          status: t.status,
          direction: moved ? incoming ? 'in' as const : 'out' as const : undefined,
          items: [{ id: t.id, productId: t.productId, name: product?.name || 'Product unavailable', sku: product?.sku || '', quantity: t.quantity, unitPrice: null, warehouseId: wId }],
          notes: `${srcName} → ${dstName}. ${moved ? 'Stock movement recorded.' : t.status === 'cancelled' ? 'Cancelled transfer; no net stock movement.' : 'Stock has not arrived at or left this warehouse yet.'} Historical item valuation was not recorded.`,
        });
      };
      if (t.sourceWarehouseId) addTransfer(t.sourceWarehouseId, t.destinationWarehouseId === t.sourceWarehouseId);
      if (t.destinationWarehouseId && t.destinationWarehouseId !== t.sourceWarehouseId) addTransfer(t.destinationWarehouseId, true);
    }
    for (const m of movements) {
      const addMovement = (wId: string, incoming: boolean) => {
        pushRow(wId, {
          id: m.id,
          entityId: wId,
          type: m.type === 'external' ? 'Purchase' : incoming ? 'Transfer In' : 'Transfer Out',
          date: dateValue(m.createdAt),
          reference: m.movementNumber,
          amount: m.totalValue == null ? null : Number(m.totalValue),
          remaining: null,
          status: m.status,
          direction: incoming ? 'in' as const : 'out' as const,
          items: m.items.map((line, i) => ({ ...line, id: `${m.id}:${i}`, unitPrice: Number(line.unitCost), warehouseId: wId })),
          notes: `${m.sourceWarehouseName || m.supplierName || 'Supplier'} → ${m.destinationWarehouseName}${m.notes ? ` · ${m.notes}` : ''}`,
        });
      };
      if (m.sourceWarehouseId) addMovement(m.sourceWarehouseId, m.destinationWarehouseId === m.sourceWarehouseId);
      if (m.destinationWarehouseId && m.destinationWarehouseId !== m.sourceWarehouseId) addMovement(m.destinationWarehouseId, true);
    }
    for (const row of orderRows) {
      if (row.status === 'cancelled') continue;
      const itemsByWh = new Map<string, ChainTransaction['items']>();
      for (const item of row.items) {
        if (!item.warehouseId) continue;
        let list = itemsByWh.get(item.warehouseId);
        if (!list) {
          list = [];
          itemsByWh.set(item.warehouseId, list);
        }
        list.push(item);
      }
      for (const [wId, wItems] of itemsByWh) {
        pushRow(wId, {
          ...row,
          entityId: wId,
          items: wItems,
          amount: wItems.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0),
        });
      }
    }
    return map;
  }, [warehouse, transfers, movements, orderRows, productById, warehouseById]);

  const nonWarehouseRowsByEntityId = useMemo(() => {
    const map = new Map<string, ChainTransaction[]>();
    if (warehouse) return map;
    const base = customer ? customerOrders : purchaseRows;
    const pushRow = (eId: string, tx: ChainTransaction) => {
      if (!eId) return;
      let bucket = map.get(eId);
      if (!bucket) {
        bucket = [];
        map.set(eId, bucket);
      }
      bucket.push(tx);
    };
    for (const row of base) pushRow(row.entityId, row);
    for (const row of committedTransactions) pushRow(row.entityId, row);
    for (const row of previews) pushRow(row.entityId, row);
    return map;
  }, [warehouse, customer, customerOrders, purchaseRows, committedTransactions, previews]);

  const warehouseStockSummaryById = useMemo(() => {
    const map = new Map<string, { units: number; valuation: number; missingCosts: boolean }>();
    if (!warehouse) return map;
    for (const item of inventory) {
      let entry = map.get(item.warehouseId);
      if (!entry) {
        entry = { units: 0, valuation: 0, missingCosts: false };
        map.set(item.warehouseId, entry);
      }
      entry.units += item.quantity;
      const product = productById.get(item.productId);
      if (product?.costPrice == null && item.quantity !== 0) {
        entry.missingCosts = true;
      }
      entry.valuation += item.quantity * Number(product?.costPrice ?? 0);
    }
    return map;
  }, [warehouse, inventory, productById]);

  const rows = useMemo(() => {
    const currentId = current?.id;
    if (!currentId) return [];
    let list: ChainTransaction[];
    if (warehouse) {
      const base = warehouseHistoryById.get(currentId) || [];
      const matchingPreviews = previews.filter(
        row => row.direction && row.items.some(item => item.warehouseId === currentId)
      );
      list = matchingPreviews.length > 0
        ? [
            ...base,
            ...matchingPreviews.map(row => ({
              ...row,
              type: row.type === 'Refund' ? 'Order Refund' : row.type,
              entityId: currentId,
            })),
          ]
        : [...base];
    } else {
      list = [...(nonWarehouseRowsByEntityId.get(currentId) || [])];
    }
    list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }, [current?.id, warehouse, warehouseHistoryById, nonWarehouseRowsByEntityId, previews]);

  const filteredRows = useMemo(() => {
    const query = search.toLowerCase();
    if (typeFilter === 'All' && !query) return rows;
    return rows.filter(
      row =>
        (typeFilter === 'All' || row.type === typeFilter) &&
        (!query || `${row.type} ${row.reference} ${row.status}`.toLowerCase().includes(query))
    );
  }, [rows, typeFilter, search]);

  const selected = useMemo(
    () => (selectedId ? filteredRows.find(row => row.id === selectedId) : undefined),
    [filteredRows, selectedId]
  );

  const { unknownBalance, balance, overdueCount } = useMemo(() => {
    const committedRows = rows.filter(row => !row.draft && ['Order', 'Purchase'].includes(row.type));
    return {
      unknownBalance: committedRows.some(row => row.remaining === null),
      balance: committedRows.reduce((sum, row) => sum + (row.remaining ?? 0), 0),
      overdueCount: committedRows.filter(row => isOverdue(row)).length,
    };
  }, [rows]);

  const stockSummary = current?.id ? warehouseStockSummaryById.get(current.id) : undefined;
  const stockUnits = stockSummary?.units ?? 0;
  const missingCosts = stockSummary?.missingCosts ?? false;
  const valuation = stockSummary?.valuation ?? 0;
  const previewPending = useMemo(
    () => (selected ? previews.some(row => row.parentId === selected.id) : false),
    [previews, selected]
  );
  const historyTotalPages = Math.max(1, Math.ceil(filteredRows.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyTotalPages);
  const pagedHistoryRows = useMemo(() => {
    const start = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE;
    return filteredRows.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredRows, safeHistoryPage]);

  const canAct = (kind: 'payment' | 'refund') => canManage && !loading && !loadError && !warehouse && !previewPending && supportsAction(selected, kind);
  const handleSelectEntity = useCallback((id: string) => {
    setEntityId(id);
    setSelectedId('');
    setSearch('');
    setHistoryPage(1);
  }, []);
  const handleSelectRow = useCallback((rowId: string) => setSelectedId(rowId), []);
  const handleInspectRow = useCallback((row: ChainTransaction) => setDetails(row), []);
  const handleCloseAction = useCallback(() => setAction(null), []);
  const handlePreviewEntry = useCallback((entry: ChainTransaction) => {
    setPreviews(rows => [...rows, entry]);
    setAction(null);
    setSelectedId(entry.id);
    setTypeFilter('All');
    setSearch('');
    setHistoryPage(1);
    toast.success('Preview added. No financial or inventory changes posted.');
  }, []);

  useEffect(() => {
    const viewParam = searchParams.get('view') as SupplyView | null;
    const entityParam = searchParams.get('entityId');
    const actionParam = searchParams.get('action');
    if (!viewParam && !entityParam && !actionParam) {
      lastAppliedSupplyKeyRef.current = '';
      return;
    }
    const key = `${viewParam || ''}:${entityParam || ''}:${actionParam || ''}`;
    if (lastAppliedSupplyKeyRef.current === key) return;
    const validView = viewParam && allowedViews.some(item => item.id === viewParam) ? viewParam : null;
    lastAppliedSupplyKeyRef.current = key;
    setShowCategories(false);
    const wantsAdd = actionParam === 'add' && canManage && (validView === 'warehouses' || view === 'warehouses');
    if (validView && validView !== view) {
      pendingEntityIdRef.current = entityParam || null;
      pendingAddRef.current = wantsAdd;
      setView(validView);
    } else {
      if (entityParam) {
        setDirectorySearch('');
        setEntityId(entityParam);
      }
      if (wantsAdd) {
        setEditError('');
        setEditor({ id: '', name: '', active: true });
      }
    }
    if (actionParam) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('action');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, allowedViews, view, canManage, setSearchParams]);

  useEffect(() => {
    const preservedEntityId = pendingEntityIdRef.current;
    const shouldOpenAdd = pendingAddRef.current && canManage && view === 'warehouses';
    pendingEntityIdRef.current = null;
    pendingAddRef.current = false;
    setEntityId(preservedEntityId || '');
    setSelectedId('');
    if (shouldOpenAdd) {
      setEditError('');
      setEditor({ id: '', name: '', active: true });
    } else {
      setEditor(null);
    }
    setEditError('');
    setAction(null);
    setDetails(null);
    setPreviews([]);
    setDirectorySearch('');
    setSearch('');
    setTypeFilter('All');
    setHistoryPage(1);
  }, [view, canManage]);

  function switchView(next: SupplyView) {
    lastAppliedSupplyKeyRef.current = '';
    pendingEntityIdRef.current = null;
    if (searchParams.has('view') || searchParams.has('entityId')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('view');
      nextParams.delete('entityId');
      setSearchParams(nextParams, { replace: true });
    }
    setView(next);
    setEntityId('');
    setDirectorySearch('');
    setSearch('');
    setTypeFilter('All');
    setHistoryPage(1);
    setSelectedId('');
    setAction(null);
    setEditor(null);
    setEditError('');
    setDetails(null);
    setPreviews([]);
  }

  async function saveEntity() {
    if (!editor || saving) return;
    if (!customer && (sourceLoading || sourceError)) { setEditError("Wait for the directory and inventory records to load before saving."); return; }
    const name = editor.name.trim();
    if (!name) { setEditError('Enter a name.'); return; }
    if (entities.some(e => e.id !== editor.id && e.name.trim().toLowerCase() === name.toLowerCase())) { setEditError(`A ${singular} with that name already exists.`); return; }
    setSaving(true); setEditError('');
    try {
      let id = editor.id;
      if (customer) {
        const originalCustomer = entities.find(e => e.id === editor.id);
        const oldName = originalCustomer?.name?.trim() || '';
        const oldKey = editor.id || (oldName ? customerKey(oldName) : '');
        const newKey = customerKey(name);
        id = newKey;
        const record: Entity = {
          ...editor,
          id: newKey,
          name,
          address: editor.address?.trim() || '',
          contact: editor.contact?.trim() || '',
          phone: editor.phone?.trim() || '',
          terms: editor.terms?.trim() || '',
          viber: editor.viber?.trim() || '',
          messenger: editor.messenger?.trim() || '',
          email: editor.email?.trim() || '',
          bankName: editor.bankName?.trim() || '',
          bankAccountNumber: editor.bankAccountNumber?.trim() || '',
          bankAccountName: editor.bankAccountName?.trim() || '',
          bankBranchAddress: editor.bankBranchAddress?.trim() || '',
          paymentNotes: editor.paymentNotes?.trim() || '',
          draft: false,
        };

        const isRenaming = oldKey && oldKey !== newKey;

        setCustomerDrafts(items => {
          const filtered = items.filter(c => 
            c.id !== id && 
            c.id !== oldKey && 
            c.name.toLowerCase() !== name.toLowerCase() && 
            (!oldName || c.name.toLowerCase() !== oldName.toLowerCase())
          );
          const next = [...filtered, record];
          try { localStorage.setItem('activepro_supply_chain_customers', JSON.stringify(next)); } catch {}
          window.dispatchEvent(new CustomEvent('activepro_customers_changed'));
          return next;
        });

        // Persist to Supabase database so all devices/users receive the customer update
        try {
          await setDoc(doc(db, 'customers', newKey), {
            id: newKey,
            name,
            address: record.address || '',
            contact: record.contact || '',
            phone: record.phone || '',
            terms: record.terms || '',
            viber: record.viber || '',
            messenger: record.messenger || '',
            email: record.email || '',
            bankName: record.bankName || '',
            bankAccountNumber: record.bankAccountNumber || '',
            bankAccountName: record.bankAccountName || '',
            bankBranchAddress: record.bankBranchAddress || '',
            paymentNotes: record.paymentNotes || '',
            updatedAt: serverTimestamp(),
          });
        } catch (custDbErr) {
          console.warn('Could not persist customer to Supabase table:', custDbErr);
        }

        if (isRenaming) {
          // Hide old customer key so past orders mapped to oldName won't recreate a duplicate
          setHiddenCustomers(items => {
            const next = Array.from(new Set([...items.filter(hId => hId !== newKey), oldKey]));
            try { localStorage.setItem('activepro_supply_chain_hidden_customers', JSON.stringify(next)); } catch {}
            return next;
          });
          deleteDoc(doc(db, 'customers', oldKey)).catch(() => {});

          // Sync past orders to new customer name
          if (oldName) {
            const matchingOrders = orders.filter(o => o.clientName?.trim().toLowerCase() === oldName.toLowerCase());
            for (const ord of matchingOrders) {
              try {
                await updateDoc(doc(db, 'orders', ord.id), { clientName: name });
              } catch (ordErr) {
                console.warn('Could not update order clientName for renamed customer:', ordErr);
              }
            }
          }
        } else {
          setHiddenCustomers(items => {
            const next = items.filter(hId => hId !== id);
            try { localStorage.setItem('activepro_supply_chain_hidden_customers', JSON.stringify(next)); } catch {}
            return next;
          });
        }
      } else if (warehouse) {
        const payload = { name, location: editor.address?.trim() || 'Warehouse Facility', active: editor.active !== false };
        if (id) await updateDoc(doc(db, 'warehouses', id), payload);
        else {
          const saved = await addDoc(collection(db, 'warehouses'), payload); id = saved.id;
          const CHUNK_SIZE = 25;
          for (let i = 0; i < products.length; i += CHUNK_SIZE) {
            const chunk = products.slice(i, i + CHUNK_SIZE);
            await Promise.all(
              chunk.map(product =>
                addDoc(collection(db, 'inventory'), {
                  productId: product.id,
                  warehouseId: id,
                  quantity: 0,
                  lastUpdated: serverTimestamp()
                })
              )
            );
          }
        }
      } else {
        if (id) {
          const original = suppliers.find(supplier => supplier.id === id);
          await updateDoc(doc(db, 'suppliers', id), { name, updatedAt: serverTimestamp() });
          if (original && original.name !== name) {
            const matching = products.filter(p => p.supplier === original.name);
            const CHUNK_SIZE = 25;
            for (let i = 0; i < matching.length; i += CHUNK_SIZE) {
              const chunk = matching.slice(i, i + CHUNK_SIZE);
              await Promise.all(
                chunk.map(product =>
                  updateDoc(doc(db, 'products', product.id), {
                    supplier: name,
                    updatedAt: serverTimestamp()
                  })
                )
              );
            }
          }
        } else id = (await addDoc(collection(db, 'suppliers'), { name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })).id;
      }
      setMetadata(items => {
        const next = {
          ...items,
          [`${view}:${id}`]: {
            ...(customer ? { name, address: editor.address, draft: false } : !warehouse ? { address: editor.address } : {}),
            contact: editor.contact,
            phone: editor.phone,
            terms: editor.terms,
            viber: editor.viber,
            messenger: editor.messenger,
            email: editor.email,
            bankName: editor.bankName,
            bankAccountNumber: editor.bankAccountNumber,
            bankAccountName: editor.bankAccountName,
            bankBranchAddress: editor.bankBranchAddress,
            paymentNotes: editor.paymentNotes,
          }
        };
        try { localStorage.setItem('activepro_supply_chain_metadata', JSON.stringify(next)); } catch {}
        return next;
      });
      setEntityId(id); setEditor(null);
      toast.success(customer ? 'Customer saved and ready for Order Entry' : `${warehouse ? 'Warehouse' : 'Supplier'} saved; contact details kept in this preview`);
    } catch { setEditError(`Could not finish saving this ${singular}. Check the current record before retrying.`); }
    finally { setSaving(false); }
  }

  const handleCommitPreviews = async () => {
    if (!previews.length) return;
    try {
      const newCommitted: ChainTransaction[] = [];
      const updatedOrderBalances = { ...orderBalanceOverrides };

      for (const preview of previews) {
        // Customer payments & supplier bill payments settle existing AR/AP balances (orders / inventory_movements)
        // and must not be posted as operating expenses; purchase refunds are vendor credits rather than OPEX.
        if (preview.type === 'Refund') {
          const counterparty = entities.find(ent => ent.id === preview.entityId)?.name;
          const prefix = counterparty ? `Customer Refund · ${counterparty}` : 'Customer Refund';
          const description = preview.notes && preview.notes.includes(preview.reference)
            ? `${prefix} · ${preview.notes}`
            : `${prefix} (${preview.reference}) · ${preview.notes || 'Order refund'}`;
          await addDoc(collection(db, 'expenses'), {
            amount: preview.amount,
            category: 'Refund / Return',
            date: preview.date,
            description,
            ...(preview.parentId ? { orderId: preview.parentId } : {}),
          });
        }

        // If it's a Customer Payment on an order, deduct remaining balance and persist
        if (preview.type === 'Payment' && preview.parentId) {
          const targetOrder = orders.find(o => o.id === preview.parentId);
          if (targetOrder) {
            const currentRem = updatedOrderBalances[targetOrder.id] !== undefined
              ? updatedOrderBalances[targetOrder.id]
              : (orderBalance(targetOrder) ?? targetOrder.totalAmount);
            const newRem = Math.max(0, currentRem - (preview.amount || 0));
            const newPaid = (targetOrder.amountPaid || 0) + (preview.amount || 0);
            const newPaymentStatus = newRem <= 0 ? 'paid' : 'partially_paid';

            updatedOrderBalances[targetOrder.id] = newRem;

            setOrders(prev => prev.map(o => o.id === targetOrder.id ? { ...o, remainingBalance: newRem, amountPaid: newPaid, paymentStatus: newPaymentStatus as any } : o));
            try {
              await updateDoc(doc(db, 'orders', targetOrder.id), {
                remainingBalance: newRem,
                amountPaid: newPaid,
                paymentStatus: newPaymentStatus,
                updatedAt: serverTimestamp()
              });
            } catch (err) {
              console.warn('Could not update order in database:', err);
            }
          }
        }

        // If it's a Supplier Bill Payment on a purchase movement, update paid/remaining amount and persist
        if (preview.type === 'Bill Payment' && preview.parentId) {
          const targetMovement = movements.find(m => m.id === preview.parentId);
          if (targetMovement) {
            const originalAmount = targetMovement.totalValue != null
              ? Number(targetMovement.totalValue)
              : targetMovement.items.reduce((sum, line) => sum + line.quantity * (line.unitCost || 0), 0);
            const currentPaid = Number((targetMovement as any).amountPaid || 0);
            const newPaid = currentPaid + (preview.amount || 0);
            const newRem = Math.max(0, originalAmount - newPaid);
            const newStatus = newRem <= 0 ? 'paid' : 'partially_paid';

            setMovements(prev => prev.map(m => m.id === targetMovement.id ? { ...m, amountPaid: newPaid, remainingBalance: newRem, status: newStatus as any } : m));
            try {
              await updateDoc(doc(db, 'inventory_movements', targetMovement.id), {
                amountPaid: newPaid,
                remainingBalance: newRem,
                status: newStatus,
                lastUpdated: serverTimestamp()
              });
            } catch (err) {
              console.warn('Could not update inventory movement in database:', err);
            }
          }
        }

        newCommitted.push({
          ...preview,
          status: 'Completed',
          draft: false,
        });
      }

      setOrderBalanceOverrides(updatedOrderBalances);
      try {
        localStorage.setItem('activepro_order_balances', JSON.stringify(updatedOrderBalances));
      } catch {}

      setCommittedTransactions(prev => {
        const next = [...newCommitted, ...prev];
        try {
          localStorage.setItem('activepro_supply_chain_committed_transactions', JSON.stringify(next));
        } catch {}
        return next;
      });

      setPreviews([]);
      setSelectedId('');
      toast.success('All transactions successfully committed to the ledger.');
    } catch (err) {
      console.error('Commit error:', err);
      toast.error('Failed to commit transactions. Please try again.');
    }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageHeading title="Supply Chain" subtitle="Your customers, suppliers, warehouses, and categories. Connected in one place." /></div>
    <div className="flex flex-wrap gap-1 rounded-2xl border bg-muted/40 p-1.5" role="group" aria-label="Supply Chain views">{allowedViews.map(({ id, name, icon: Icon }) => <button key={id} type="button" aria-pressed={!showCategories && view === id} onClick={() => { setShowCategories(false); switchView(id); }} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${!showCategories && view === id ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}><Icon className="size-4 shrink-0" />{name}</button>)}{canManage && <button type="button" aria-pressed={showCategories} onClick={() => setShowCategories(true)} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${showCategories ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}><Package className="size-4 shrink-0" />Categories</button>}</div>
    {showCategories ? categoriesContent : <><div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="space-y-3 border-b p-4"><div className="flex min-h-8 items-center justify-between"><h2 className="font-semibold">{title} <span className="ml-1 inline-block min-w-4 text-xs font-normal tabular-nums text-muted-foreground">{loading && entities.length === 0 ? '—' : entities.length}</span></h2>{canManage && <Button size="sm" onClick={() => { setEditError(''); setEditor({ id: '', name: '', active: true }); }}><Plus className="size-4" />Add</Button>}</div><SearchBar value={directorySearch} onValueChange={setDirectorySearch} placeholder={`Search ${title.toLowerCase()}…`} /></div>
        <div className="h-64 overflow-y-auto p-2 xl:h-136">
          {loading ? (
            <div aria-label={`Loading ${title.toLowerCase()}`} className="space-y-1.5">
              {[0, 1, 2, 3].map(idx => (
                <div key={idx} className="h-14 rounded-xl border border-transparent bg-muted/40 p-3">
                  <div className="h-3.5 w-32 rounded bg-muted" />
                  <div className="mt-2 h-2.5 w-44 rounded bg-muted/70" />
                </div>
              ))}
            </div>
          ) : (
            visibleEntities.map(entity => (
              <EntitySidebarButton
                key={entity.id}
                entity={entity}
                selected={current?.id === entity.id}
                warehouse={warehouse}
                customer={customer}
                onSelect={handleSelectEntity}
              />
            ))
          )}
          {!loading && !visibleEntities.length && <div className="p-6 text-center text-sm text-muted-foreground">{directorySearch ? 'No matching records.' : `No ${title.toLowerCase()} yet.`}</div>}
        </div>
        <p className="flex min-h-12 items-center border-t px-4 py-3 text-xs text-muted-foreground">
          {customer
            ? 'Customers added here can be selected when creating orders in Order Entry.'
            : warehouse
              ? 'Warehouses added here appear in Inventory Layout and stock records.'
              : 'Suppliers added here can be selected when recording Item Entry receipts.'}
        </p>
      </aside>
      <div className="min-w-0 space-y-5">
        {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><span><AlertCircle className="mr-2 inline size-4" />Some records could not load. Totals and actions are unavailable.</span><Button variant="outline" size="sm" onClick={() => { setReload(n => n + 1); onRetrySources(); }}>Retry</Button></div>}
        {current ? <>
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex min-h-20 flex-wrap items-start justify-between gap-3 p-5"><div><div className="mb-2 flex items-center gap-2"><Badge variant="secondary">{warehouse ? 'Warehouse' : customer ? 'Customer account' : 'Supplier account'}</Badge>{warehouse && <Badge variant={current.active === false ? 'outline' : 'secondary'}>{current.active === false ? 'Inactive' : 'Active'}</Badge>}{current.draft && <Badge variant="outline">Preview</Badge>}</div><h2 className="text-xl font-bold">{current.name}</h2></div>{canManage && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setEditError(''); setEditor({ ...current }); }}><Pencil className="size-3.5" />Edit</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(true)}><Trash2 className="size-3.5" />Remove</Button></div>}</div>
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
              <InfoField icon={MapPin} label={warehouse ? "Location" : "Address"} value={current.address} />
              <InfoField icon={UserRound} label="Contact person" value={current.contact} />
              <InfoField icon={Phone} label="Contact number" value={current.phone} />
              <InfoField icon={CalendarDays} label={warehouse ? 'Status' : 'Payment terms'} value={warehouse ? current.active === false ? 'Inactive' : 'Active' : current.terms} />
              {customer && (
                <>
                  <InfoField icon={DeviceMobile} label="Viber number" value={current.viber} />
                  <InfoField icon={ChatCircle} label="Messenger" value={current.messenger} />
                  <InfoField icon={Envelope} label="Email address" value={current.email} />
                </>
              )}
            </div>
            {customer && current.paymentNotes && (
              <div className="mx-5 mb-4 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 text-xs text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100 flex items-start gap-2.5">
                <Note className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div className="space-y-0.5 min-w-0 flex-1">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-amber-800 dark:text-amber-300 block">
                    Payment & Client Notes
                  </span>
                  <p className="font-semibold text-amber-950 dark:text-amber-100 text-xs whitespace-pre-wrap">{current.paymentNotes}</p>
                </div>
              </div>
            )}
            {customer && (current.bankName || current.bankAccountNumber || current.bankAccountName || current.bankBranchAddress) && (
              <div className="mx-5 mb-4 rounded-xl border bg-muted/20 p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
                  <Bank className="size-3.5" /> Bank Account Details
                </div>
                <div className="grid gap-2 sm:grid-cols-2 pt-1">
                  <div><span className="text-muted-foreground">Bank Name: </span><span className="font-semibold text-foreground">{current.bankName || '—'}</span></div>
                  <div><span className="text-muted-foreground">Account Name: </span><span className="font-semibold text-foreground">{current.bankAccountName || '—'}</span></div>
                  <div><span className="text-muted-foreground">Account Number: </span><span className="font-mono font-semibold text-foreground">{current.bankAccountNumber || '—'}</span></div>
                  <div><span className="text-muted-foreground">Branch Address: </span><span className="font-semibold text-foreground">{current.bankBranchAddress || '—'}</span></div>
                </div>
              </div>
            )}
            {metadata[`${view}:${current.id}`] && !customer && <p className="px-5 pb-4 text-xs text-amber-700 dark:text-amber-300">Contact details and payment terms are session previews.</p>}
            {(!warehouse || canViewValuation) && <div className="flex min-h-24 flex-wrap items-center justify-between gap-4 border-t bg-muted/30 px-5 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{warehouse ? 'Total Inventory Valuation' : 'Total Open Balance'}</p><p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{loading ? 'Loading…' : loadError ? 'Unavailable' : warehouse ? chainMoney(missingCosts ? null : valuation) : chainMoney(unknownBalance ? null : balance)}</p><p className="mt-1 text-xs text-muted-foreground">{warehouse ? missingCosts ? 'Some inventory items are missing cost prices.' : 'At product cost · Visible to administrators' : unknownBalance ? `Exact ${customer ? 'receivables' : 'payables'} are not available in the source records.` : customer ? 'Outstanding customer receivables' : 'Outstanding supplier payables'}</p></div>{overdueCount > 0 && <Badge variant="destructive">{overdueCount} overdue {overdueCount === 1 ? 'order' : 'orders'}</Badge>}{warehouse && <div className="text-right"><p className="text-xl font-semibold tabular-nums">{stockUnits.toLocaleString()}</p><p className="text-xs text-muted-foreground">units on hand</p></div>}</div>}
          </section>
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><h2 className="font-semibold">{warehouse ? 'Inventory Movement History' : 'Transaction History'}</h2><p className="mt-1 text-xs text-muted-foreground">{warehouse ? 'Track what comes in and what goes out.' : `Select ${customer ? 'an order' : 'a purchase'} to preview a payment or refund.`} Double-click a row to view details.</p></div>{canManage && !warehouse && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!canAct('refund')} onClick={() => setAction('refund')}><RotateCcw className="size-3.5" />Refund</Button><Button size="sm" disabled={!canAct('payment')} onClick={() => setAction('payment')}><CreditCard className="size-3.5" />Payment</Button></div>}</div>
            <div className="flex flex-wrap gap-3 p-4"><div className="min-w-48 flex-1"><SearchBar value={search} onValueChange={value => { setSearch(value); setSelectedId(''); setHistoryPage(1); }} placeholder="Search by reference or transaction…" /></div><select aria-label="Transaction type" className="h-10 rounded-lg border bg-background px-3 text-sm" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setSelectedId(''); setHistoryPage(1); }}>{filters[view].map(type => <option key={type} value={type}>{type === 'All' ? 'All transaction types' : type}</option>)}</select></div>
            {selected && <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs"><span className="font-medium">Selected: {selected.reference}{previewPending && ' · Preview already added'}</span><Button variant="ghost" size="sm" onClick={() => setSelectedId('')} className="h-7"><X className="size-3" />Clear</Button></div>}
            <div className="h-72 overflow-y-auto"><Table><TableHeader className="sticky top-0 z-10 bg-muted/95"><TableRow className="bg-muted/40"><TableHead>{warehouse ? 'Entry Type' : 'Type'}</TableHead><TableHead>Date</TableHead><TableHead>{warehouse ? 'Reference / Action #' : customer ? 'Order #' : 'Purchase #'}</TableHead><TableHead className="text-right">{warehouse ? 'Amount / Value' : 'Amount'}</TableHead>{warehouse ? <TableHead>Status</TableHead> : <><TableHead className="text-right">Remaining Balance</TableHead><TableHead>Due Date</TableHead></>}<TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader><TableBody>
              {!loading && pagedHistoryRows.map(row => (
                <HistoryRow
                  key={row.id}
                  row={row}
                  warehouse={warehouse}
                  isSelected={selectedId === row.id}
                  onSelect={handleSelectRow}
                  onInspect={handleInspectRow}
                />
              ))}
              {(loading || !filteredRows.length) && <TableRow><TableCell colSpan={warehouse ? 6 : 7} className="h-56 text-center"><div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-muted-foreground">{loading ? <Loader2 className="size-7 animate-spin" /> : <Package className="size-8 opacity-40" />}<p className="font-medium text-foreground">{loading ? 'Loading history…' : loadError ? 'History unavailable' : search || typeFilter !== 'All' ? 'No matching transactions' : 'No transactions yet'}</p><p className="text-xs">{loading ? 'Getting your latest records.' : search || typeFilter !== 'All' ? 'Try another search or transaction type.' : `Activity for ${current.name} will appear here.`}</p>{(search || typeFilter !== 'All') && <Button size="sm" variant="outline" onClick={() => { setSearch(''); setTypeFilter('All'); setHistoryPage(1); }}>Reset filters</Button>}</div></TableCell></TableRow>}
            </TableBody></Table></div>
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <span>{filteredRows.length} {filteredRows.length === 1 ? 'entry' : 'entries'}{warehouse && ' · ↑ Outgoing  ↓ Incoming'}</span>
              <div className="flex flex-wrap items-center gap-2">
                {historyTotalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={safeHistoryPage <= 1} onClick={() => setHistoryPage(p => Math.max(1, p - 1))}>Prev</Button>
                    <span className="tabular-nums">Page {safeHistoryPage} of {historyTotalPages}</span>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={safeHistoryPage >= historyTotalPages} onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}>Next</Button>
                  </div>
                )}
                {previews.length > 0 && <div className="flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => { setPreviews([]); setSelectedId(''); }}>Clear previews</Button><Button size="sm" onClick={handleCommitPreviews}>Commit {previews.length} Previews to Ledger</Button></div>}
              </div>
            </div>
          </section>
          <p className="text-xs leading-relaxed text-muted-foreground">{warehouse ? 'History uses inventory receipts, transfers, and orders with a recorded warehouse. Financial previews do not change stock.' : 'Payments and refunds are interactive previews. Due dates appear only when recorded; delivery deadlines are not treated as payment due dates.'}</p>
        </> : loading ? (
          <div aria-busy="true" className="space-y-5">
            <div className="h-72 rounded-2xl border bg-card p-5 shadow-sm">
              <div className="h-5 w-44 rounded bg-muted" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="h-10 rounded bg-muted/60" />
                <div className="h-10 rounded bg-muted/60" />
                <div className="h-10 rounded bg-muted/60" />
                <div className="h-10 rounded bg-muted/60" />
              </div>
              <div className="mt-6 h-16 rounded bg-muted/40" />
            </div>
            <div className="flex h-104 items-center justify-center rounded-2xl border bg-card p-5 text-sm text-muted-foreground shadow-sm">
              <Loader2 className="mr-2 size-5 animate-spin" />Loading records…
            </div>
          </div>
        ) : <div className="flex min-h-136 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center"><Users className="mb-3 size-9 text-muted-foreground/40" /><h2 className="font-semibold">{`Select a ${singular}`}</h2><p className="mt-2 text-sm text-muted-foreground">Choose a record on the left, or add one to get started.</p></div>}
      </div>
    </div>

    {action && selected && canAct(action) && <SupplyChainTransactionDialog key={`${selected.id}:${action}`} view={view} action={action} transaction={selected} products={products} warehouses={warehouses} inventory={inventory} onClose={handleCloseAction} onPreview={handlePreviewEntry} />}

    <Dialog open={!!details} onOpenChange={open => { if (!open) setDetails(null); }}>
      {details ? (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{details.type} details</DialogTitle><DialogDescription>{details.reference} · {formatDate(details.date)}</DialogDescription></DialogHeader>
          <div className="flex flex-wrap justify-between gap-3 rounded-xl bg-muted/40 p-4"><div><p className="text-xs text-muted-foreground">Amount / value</p><p className="text-2xl font-bold">{chainMoney(details.amount)}</p></div><Badge variant="secondary" className="h-fit capitalize">{details.status.replaceAll('_', ' ')}</Badge></div>
          {details.direction && <div className={`rounded-lg p-3 text-sm ${details.direction === 'in' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-orange-500/10 text-orange-700 dark:text-orange-300'}`}>{details.draft ? 'Preview: inventory would ' : 'Inventory direction: '}{details.direction === 'in' ? 'increase — items received' : 'decrease — items issued'}</div>}
          {details.notes && <p className="text-sm text-muted-foreground">{details.notes}</p>}
          <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Unit value</TableHead></TableRow></TableHeader><TableBody>{details.items.map(item => <TableRow key={item.id}><TableCell><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku}{item.warehouseId && ` · ${warehouseById.get(item.warehouseId)?.name || 'Warehouse'}`}</p></TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell className="text-right">{chainMoney(item.unitPrice)}</TableCell></TableRow>)}{!details.items.length && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No physical items recorded.</TableCell></TableRow>}</TableBody></Table>
          {details.draft && <p className="text-xs text-amber-700 dark:text-amber-300">Session preview only. No financial or inventory changes posted.</p>}
          <Button variant="outline" onClick={() => setDetails(null)}>Close</Button>
        </DialogContent>
      ) : null}
    </Dialog>

    <Dialog open={!!editor} onOpenChange={open => { if (!open && !saving) setEditor(null); }}>
      {editor ? (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{editor.id ? 'Edit' : 'Add'} {singular}</DialogTitle><DialogDescription>{customer ? 'Customer profiles can be used in Order Entry to create orders.' : `The ${warehouse ? 'name, location, and status' : 'name'} will be saved. Contact details${!warehouse ? ', address, and payment terms' : ''} are session previews.`}</DialogDescription></DialogHeader>
          <form onSubmit={event => { event.preventDefault(); void saveEntity(); }} className="space-y-4">
            <Field label="Name" id="chain-entity-name"><Input id="chain-entity-name" required value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} /></Field>
            <Field label={warehouse ? "Location" : "Address"} id="chain-entity-address"><Input id="chain-entity-address" value={editor.address || ''} onChange={e => setEditor({ ...editor, address: e.target.value })} placeholder={warehouse ? "e.g. Hub 1" : "Street, city, province"} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact person" id="chain-entity-contact"><Input id="chain-entity-contact" value={editor.contact || ''} onChange={e => setEditor({ ...editor, contact: e.target.value })} /></Field>
              <Field label="Contact number" id="chain-entity-phone"><Input id="chain-entity-phone" type="tel" value={editor.phone || ''} onChange={e => setEditor({ ...editor, phone: e.target.value })} /></Field>
            </div>

            {customer && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Viber Number" id="chain-entity-viber"><Input id="chain-entity-viber" value={editor.viber || ''} onChange={e => setEditor({ ...editor, viber: e.target.value })} placeholder="e.g. 09171234567" /></Field>
                  <Field label="Messenger" id="chain-entity-messenger"><Input id="chain-entity-messenger" value={editor.messenger || ''} onChange={e => setEditor({ ...editor, messenger: e.target.value })} placeholder="e.g. m.me/profile or username" /></Field>
                </div>
                <Field label="Email Address" id="chain-entity-email"><Input id="chain-entity-email" type="email" value={editor.email || ''} onChange={e => setEditor({ ...editor, email: e.target.value })} placeholder="e.g. client@example.com" /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Payment terms" id="chain-entity-terms"><Input id="chain-entity-terms" value={editor.terms || ''} onChange={e => setEditor({ ...editor, terms: e.target.value })} placeholder="e.g. Cash on delivery, Net 30" /></Field>
                  <Field label="Payment Notes" id="chain-entity-payment-notes"><Input id="chain-entity-payment-notes" value={editor.paymentNotes || ''} onChange={e => setEditor({ ...editor, paymentNotes: e.target.value })} placeholder="e.g. MM & add 5%, No sale of Shimano" /></Field>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">
                    <Bank className="size-3.5" /> Bank Details
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Bank Name" id="chain-bank-name"><Input id="chain-bank-name" value={editor.bankName || ''} onChange={e => setEditor({ ...editor, bankName: e.target.value })} placeholder="e.g. BDO, BPI, Metrobank" /></Field>
                    <Field label="Account Name" id="chain-bank-acc-name"><Input id="chain-bank-acc-name" value={editor.bankAccountName || ''} onChange={e => setEditor({ ...editor, bankAccountName: e.target.value })} placeholder="e.g. Active Pro Trading" /></Field>
                    <Field label="Account Number" id="chain-bank-acc-num"><Input id="chain-bank-acc-num" value={editor.bankAccountNumber || ''} onChange={e => setEditor({ ...editor, bankAccountNumber: e.target.value })} placeholder="e.g. 0012-3456-7890" /></Field>
                    <Field label="Bank Branch Address" id="chain-bank-branch"><Input id="chain-bank-branch" value={editor.bankBranchAddress || ''} onChange={e => setEditor({ ...editor, bankBranchAddress: e.target.value })} placeholder="e.g. Ortigas Branch, Pasig City" /></Field>
                  </div>
                </div>
              </>
            )}

            {!customer && (
              warehouse ? <Field label="Status" id="chain-entity-status"><select id="chain-entity-status" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={editor.active === false ? 'inactive' : 'active'} onChange={e => setEditor({ ...editor, active: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field> : <Field label="Payment terms" id="chain-entity-terms"><Input id="chain-entity-terms" value={editor.terms || ''} onChange={e => setEditor({ ...editor, terms: e.target.value })} placeholder="e.g. Cash on delivery, Net 30" /></Field>
            )}

            {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setEditor(null)}>Cancel</Button>
              <Button type="submit" disabled={saving || !editor.name.trim()}>{saving ? 'Saving…' : customer ? 'Save customer' : 'Save changes'}</Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>

    <Dialog open={removing} onOpenChange={setRemoving}>
      {removing ? (
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove {current?.name}?</DialogTitle><DialogDescription>{customer ? 'This removes the customer from the directory and Order Entry. Existing orders and balances are preserved.' : warehouse ? 'The existing warehouse removal flow will show the stock impact before deletion.' : 'The existing supplier removal flow will show which product assignments are affected.'}</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRemoving(false)}>Cancel</Button><Button variant="destructive" onClick={() => { if (!current) return; if (customer) {
            setHiddenCustomers(ids => {
              const next = [...ids, current.id];
              try { localStorage.setItem('activepro_supply_chain_hidden_customers', JSON.stringify(next)); } catch {}
              return next;
            });
            setCustomerDrafts(items => {
              const next = items.filter(c => c.id !== current.id && c.name.toLowerCase() !== current.name.toLowerCase());
              try { localStorage.setItem('activepro_supply_chain_customers', JSON.stringify(next)); } catch {}
              window.dispatchEvent(new CustomEvent('activepro_customers_changed'));
              return next;
            });
            deleteDoc(doc(db, 'customers', current.id)).catch(() => {});
            setEntityId('');
          } else if (warehouse) { const record = warehouseById.get(current.id); if (record) onRemoveWarehouse(record); } else onRemoveSupplier(current.name); setRemoving(false); }}>{customer ? 'Remove customer' : 'Continue'}</Button></div>
        </DialogContent>
      ) : null}
    </Dialog>
  </>}
  </div>;
});

const EntitySidebarButton = memo(function EntitySidebarButton({
  entity,
  selected,
  warehouse,
  customer,
  onSelect,
}: {
  entity: Entity;
  selected: boolean;
  warehouse: boolean;
  customer: boolean;
  onSelect: (id: string) => void;
}) {
  const subtitle = entity.draft
    ? 'Directory customer'
    : warehouse
      ? [entity.address, entity.active === false ? 'Inactive' : 'Active warehouse'].filter(Boolean).join(' / ')
      : entity.address || (customer ? 'From order records' : 'Supplier account');
  return (
    <button
      type="button"
      onClick={() => onSelect(entity.id)}
      aria-pressed={selected}
      className={`mb-1 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entity.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
});

const HistoryRow = memo(function HistoryRow({
  row,
  warehouse,
  isSelected,
  onSelect,
  onInspect,
}: {
  row: ChainTransaction;
  warehouse: boolean;
  isSelected: boolean;
  onSelect: (rowId: string) => void;
  onInspect: (row: ChainTransaction) => void;
}) {
  const overdue = isOverdue(row);
  return (
    <TableRow
      tabIndex={0}
      aria-selected={isSelected}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => onInspect(row)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          onInspect(row);
        }
        if (event.key === ' ') {
          event.preventDefault();
          onSelect(row.id);
        }
      }}
      className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-primary ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : ''} ${overdue ? 'bg-red-500/5' : ''}`}
    >
      <TableCell>
        <div className="flex items-center gap-2 whitespace-nowrap">
          {row.direction === 'in'
            ? <ArrowDownLeft className="size-4 text-emerald-600" />
            : row.direction === 'out'
              ? <ArrowUpRight className="size-4 text-orange-600" />
              : <CreditCard className="size-4 text-muted-foreground" />}
          <span className="text-sm font-medium">{row.type}</span>
          {row.draft && <Badge variant="outline">Preview</Badge>}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.date)}</TableCell>
      <TableCell className="font-mono text-xs">{row.reference}</TableCell>
      <TableCell className="text-right tabular-nums">{chainMoney(row.amount)}</TableCell>
      {warehouse ? (
        <TableCell>
          <Badge variant="secondary" className="capitalize">{row.status.replaceAll('_', ' ')}</Badge>
        </TableCell>
      ) : (
        <>
          <TableCell className={`text-right font-medium tabular-nums ${overdue ? 'text-red-600' : ''}`}>
            {chainMoney(row.remaining)}
          </TableCell>
          <TableCell className="whitespace-nowrap text-xs">
            {formatDate(row.dueDate)}
            {overdue && <span className="mt-1 block font-semibold text-red-600">Overdue</span>}
          </TableCell>
        </>
      )}
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`View ${row.reference}`}
          onClick={event => {
            event.stopPropagation();
            onInspect(row);
          }}
        >
          <Eye className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
});

function InfoField({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value?: string }) {
  return <div className="flex items-start gap-2.5"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-medium">{value || 'Not provided'}</p></div></div>;
}
