import { PageHeading } from './PageHeading';
import { hasAdminRole } from '../lib/staffPermissions';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { collection, db, getDocs } from '../lib/supabaseAdapter';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { InventoryItem, Order, Product, Transfer } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '../hooks/useAuth';
import { useAdminNotifications } from '../hooks/useStaffAccess';
import { BellIcon as Bell, WarningIcon as AlertTriangle, ArrowRightIcon as ArrowRight, CheckCircleIcon as CheckCircle2, ClockIcon as Clock3, PackageIcon as Package, CoinsIcon as PhilippinePeso, ArrowsClockwiseIcon as RefreshCw, ShoppingCartIcon as ShoppingCart, TruckIcon as Truck } from '@phosphor-icons/react';

type OverviewOrder = Pick<Order, 'id' | 'status' | 'totalAmount' | 'createdAt' | 'deliveryDeadline'>;
type OverviewProduct = Pick<Product, 'id' | 'name' | 'sku' | 'reorderPoint'>;
type OverviewInventoryItem = Pick<InventoryItem, 'productId' | 'quantity'>;

interface OverviewPayload {
  orders: OverviewOrder[];
  products: OverviewProduct[];
  inventory: OverviewInventoryItem[];
  pendingTransfersCount: number;
}

interface OverviewCacheEntry {
  uid: string;
  payload: OverviewPayload;
  lastChecked: Date;
  fetchedAt: number;
}

const OVERVIEW_PAGE_SIZE = 1000;
const STRICT_MODE_DEDUPE_MS = 250;
const DB_REFRESH_DEBOUNCE_MS = 150;

let cachedOverview: OverviewCacheEntry | null = null;
let inFlightOverview: { uid: string; promise: Promise<OverviewPayload> } | null = null;

const toDate = (value: any) => {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

async function fetchProjectedRows<T>(
  table: string,
  columns: string,
  applyFilter?: (builder: any) => any,
): Promise<T[]> {
  const runPage = (offset: number, end: number, withCount = false) => {
    let builder: any = supabase.from(table).select(columns, withCount ? { count: 'exact' } : undefined);
    if (applyFilter) {
      builder = applyFilter(builder);
    }
    return builder.range(offset, end);
  };

  const first = await runPage(0, OVERVIEW_PAGE_SIZE - 1, true);
  if (first.error) throw first.error;

  const rows = (Array.isArray(first.data) ? first.data : []) as T[];
  const total = typeof first.count === 'number' ? first.count : null;

  if (rows.length === 0 || (total !== null && rows.length >= total)) {
    return rows;
  }

  const pageStep = rows.length;
  if (total !== null && total > rows.length && pageStep > 0) {
    const pageRequests: Promise<any>[] = [];
    for (let offset = pageStep; offset < total; offset += pageStep) {
      pageRequests.push(runPage(offset, offset + pageStep - 1, false));
    }
    const restPages = await Promise.all(pageRequests);
    for (const page of restPages) {
      if (page.error) throw page.error;
      if (Array.isArray(page.data)) {
        rows.push(...(page.data as T[]));
      }
    }
    return rows;
  }

  if (rows.length < OVERVIEW_PAGE_SIZE) {
    return rows;
  }

  let offset = rows.length;
  while (true) {
    const next = await runPage(offset, offset + OVERVIEW_PAGE_SIZE - 1, false);
    if (next.error) throw next.error;
    const batch = (Array.isArray(next.data) ? next.data : []) as T[];
    rows.push(...batch);
    if (batch.length < OVERVIEW_PAGE_SIZE) break;
    offset += batch.length;
  }
  return rows;
}

async function loadOverviewOrders(): Promise<OverviewOrder[]> {
  if (isSupabaseConfigured) {
    try {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - 1);
      const sinceIso = since.toISOString();

      return await fetchProjectedRows<OverviewOrder>(
        'orders',
        'id, status, totalAmount, createdAt, deliveryDeadline',
        (q) => q.or(`createdAt.gte.${sinceIso},status.not.in.(completed,delivered,cancelled),status.is.null`),
      );
    } catch {
      // Fall back to adapter (which merges localStorage cache/seeds when offline)
    }
  }
  const snap = await getDocs(collection(db, 'orders'));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order));
}

async function loadOverviewProducts(): Promise<OverviewProduct[]> {
  if (isSupabaseConfigured) {
    try {
      return await fetchProjectedRows<OverviewProduct>('products', 'id, name, sku, reorderPoint');
    } catch {
      // Fall back to adapter when offline or direct query fails
    }
  }
  const snap = await getDocs(collection(db, 'products'));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Product));
}

