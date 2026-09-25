import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  User,
  Bell,
  CheckCircle2,
  Edit2,
  CheckCircle,
  Sun,
  Moon,
  ShoppingBag,
  Truck,
  ArrowLeftRight,
  CheckCheck,
  SlidersHorizontal,
  Sparkles,
  Clock,
  Volume2,
  VolumeX,
  Layers,
  Activity
} from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { collection, db, onSnapshot, query, orderBy, limit } from '../lib/supabaseAdapter';
import { Order, Transfer } from '../types';

interface DispatchTrip {
  id: string;
  vehicle_name?: string;
  driver?: string;
  plate?: string;
  region?: string;
  total_units?: number;
  savings_php?: number;
  status?: string;
  dispatched_at?: string | { toDate?: () => Date };
  dispatched_by?: string;
}

interface NotificationItem {
  id: string;
  type: 'order' | 'logistics' | 'transfer';
  title: string;
  description: string;
  timestamp: Date;
  meta?: string;
  statusBadge?: string;
  statusColor?: string;
}

const NOTIF_PREFS_KEY = 'activepro.notification_prefs';
const NOTIF_READ_KEY = 'activepro.read_notifications';

export function Settings() {
  const { profile, updateProfileData } = useAuth();
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  // Raw data collections from Supabase
  const [orders, setOrders] = useState<Order[]>([]);
  const [trips, setTrips] = useState<DispatchTrip[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  // Filter and preference states
  const [activeFilter, setActiveFilter] = useState<'all' | 'order' | 'logistics' | 'transfer'>('all');
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(NOTIF_READ_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [prefs, setPrefs] = useState<{
    orderAlerts: boolean;
    logisticsAlerts: boolean;
    transferAlerts: boolean;
    toastAlerts: boolean;
  }>(() => {
    try {
      const saved = localStorage.getItem(NOTIF_PREFS_KEY);
      return saved ? JSON.parse(saved) : { orderAlerts: true, logisticsAlerts: true, transferAlerts: true, toastAlerts: true };
    } catch {
      return { orderAlerts: true, logisticsAlerts: true, transferAlerts: true, toastAlerts: true };
    }
  });

  const [showPreferences, setShowPreferences] = useState(false);

  // Subscribe to live collections
  useEffect(() => {
    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => {
        setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
      },
      (err) => console.warn('Orders notification subscription failed:', err)
    );

    const unsubTrips = onSnapshot(
      query(collection(db, 'dispatch_trips'), orderBy('dispatched_at', 'desc'), limit(20)),
      (snap) => {
        setTrips(snap.docs.map(d => ({ id: d.id, ...d.data() } as DispatchTrip)));
      },
      (err) => console.warn('Dispatch trips subscription failed:', err)
    );

    const unsubTransfers = onSnapshot(
      query(collection(db, 'transfers'), orderBy('updatedAt', 'desc'), limit(20)),
      (snap) => {
        setTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transfer)));
      },
      (err) => console.warn('Transfers notification subscription failed:', err)
    );

    return () => {
      unsubOrders();
      unsubTrips();
      unsubTransfers();
    };
  }, []);

  // Format date helper
  const parseDate = (val: any): Date => {
    if (!val) return new Date();
    if (typeof val?.toDate === 'function') return val.toDate();
    if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };

  const getRelativeTime = (d: Date): string => {
    const now = Date.now();
    const diff = Math.max(0, now - d.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Compile combined notifications stream
  const allNotifications = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];

    if (prefs.orderAlerts) {
      orders.forEach(o => {
        const date = parseDate(o.createdAt);
        const skuCount = o.skus?.length || 0;
        const totalFormatted = (o.totalAmount || 0).toLocaleString();
        list.push({
          id: `ord-${o.id}`,
          type: 'order',
          title: `Order #${o.orderNumber || o.id.slice(-6)} ${o.status ? `(${o.status.toUpperCase().replace(/_/g, ' ')})` : ''}`,
          description: `${o.clientName || 'Customer'} • ${skuCount > 0 ? `${skuCount} SKU(s)` : 'Sales Order'} • ₱${totalFormatted}`,
          timestamp: date,
          statusBadge: o.status ? o.status.replace(/_/g, ' ') : 'pending',
          statusColor: o.status === 'delivered' || o.status === 'completed'
            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
            : o.status === 'out_for_delivery' || o.status === 'preparing'
            ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
            : 'bg-amber-500/10 text-amber-600 border-amber-500/20',
          meta: o.deliveryCity ? `Delivery: ${o.deliveryCity}` : undefined
        });
      });
    }

    if (prefs.logisticsAlerts) {
      trips.forEach(t => {
        const date = parseDate(t.dispatched_at);
        const savingsFormatted = t.savings_php ? `₱${t.savings_php.toLocaleString()}` : 'Optimized';
        list.push({
          id: `trip-${t.id}`,
          type: 'logistics',
          title: `Fleet Dispatched: ${t.vehicle_name || 'Delivery Truck'}`,
          description: `Driver: ${t.driver || 'Assigned Driver'} • Region: ${t.region || 'Metro Manila'} (${t.total_units || 0} units)`,
          timestamp: date,
          statusBadge: t.status || 'in_transit',
          statusColor: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
          meta: `Savings: ${savingsFormatted}`
        });
      });
    }

    if (prefs.transferAlerts) {
      transfers.forEach(tr => {
        const date = parseDate(tr.updatedAt || tr.dispatchedAt || tr.createdAt);
        list.push({
          id: `tfr-${tr.id}`,
          type: 'transfer',
          title: `Stock Transfer: TFR-${tr.id.slice(-6).toUpperCase()}`,
          description: `${tr.quantity} unit(s) • ${tr.driverName ? `Driver: ${tr.driverName}` : 'Inter-facility Transport'}`,
          timestamp: date,
          statusBadge: tr.status || 'pending',
          statusColor: tr.status === 'received'
            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
            : tr.status === 'in_transit'
            ? 'bg-sky-500/10 text-sky-600 border-sky-500/20'
            : 'bg-amber-500/10 text-amber-600 border-amber-500/20',
          meta: tr.status === 'in_transit' ? 'In Transit' : tr.status === 'received' ? 'Received' : 'Pending'
        });
      });
    }

    return list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [orders, trips, transfers, prefs]);

  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return allNotifications;
    return allNotifications.filter(n => n.type === activeFilter);
  }, [allNotifications, activeFilter]);

  const unreadCount = useMemo(() => {
    return allNotifications.filter(n => !readIds.has(n.id)).length;
  }, [allNotifications, readIds]);

  const markAllAsRead = () => {
    const nextSet = new Set([...readIds, ...allNotifications.map(n => n.id)]);
    setReadIds(nextSet);
    localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(Array.from(nextSet)));
    toast.success('All notifications marked as read');
  };

  const markItemAsRead = (id: string) => {
    if (readIds.has(id)) return;
    const nextSet = new Set(readIds);
    nextSet.add(id);
    setReadIds(nextSet);
    localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(Array.from(nextSet)));
  };

  const togglePref = (key: keyof typeof prefs) => {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(updated));
    toast.success('Notification preferences updated');
  };

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;

    await updateProfileData({
      firstName,
      lastName
    });
    setIsEditProfileOpen(false);
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground font-medium">Manage your personal preferences, live alerts, and system telemetry.</p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-center bg-muted/50 p-1.5 rounded-2xl border border-border">
          <Button
            variant={theme === 'light' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTheme('light')}
            className={`h-8 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${theme === 'light' ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Sun className="w-3.5 h-3.5 mr-2" /> Light
          </Button>
          <Button
            variant={theme === 'dark' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTheme('dark')}
            className={`h-8 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${theme === 'dark' ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Moon className="w-3.5 h-3.5 mr-2" /> Dark
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Card: Account Profile */}
        <Card className="lg:col-span-5 border-border overflow-hidden group hover:border-primary/40 transition-colors h-fit">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-foreground" />
                <CardTitle className="text-xs font-black uppercase tracking-widest">Account Profile</CardTitle>
              </div>
              <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
                <DialogTrigger render={
                  <Button variant="ghost" size="sm" className="h-8 gap-2 text-[10px] font-black uppercase tracking-widest hover:bg-foreground hover:text-background dark:hover:bg-foreground dark:hover:text-background transition-all">
                    <Edit2 className="w-3 h-3" /> Edit Profile
                  </Button>
                } />
                <DialogContent className="rounded-[2.5rem] p-8">
                  <DialogHeader className="mb-6">
                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Edit Identity</DialogTitle>
                    <DialogDescription className="text-muted-foreground font-medium">Update your system identification and avatar node.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleUpdateProfile} className="space-y-6 font-sans">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">First Name</Label>
                        <Input id="firstName" name="firstName" defaultValue={profile?.firstName} required className="rounded-xl border-2 border-border h-12 focus:border-primary transition-all font-bold" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Last Name</Label>
                        <Input id="lastName" name="lastName" defaultValue={profile?.lastName} required className="rounded-xl border-2 border-border h-12 focus:border-primary transition-all font-bold" />
                      </div>
                    </div>

                    <DialogFooter className="pt-4">
                      <Button type="submit" className="w-full h-14 bg-primary text-primary-foreground font-black uppercase tracking-widest text-xs rounded-2xl group">
                        Confirm <CheckCircle className="w-4 h-4 ml-2 group-hover:scale-110 transition-transform" />
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <CardDescription className="text-xs font-medium">System identification and access metadata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-muted border-2 border-border overflow-hidden flex-shrink-0">
                {profile?.photoUrl ? (
                  <img src={profile.photoUrl} alt={profile.displayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center font-black text-xl text-muted-foreground">
                    {profile?.displayName?.charAt(0)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Authenticated Identity</p>
                  <Badge variant="outline" className="text-[9px] uppercase font-black tracking-widest border-border py-0 h-4">{profile?.role}</Badge>
                </div>
                <p className="text-xl font-black text-foreground truncate tracking-tight leading-none">{profile?.displayName || 'N/A'}</p>
                <p className="text-xs font-medium text-muted-foreground mt-1">{profile?.email || 'N/A'}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted/40 p-3 rounded-xl border border-border">
                <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">First Name</p>
                <p className="text-xs font-bold text-foreground">{profile?.firstName || '—'}</p>
              </div>
              <div className="bg-muted/40 p-3 rounded-xl border border-border">
                <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Last Name</p>
                <p className="text-xs font-bold text-foreground">{profile?.lastName || '—'}</p>
              </div>
            </div>

            <div className="pt-4 border-t border-dashed border-border italic text-[10px] text-muted-foreground font-medium flex items-center justify-between">
              <span>Metadata synced via regional cluster.</span>
              <div className="flex items-center gap-1.5 text-emerald-500 font-bold">
                <CheckCircle2 className="w-3 h-3" /> Encrypted
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Card: Live Notifications & Activity Stream */}
        <Card className="lg:col-span-7 border-border overflow-hidden group hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <Bell className="w-4 h-4 text-primary" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                </div>
                <div>
                  <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                    Live System Activity
                    {unreadCount > 0 && (
                      <Badge variant="secondary" className="text-[9px] font-bold px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20">
                        {unreadCount} new
                      </Badge>
                    )}
                  </CardTitle>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreferences(!showPreferences)}
                  className={`h-7 px-2.5 rounded-lg text-[10px] font-bold transition-all ${showPreferences ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  title="Alert Preferences"
                >
                  <SlidersHorizontal className="w-3 h-3 mr-1.5" />
                  Preferences
                </Button>
                {unreadCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={markAllAsRead}
                    className="h-7 px-2.5 rounded-lg text-[10px] font-bold border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                  >
                    <CheckCheck className="w-3 h-3 mr-1.5 text-emerald-500" />
                    Mark all read
                  </Button>
                )}
              </div>
            </div>
            <CardDescription className="text-xs font-medium">
              Real-time operational stream from Order Entry, Fleet Logistics, and Inventory Transfers.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-1">
            {/* Preferences Collapsible Box */}
            {showPreferences && (
              <div className="bg-muted/40 p-4 rounded-2xl border border-border space-y-3 animate-in fade-in-50 duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <p className="text-[10px] font-black uppercase tracking-widest text-foreground flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3 h-3 text-primary" /> Notification Feeds &amp; Alerts
                  </p>
                  <Badge variant="outline" className="text-[8px] font-mono uppercase">Admin Controls</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background/60 hover:bg-background cursor-pointer transition-colors text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <ShoppingBag className="w-3.5 h-3.5 text-emerald-500" /> Sales Orders
                    </span>
                    <input
                      type="checkbox"
                      checked={prefs.orderAlerts}
                      onChange={() => togglePref('orderAlerts')}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background/60 hover:bg-background cursor-pointer transition-colors text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <Truck className="w-3.5 h-3.5 text-indigo-500" /> Fleet Dispatches
                    </span>
                    <input
                      type="checkbox"
                      checked={prefs.logisticsAlerts}
                      onChange={() => togglePref('logisticsAlerts')}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background/60 hover:bg-background cursor-pointer transition-colors text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <ArrowLeftRight className="w-3.5 h-3.5 text-sky-500" /> Warehouse Transfers
                    </span>
                    <input
                      type="checkbox"
                      checked={prefs.transferAlerts}
                      onChange={() => togglePref('transferAlerts')}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background/60 hover:bg-background cursor-pointer transition-colors text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      {prefs.toastAlerts ? <Volume2 className="w-3.5 h-3.5 text-amber-500" /> : <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />} Toast Notifications
                    </span>
                    <input
                      type="checkbox"
                      checked={prefs.toastAlerts}
                      onChange={() => togglePref('toastAlerts')}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {[
                { id: 'all', label: 'All Activity', icon: Layers, count: allNotifications.length },
                { id: 'order', label: 'Orders', icon: ShoppingBag, count: allNotifications.filter(n => n.type === 'order').length },
                { id: 'logistics', label: 'Logistics', icon: Truck, count: allNotifications.filter(n => n.type === 'logistics').length },
                { id: 'transfer', label: 'Transfers', icon: ArrowLeftRight, count: allNotifications.filter(n => n.type === 'transfer').length },
              ].map(tab => (
                <Button
                  key={tab.id}
                  variant={activeFilter === tab.id ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveFilter(tab.id as any)}
                  className={`h-7 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 flex-shrink-0 ${
                    activeFilter === tab.id ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground bg-muted/30'
                  }`}
                >
                  <tab.icon className="w-3 h-3" />
                  {tab.label}
                  <span className={`ml-1 text-[9px] px-1 py-0.2 rounded-md ${activeFilter === tab.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {tab.count}
                  </span>
                </Button>
              ))}
            </div>

            {/* Scrollable Notification Stream */}
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {filteredNotifications.length > 0 ? (
                filteredNotifications.map(item => {
                  const isRead = readIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => markItemAsRead(item.id)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer relative group ${
                        isRead
                          ? 'bg-muted/20 border-border opacity-75 hover:opacity-100 hover:border-primary/30'
                          : 'bg-card border-border hover:border-primary/40 shadow-xs'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`p-2 rounded-xl flex-shrink-0 mt-0.5 ${
                            item.type === 'order'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : item.type === 'logistics'
                              ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                              : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                          }`}>
                            {item.type === 'order' ? (
                              <ShoppingBag className="w-4 h-4" />
                            ) : item.type === 'logistics' ? (
                              <Truck className="w-4 h-4" />
                            ) : (
                              <ArrowLeftRight className="w-4 h-4" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={`text-xs font-bold leading-tight ${isRead ? 'text-foreground' : 'text-foreground font-black'}`}>
                                {item.title}
                              </p>
                              {item.statusBadge && (
                                <Badge variant="outline" className={`text-[8px] uppercase font-black px-1.5 py-0 h-4 border ${item.statusColor}`}>
                                  {item.statusBadge}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground font-medium mt-1 leading-normal">
                              {item.description}
                            </p>
                            {item.meta && (
                              <p className="text-[10px] text-muted-foreground/80 font-mono mt-1 font-semibold flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5 text-primary" /> {item.meta}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end flex-shrink-0">
                          <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {getRelativeTime(item.timestamp)}
                          </span>
                          {!isRead && (
                            <span className="w-2 h-2 rounded-full bg-primary mt-1.5 animate-pulse" title="Unread" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center rounded-2xl border border-dashed border-border bg-muted/10 space-y-2">
                  <Activity className="w-8 h-8 mx-auto text-muted-foreground/40" />
                  <p className="text-xs font-bold text-foreground">No Activity Found</p>
                  <p className="text-[11px] text-muted-foreground">
                    {activeFilter === 'all'
                      ? 'No recent operational events detected. Check your notification feed preferences above.'
                      : `No notifications found under the ${activeFilter} category.`}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

