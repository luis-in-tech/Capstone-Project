import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PageHeading } from './PageHeading';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  UserIcon as User,
  BellIcon as Bell,
  CheckCircleIcon as CheckCircle2,
  PencilSimpleIcon as Edit2,
  CheckCircleIcon as CheckCircle,
  SunIcon as Sun,
  MoonIcon as Moon,
  ShoppingBagIcon as ShoppingBag,
  TruckIcon as Truck,
  ArrowsLeftRightIcon as ArrowLeftRight,
  ChecksIcon as CheckCheck,
  SlidersHorizontalIcon as SlidersHorizontal,
  SparkleIcon as Sparkles,
  ClockIcon as Clock,
  SpeakerHighIcon as Volume2,
  SpeakerSlashIcon as VolumeX,
  StackIcon as Layers,
  PulseIcon as Activity,
  StackIcon as Boxes,
  GraphIcon as Network,
  DatabaseIcon as Database,
  DownloadIcon as Download,
  CaretDownIcon as ChevronDown,
  PackageIcon as Package,
  CurrencyDollarIcon as DollarSign,
  FileXlsIcon as FileSpreadsheet,
  SpinnerGapIcon as Loader2
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { useTheme } from './ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { formatNotificationRelativeTime, useAdminNotifications } from '../hooks/useStaffAccess';
import { hasAdminRole } from '../lib/staffPermissions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { collection, db, getDocs } from '../lib/supabaseAdapter';

const safeReadStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeWriteStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
};