async function loadOverviewInventory(): Promise<OverviewInventoryItem[]> {
  if (isSupabaseConfigured) {
    try {
      return await fetchProjectedRows<OverviewInventoryItem>('inventory', 'productId, quantity');
    } catch {
      // Fall back to adapter when offline or direct query fails
    }
  }
  const snap = await getDocs(collection(db, 'inventory'));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as InventoryItem));
}

async function loadPendingTransfersCount(): Promise<number> {
  if (isSupabaseConfigured) {
    try {
      const { count, error } = await supabase
        .from('transfers')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'in_transit']);
      if (!error && typeof count === 'number') {
        return count;
      }
    } catch {
      // Fall back to adapter when offline or direct query fails
    }
  }
  const snap = await getDocs(collection(db, 'transfers'));
  return snap.docs
    .map((doc) => doc.data() as Transfer)
    .filter((transfer) => transfer.status === 'pending' || transfer.status === 'in_transit')
    .length;
}

async function fetchOverviewPayload(): Promise<OverviewPayload> {
  const [orders, products, inventory, pendingTransfersCount] = await Promise.all([
    loadOverviewOrders(),
    loadOverviewProducts(),
    loadOverviewInventory(),
    loadPendingTransfersCount(),
  ]);
  return { orders, products, inventory, pendingTransfersCount };
}

