import { formatNotificationRelativeTime, useAdminNotifications, useStaffAccess } from '../hooks/useStaffAccess';
import { canVisit } from '../lib/staffPermissions';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChartBarIcon as BarChart3,
  PackageIcon as Package,
  BuildingsIcon as Building2,
  ShoppingCartIcon as ShoppingCart,
  TruckIcon as Truck,
  CurrencyDollarIcon as DollarSign,
  GearIcon as Settings,
  ListIcon as Menu,
  SignOutIcon as LogOut,
  CaretRightIcon as ChevronRight,
  CaretLeftIcon as ChevronLeft,
  UserIcon,
  UserGearIcon as UserCog,
  SquaresFourIcon,
  QuestionIcon as HelpCircle,
  SunIcon as Sun,
  MoonIcon as Moon,
  TagIcon as Tag,
  PulseIcon as Activity,
  BellIcon as Bell,
  ChecksIcon as CheckCheck,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from './ThemeProvider';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { motion, AnimatePresence } from 'motion/react';
import { TutorialOverlay } from './TutorialOverlay';
import { SidebarCollapsedContext } from './PageHeading';

const navigation = [
  { name: 'Overview', href: '/admin', icon: SquaresFourIcon, roles: ['admin'], section: 'OVERVIEW & ANALYTICS' },
  { name: 'Analytics', href: '/dashboard', icon: BarChart3, roles: ['admin'], section: 'OVERVIEW & ANALYTICS' },
  { name: 'Inventory', href: '/inventory', icon: Package, roles: ['admin', 'secretary', 'agent', 'staff'], section: 'OPERATIONS & SUPPLY' },
  { name: 'Supply Chain', href: '/supply-chain', icon: Building2, roles: ['admin', 'secretary', 'agent', 'staff'], section: 'OPERATIONS & SUPPLY' },
  { name: 'Order Entry', href: '/orders', icon: ShoppingCart, roles: ['admin', 'secretary', 'agent', 'staff'], section: 'TRANSACTIONS' },
  { name: 'Item Entry', href: '/transfers', icon: Truck, roles: ['admin', 'secretary', 'agent', 'staff'], section: 'TRANSACTIONS' },
  { name: 'Financials', href: '/finance', icon: DollarSign, roles: ['admin', 'secretary', 'agent', 'staff'], section: 'FINANCIAL AUDIT' },
  { name: 'Logistics Optimizer', href: '/logistics', icon: Activity, roles: ['admin', 'secretary'], section: 'OPERATIONS & SUPPLY' },
  { name: 'Pricelist', href: '/pricelist', icon: Tag, roles: ['admin', 'secretary', 'agent', 'staff'], section: 'OPERATIONS & SUPPLY' },
  { name: 'Staff Delegation', href: '/delegation', icon: UserCog, roles: ['admin'], section: 'ADMINISTRATION' },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin', 'secretary', 'agent', 'staff'], section: 'ADMINISTRATION' },
];

