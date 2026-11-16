import { PageHeading } from './PageHeading';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collection, db, DEFAULT_PL_ORDERS, getDocs } from '../lib/supabaseAdapter';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { escapeCsvCell } from '../lib/exportUtils';
import { Order } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { useAuth } from '../hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDownRightIcon as ArrowDownRight, ArrowUpRightIcon as ArrowUpRight, ChartBarIcon as BarChart3, DownloadIcon as Download, FunnelIcon as Filter, CoinsIcon as PhilippinePeso, ShoppingCartIcon as ShoppingCart, TargetIcon as Target, WarningIcon as AlertTriangle } from '@phosphor-icons/react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type RangeOption = '7' | '30' | 'custom';
type DashboardOrder = Pick<
  Order,
  'id' | 'orderNumber' | 'clientName' | 'status' | 'totalAmount' | 'paymentStatus' | 'deliveryRegion' | 'createdAt'
>;

const DASHBOARD_ORDER_COLUMNS =
  'id, orderNumber, clientName, status, totalAmount, paymentStatus, deliveryRegion, createdAt';
const DASHBOARD_PAGE_SIZE = 1000;
const STRICT_MODE_DEDUPE_MS = 250;
const DB_REFRESH_DEBOUNCE_MS = 150;

interface DashboardCacheEntry {
  uid: string;
  orders: DashboardOrder[];
  fetchedAt: number;
}

let cachedDashboardOrders: DashboardCacheEntry | null = null;
let inFlightDashboardOrders: { uid: string; promise: Promise<DashboardOrder[]> } | null = null;

const toDate = (value: any) => {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

async function fetchProjectedOrders(): Promise<DashboardOrder[]> {
  if (isSupabaseConfigured) {
    try {
      const runPage = (offset: number, end: number, withCount = false) =>
        supabase
          .from('orders')
          .select(DASHBOARD_ORDER_COLUMNS, withCount ? { count: 'exact' } : undefined)
          .range(offset, end);

      const first = await runPage(0, DASHBOARD_PAGE_SIZE - 1, true);
      if (first.error) throw first.error;

      const rows = (Array.isArray(first.data) ? first.data : []) as DashboardOrder[];
      const total = typeof first.count === 'number' ? first.count : null;

      if (rows.length > 0 && (total === null || rows.length < total)) {
        const pageStep = rows.length;
        if (total !== null && total > rows.length && pageStep > 0) {
          const requests: PromiseLike<any>[] = [];
          for (let offset = pageStep; offset < total; offset += pageStep) {
            requests.push(runPage(offset, offset + pageStep - 1, false));
          }
          const rest = await Promise.all(requests);
          for (const page of rest) {
            if (page.error) throw page.error;
            if (Array.isArray(page.data)) {
              rows.push(...(page.data as DashboardOrder[]));
            }
          }
        } else if (rows.length >= DASHBOARD_PAGE_SIZE) {
          let offset = rows.length;
          while (true) {
            const next = await runPage(offset, offset + DASHBOARD_PAGE_SIZE - 1, false);
            if (next.error) throw next.error;
            const batch = (Array.isArray(next.data) ? next.data : []) as DashboardOrder[];
            rows.push(...batch);
            if (batch.length < DASHBOARD_PAGE_SIZE) break;
            offset += batch.length;
          }
        }
      }

      const seenIds = new Set(rows.map((row) => row.id));
      for (const defOrd of DEFAULT_PL_ORDERS) {
        if (!seenIds.has(defOrd.id)) {
          rows.push(defOrd as DashboardOrder);
        }
      }
      return rows;
    } catch {
      // Fall back to adapter when offline or direct query fails
    }
  }
  const snapshot = await getDocs(collection(db, 'orders'));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order));
}

const formatLocalDateInput = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parseLocalDateInput = (value: string, endOfDay = false): Date | null => {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const d = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
  return Number.isNaN(d.getTime()) ? null : d;
};

