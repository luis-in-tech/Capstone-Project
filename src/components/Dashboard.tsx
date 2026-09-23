import { useEffect, useMemo, useState } from 'react';
import { collection, db, getDocs } from '../lib/supabaseAdapter';
import { Order } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDownRight, ArrowUpRight, BarChart3, Download, Filter, PhilippinePeso, ShoppingCart, Target } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type RangeDays = 7 | 30 | 90;

const toDate = (value: any) => {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'orders'));
        setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
      } catch (error) {
        handleSupabaseError(error, OperationType.GET, 'analytics_orders');
      } finally {
        setLoading(false);
      }
    };
    loadOrders();
  }, []);

  const regions = useMemo(() => Array.from(new Set(orders.map(order => order.deliveryRegion).filter(Boolean))).sort(), [orders]);

  const analytics = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - rangeDays + 1);
    start.setHours(0, 0, 0, 0);
    const previousStart = new Date(start);
    previousStart.setDate(start.getDate() - rangeDays);

    const matchesDimensions = (order: Order) => (region === 'all' || order.deliveryRegion === region) && (status === 'all' || order.status === status);
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

    const bucketCount = rangeDays === 7 ? 7 : rangeDays === 30 ? 10 : 12;
    const bucketSize = Math.ceil(rangeDays / bucketCount);
    const trend = Array.from({ length: bucketCount }, (_, index) => {
      const bucketStart = new Date(start);
      bucketStart.setDate(start.getDate() + index * bucketSize);
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketStart.getDate() + bucketSize);
      const bucketOrders = current.filter(order => {
        const date = toDate(order.createdAt);
        return date && date >= bucketStart && date < bucketEnd;
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
  }, [orders, rangeDays, region, status]);

  const downloadReport = () => {
    const headers = ['Order Number', 'Created At', 'Client', 'Region', 'Status', 'Payment Status', 'Amount'];
    const rows = analytics.current.map(order => [order.orderNumber, toDate(order.createdAt)?.toISOString() || '', order.clientName, order.deliveryRegion, order.status, order.paymentStatus, order.totalAmount]);
    const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `active-pro-analytics-${rangeDays}-days.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="space-y-6"><Skeleton className="h-24 rounded-2xl" /><div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mt-1 text-sm text-muted-foreground">Historical order and revenue analysis for Active Pro operations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3"><Filter className="h-3.5 w-3.5 text-muted-foreground" /><select aria-label="Date range" value={rangeDays} onChange={event => setRangeDays(Number(event.target.value) as RangeDays)} className="h-9 bg-transparent text-xs font-bold outline-none"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></div>
          <select aria-label="Delivery region" value={region} onChange={event => setRegion(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-bold outline-none"><option value="all">All regions</option>{regions.map(item => <option key={item} value={item}>{item}</option>)}</select>
          <select aria-label="Order status" value={status} onChange={event => setStatus(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-bold capitalize outline-none"><option value="all">All statuses</option>{['pending', 'preparing', 'out_for_delivery', 'delivered', 'completed', 'escalated'].map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select>
          <button type="button" onClick={downloadReport} disabled={analytics.current.length === 0} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Recognized revenue" value={`₱${analytics.revenue.toLocaleString()}`} change={analytics.revenueChange} detail="vs previous period" icon={<PhilippinePeso className="h-4 w-4" />} />
        <Metric label="Orders" value={analytics.current.length.toLocaleString()} change={analytics.orderChange} detail="vs previous period" icon={<ShoppingCart className="h-4 w-4" />} />
        <Metric label="Average order value" value={`₱${Math.round(analytics.averageOrder).toLocaleString()}`} detail="Across filtered orders" icon={<Target className="h-4 w-4" />} />
        <Metric label="Completion rate" value={`${analytics.completionRate.toFixed(1)}%`} change={analytics.completionChange} detail="percentage-point change" icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader><CardTitle className="text-base font-black">Revenue and order trend</CardTitle><CardDescription>Historical movement across the selected period and filters.</CardDescription></CardHeader>
        <CardContent className="h-[320px] px-2 sm:px-6">
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics.trend}><defs><linearGradient id="analyticsRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fdd001" stopOpacity={0.3} /><stop offset="95%" stopColor="#fdd001" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickFormatter={value => `₱${value >= 1000 ? `${Math.round(value / 1000)}k` : value}`} /><Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--card-foreground)' }} formatter={(value: number, name: string) => [name === 'revenue' ? `₱${value.toLocaleString()}` : value, name]} /><Area type="monotone" dataKey="revenue" stroke="#fdd001" strokeWidth={2} fill="url(#analyticsRevenue)" /></AreaChart></ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-sm"><CardHeader><CardTitle className="text-base font-black">Regional breakdown</CardTitle><CardDescription>Recognized revenue by delivery region.</CardDescription></CardHeader><CardContent className="h-[280px]">{analytics.regional.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.regional} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--card-foreground)' }} formatter={(value: number) => [`₱${value.toLocaleString()}`, 'Revenue']} /><Bar dataKey="revenue" fill="#fdd001" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer> : <Empty />}</CardContent></Card>
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
