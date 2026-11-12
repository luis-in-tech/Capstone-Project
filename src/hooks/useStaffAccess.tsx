import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { collection, db, limit, onSnapshot, orderBy, query, where } from '../lib/supabaseAdapter';
import { hasAdminRole, resolvePermissions } from '../lib/staffPermissions';
import type { Order, StaffDelegation, Transfer } from '../types';

export interface AdminNotificationPrefs {
  orderAlerts: boolean;
  logisticsAlerts: boolean;
  transferAlerts: boolean;
  movementAlerts: boolean;
  supplyChainAlerts: boolean;
  toastAlerts: boolean;
}

export interface AdminNotificationItem {
  id: string;
  type: 'order' | 'logistics' | 'transfer' | 'movement' | 'supply_chain';
  title: string;
  description: string;
  timestamp: Date | null;
  meta?: string;
  statusBadge?: string;
  statusColor?: string;
  href: string;
}

interface DispatchTripDoc {
  id: string;
  vehicle_name?: string;
  driver?: string;
  plate?: string;
  region?: string;
  total_units?: number;
  savings_php?: number;
  status?: string;
  dispatched_at?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
}

interface InventoryMovementDoc {
  id: string;
  movementNumber?: string;
  type?: string;
  supplierName?: string;
  sourceWarehouseName?: string;
  destinationWarehouseName?: string;
  totalValue?: number;
  items?: Array<{ name?: string; quantity: number }>;
  recordedByName?: string;
  createdAt?: unknown;
  created_at?: unknown;
}