export function Dashboard() {
  const { profile } = useAuth();
  const uid = profile?.uid || '';
  const initialCache = cachedDashboardOrders && cachedDashboardOrders.uid === uid ? cachedDashboardOrders : null;

  const [orders, setOrders] = useState<DashboardOrder[]>(() => initialCache?.orders ?? []);
  const [rangeType, setRangeType] = useState<RangeOption>('30');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return formatLocalDateInput(d);
  });
  const [customEnd, setCustomEnd] = useState(() => formatLocalDateInput(new Date()));
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(() => !initialCache);
  const [loadError, setLoadError] = useState(false);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(Boolean(initialCache));
  const revokeTimerRef = useRef<{ timerId: number; url: string } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (revokeTimerRef.current) {
        window.clearTimeout(revokeTimerRef.current.timerId);
        URL.revokeObjectURL(revokeTimerRef.current.url);
        revokeTimerRef.current = null;
      }
    };
  }, []);

  const loadOrders = useCallback(async (silent = false, force = false) => {
    if (cachedDashboardOrders && cachedDashboardOrders.uid !== uid) {
      cachedDashboardOrders = null;
      hasDataRef.current = false;
    }

    if (
      !force &&
      cachedDashboardOrders &&
      cachedDashboardOrders.uid === uid &&
      Date.now() - cachedDashboardOrders.fetchedAt < STRICT_MODE_DEDUPE_MS
    ) {
      if (mountedRef.current) {
        hasDataRef.current = true;
        setOrders(cachedDashboardOrders.orders);
        setLoading(false);
        setLoadError(false);
      }
      return;
    }

    if (mountedRef.current) {
      if (!silent && !hasDataRef.current) setLoading(true);
      setLoadError(false);
    }

    try {
      let activePromise: Promise<DashboardOrder[]>;
      if (!force && inFlightDashboardOrders && inFlightDashboardOrders.uid === uid) {
        activePromise = inFlightDashboardOrders.promise;
      } else {
        const promise = fetchProjectedOrders();
        inFlightDashboardOrders = { uid, promise };
        activePromise = promise.finally(() => {
          if (inFlightDashboardOrders?.promise === promise) {
            inFlightDashboardOrders = null;
          }
        });
      }

      const nextOrders = await activePromise;
      cachedDashboardOrders = { uid, orders: nextOrders, fetchedAt: Date.now() };
      if (!mountedRef.current) return;
      hasDataRef.current = true;
      setOrders(nextOrders);
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(true);
      handleSupabaseError(error, OperationType.GET, 'analytics_orders');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void loadOrders(hasDataRef.current);
  }, [loadOrders]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void loadOrders(true, true);
      }, DB_REFRESH_DEBOUNCE_MS);
    };
    const handleDbChange = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!path || path === 'orders') {
        scheduleRefresh();
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'activepro_db_orders' || e.key === 'activepro_order_overrides') {
        scheduleRefresh();
      }
    };
    window.addEventListener('activepro_db_changed', handleDbChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      window.removeEventListener('activepro_db_changed', handleDbChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [loadOrders]);

  const regions = useMemo(() => {
    const defaultRegions = ['Metro Manila', 'Luzon', 'Visayas', 'Mindanao'];
    const orderRegions = orders.map(order => order.deliveryRegion).filter(Boolean) as string[];
    const set = new Set<string>([...defaultRegions, ...orderRegions]);
    return Array.from(set).sort((a, b) => {
      const aIdx = defaultRegions.indexOf(a);
      const bIdx = defaultRegions.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [orders]);

  const analytics = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let start = new Date();
    let end = new Date();
    end.setHours(23, 59, 59, 999);

    switch (rangeType) {
      case '7':
        start = new Date(end);
        start.setDate(end.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        break;
      case '30':
        start = new Date(end);
        start.setDate(end.getDate() - 29);
        start.setHours(0, 0, 0, 0);
        break;
      case 'custom': {
        const parsedStart = customStart ? parseLocalDateInput(customStart, false) : null;
        const parsedEnd = customEnd ? parseLocalDateInput(customEnd, true) : null;
        start = parsedStart || new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
        end = parsedEnd || new Date(currentYear, currentMonth, now.getDate(), 23, 59, 59, 999);
        if (start > end) {
          const origStart = start;
          start = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
          end = new Date(origStart.getFullYear(), origStart.getMonth(), origStart.getDate(), 23, 59, 59, 999);
        }
        break;
      }
    }

    const dayCount = Math.max(
      1,
      Math.round(
        (new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
          - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / (1000 * 60 * 60 * 24)
      ) + 1
    );
    const previousStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - dayCount, 0, 0, 0, 0);

    const startMs = start.getTime();
    const endMs = end.getTime();
    const previousStartMs = previousStart.getTime();
    const diffDays = dayCount;
    let bucketCount = 10;
    if (diffDays <= 7) bucketCount = diffDays;
    else if (diffDays <= 14) bucketCount = diffDays;
    else if (diffDays <= 31) bucketCount = 10;
    else bucketCount = 12;

    const isDaily = bucketCount === dayCount;
    const durationMs = Math.max(1, endMs - startMs);
    const bucketMs = durationMs / bucketCount;
    const bucketStarts: number[] = [];
    const bucketEnds: number[] = [];
    const trend = Array.from({ length: bucketCount }, (_, index) => {
      const bucketStart = isDaily
        ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 0, 0, 0, 0)
        : new Date(startMs + index * bucketMs);
      const bucketEnd = isDaily
        ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + index + 1, 0, 0, 0, 0)
        : new Date(startMs + (index + 1) * bucketMs);
      bucketStarts.push(bucketStart.getTime());
      bucketEnds.push(bucketEnd.getTime());
      return {
        name: bucketStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        revenue: 0,
        orders: 0,
      };
    });

    const current: DashboardOrder[] = [];
    let revenue = 0;
    let previousRevenue = 0;
    let currentCompleted = 0;
    let previousCount = 0;
    let previousCompleted = 0;
    let totalAmountSum = 0;
    const regionMap = new Map<string, { orders: number; revenue: number }>();
    const statusMap = new Map<string, number>();

    for (const order of orders) {
      const matchesRegion = region === 'all'
        || order.deliveryRegion === region
        || (region === 'Luzon' && order.deliveryRegion === 'Provincial Luzon');
      if (!matchesRegion) continue;
      if (status !== 'all' && order.status !== status) continue;

      const date = toDate(order.createdAt);
      if (!date) continue;
      const timeMs = date.getTime();
      const isRecognized = order.status === 'completed' || order.status === 'delivered';
      const amount = Number(order.totalAmount || 0);

      if (timeMs >= startMs && timeMs <= endMs) {
        current.push(order);
        totalAmountSum += amount;
        if (isRecognized) {
          revenue += amount;
          currentCompleted++;
        }

        const regionKey = order.deliveryRegion || 'Unassigned';
        const regionEntry = regionMap.get(regionKey) || { orders: 0, revenue: 0 };
        regionEntry.orders += 1;
        if (isRecognized) regionEntry.revenue += amount;
        regionMap.set(regionKey, regionEntry);

        statusMap.set(order.status, (statusMap.get(order.status) || 0) + 1);

        for (let i = 0; i < bucketCount; i++) {
          const inclusiveEnd = !isDaily && i === bucketCount - 1;
          if (timeMs >= bucketStarts[i] && (inclusiveEnd ? timeMs <= bucketEnds[i] : timeMs < bucketEnds[i])) {
            trend[i].orders += 1;
            if (isRecognized) trend[i].revenue += amount;
            break;
          }
        }
      } else if (timeMs >= previousStartMs && timeMs < startMs) {
        previousCount++;
        if (isRecognized) {
          previousRevenue += amount;
          previousCompleted++;
        }
      }
    }

    const completionRate = current.length ? (currentCompleted / current.length) * 100 : 0;
    const previousCompletionRate = previousCount ? (previousCompleted / previousCount) * 100 : 0;
    const change = (value: number, oldValue: number) => oldValue === 0 ? (value > 0 ? 100 : 0) : ((value - oldValue) / oldValue) * 100;

    const regional = Array.from(regionMap, ([name, values]) => ({ name, ...values })).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
    const statuses = Array.from(statusMap, ([name, value]) => ({ name: name.replaceAll('_', ' '), value })).sort((a, b) => b.value - a.value);

    return {
      current, revenue, completionRate, trend, regional, statuses,
      revenueChange: change(revenue, previousRevenue),
      orderChange: change(current.length, previousCount),
      completionChange: completionRate - previousCompletionRate,
      averageOrder: current.length ? totalAmountSum / current.length : 0,
    };
  }, [orders, rangeType, customStart, customEnd, region, status]);

  const downloadReport = () => {
    const headers = ['Order Number', 'Created At', 'Client', 'Region', 'Status', 'Payment Status', 'Amount'];
    const rows = analytics.current.map(order => [order.orderNumber, toDate(order.createdAt)?.toISOString() || '', order.clientName, order.deliveryRegion, order.status, order.paymentStatus, order.totalAmount]);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    if (revokeTimerRef.current) {
      window.clearTimeout(revokeTimerRef.current.timerId);
      URL.revokeObjectURL(revokeTimerRef.current.url);
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `active-pro-analytics-${rangeType}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    const timerId = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      if (revokeTimerRef.current?.timerId === timerId) {
        revokeTimerRef.current = null;
      }
    }, 60000);
    revokeTimerRef.current = { timerId, url };
  };

  const isCustomRangeSwapped = rangeType === 'custom' && Boolean(customStart && customEnd && customStart > customEnd);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <PageHeading title="Analytics" subtitle="Historical order and revenue analysis for Active Pro operations." />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              aria-label="Date range"
              value={rangeType}
              onChange={event => setRangeType(event.target.value as RangeOption)}
              className="h-9 bg-transparent text-xs font-bold outline-none cursor-pointer"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="custom">Custom date range</option>
            </select>
          </div>
          {rangeType === 'custom' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5">
              <input
                type="date"
                aria-label="Start date"
                value={customStart}
                max={customEnd || undefined}
                onChange={e => setCustomStart(e.target.value)}
                className="h-9 bg-transparent text-xs font-medium outline-none"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <input
                type="date"
                aria-label="End date"
                value={customEnd}
                min={customStart || undefined}
                onChange={e => setCustomEnd(e.target.value)}
                className="h-9 bg-transparent text-xs font-medium outline-none"
              />
              {isCustomRangeSwapped && (
                <span className="text-[10px] font-bold text-amber-600">Reversed range normalized</span>
              )}
            </div>
          )}
          <select
            aria-label="Delivery region"
            value={region}
            onChange={event => setRegion(event.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-bold outline-none cursor-pointer"
          >
            <option value="all">All regions</option>
            {regions.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select
            aria-label="Order status"
            value={status}
            onChange={event => setStatus(event.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-bold capitalize outline-none cursor-pointer"
          >
            <option value="all">All statuses</option>
            {['pending', 'preparing', 'out_for_delivery', 'delivered', 'completed', 'escalated', 'cancelled'].map(item => (
              <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={downloadReport}
            disabled={loading || analytics.current.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" /> Download CSV
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Could not load analytics orders. Displayed metrics may be incomplete.
          </span>
          <button
            type="button"
            onClick={() => void loadOrders(false, true)}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-bold hover:bg-muted cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Recognized revenue" value={loading ? <Skeleton className="h-8 w-24" /> : `₱${analytics.revenue.toLocaleString()}`} change={loading ? undefined : analytics.revenueChange} detail="vs previous period" icon={<PhilippinePeso className="h-4 w-4" />} />
        <Metric label="Orders" value={loading ? <Skeleton className="h-8 w-16" /> : analytics.current.length.toLocaleString()} change={loading ? undefined : analytics.orderChange} detail="vs previous period" icon={<ShoppingCart className="h-4 w-4" />} />
        <Metric label="Average order value" value={loading ? <Skeleton className="h-8 w-20" /> : `₱${Math.round(analytics.averageOrder).toLocaleString()}`} detail="Across filtered orders" icon={<Target className="h-4 w-4" />} />
        <Metric label="Completion rate" value={loading ? <Skeleton className="h-8 w-16" /> : `${analytics.completionRate.toFixed(1)}%`} change={loading ? undefined : analytics.completionChange} detail="percentage-point change" icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <Card className="min-w-0 border-border bg-card shadow-sm">
        <CardHeader><CardTitle className="text-base font-black">Revenue and order trend</CardTitle><CardDescription>Historical revenue and order volume across the selected period and filters.</CardDescription></CardHeader>
        <CardContent className="h-80 min-w-0 px-2 sm:px-6">
          {loading ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={320} minWidth={0}><AreaChart data={analytics.trend}><defs><linearGradient id="analyticsRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fdd001" stopOpacity={0.3} /><stop offset="95%" stopColor="#fdd001" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><YAxis yAxisId="revenue" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickFormatter={value => `₱${value >= 1000 ? `${Math.round(value / 1000)}k` : value}`} /><YAxis yAxisId="orders" orientation="right" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--card-foreground)' }} formatter={(value, name) => [name === 'revenue' ? `₱${Number(value ?? 0).toLocaleString()}` : Number(value ?? 0), name === 'revenue' ? 'Revenue' : 'Orders']} /><Area yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#fdd001" strokeWidth={2} fill="url(#analyticsRevenue)" animationDuration={250} /><Area yAxisId="orders" type="monotone" dataKey="orders" stroke="var(--foreground)" strokeWidth={1.75} strokeDasharray="4 4" fill="none" animationDuration={250} /></AreaChart></ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0 border-border bg-card shadow-sm"><CardHeader><CardTitle className="text-base font-black">Regional breakdown</CardTitle><CardDescription>Recognized revenue by delivery region.</CardDescription></CardHeader><CardContent className="h-70 min-w-0">{loading ? <Skeleton className="h-full w-full rounded-xl" /> : analytics.regional.length ? <ResponsiveContainer width="100%" height={280} minWidth={0}><BarChart data={analytics.regional} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--card-foreground)' }} formatter={(value) => [`₱${Number(value ?? 0).toLocaleString()}`, 'Revenue']} /><Bar dataKey="revenue" fill="#fdd001" radius={[0, 6, 6, 0]} animationDuration={250} /></BarChart></ResponsiveContainer> : <Empty />}</CardContent></Card>
        <Card className="min-w-0 border-border bg-card shadow-sm"><CardHeader><CardTitle className="text-base font-black">Fulfillment status</CardTitle><CardDescription>Order volume grouped by workflow stage.</CardDescription></CardHeader><CardContent className="space-y-3">{loading ? [1, 2, 3, 4].map(item => <Skeleton key={item} className="h-8 w-full rounded-lg" />) : <>{analytics.statuses.map(item => { const share = analytics.current.length ? (item.value / analytics.current.length) * 100 : 0; return <div key={item.name}><div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-bold capitalize text-foreground">{item.name}</span><span className="text-xs text-muted-foreground">{item.value} · {share.toFixed(0)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} /></div></div>; })}{analytics.statuses.length === 0 && <Empty />}</>}</CardContent></Card>
      </div>
    </div>
  );
}

function Metric({ label, value, change, detail, icon }: { label: string; value: ReactNode; change?: number; detail: string; icon: ReactNode }) {
  const positive = (change || 0) >= 0;
  return <Card className="border-border bg-card shadow-sm"><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</CardTitle><div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div></CardHeader><CardContent><div className="text-2xl font-black tracking-tight text-foreground">{value}</div><div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">{change !== undefined && <Badge variant="outline" className={`h-5 gap-0.5 px-1 ${positive ? 'text-emerald-600' : 'text-red-500'}`}>{positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(change).toFixed(1)}%</Badge>} {detail}</div></CardContent></Card>;
}

function Empty() { return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No orders match the selected filters.</div>; }