function AdminNotificationBell({ align = 'end', onNavigate }: { align?: 'start' | 'end'; onNavigate?: () => void }) {
  const { isAdmin, allNotifications, unreadCount, readIds, markItemAsRead, markAllAsRead } = useAdminNotifications();
  const navigate = useNavigate();

  if (!isAdmin) return null;

  const recentNotifications = allNotifications.slice(0, 8);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center rounded-sm h-8 w-8 bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
        title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Live Notifications'}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-black leading-none flex items-center justify-center shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-80 rounded-xl p-1.5">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-[10px] font-black uppercase tracking-wider text-foreground">
            System Notifications
          </DropdownMenuLabel>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                markAllAsRead();
              }}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:underline cursor-pointer"
            >
              <CheckCheck className="w-3 h-3" /> Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {recentNotifications.length > 0 ? (
          <div className="max-h-72 overflow-y-auto space-y-0.5 py-0.5">
            {recentNotifications.map((item) => {
              const isRead = readIds.has(item.id);
              return (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => {
                    markItemAsRead(item.id);
                    onNavigate?.();
                    navigate(item.href);
                  }}
                  className={`flex flex-col items-start gap-0.5 px-2.5 py-2 rounded-lg cursor-pointer ${isRead ? 'opacity-70' : 'bg-primary/5'}`}
                >
                  <div className="flex items-center justify-between w-full gap-2">
                    <span className="text-[11px] font-bold text-foreground truncate">{item.title}</span>
                    {!isRead && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  <span className="text-[10px] text-muted-foreground line-clamp-1">{item.description}</span>
                  <span className="text-[9px] font-semibold text-muted-foreground/80">
                    {formatNotificationRelativeTime(item.timestamp)}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-5 text-center text-[11px] text-muted-foreground">
            No active notifications for your enabled feeds.
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            onNavigate?.();
            navigate('/settings');
          }}
          className="justify-center text-[11px] font-bold text-primary cursor-pointer"
        >
          Manage notification settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SidebarContentProps {
  isCollapsed: boolean;
  sections: string[];
  filteredNavigation: typeof navigation;
  currentPath: string;
  profile: ReturnType<typeof useAuth>['profile'];
  isAdmin: boolean;
  unreadCount: number;
  onCollapseToggle: () => void;
  onCloseMobile: () => void;
  onOpenTutorial: () => void;
  onLogout: () => void;
}

function SidebarContent({
  isCollapsed,
  sections,
  filteredNavigation,
  currentPath,
  profile,
  isAdmin,
  unreadCount,
  onCollapseToggle,
  onCloseMobile,
  onOpenTutorial,
  onLogout,
}: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground select-none">
      {/* Brand Header */}
      <div className={`px-4 py-3.5 border-b border-sidebar-border ${isCollapsed ? 'flex flex-col items-center gap-2 px-1' : 'flex items-center justify-between gap-2'}`}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 shrink-0">
            <img src="/logo.png" alt="Active Pro" className="w-full h-full object-contain" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span style={{ fontFamily: "'Anton', sans-serif" }} className="text-xl tracking-tight text-sidebar-foreground leading-none italic">
                Active <span className="text-amber-700 dark:text-[#fdd001]">Pro</span>
              </span>
            </div>
          )}
        </div>
        <AdminNotificationBell align={isCollapsed ? 'start' : 'end'} onNavigate={onCloseMobile} />
      </div>

      {/* Nav with Enterprise Grouping */}
      <nav className="flex-1 px-2.5 py-3 space-y-3 overflow-y-auto">
        {sections.map((sec) => {
          const items = filteredNavigation.filter(item => (item.section || 'MENU') === sec);
          if (!items.length) return null;
          return (
            <div key={sec} className="space-y-0.5">
              {!isCollapsed && (
                <div className="px-2.5 pb-1 text-[9px] font-black uppercase tracking-widest text-sidebar-foreground/50">
                  {sec}
                </div>
              )}
              {items.map((item) => {
                const isActive = currentPath === item.href;
                const showNotifBadge = item.href === '/settings' && isAdmin && unreadCount > 0;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={onCloseMobile}
                    className={`relative flex items-center ${isCollapsed ? 'justify-center px-0 h-9' : 'gap-2.5 px-2.5 h-8.5'} text-xs font-semibold transition-all group ${
                      isActive
                        ? 'bg-neutral-100 dark:bg-white/10 text-neutral-900 dark:text-white border-l-[3px] border-[#fdd001] rounded-r-sm rounded-l-none pl-2 font-bold shadow-none'
                        : 'text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-neutral-100 dark:hover:bg-white/5 rounded-sm border-l-[3px] border-transparent'
                    }`}
                    title={isCollapsed ? (showNotifBadge ? `${item.name} (${unreadCount} unread)` : item.name) : undefined}
                  >
                    <item.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-700 dark:text-[#fdd001]' : 'text-sidebar-foreground/60 group-hover:text-sidebar-foreground'}`} />
                    {!isCollapsed && <span className="flex-1 truncate">{item.name}</span>}
                    {showNotifBadge && !isCollapsed && (
                      <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-black leading-none">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                    {showNotifBadge && isCollapsed && (
                      <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-primary" />
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}

        {/* Collapse Toggle */}
        <div className={`flex ${isCollapsed ? 'justify-center' : 'justify-end'} pt-2 px-1`}>
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-neutral-100 dark:hover:bg-white/10 rounded-sm transition-all"
            onClick={onCollapseToggle}
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {!isCollapsed && <span>Collapse</span>}
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>
      </nav>

      {/* Bottom User & System Section */}
      <div className={`p-3 mt-auto border-t border-sidebar-border ${isCollapsed ? 'flex flex-col items-center px-1' : ''}`}>
        {/* User profile */}
        <Link
          to="/settings"
          onClick={onCloseMobile}
          className={`flex items-center ${isCollapsed ? 'justify-center p-1.5' : 'gap-2.5 p-2'} mb-2 rounded-sm bg-neutral-100/70 dark:bg-white/5 hover:bg-neutral-200/60 dark:hover:bg-white/10 border border-sidebar-border transition-all group relative overflow-hidden w-full`}
          title={isCollapsed ? profile?.displayName || 'User' : undefined}
        >
          <div className="w-7 h-7 bg-neutral-200/70 dark:bg-white/10 rounded-sm shrink-0 overflow-hidden border border-sidebar-border group-hover:border-[#fdd001] transition-colors flex items-center justify-center">
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon className="w-3.5 h-3.5 text-sidebar-foreground/60" />
            )}
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 pr-4">
              <span className="text-xs font-bold text-sidebar-foreground truncate tracking-tight">
                {profile?.displayName || 'User'}
              </span>
              <span className="text-[9px] text-amber-700 dark:text-[#fdd001] uppercase font-bold tracking-widest mt-0.5">
                {profile?.role} PORTAL
              </span>
            </div>
          )}
          {!isCollapsed && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
              <UserCog className="w-3.5 h-3.5 text-sidebar-foreground/50" />
            </div>
          )}
        </Link>

        <div className="space-y-1">
          <button
            type="button"
            className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-2 px-2.5'} h-7.5 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-neutral-100 dark:hover:bg-white/5 rounded-sm transition-all`}
            onClick={onOpenTutorial}
            title={isCollapsed ? "System Guide" : undefined}
            aria-label="System Guide"
          >
            <HelpCircle className="w-3.5 h-3.5 shrink-0" />
            {!isCollapsed && "System Guide"}
          </button>

          <button
            type="button"
            className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-2 px-2.5'} h-7.5 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-500/10 rounded-sm transition-all`}
            onClick={onLogout}
            title={isCollapsed ? "Logout" : undefined}
            aria-label="Logout"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!isCollapsed && "Logout"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { profile, logout } = useAuth();
  const access = useStaffAccess();
  const { isAdmin, unreadCount } = useAdminNotifications();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const isDark = theme === 'dark';

  const filteredNavigation = navigation.filter(item =>
    item.roles.includes(profile?.role || 'agent') && ((!access.revoked && !access.error && canVisit(item.href, access.permissions)) || item.href === '/settings')
  );

  const sections = Array.from(new Set(filteredNavigation.map(item => item.section || 'MENU')));

  const sidebarProps: SidebarContentProps = {
    isCollapsed,
    sections,
    filteredNavigation,
    currentPath: location.pathname,
    profile,
    isAdmin,
    unreadCount,
    onCollapseToggle: () => setIsCollapsed(prev => !prev),
    onCloseMobile: () => setIsMobileMenuOpen(false),
    onOpenTutorial: () => setIsTutorialOpen(true),
    onLogout: logout,
  };

  return (
    <div className="min-h-screen bg-background flex w-full overflow-x-hidden">
      <TutorialOverlay open={isTutorialOpen} onOpenChange={setIsTutorialOpen} />

      {/* Desktop Sidebar */}
      <aside className={`hidden lg:block fixed inset-y-0 z-50 border-r border-sidebar-border bg-sidebar transition-all duration-200 ${isCollapsed ? 'w-16' : 'w-60'}`}>
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ${isCollapsed ? 'lg:pl-16' : 'lg:pl-60'}`}>
        {/* Top Header for Mobile */}
        <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-2.5 bg-background/95 backdrop-blur-sm border-b border-border lg:hidden">
          {/* Mobile menu */}
          <div className="lg:hidden">
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger aria-label="Open navigation menu" className="inline-flex shrink-0 items-center justify-center rounded-sm h-8 w-8 bg-sidebar text-sidebar-foreground border border-sidebar-border hover:bg-sidebar-accent transition-all">
                <Menu className="w-4 h-4" />
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-60 border-0 bg-sidebar">
                <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                <SidebarContent {...sidebarProps} isCollapsed={false} />
              </SheetContent>
            </Sheet>
          </div>

          {/* Page title */}
          <div className="flex flex-col">
            <span style={{ fontFamily: "'Anton', sans-serif" }} className="text-base tracking-tight text-foreground leading-none italic">
              Active <span className="text-amber-700 dark:text-[#fdd001]">Pro</span>
            </span>
            <span className="text-[9px] uppercase font-black tracking-widest text-muted-foreground mt-0.5">
              {filteredNavigation.find(item => item.href === location.pathname)?.name || 'Portal'}
            </span>
          </div>

          {/* Header right */}
          <div className="flex items-center gap-2">
            <AdminNotificationBell align="end" />
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="inline-flex items-center justify-center rounded-sm h-8 w-8 bg-muted text-muted-foreground hover:text-foreground transition-all"
              title="Toggle theme"
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 w-full min-w-0 p-4 lg:p-6 overflow-x-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <SidebarCollapsedContext.Provider value={isCollapsed}>
                {children}
              </SidebarCollapsedContext.Provider>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