interface SupplyChainEntityDoc {
  id: string;
  name?: string;
  location?: string;
  active?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

type DelegationRecord = StaffDelegation & {
  updatedAt?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

interface AdminNotificationsContextValue {
  isAdmin: boolean;
  loading: boolean;
  allNotifications: AdminNotificationItem[];
  unreadCount: number;
  readIds: Set<string>;
  prefs: AdminNotificationPrefs;
  markItemAsRead: (id: string) => void;
  markAllAsRead: () => void;
  togglePref: (key: keyof AdminNotificationPrefs) => void;
}

const NOTIF_PREFS_KEY = 'activepro.notification_prefs';
const NOTIF_READ_KEY = 'activepro.read_notifications';
const NOTIF_SYNC_EVENT = 'activepro_notifications_changed';
const INITIAL_SETTLE_TIMEOUT_MS = 2000;
const SUBSCRIPTION_SOURCES = ['orders', 'dispatch_trips', 'transfers', 'inventory_movements', 'warehouses', 'delegations'] as const;

export const DEFAULT_ADMIN_NOTIFICATION_PREFS: AdminNotificationPrefs = {
  orderAlerts: true,
  logisticsAlerts: true,
  transferAlerts: true,
  movementAlerts: true,
  supplyChainAlerts: true,
  toastAlerts: true,
};

function safeReadStorage(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeWriteStorage(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent(NOTIF_SYNC_EVENT, { detail: { key } }));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

function loadReadIds(scopedKey: string): Set<string> {
  try {
    const raw = safeReadStorage(scopedKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function loadPrefs(scopedKey: string): AdminNotificationPrefs {
  try {
    const raw = safeReadStorage(scopedKey);
    if (!raw) return { ...DEFAULT_ADMIN_NOTIFICATION_PREFS };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? { ...DEFAULT_ADMIN_NOTIFICATION_PREFS, ...parsed }
      : { ...DEFAULT_ADMIN_NOTIFICATION_PREFS };
  } catch {
    return { ...DEFAULT_ADMIN_NOTIFICATION_PREFS };
  }
}

/** Parses Firestore-like timestamps, Date instances, epoch numbers, or ISO strings without inventing current time. */
export function parseOptionalNotificationDate(val: unknown): Date | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate?: unknown }).toDate === 'function') {
    const converted = (val as { toDate: () => Date }).toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const parsed = new Date(val);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Formats a notification timestamp cleanly, keeping undated master records honest instead of reporting 'Just now'. */
export function formatNotificationRelativeTime(date: Date | null): string {
  if (!date) return 'Master record';
  const diff = Math.max(0, Date.now() - date.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function summarizeDelegationPermissions(del: DelegationRecord): string {
  if (del.active === false) {
    return 'Staff access suspended / deactivated';
  }
  const resolved = resolvePermissions(
    { uid: del.id, email: del.staffEmail || '', displayName: del.staffEmail || '', role: 'staff' },
    del,
  );
  const capabilities = [
    resolved.inventory === 'adjust' ? 'Inventory Adjust' : null,
    resolved.pricelist === 'edit' ? 'Pricelist Edit' : null,
    resolved.orders !== 'none' ? `Orders (${resolved.orders})` : null,
    resolved.movementCreate !== 'none' ? `Movements (${resolved.movementCreate})` : null,
    resolved.financials && resolved.financials !== 'none' ? `Financials (${resolved.financials})` : null,
  ].filter(Boolean);
  return `Permissions: ${capabilities.join(' • ') || 'View Only'}`;
}

const emptyNotificationsContext: AdminNotificationsContextValue = {
  isAdmin: false,
  loading: false,
  allNotifications: [],
  unreadCount: 0,
  readIds: new Set<string>(),
  prefs: { ...DEFAULT_ADMIN_NOTIFICATION_PREFS },
  markItemAsRead: () => {},
  markAllAsRead: () => {},
  togglePref: () => {},
};

const AdminNotificationsContext = createContext<AdminNotificationsContextValue>(emptyNotificationsContext);

function AdminNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const isAdmin = hasAdminRole(profile);

  const notifReadKey = profile?.uid ? `${NOTIF_READ_KEY}.${profile.uid}` : NOTIF_READ_KEY;
  const notifPrefsKey = profile?.uid ? `${NOTIF_PREFS_KEY}.${profile.uid}` : NOTIF_PREFS_KEY;

  const [orders, setOrders] = useState<Order[]>([]);
  const [trips, setTrips] = useState<DispatchTripDoc[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [movements, setMovements] = useState<InventoryMovementDoc[]>([]);
  const [warehousesDoc, setWarehousesDoc] = useState<SupplyChainEntityDoc[]>([]);
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds(notifReadKey));
  const [prefs, setPrefs] = useState<AdminNotificationPrefs>(() => loadPrefs(notifPrefsKey));

  const readIdsRef = useRef<Set<string>>(readIds);
  const prefsRef = useRef<AdminNotificationPrefs>(prefs);
  readIdsRef.current = readIds;
  prefsRef.current = prefs;

  useEffect(() => {
    const nextRead = loadReadIds(notifReadKey);
    const nextPrefs = loadPrefs(notifPrefsKey);
    readIdsRef.current = nextRead;
    prefsRef.current = nextPrefs;
    setReadIds(nextRead);
    setPrefs(nextPrefs);
  }, [notifReadKey, notifPrefsKey]);

  // Cross-tab & cross-component storage synchronization for notification preferences and read state
  useEffect(() => {
    const syncFromStorage = (targetKey?: string | null) => {
      if (!targetKey || targetKey === notifReadKey) {
        const nextRead = loadReadIds(notifReadKey);
        readIdsRef.current = nextRead;
        setReadIds(nextRead);
      }
      if (!targetKey || targetKey === notifPrefsKey) {
        const nextPrefs = loadPrefs(notifPrefsKey);
        prefsRef.current = nextPrefs;
        setPrefs(nextPrefs);
      }
    };

    const handleStorage = (e: StorageEvent) => syncFromStorage(e.key);
    const handleCustomSync = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string }>).detail;
      syncFromStorage(detail?.key);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(NOTIF_SYNC_EVENT, handleCustomSync);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(NOTIF_SYNC_EVENT, handleCustomSync);
    };
  }, [notifReadKey, notifPrefsKey]);

  const settledSourcesRef = useRef<Set<string>>(new Set());
  const seenRawIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    settledSourcesRef.current = new Set();
    seenRawIdsRef.current = new Set();

    if (!isAdmin) {
      setOrders([]);
      setTrips([]);
      setTransfers([]);
      setMovements([]);
      setWarehousesDoc([]);
      setDelegations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const settleTimer = window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, INITIAL_SETTLE_TIMEOUT_MS);

    const recordSourceSnapshot = (sourceName: string, notifIds: string[]) => {
      if (!settledSourcesRef.current.has(sourceName)) {
        settledSourcesRef.current.add(sourceName);
        // Seed initial snapshot IDs synchronously before React renders so late/final initial snapshots never trigger false toasts
        notifIds.forEach((id) => seenRawIdsRef.current.add(id));
        if (settledSourcesRef.current.size >= SUBSCRIPTION_SOURCES.length && !cancelled) {
          setLoading(false);
        }
      }
    };

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => {
        if (cancelled) return;
        const rows: Order[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Order));
        recordSourceSnapshot('orders', rows.map((row) => `ord-${row.id}`));
        setOrders(rows);
      },
      (err) => {
        console.warn('Orders notification subscription failed:', err);
        recordSourceSnapshot('orders', []);
      },
    );

