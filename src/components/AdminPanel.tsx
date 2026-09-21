import { hasAdminRole } from '../lib/staffPermissions';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, db, getDocs } from '../lib/supabaseAdapter';
import { InventoryItem, Order, Product, Transfer } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '../hooks/useAuth';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock3, Package, PhilippinePeso, RefreshCw, ShoppingCart, Truck } from 'lucide-react';

const toDate = (value: any) => {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isToday = (value: any) => {
  const date = toDate(value);
  if (!date) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
};

export function AdminPanel() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const loadOverview = async () => {
    if (!hasAdminRole(profile)) return;
    setLoading(true);
    setLoadError(false);
    try {
      const [ordersSnap, productsSnap, inventorySnap, transfersSnap] = await Promise.all([
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'products')),
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'transfers')),
      ]);
      setOrders(ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
      setProducts(productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
      setInventory(inventorySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
      setTransfers(transfersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transfer)));
      setLastChecked(new Date());
    } catch (error) {
      setLoadError(true);
      handleSupabaseError(error, OperationType.GET, 'admin_overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOverview(); }, [profile?.role]);

  const overview = useMemo(() => {
    const todaysOrders = orders.filter(order => isToday(order.createdAt));
    const todaysRevenue = todaysOrders.filter(order => ['completed', 'delivered'].includes(order.status)).reduce((total, order) => total + (order.totalAmount || 0), 0);
    const stockByProduct = new Map<string, number>();
    inventory.forEach(item => stockByProduct.set(item.productId, (stockByProduct.get(item.productId) || 0) + Number(item.quantity || 0)));
    const stockAlerts = products.map(product => ({ product, quantity: stockByProduct.get(product.id) || 0 }))
      .filter(({ product, quantity }) => quantity <= Number(product.reorderPoint || 0)).sort((a, b) => a.quantity - b.quantity);
    const pendingOrders = orders.filter(order => ['pending', 'preparing', 'escalated'].includes(order.status));
    const pendingTransfers = transfers.filter(transfer => ['pending', 'in_transit'].includes(transfer.status));
    const overdueOrders = orders.filter(order => {
      const deadline = toDate(order.deliveryDeadline);
      return deadline && deadline < new Date() && !['completed', 'delivered'].includes(order.status);
    });
    return {
      todaysOrders, todaysRevenue, stockAlerts, pendingOrders, pendingTransfers, overdueOrders,
      pendingActions: pendingOrders.length + pendingTransfers.length + overdueOrders.length
    };
  }, [inventory, orders, products, transfers]);

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-32 rounded-2xl" />)}</div>
      <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mt-1 text-sm text-muted-foreground">Today’s operational pulse for Active Pro inventory and fulfillment.</p>
        </div>
        <button type="button" onClick={loadOverview} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Orders today" value={overview.todaysOrders.length.toLocaleString()} detail="New fulfillment requests" icon={<ShoppingCart className="h-4 w-4 text-primary" />} />
        <MetricCard label="Revenue today" value={`₱${overview.todaysRevenue.toLocaleString()}`} detail="Completed and delivered orders" icon={<PhilippinePeso className="h-4 w-4 text-emerald-600" />} />
        <MetricCard label="Inventory alerts" value={overview.stockAlerts.length.toLocaleString()} detail="Products at or below reorder point" icon={<Package className="h-4 w-4 text-amber-600" />} alert={overview.stockAlerts.length > 0} />
        <MetricCard label="Pending actions" value={overview.pendingActions.toLocaleString()} detail="Orders, transfers, and overdue items" icon={<Clock3 className="h-4 w-4 text-blue-500" />} alert={overview.overdueOrders.length > 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div><CardTitle className="text-base font-black">Urgent inventory alerts</CardTitle><CardDescription>Stock requiring the admin team’s attention.</CardDescription></div>
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">{overview.stockAlerts.length} open</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.stockAlerts.slice(0, 5).map(({ product, quantity }) => (
              <div key={product.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10"><AlertTriangle className="h-4 w-4 text-amber-600" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{product.name}</p><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">SKU {product.sku}</p></div>
                <div className="text-right"><p className={`text-sm font-black ${quantity === 0 ? 'text-red-500' : 'text-amber-600'}`}>{quantity} in stock</p><p className="text-[10px] text-muted-foreground">Reorder at {product.reorderPoint}</p></div>
              </div>
            ))}
            {overview.stockAlerts.length === 0 && <EmptyState label="Inventory levels are currently healthy." />}
            <Link to="/inventory" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Review inventory <ArrowRight className="h-3 w-3" /></Link>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardHeader><CardTitle className="text-base font-black">Pending actions</CardTitle><CardDescription>Work queues that may need follow-up today.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <ActionRow icon={<ShoppingCart className="h-4 w-4" />} label="Orders awaiting action" value={overview.pendingOrders.length} href="/orders" />
            <ActionRow icon={<Truck className="h-4 w-4" />} label="Open stock transfers" value={overview.pendingTransfers.length} href="/transfers" />
            <ActionRow icon={<AlertTriangle className="h-4 w-4" />} label="Overdue deliveries" value={overview.overdueOrders.length} href="/orders" urgent={overview.overdueOrders.length > 0} />
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
            <Badge className={loadError ? 'bg-red-500/10 text-red-500 hover:bg-red-500/10' : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10'}>{loadError ? 'Attention required' : 'All systems operational'}</Badge>
            {lastChecked && <p className="mt-1 text-[10px] text-muted-foreground">Checked {lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value, detail, icon, alert = false }: { label: string; value: string; detail: string; icon: React.ReactNode; alert?: boolean }) {
  return <Card className={`border-border bg-card shadow-sm ${alert ? 'ring-1 ring-amber-500/20' : ''}`}><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</CardTitle><div className="rounded-lg bg-muted p-2">{icon}</div></CardHeader><CardContent><div className="text-2xl font-black tracking-tight text-foreground">{value}</div><p className="mt-1 text-[10px] font-medium text-muted-foreground">{detail}</p></CardContent></Card>;
}

function ActionRow({ icon, label, value, href, urgent = false }: { icon: React.ReactNode; label: string; value: number; href: string; urgent?: boolean }) {
  return <Link to={href} className="group flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/60"><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${urgent ? 'bg-red-500/10 text-red-500' : 'bg-primary/10 text-primary'}`}>{icon}</div><span className="flex-1 text-sm font-bold text-foreground">{label}</span><Badge variant="outline" className={urgent ? 'border-red-500/30 text-red-500' : ''}>{value}</Badge><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Link>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {label}</div>;
}
