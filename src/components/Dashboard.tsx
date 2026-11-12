import { PageHeading } from './PageHeading';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, db, getDocs } from '../lib/supabaseAdapter';
import { escapeCsvCell } from '../lib/exportUtils';
import { Order } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDownRightIcon as ArrowDownRight, ArrowUpRightIcon as ArrowUpRight, ChartBarIcon as BarChart3, DownloadIcon as Download, FunnelIcon as Filter, CoinsIcon as PhilippinePeso, ShoppingCartIcon as ShoppingCart, TargetIcon as Target, WarningIcon as AlertTriangle } from '@phosphor-icons/react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type RangeOption = '7' | '30' | 'custom';

const toDate = (value: any) => {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

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
  const [orders, setOrders] = useState<Order[]>([]);
  const [rangeType, setRangeType] = useState<RangeOption>('30');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return formatLocalDateInput(d);
  });
  const [customEnd, setCustomEnd] = useState(() => formatLocalDateInput(new Date()));
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const mountedRef = useRef(true);
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

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const snapshot = await getDocs(collection(db, 'orders'));
      if (!mountedRef.current) return;
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(true);
      handleSupabaseError(error, OperationType.GET, 'analytics_orders');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
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

    const matchesDimensions = (order: Order) => {
      const matchesRegion = region === 'all'
        || order.deliveryRegion === region
        || (region === 'Luzon' && order.deliveryRegion === 'Provincial Luzon');
      const matchesStatus = status === 'all' || order.status === status;
      return matchesRegion && matchesStatus;
    };
    const current = orders.filter(order => {
      const date = toDate(order.createdAt);
      return date && date >= start && date <= end && matchesDimensions(order);
    });
    const previous = orders.filter(order => {
      const date = toDate(order.createdAt);
      return date && date >= previousStart && date < start && matchesDimensions(order);
    });
    const recognizedRevenue = (items: Order[]) => items.filter(order => ['completed', 'delivered'].includes(order.status)).reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const revenue = recognizedRevenue(current);
    const previousRevenue = recognizedRevenue(previous);
    const completionRate = current.length ? (current.filter(order => ['completed', 'delivered'].includes(order.status)).length / current.length) * 100 : 0;
    const previousCompletionRate = previous.length ? (previous.filter(order => ['completed', 'delivered'].includes(order.status)).length / previous.length) * 100 : 0;
    const change = (value: number, oldValue: number) => oldValue === 0 ? (value > 0 ? 100 : 0) : ((value - oldValue) / oldValue) * 100;

    const diffDays = dayCount;
    let bucketCount = 10;
    if (diffDays <= 7) bucketCount = diffDays;
    else if (diffDays <= 14) bucketCount = diffDays;
    else if (diffDays <= 31) bucketCount = 10;
    else bucketCount = 12;

    const durationMs = Math.max(1, end.getTime() - start.getTime());
    const bucketMs = durationMs / bucketCount;
    const trend = Array.from({ length: bucketCount }, (_, index) => {
      const isDaily = bucketCount === dayCount;
      const bucketStart = isDaily
        ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 0, 0, 0, 0)
        : new Date(start.getTime() + index * bucketMs);
      const bucketEnd = isDaily
        ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + index + 1, 0, 0, 0, 0)
        : new Date(start.getTime() + (index + 1) * bucketMs);
      const bucketOrders = current.filter(order => {
        const date = toDate(order.createdAt);
        return date && date >= bucketStart && (!isDaily && index === bucketCount - 1 ? date <= bucketEnd : date < bucketEnd);
      });
      return {
        name: bucketStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        revenue: recognizedRevenue(bucketOrders),
        orders: bucketOrders.length,
      };
    });

    const regionMap = new Map<string, { orders: number; revenue: number }>();
    current.forEach(order => {
      const key = order.deliveryRegion || 'Unassigned';
      const item = regionMap.get(key) || { orders: 0, revenue: 0 };
      item.orders += 1;
      if (['completed', 'delivered'].includes(order.status)) item.revenue += Number(order.totalAmount || 0);
      regionMap.set(key, item);
    });
    const regional = Array.from(regionMap, ([name, values]) => ({ name, ...values })).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

    const statusMap = new Map<string, number>();
    current.forEach(order => statusMap.set(order.status, (statusMap.get(order.status) || 0) + 1));
    const statuses = Array.from(statusMap, ([name, value]) => ({ name: name.replaceAll('_', ' '), value })).sort((a, b) => b.value - a.value);

    return {
      current, revenue, completionRate, trend, regional, statuses,
      revenueChange: change(revenue, previousRevenue),
      orderChange: change(current.length, previous.length),
      completionChange: completionRate - previousCompletionRate,
      averageOrder: current.length ? current.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0) / current.length : 0,
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

  if (loading) return <div className="space-y-6"><Skeleton className="h-24 rounded-2xl" /><div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
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
            disabled={analytics.current.length === 0}
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
            onClick={() => void loadOrders()}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-bold hover:bg-muted cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Recognized revenue" value={`₱${analytics.revenue.toLocaleString()}`} change={analytics.revenueChange} detail="vs previous period" icon={<PhilippinePeso className="h-4 w-4" />} />
        <Metric label="Orders" value={analytics.current.length.toLocaleString()} change={analytics.orderChange} detail="vs previous period" icon={<ShoppingCart className="h-4 w-4" />} />
        <Metric label="Average order value" value={`₱${Math.round(analytics.averageOrder).toLocaleString()}`} detail="Across filtered orders" icon={<Target className="h-4 w-4" />} />
        <Metric label="Completion rate" value={`${analytics.completionRate.toFixed(1)}%`} change={analytics.completionChange} detail="percentage-point change" icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader><CardTitle className="text-base font-black">Revenue and order trend</CardTitle><CardDescription>Historical revenue and order volume across the selected period and filters.</CardDescription></CardHeader>
        <CardContent className="h-80 px-2 sm:px-6">
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics.trend}><defs><linearGradient id="analyticsRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fdd001" stopOpacity={0.3} /><stop offset="95%" stopColor="#fdd001" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><YAxis yAxisId="revenue" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickFormatter={value => `₱${value >= 1000 ? `${Math.round(value / 1000)}k` : value}`} /><YAxis yAxisId="orders" orientation="right" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--card-foreground)' }} formatter={(value, name) => [name === 'revenue' ? `₱${Number(value ?? 0).toLocaleString()}` : Number(value ?? 0), name === 'revenue' ? 'Revenue' : 'Orders']} /><Area yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#fdd001" strokeWidth={2} fill="url(#analyticsRevenue)" /><Area yAxisId="orders" type="monotone" dataKey="orders" stroke="var(--foreground)" strokeWidth={1.75} strokeDasharray="4 4" fill="none" /></AreaChart></ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-sm"><CardHeader><CardTitle className="text-base font-black">Regional breakdown</CardTitle><CardDescription>Recognized revenue by delivery region.</CardDescription></CardHeader><CardContent className="h-70">{analytics.regional.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.regional} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--card-foreground)' }} formatter={(value) => [`₱${Number(value ?? 0).toLocaleString()}`, 'Revenue']} /><Bar dataKey="revenue" fill="#fdd001" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer> : <Empty />}</CardContent></Card>
        <Card className="border-border bg-card shadow-sm"><CardHeader><CardTitle className="text-base font-black">Fulfillment status</CardTitle><CardDescription>Order volume grouped by workflow stage.</CardDescription></CardHeader><CardContent className="space-y-3">{analytics.statuses.map(item => { const share = analytics.current.length ? (item.value / analytics.current.length) * 100 : 0; return <div key={item.name}><div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-bold capitalize text-foreground">{item.name}</span><span className="text-xs text-muted-foreground">{item.value} · {share.toFixed(0)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} /></div></div>; })}{analytics.statuses.length === 0 && <Empty />}</CardContent></Card>
      </div>
    </div>
  );
}

function Metric({ label, value, change, detail, icon }: { label: string; value: string; change?: number; detail: string; icon: React.ReactNode }) {
  const positive = (change || 0) >= 0;
  return <Card className="border-border bg-card shadow-sm"><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</CardTitle><div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div></CardHeader><CardContent><div className="text-2xl font-black tracking-tight text-foreground">{value}</div><div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">{change !== undefined && <Badge variant="outline" className={`h-5 gap-0.5 px-1 ${positive ? 'text-emerald-600' : 'text-red-500'}`}>{positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(change).toFixed(1)}%</Badge>} {detail}</div></CardContent></Card>;
}

function Empty() { return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No orders match the selected filters.</div>; }