export function AdminPanel() {
  const { profile } = useAuth();
  const { unreadCount } = useAdminNotifications();
  const uid = profile?.uid || '';
  const initialCache = cachedOverview && cachedOverview.uid === uid ? cachedOverview : null;

  const [orders, setOrders] = useState<OverviewOrder[]>(() => initialCache?.payload.orders ?? []);
  const [products, setProducts] = useState<OverviewProduct[]>(() => initialCache?.payload.products ?? []);
  const [inventory, setInventory] = useState<OverviewInventoryItem[]>(() => initialCache?.payload.inventory ?? []);
  const [pendingTransfersCount, setPendingTransfersCount] = useState<number>(() => initialCache?.payload.pendingTransfersCount ?? 0);
  const [loading, setLoading] = useState(() => !initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(() => initialCache?.lastChecked ?? null);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(Boolean(initialCache));
  const isAdmin = hasAdminRole(profile);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyPayload = useCallback((payload: OverviewPayload, checkedAt: Date) => {
    hasDataRef.current = true;
    setOrders(payload.orders);
    setProducts(payload.products);
    setInventory(payload.inventory);
    setPendingTransfersCount(payload.pendingTransfersCount);
    setLastChecked(checkedAt);
  }, []);

  const loadOverview = useCallback(async (silent = false, force = false) => {
    if (!isAdmin) {
      cachedOverview = null;
      hasDataRef.current = false;
      if (mountedRef.current) setLoading(false);
      return;
    }

    if (cachedOverview && cachedOverview.uid !== uid) {
      cachedOverview = null;
      hasDataRef.current = false;
    }

    if (
      !force &&
      cachedOverview &&
      cachedOverview.uid === uid &&
      Date.now() - cachedOverview.fetchedAt < STRICT_MODE_DEDUPE_MS
    ) {
      if (mountedRef.current) {
        applyPayload(cachedOverview.payload, cachedOverview.lastChecked);
        setLoading(false);
        setLoadError(false);
      }
      return;
    }

    if (mountedRef.current) {
      if (!silent && !hasDataRef.current) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setLoadError(false);
    }

    try {
      let activePromise: Promise<OverviewPayload>;
      if (!force && inFlightOverview && inFlightOverview.uid === uid) {
        activePromise = inFlightOverview.promise;
      } else {
        const promise = fetchOverviewPayload();
        inFlightOverview = { uid, promise };
        activePromise = promise.finally(() => {
          if (inFlightOverview?.promise === promise) {
            inFlightOverview = null;
          }
        });
      }

      const payload = await activePromise;
      const checkedAt = new Date();
      cachedOverview = { uid, payload, lastChecked: checkedAt, fetchedAt: Date.now() };
      if (!mountedRef.current) return;
      applyPayload(payload, checkedAt);
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(true);
      handleSupabaseError(error, OperationType.GET, 'admin_overview');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [applyPayload, isAdmin, uid]);

  useEffect(() => {
    void loadOverview(hasDataRef.current);
  }, [loadOverview]);

  useEffect(() => {
    if (!isAdmin) return;
    const overviewCollections = new Set(['orders', 'products', 'inventory', 'transfers']);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void loadOverview(true, true);
      }, DB_REFRESH_DEBOUNCE_MS);
    };

    const handleDbChange = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!path || overviewCollections.has(path)) {
        scheduleRefresh();
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || Array.from(overviewCollections).some(col => e.key === `activepro_db_${col}`)) {
        scheduleRefresh();
      }
    };
    window.addEventListener('activepro_db_changed', handleDbChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      window.removeEventListener('activepro_db_changed', handleDbChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isAdmin, loadOverview]);

  const overview = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const startOfTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfTomorrowMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

    let todaysOrdersCount = 0;
    let todaysRevenue = 0;
    let pendingOrdersCount = 0;
    let overdueOrdersCount = 0;
    const pendingOrOverdueOrderIds = new Set<string>();

    for (const order of orders) {
      const created = toDate(order.createdAt);
      if (created) {
        const createdMs = created.getTime();
        if (createdMs >= startOfTodayMs && createdMs < startOfTomorrowMs) {
          todaysOrdersCount++;
          if (order.status === 'completed' || order.status === 'delivered') {
            todaysRevenue += Number(order.totalAmount || 0);
          }
        }
      }

      const isPending = order.status === 'pending' || order.status === 'preparing' || order.status === 'escalated';
      if (isPending) {
        pendingOrdersCount++;
      }

      const deadline = toDate(order.deliveryDeadline);
      const isOverdue = Boolean(
        deadline &&
          deadline.getTime() < nowMs &&
          order.status !== 'completed' &&
          order.status !== 'delivered' &&
          order.status !== 'cancelled',
      );
      if (isOverdue) {
        overdueOrdersCount++;
      }

      if (isPending || isOverdue) {
        pendingOrOverdueOrderIds.add(order.id);
      }
    }

    const stockByProduct = new Map<string, number>();
    for (const item of inventory) {
      stockByProduct.set(item.productId, (stockByProduct.get(item.productId) || 0) + Number(item.quantity || 0));
    }

    let stockAlertCount = 0;
    const topStockAlerts: Array<{ product: OverviewProduct; quantity: number }> = [];
    for (const product of products) {
      const quantity = stockByProduct.get(product.id) || 0;
      if (quantity <= Number(product.reorderPoint || 0)) {
        stockAlertCount++;
        if (topStockAlerts.length < 5 || quantity < topStockAlerts[topStockAlerts.length - 1].quantity) {
          let insertAt = topStockAlerts.length;
          for (let i = 0; i < topStockAlerts.length; i++) {
            if (quantity < topStockAlerts[i].quantity) {
              insertAt = i;
              break;
            }
          }
          topStockAlerts.splice(insertAt, 0, { product, quantity });
          if (topStockAlerts.length > 5) {
            topStockAlerts.pop();
          }
        }
      }
    }

    return {
      todaysOrdersCount,
      todaysRevenue,
      stockAlertCount,
      topStockAlerts,
      pendingOrdersCount,
      pendingTransfersCount,
      overdueOrdersCount,
      pendingActions: pendingOrOverdueOrderIds.size + pendingTransfersCount,
    };
  }, [inventory, orders, pendingTransfersCount, products]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeading title="Overview" subtitle="Today’s operational pulse for Active Pro inventory and fulfillment." />
        <div className="flex items-center gap-2">
          <Link to="/settings" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted">
            <Bell className="h-3.5 w-3.5 text-primary" />
            <span>Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px] font-black bg-primary/15 text-primary border-0">
                {unreadCount}
              </Badge>
            )}
          </Link>
          <button type="button" onClick={() => void loadOverview(hasDataRef.current, true)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing || loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Orders today" value={loading ? <Skeleton className="h-8 w-16" /> : overview.todaysOrdersCount.toLocaleString()} detail="New fulfillment requests" icon={<ShoppingCart className="h-4 w-4 text-primary" />} />
        <MetricCard label="Revenue today" value={loading ? <Skeleton className="h-8 w-24" /> : `₱${overview.todaysRevenue.toLocaleString()}`} detail="Completed and delivered orders" icon={<PhilippinePeso className="h-4 w-4 text-emerald-600" />} />
        <MetricCard label="Inventory alerts" value={loading ? <Skeleton className="h-8 w-16" /> : overview.stockAlertCount.toLocaleString()} detail="Products at or below reorder point" icon={<Package className="h-4 w-4 text-amber-600" />} alert={!loading && overview.stockAlertCount > 0} />
        <MetricCard label="Pending actions" value={loading ? <Skeleton className="h-8 w-16" /> : overview.pendingActions.toLocaleString()} detail="Orders, transfers, and overdue items" icon={<Clock3 className="h-4 w-4 text-blue-500" />} alert={!loading && overview.overdueOrdersCount > 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div><CardTitle className="text-base font-black">Urgent inventory alerts</CardTitle><CardDescription>Stock requiring the admin team’s attention.</CardDescription></div>
            {loading ? (
              <Skeleton className="h-5 w-16 rounded-full" />
            ) : (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">{overview.stockAlertCount} open</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              [1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-16 w-full rounded-xl" />)
            ) : (
              <>
                {overview.topStockAlerts.map(({ product, quantity }) => (
                  <div key={product.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10"><AlertTriangle className="h-4 w-4 text-amber-600" /></div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{product.name}</p><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">SKU {product.sku}</p></div>
                    <div className="text-right"><p className={`text-sm font-black ${quantity === 0 ? 'text-red-500' : 'text-amber-600'}`}>{quantity} in stock</p><p className="text-[10px] text-muted-foreground">Reorder at {product.reorderPoint}</p></div>
                  </div>
                ))}
                {overview.stockAlertCount === 0 && <EmptyState label="Inventory levels are currently healthy." />}
              </>
            )}
            <Link to="/inventory" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Review inventory <ArrowRight className="h-3 w-3" /></Link>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardHeader><CardTitle className="text-base font-black">Pending actions</CardTitle><CardDescription>Work queues that may need follow-up today.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <ActionRow icon={<ShoppingCart className="h-4 w-4" />} label="Orders awaiting action" value={overview.pendingOrdersCount} loading={loading} href="/orders" />
            <ActionRow icon={<Truck className="h-4 w-4" />} label="Open stock transfers" value={overview.pendingTransfersCount} loading={loading} href="/transfers" />
            <ActionRow icon={<AlertTriangle className="h-4 w-4" />} label="Overdue deliveries" value={overview.overdueOrdersCount} loading={loading} href="/orders" urgent={!loading && overview.overdueOrdersCount > 0} />
          </CardContent>
        </Card>
      </div>

      <Card className={`${loadError ? 'border-red-500/30' : 'border-emerald-500/25'} bg-card shadow-sm`}>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${loadError ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>{loadError ? <AlertTriangle className="h-5 w-5 text-red-500" /> : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}</div>
            <div><p className="text-sm font-black text-foreground">System health</p><p className="text-xs text-muted-foreground">{loadError ? 'The operational data service could not be reached.' : 'Operational data services are responding normally.'}</p></div>
          </div>
          <div className="text-left sm:text-right">
            <Badge className={loadError ? 'bg-red-500/10 text-red-500 hover:bg-red-500/10' : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10'}>{loadError ? 'Attention required' : loading ? 'Checking status' : 'All systems operational'}</Badge>
            {lastChecked && <p className="mt-1 text-[10px] text-muted-foreground">Checked {lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value, detail, icon, alert = false }: { label: string; value: ReactNode; detail: string; icon: ReactNode; alert?: boolean }) {
  return <Card className={`border-border bg-card shadow-sm ${alert ? 'ring-1 ring-amber-500/20' : ''}`}><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</CardTitle><div className="rounded-lg bg-muted p-2">{icon}</div></CardHeader><CardContent><div className="text-2xl font-black tracking-tight text-foreground">{value}</div><p className="mt-1 text-[10px] font-medium text-muted-foreground">{detail}</p></CardContent></Card>;
}

function ActionRow({ icon, label, value, href, urgent = false, loading = false }: { icon: ReactNode; label: string; value: number; href: string; urgent?: boolean; loading?: boolean }) {
  return <Link to={href} className="group flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/60"><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${urgent ? 'bg-red-500/10 text-red-500' : 'bg-primary/10 text-primary'}`}>{icon}</div><span className="flex-1 text-sm font-bold text-foreground">{label}</span>{loading ? <Skeleton className="h-5 w-8 rounded-full" /> : <Badge variant="outline" className={urgent ? 'border-red-500/30 text-red-500' : ''}>{value}</Badge>}<ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Link>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {label}</div>;
}