export function Settings() {
  const { profile, updateProfileData } = useAuth();
  const isAdmin = hasAdminRole(profile);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const { theme, setTheme } = useTheme();

  const [fulfillmentStrategy, setFulfillmentStrategy] = useState<'FIFO'|'LIFO'>(
    () => (safeReadStorage('activepro.fulfillment_strategy') === 'LIFO' ? 'LIFO' : 'FIFO')
  );

  useEffect(() => {
    const syncStrategy = () => {
      setFulfillmentStrategy(safeReadStorage('activepro.fulfillment_strategy') === 'LIFO' ? 'LIFO' : 'FIFO');
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

  const handleStrategyChange = (val: 'FIFO'|'LIFO') => {
    setFulfillmentStrategy(val);
    safeWriteStorage('activepro.fulfillment_strategy', val);
    window.dispatchEvent(new CustomEvent('activepro_fulfillment_strategy_changed', { detail: { strategy: val } }));
    toast.success(`Fulfillment Strategy updated to ${val}`);
  };

  const exportTimersRef = useRef<Map<number, string | undefined>>(new Map());
  useEffect(() => {
    return () => {
      exportTimersRef.current.forEach((blobUrl, timerId) => {
        window.clearTimeout(timerId);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      });
      exportTimersRef.current.clear();
    };
  }, []);

  const [isExporting, setIsExporting] = useState(false);

  const handleExportBackup = async (target: 'all-xlsx' | 'all-csv' | 'products' | 'orders' | 'expenses' | 'transfers') => {
    if (!isAdmin) {
      toast.error('Administrator access required for database backups.');
      return;
    }
    setIsExporting(true);
    toast.info('Preparing live database backup...');

    try {
      const dateStr = new Date().toISOString().split('T')[0];

      const escapeField = (val: unknown): string => {
        if (val === undefined || val === null) return '""';
        let str = '';
        if (typeof val === 'object') {
          if (typeof (val as any).toDate === 'function') {
            str = (val as any).toDate().toISOString();
          } else {
            str = JSON.stringify(val);
          }
        } else {
          str = String(val);
        }
        if (/^[=+\-@\t\r]/.test(str)) {
          str = `'${str}`;
        }
        return `"${str.replace(/"/g, '""')}"`;
      };

      const downloadCsv = (name: string, headers: string[], rows: string[][]) => {
        const csvContent = '\uFEFF' + [headers.map(escapeField).join(','), ...rows.map(r => r.join(','))].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name}_${dateStr}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        const timerId = window.setTimeout(() => {
          URL.revokeObjectURL(url);
          exportTimersRef.current.delete(timerId);
        }, 60000);
        exportTimersRef.current.set(timerId, url);
      };

      const sanitizeExcelCell = (val: unknown): string | number | boolean => {
        if (val === undefined || val === null) return '';
        if (typeof val === 'number') return Number.isFinite(val) ? val : '';
        if (typeof val === 'boolean') return val;
        let str = '';
        if (typeof val === 'object') {
          str = typeof (val as any).toDate === 'function'
            ? (val as any).toDate().toISOString()
            : JSON.stringify(val);
        } else {
          str = String(val);
        }
        return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      };

      const serializeCollection = (snap: any, defaultHeaders: string[]) => {
        if (snap.docs.length > 0) {
          const docKeys = (Array.from(new Set(snap.docs.flatMap((d: any) => Object.keys(d.data())))) as string[])
            .filter((k) => k !== 'id');
          const headers = ['id', ...docKeys];
          const rows = snap.docs.map((d: any) => {
            const data = d.data();
            return [escapeField(d.id), ...docKeys.map(k => escapeField(data[k]))];
          });
          const rawData = snap.docs.map((d: any) => {
            const data = d.data();
            const cleanRow: Record<string, string | number | boolean> = { id: sanitizeExcelCell(d.id) };
            docKeys.forEach(k => {
              cleanRow[k] = sanitizeExcelCell(data[k]);
            });
            return cleanRow;
          });
          return {
            headers,
            rows,
            count: snap.docs.length,
            rawData,
          };
        } else {
          return {
            headers: defaultHeaders,
            rows: [] as string[][],
            count: 0,
            rawData: [] as Record<string, string | number | boolean>[],
          };
        }
      };

      if (target === 'products') {
        const snap = await getDocs(collection(db, 'products'));
        const { headers, rows, count } = serializeCollection(
          snap,
          ['id', 'name', 'sku', 'category', 'supplier', 'basePrice', 'costPrice', 'quantity', 'reorderPoint', 'status', 'createdAt']
        );
        downloadCsv('products_cmdb_backup', headers, rows);
        toast.success(`Products CMDB exported (${count.toLocaleString()} records).`);
      } else if (target === 'orders') {
        const snap = await getDocs(collection(db, 'orders'));
        const { headers, rows, count } = serializeCollection(
          snap,
          ['id', 'orderNumber', 'clientName', 'clientId', 'deliveryRegion', 'deliveryCity', 'status', 'paymentStatus', 'totalAmount', 'stockReserved', 'createdAt']
        );
        downloadCsv('orders_ledger_backup', headers, rows);
        toast.success(`Orders Ledger exported (${count.toLocaleString()} records).`);
      } else if (target === 'expenses') {
        const snap = await getDocs(collection(db, 'expenses'));
        const { headers, rows, count } = serializeCollection(
          snap,
          ['id', 'category', 'amount', 'description', 'date', 'type', 'recordedBy', 'createdAt']
        );
        downloadCsv('financial_expenses_backup', headers, rows);
        toast.success(`Financial Expenses exported (${count.toLocaleString()} records).`);
      } else if (target === 'transfers') {
        const snap = await getDocs(collection(db, 'transfers'));
        const { headers, rows, count } = serializeCollection(
          snap,
          ['id', 'manifestId', 'sourceWarehouseId', 'destinationWarehouseId', 'productId', 'quantity', 'status', 'driverName', 'vehiclePlate', 'initiatedBy', 'createdAt']
        );
        downloadCsv('transfers_backup', headers, rows);
        toast.success(`Transfers Ledger exported (${count.toLocaleString()} records).`);
      } else if (target === 'all-xlsx') {
        const [prodSnap, ordSnap, expSnap, trfSnap] = await Promise.all([
          getDocs(collection(db, 'products')),
          getDocs(collection(db, 'orders')),
          getDocs(collection(db, 'expenses')),
          getDocs(collection(db, 'transfers')),
        ]);

        const prod = serializeCollection(prodSnap, ['id', 'name', 'sku', 'category', 'supplier', 'basePrice', 'costPrice', 'quantity', 'status']);
        const ord = serializeCollection(ordSnap, ['id', 'orderNumber', 'clientName', 'deliveryRegion', 'status', 'paymentStatus', 'totalAmount']);
        const exp = serializeCollection(expSnap, ['id', 'category', 'amount', 'description', 'date', 'type']);
        const trf = serializeCollection(trfSnap, ['id', 'manifestId', 'sourceWarehouseId', 'destinationWarehouseId', 'productId', 'quantity', 'status']);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prod.rawData, { header: prod.headers }), 'Products CMDB');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ord.rawData, { header: ord.headers }), 'Orders Ledger');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exp.rawData, { header: exp.headers }), 'Financial Expenses');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trf.rawData, { header: trf.headers }), 'Transfers');

        XLSX.writeFile(wb, `activepro_database_full_backup_${dateStr}.xlsx`);
        toast.success('Complete database exported as a single Excel workbook (.xlsx).');
      } else if (target === 'all-csv') {
        const [prodSnap, ordSnap, expSnap, trfSnap] = await Promise.all([
          getDocs(collection(db, 'products')),
          getDocs(collection(db, 'orders')),
          getDocs(collection(db, 'expenses')),
          getDocs(collection(db, 'transfers')),
        ]);

        const configs = [
          { name: 'products_cmdb_backup', ...serializeCollection(prodSnap, ['id', 'name', 'sku']) },
          { name: 'orders_ledger_backup', ...serializeCollection(ordSnap, ['id', 'orderNumber', 'clientName']) },
          { name: 'financial_expenses_backup', ...serializeCollection(expSnap, ['id', 'category', 'amount']) },
          { name: 'transfers_backup', ...serializeCollection(trfSnap, ['id', 'manifestId', 'quantity']) },
        ];

        configs.forEach((cfg, idx) => {
          const timerId = window.setTimeout(() => {
            exportTimersRef.current.delete(timerId);
            downloadCsv(cfg.name, cfg.headers, cfg.rows);
          }, idx * 250);
          exportTimersRef.current.set(timerId, undefined);
        });
        toast.success('All 4 CSV backups generated and downloaded.');
      }
    } catch (err) {
      console.error('Export backup failed:', err);
      toast.error('Failed to export database backup.');
    } finally {
      setIsExporting(false);
    }
  };

  const {
    allNotifications,
    unreadCount,
    readIds,
    prefs,
    markItemAsRead,
    markAllAsRead,
    togglePref,
  } = useAdminNotifications();

  // Filter and preference panel states
  const [activeFilter, setActiveFilter] = useState<'all' | 'order' | 'logistics' | 'transfer' | 'movement' | 'supply_chain'>('all');
  const [showPreferences, setShowPreferences] = useState(false);

  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return allNotifications;
    return allNotifications.filter(n => n.type === activeFilter);
  }, [allNotifications, activeFilter]);

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSavingProfile) return;
    const formData = new FormData(e.currentTarget);
    const firstName = String(formData.get('firstName') ?? '').trim();
    const lastName = String(formData.get('lastName') ?? '').trim();

    if (!firstName || !lastName) {
      toast.error('First and last name are required.');
      return;
    }

    setIsSavingProfile(true);
    try {
      await updateProfileData({
        firstName,
        lastName
      });
      setIsEditProfileOpen(false);
    } catch {
      // Error surfaced via handleSupabaseError inside updateProfileData
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <PageHeading
          title="Settings"
          subtitle="Manage your personal preferences, live alerts, and system telemetry."
        />
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
        <Card className={cn("border-border overflow-hidden group hover:border-primary/40 transition-colors h-fit", isAdmin ? "lg:col-span-5" : "lg:col-span-12")}>
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
                      <Button type="submit" disabled={isSavingProfile} className="w-full h-14 bg-primary text-primary-foreground font-black uppercase tracking-widest text-xs rounded-2xl group">
                        {isSavingProfile ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                        ) : (
                          <>Confirm <CheckCircle className="w-4 h-4 ml-2 group-hover:scale-110 transition-transform" /></>
                        )}
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
              <div className="h-16 w-16 rounded-2xl bg-muted border-2 border-border overflow-hidden shrink-0">
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

        {/* Right Card: Live Notifications & Activity Stream (Admin only) */}
        {isAdmin && (
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
                      <Boxes className="w-3.5 h-3.5 text-purple-500" /> Inventory Movements
                    </span>
                    <input
                      type="checkbox"
                      checked={prefs.movementAlerts}
                      onChange={() => togglePref('movementAlerts')}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background/60 hover:bg-background cursor-pointer transition-colors text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <Network className="w-3.5 h-3.5 text-amber-500" /> Supply Chain &amp; Security
                    </span>
                    <input
                      type="checkbox"
                      checked={prefs.supplyChainAlerts}
                      onChange={() => togglePref('supplyChainAlerts')}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background/60 hover:bg-background cursor-pointer transition-colors text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      {prefs.toastAlerts ? <Volume2 className="w-3.5 h-3.5 text-emerald-500" /> : <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />} Toast Notifications
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
                { id: 'movement', label: 'Movements', icon: Boxes, count: allNotifications.filter(n => n.type === 'movement').length },
                { id: 'supply_chain', label: 'Supply Chain', icon: Network, count: allNotifications.filter(n => n.type === 'supply_chain').length },
              ].map(tab => (
                <Button
                  key={tab.id}
                  variant={activeFilter === tab.id ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveFilter(tab.id as any)}
                  className={`h-7 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shrink-0 ${activeFilter === tab.id ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground bg-muted/30'
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
            <div className="space-y-2.5 max-h-95 overflow-y-auto pr-1">
              {filteredNotifications.length > 0 ? (
                filteredNotifications.map(item => {
                  const isRead = readIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-all relative group ${isRead
                          ? 'bg-muted/20 border-border opacity-75 hover:opacity-100 hover:border-primary/30'
                          : 'bg-card border-border hover:border-primary/40 shadow-xs'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => markItemAsRead(item.id)}
                          className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className={`p-2 rounded-xl shrink-0 mt-0.5 ${item.type === 'order'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : item.type === 'logistics'
                                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                : item.type === 'transfer'
                                  ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                  : item.type === 'movement'
                                    ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            }`}>
                            {item.type === 'order' ? (
                              <ShoppingBag className="w-4 h-4" />
                            ) : item.type === 'logistics' ? (
                              <Truck className="w-4 h-4" />
                            ) : item.type === 'transfer' ? (
                              <ArrowLeftRight className="w-4 h-4" />
                            ) : item.type === 'movement' ? (
                              <Boxes className="w-4 h-4" />
                            ) : (
                              <Network className="w-4 h-4" />
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
                        </button>

                        <div className="flex flex-col items-end shrink-0 gap-1.5">
                          <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {formatNotificationRelativeTime(item.timestamp)}
                          </span>
                          <div className="flex items-center gap-2">
                            <Link
                              to={item.href}
                              onClick={() => markItemAsRead(item.id)}
                              className="text-[10px] font-bold text-primary hover:underline whitespace-nowrap"
                            >
                              Open
                            </Link>
                            {!isRead && (
                              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" title="Unread" />
                            )}
                          </div>
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
        )}

        <Card className="lg:col-span-12 border-border overflow-hidden group hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-foreground" />
              <CardTitle className="text-xs font-black uppercase tracking-widest">Fulfillment & Operations</CardTitle>
            </div>
            <CardDescription className="text-xs font-medium">Configure warehouse queuing and allocation behavior.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl bg-muted/30 border border-border/50 gap-4">
              <div>
                <p className="text-sm font-black uppercase tracking-wider text-foreground">Algorithmic Queueing Strategy</p>
                <p className="text-xs text-muted-foreground mt-1 font-medium max-w-lg">
                  Determines how inventory batches are automatically allocated to approved orders. FIFO depletes older assets first.
                </p>
              </div>
              <div className="flex items-center gap-2 bg-background p-1.5 rounded-xl border border-border shrink-0">
                <Button
                  variant={fulfillmentStrategy === 'FIFO' ? 'default' : 'ghost'}
                  size="sm"
                  className={`h-9 px-4 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${fulfillmentStrategy === 'FIFO' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => handleStrategyChange('FIFO')}
                >
                  FIFO (Rec.)
                </Button>
                <Button
                  variant={fulfillmentStrategy === 'LIFO' ? 'default' : 'ghost'}
                  size="sm"
                  className={`h-9 px-4 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${fulfillmentStrategy === 'LIFO' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => handleStrategyChange('LIFO')}
                >
                  LIFO
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isAdmin && (
        <Card className="lg:col-span-12 border-border overflow-hidden group hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-foreground" />
              <CardTitle className="text-xs font-black uppercase tracking-widest">System Maintenance & Backup</CardTitle>
            </div>
            <CardDescription className="text-xs font-medium">Manage database state and regulatory audit exports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl bg-muted/30 border border-border/50 gap-4">
              <div>
                <p className="text-sm font-black uppercase tracking-wider text-foreground">Automated SQL Database Backup</p>
                <p className="text-xs text-muted-foreground mt-1 font-medium max-w-lg">
                  Generates an immutable CSV archive of the products CMDB, orders ledger, financial expenses, and audit trail.
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={isExporting}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    "h-10 px-5 gap-2 text-xs font-black uppercase tracking-widest border-2 hover:bg-foreground hover:text-background transition-all shrink-0 cursor-pointer"
                  )}
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" /> Export Backup <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
                    </>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 p-1.5 shadow-xl rounded-xl border border-border bg-popover">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2 py-1.5">
                      Individual CSV Exports
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => handleExportBackup('products')}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs font-bold hover:bg-muted"
                    >
                      <Package className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span>Products CMDB</span>
                        <span className="text-[10px] font-normal text-muted-foreground truncate">Catalog items, prices & stock levels</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExportBackup('orders')}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs font-bold hover:bg-muted"
                    >
                      <ShoppingBag className="w-4 h-4 text-emerald-500 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span>Orders Ledger</span>
                        <span className="text-[10px] font-normal text-muted-foreground truncate">Client orders, status & payments</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExportBackup('expenses')}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs font-bold hover:bg-muted"
                    >
                      <DollarSign className="w-4 h-4 text-amber-500 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span>Financial Expenses</span>
                        <span className="text-[10px] font-normal text-muted-foreground truncate">COGS, freight, and invoices</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExportBackup('transfers')}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs font-bold hover:bg-muted"
                    >
                      <ArrowLeftRight className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span>Inter-Warehouse Transfers</span>
                        <span className="text-[10px] font-normal text-muted-foreground truncate">Movements & transport manifests</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="my-1.5" />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2 py-1">
                      Complete Database Archives
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => handleExportBackup('all-xlsx')}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs font-bold bg-primary/5 hover:bg-primary/10 text-primary"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span>All Collections in One File (.xlsx)</span>
                        <span className="text-[10px] font-normal text-muted-foreground truncate">Single multi-sheet Excel file</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExportBackup('all-csv')}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs font-bold hover:bg-muted"
                    >
                      <Download className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span>Download All 4 CSVs</span>
                        <span className="text-[10px] font-normal text-muted-foreground truncate">Separate CSV files for each collection</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}