    const unsubTrips = onSnapshot(
      query(collection(db, 'dispatch_trips'), orderBy('dispatched_at', 'desc'), limit(20)),
      (snap) => {
        if (cancelled) return;
        const rows: DispatchTripDoc[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as DispatchTripDoc));
        recordSourceSnapshot('dispatch_trips', rows.map((row) => `trip-${row.id}`));
        setTrips(rows);
      },
      (err) => {
        console.warn('Dispatch trips subscription failed:', err);
        recordSourceSnapshot('dispatch_trips', []);
      },
    );

    const unsubTransfers = onSnapshot(
      query(collection(db, 'transfers'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => {
        if (cancelled) return;
        const rows: Transfer[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Transfer));
        recordSourceSnapshot('transfers', rows.map((row) => `tfr-${row.id}`));
        setTransfers(rows);
      },
      (err) => {
        console.warn('Transfers notification subscription failed:', err);
        recordSourceSnapshot('transfers', []);
      },
    );

    const unsubMovements = onSnapshot(
      query(collection(db, 'inventory_movements'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => {
        if (cancelled) return;
        const rows: InventoryMovementDoc[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as InventoryMovementDoc));
        recordSourceSnapshot('inventory_movements', rows.map((row) => `mov-${row.id}`));
        setMovements(rows);
      },
      (err) => {
        console.warn('Inventory movements notification subscription failed:', err);
        recordSourceSnapshot('inventory_movements', []);
      },
    );

    const unsubWarehouses = onSnapshot(
      query(collection(db, 'warehouses'), limit(15)),
      (snap) => {
        if (cancelled) return;
        const rows: SupplyChainEntityDoc[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as SupplyChainEntityDoc));
        recordSourceSnapshot('warehouses', rows.map((row) => `wh-${row.id}`));
        setWarehousesDoc(rows);
      },
      (err) => {
        console.warn('Warehouses notification subscription failed:', err);
        recordSourceSnapshot('warehouses', []);
      },
    );

    const unsubDelegations = onSnapshot(
      query(collection(db, 'delegations'), orderBy('createdAt', 'desc'), limit(15)),
      (snap) => {
        if (cancelled) return;
        const rows: DelegationRecord[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as DelegationRecord));
        recordSourceSnapshot('delegations', rows.map((row) => `del-${row.id}`));
        setDelegations(rows);
      },
      (err) => {
        console.warn('Delegations notification subscription failed:', err);
        recordSourceSnapshot('delegations', []);
      },
    );

    return () => {
      cancelled = true;
      window.clearTimeout(settleTimer);
      unsubOrders();
      unsubTrips();
      unsubTransfers();
      unsubMovements();
      unsubWarehouses();
      unsubDelegations();
    };
  }, [isAdmin, profile?.uid]);

  // Compile all notifications from raw collections regardless of category toggle so seen-ID tracking never misfires on pref re-enable
  const compiledNotifications = useMemo<AdminNotificationItem[]>(() => {
    const list: AdminNotificationItem[] = [];

    orders.forEach((o) => {
      const date = parseOptionalNotificationDate(o.createdAt);
      const skuCount = o.skus?.length || 0;
      const totalFormatted = (o.totalAmount || 0).toLocaleString();
      list.push({
        id: `ord-${o.id}`,
        type: 'order',
        title: `Order #${o.orderNumber || o.id.slice(-6)} ${o.status ? `(${o.status.toUpperCase().replace(/_/g, ' ')})` : ''}`.trim(),
        description: `${o.clientName || 'Customer'} • ${skuCount > 0 ? `${skuCount} SKU(s)` : 'Sales Order'} • ₱${totalFormatted}`,
        timestamp: date,
        statusBadge: o.status ? o.status.replace(/_/g, ' ') : 'pending',
        statusColor:
          o.status === 'delivered' || o.status === 'completed'
            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
            : o.status === 'out_for_delivery' || o.status === 'preparing'
              ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
              : o.status === 'cancelled' || o.status === 'escalated'
                ? 'bg-red-500/10 text-red-600 border-red-500/20'
                : 'bg-amber-500/10 text-amber-600 border-amber-500/20',
        meta: o.deliveryCity ? `Delivery: ${o.deliveryCity}` : undefined,
        href: '/orders',
      });
    });

    trips.forEach((t) => {
      const date = parseOptionalNotificationDate(t.dispatched_at || t.created_at || t.createdAt);
      const savingsFormatted = t.savings_php ? `₱${t.savings_php.toLocaleString()}` : 'Optimized';
      list.push({
        id: `trip-${t.id}`,
        type: 'logistics',
        title: `Fleet Dispatched: ${t.vehicle_name || 'Delivery Truck'}`,
        description: `Driver: ${t.driver || 'Assigned Driver'} • Region: ${t.region || 'Metro Manila'} (${t.total_units || 0} units)`,
        timestamp: date,
        statusBadge: t.status || 'in_transit',
        statusColor: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
        meta: `Savings: ${savingsFormatted}`,
        href: '/logistics',
      });
    });

    transfers.forEach((tr) => {
      const date = parseOptionalNotificationDate(tr.updatedAt || tr.dispatchedAt || tr.createdAt);
      list.push({
        id: `tfr-${tr.id}`,
        type: 'transfer',
        title: `Stock Transfer: TFR-${tr.id.slice(-6).toUpperCase()}`,
        description: `${tr.quantity} unit(s) • ${tr.driverName ? `Driver: ${tr.driverName}` : 'Inter-facility Transport'}`,
        timestamp: date,
        statusBadge: tr.status || 'pending',
        statusColor:
          tr.status === 'received'
            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
            : tr.status === 'in_transit'
              ? 'bg-sky-500/10 text-sky-600 border-sky-500/20'
              : 'bg-amber-500/10 text-amber-600 border-amber-500/20',
        meta: tr.status === 'in_transit' ? 'In Transit' : tr.status === 'received' ? 'Received' : 'Pending',
        href: '/transfers',
      });
    });

    movements.forEach((m) => {
      const date = parseOptionalNotificationDate(m.createdAt || m.created_at);
      const totalUnits = m.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
      const isExternal = m.type === 'external';
      const valFormatted = m.totalValue ? `₱${Number(m.totalValue).toLocaleString()}` : undefined;
      list.push({
        id: `mov-${m.id}`,
        type: 'movement',
        title: `Inventory Movement ${m.movementNumber || m.id.slice(-6).toUpperCase()}`,
        description: isExternal
          ? `Supplier Receipt: ${m.supplierName || 'Supplier'} → ${m.destinationWarehouseName || 'Warehouse'} (${totalUnits} units)`
          : `Internal Transfer: ${m.sourceWarehouseName || 'Source'} → ${m.destinationWarehouseName || 'Destination'} (${totalUnits} units)`,
        timestamp: date,
        statusBadge: isExternal ? 'Supplier Receipt' : 'Warehouse Transfer',
        statusColor: isExternal
          ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
          : 'bg-purple-500/10 text-purple-600 border-purple-500/20',
        meta: valFormatted ? `Purchase Value: ${valFormatted} • Recorded by ${m.recordedByName || 'Staff'}` : `Recorded by ${m.recordedByName || 'Staff'}`,
        href: '/transfers',
      });
    });

    warehousesDoc.forEach((w) => {
      const date = parseOptionalNotificationDate(w.updatedAt || w.createdAt || w.updated_at || w.created_at);
      list.push({
        id: `wh-${w.id}`,
        type: 'supply_chain',
        title: `Facility Node: ${w.name || 'Warehouse'}`,
        description: `Location: ${w.location || 'Facility Hub'} • Status: ${w.active === false ? 'Inactive' : 'Active Facility'}`,
        timestamp: date,
        statusBadge: w.active === false ? 'Inactive Facility' : 'Active Facility',
        statusColor:
          w.active === false
            ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
            : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
        meta: 'Supply Chain Infrastructure',
        href: '/supply-chain',
      });
    });

    delegations.forEach((del) => {
      const date = parseOptionalNotificationDate(del.updatedAt || del.updated_at || del.createdAt || del.created_at);
      list.push({
        id: `del-${del.id}`,
        type: 'supply_chain',
        title: `Executive Access Delegation: ${del.staffEmail || 'Staff User'}`,
        description: summarizeDelegationPermissions(del),
        timestamp: date,
        statusBadge: del.active === false ? 'Access Revoked' : 'Access Granted',
        statusColor:
          del.active === false
            ? 'bg-red-500/10 text-red-600 border-red-500/20'
            : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
        meta: 'Security & Key Personnel Access',
        href: '/delegation',
      });
    });

    return list.sort((a, b) => {
      const timeA = a.timestamp ? a.timestamp.getTime() : 0;
      const timeB = b.timestamp ? b.timestamp.getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return a.id.localeCompare(b.id);
    });
  }, [orders, trips, transfers, movements, warehousesDoc, delegations]);

  const allNotifications = useMemo<AdminNotificationItem[]>(() => {
    return compiledNotifications.filter((item) => {
      if (item.type === 'order') return prefs.orderAlerts;
      if (item.type === 'logistics') return prefs.logisticsAlerts;
      if (item.type === 'transfer') return prefs.transferAlerts;
      if (item.type === 'movement') return prefs.movementAlerts;
      return prefs.supplyChainAlerts;
    });
  }, [compiledNotifications, prefs]);

  // Fire live toast notifications globally across any admin route for items arriving after initial source snapshots
  useEffect(() => {
    if (!isAdmin) return;
    const allIds = compiledNotifications.map((item) => item.id);
    const enabledIds = new Set(allNotifications.map((item) => item.id));
    const newlyArrived = allNotifications.filter(
      (item) => enabledIds.has(item.id) && !seenRawIdsRef.current.has(item.id) && !readIdsRef.current.has(item.id),
    );
    allIds.forEach((id) => seenRawIdsRef.current.add(id));

    if (prefs.toastAlerts && newlyArrived.length > 0) {
      if (newlyArrived.length === 1) {
        toast.info(newlyArrived[0].title, { description: newlyArrived[0].description });
      } else {
        toast.info(`${newlyArrived.length} new system activity alerts`, { description: newlyArrived[0].title });
      }
    }
  }, [compiledNotifications, allNotifications, isAdmin, prefs.toastAlerts]);

  const unreadCount = useMemo(
    () => allNotifications.filter((item) => !readIds.has(item.id)).length,
    [allNotifications, readIds],
  );

  const markItemAsRead = useCallback((id: string) => {
    if (readIdsRef.current.has(id)) return;
    const nextSet = new Set(readIdsRef.current);
    nextSet.add(id);
    readIdsRef.current = nextSet;
    setReadIds(nextSet);
    safeWriteStorage(notifReadKey, JSON.stringify(Array.from(nextSet)));
  }, [notifReadKey]);

  const markAllAsRead = useCallback(() => {
    const nextSet = new Set([...readIdsRef.current, ...allNotifications.map((item) => item.id)]);
    readIdsRef.current = nextSet;
    setReadIds(nextSet);
    safeWriteStorage(notifReadKey, JSON.stringify(Array.from(nextSet)));
    toast.success('All notifications marked as read');
  }, [allNotifications, notifReadKey]);

  const togglePref = useCallback((key: keyof AdminNotificationPrefs) => {
    const updated = { ...prefsRef.current, [key]: !prefsRef.current[key] };
    prefsRef.current = updated;
    setPrefs(updated);
    safeWriteStorage(notifPrefsKey, JSON.stringify(updated));
    toast.success('Notification preferences updated');
  }, [notifPrefsKey]);

  const contextValue = useMemo<AdminNotificationsContextValue>(() => ({
    isAdmin,
    loading,
    allNotifications,
    unreadCount,
    readIds,
    prefs,
    markItemAsRead,
    markAllAsRead,
    togglePref,
  }), [isAdmin, loading, allNotifications, unreadCount, readIds, prefs, markItemAsRead, markAllAsRead, togglePref]);

  return (
    <AdminNotificationsContext.Provider value={contextValue}>
      {children}
    </AdminNotificationsContext.Provider>
  );
}

const AccessContext = createContext({ permissions: resolvePermissions(null), loading: true, revoked: false, error: false, hasDelegation: false });
export function StaffAccessProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [state, setState] = useState<{ uid: string; delegation?: StaffDelegation; loading: boolean; error: boolean }>({ uid: '', loading: true, error: false });
  useEffect(() => {
    if (!profile || profile.role === 'admin') {
      setState({ uid: profile?.uid || '', loading: false, error: false });
      return;
    }
    const normalizedEmail = (profile.email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      setState({ uid: profile.uid, loading: false, error: false });
      return;
    }
    setState({ uid: profile.uid, loading: true, error: false });
    return onSnapshot(query(collection(db, 'delegations'), where('staffEmail', '==', normalizedEmail)), snap => {
      const rows = snap.docs
        .map((d: any) => ({ id: d.id, ...d.data() } as StaffDelegation))
        .sort((a: StaffDelegation, b: StaffDelegation) => {
          const timeA = String((a as StaffDelegation & { updatedAt?: string }).updatedAt || a.createdAt || '');
          const timeB = String((b as StaffDelegation & { updatedAt?: string }).updatedAt || b.createdAt || '');
          if (timeB !== timeA) return timeB.localeCompare(timeA);
          return Number(b.active !== false) - Number(a.active !== false);
        });
      setState({ uid: profile.uid, delegation: rows[0], loading: false, error: false });
    }, () => setState({ uid: profile.uid, loading: false, error: true }));
  }, [profile?.uid, profile?.role, profile?.email]);
  const admin = profile?.role === 'admin';
  const loading = !profile || (!admin && (state.uid !== profile.uid || state.loading));
  const error = !admin && state.error;
  const revoked = !admin && state.delegation?.active === false;
  const permissions = resolvePermissions(profile, admin ? undefined : state.delegation);
  return (
    <AccessContext.Provider value={{ permissions, loading, revoked, error, hasDelegation: !admin && !!state.delegation }}>
      <AdminNotificationsProvider>{children}</AdminNotificationsProvider>
    </AccessContext.Provider>
  );
}
export const useStaffAccess = () => useContext(AccessContext);
export const useAdminNotifications = () => useContext(AdminNotificationsContext);
