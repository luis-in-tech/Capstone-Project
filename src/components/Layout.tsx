import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Package,
  ShoppingCart,
  Truck,
  DollarSign,
  Settings,
  Menu,
  LogOut,
  ChevronRight,
  ChevronLeft,
  User as UserIcon,
  UserCog,
  Shield,
  HelpCircle,
  Sun,
  Moon,
  Tag,
  Activity,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { motion, AnimatePresence } from 'motion/react';
import { TutorialOverlay } from './TutorialOverlay';

const navigation = [
  { name: 'Admin Panel', href: '/admin', icon: Shield, roles: ['admin'] },
  { name: 'Dashboard', href: '/dashboard', icon: BarChart3, roles: ['admin'] },
  { name: 'Inventory', href: '/inventory', icon: Package, roles: ['admin', 'secretary', 'agent', 'staff'] },
  { name: 'Order Entry', href: '/orders', icon: ShoppingCart, roles: ['admin', 'secretary', 'agent', 'staff'] },
  { name: 'Transport', href: '/transfers', icon: Truck, roles: ['admin', 'secretary'] },
  { name: 'Financials', href: '/finance', icon: DollarSign, roles: ['admin'] },
  { name: 'Logistics Optimizer', href: '/logistics', icon: Activity, roles: ['admin', 'secretary'] },
  { name: 'Pricelist', href: '/pricelist', icon: Tag, roles: ['admin', 'secretary', 'agent', 'staff'] },
  { name: 'Staff Delegation', href: '/delegation', icon: UserCog, roles: ['admin'] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin', 'secretary', 'agent', 'staff'] },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { profile, logout, updateRole } = useAuth();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const isDark = theme === 'dark';

  const filteredNavigation = navigation.filter(item =>
    item.roles.includes(profile?.role || 'agent')
  );

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar overflow-y-auto">
      {/* Logo */}
      <div className={`px-5 py-5 border-b border-sidebar-border ${isCollapsed ? 'flex justify-center px-0' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0">
            <img src="/logo.png" alt="Active Pro" className="w-full h-full object-contain" />
          </div>
          {!isCollapsed && (
            <span style={{ fontFamily: "'Anton', sans-serif" }} className="text-2xl tracking-tight text-sidebar-foreground leading-none italic">
              Active <span className="text-sidebar-primary">Pro</span>
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 relative">
        {filteredNavigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={`flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2.5 text-sm font-medium rounded-lg transition-all group ${isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-md'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                }`}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-sidebar-primary-foreground' : ''}`} />
              {!isCollapsed && <span className="flex-1">{item.name}</span>}
              {isActive && !isCollapsed && (
                <motion.div
                  layoutId="active-pill"
                  className="w-1.5 h-1.5 rounded-full bg-sidebar-primary-foreground"
                />
              )}
            </Link>
          );
        })}

        {/* Collapse Toggle */}
        <div className={`flex ${isCollapsed ? 'justify-center' : 'justify-end'} pt-2 pr-1`}>
          <button
            className={`flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40 hover:text-sidebar-foreground/80 hover:bg-sidebar-foreground/10 rounded-md transition-all`}
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {!isCollapsed && <span>Collapse</span>}
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </nav>

      {/* Bottom Section */}
      <div className={`p-4 mt-auto border-t border-sidebar-border ${isCollapsed ? 'flex flex-col items-center px-2' : ''}`}>
        {/* User profile */}
        <Link
          to="/settings"
          className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-3'} py-3 mb-3 rounded-xl hover:bg-sidebar-accent transition-all group relative overflow-hidden w-full`}
          title={isCollapsed ? profile?.displayName || 'User' : undefined}
        >
          <div className="w-9 h-9 bg-sidebar-foreground/10 rounded-xl flex-shrink-0 overflow-hidden border border-sidebar-border group-hover:border-sidebar-primary/60 transition-colors">
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon className="w-4 h-4 text-sidebar-foreground/50 m-2.5" />
            )}
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 pr-5">
              <span className="text-xs font-bold text-sidebar-foreground truncate tracking-tight">
                {profile?.displayName || 'User'}
              </span>
              <span className="text-[9px] text-sidebar-primary uppercase font-bold tracking-widest mt-0.5">
                {profile?.role} PORTAL
              </span>
            </div>
          )}
          {!isCollapsed && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
              <UserCog className="w-3.5 h-3.5 text-sidebar-foreground/60" />
            </div>
          )}
        </Link>




        <Separator className="mb-3 bg-sidebar-border" />

        <button
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 px-3'} py-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-sidebar-foreground/6 rounded-lg transition-all`}
          onClick={() => setIsTutorialOpen(true)}
          title={isCollapsed ? "System Guide" : undefined}
        >
          <HelpCircle className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && "System Guide"}
        </button>

        <button
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 px-3'} py-2 text-[10px] font-bold uppercase tracking-widest text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all mt-0.5`}
          onClick={logout}
          title={isCollapsed ? "Logout" : undefined}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && "Logout"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex w-full overflow-x-hidden">
      <TutorialOverlay open={isTutorialOpen} onOpenChange={setIsTutorialOpen} />

      {/* Desktop Sidebar */}
      <aside className={`hidden lg:block fixed inset-y-0 z-50 shadow-xl shadow-black/10 transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${isCollapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
        {/* Top Header */}
        <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-background/90 backdrop-blur-md border-b border-border lg:px-8">
          {/* Mobile menu */}
          <div className="lg:hidden">
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger className="inline-flex shrink-0 items-center justify-center rounded-lg h-9 w-9 bg-sidebar text-sidebar-foreground hover:bg-sidebar/90 transition-all">
                <Menu className="w-4 h-4" />
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64 border-0">
                <SidebarContent />
              </SheetContent>
            </Sheet>
          </div>

          {/* Page title */}
          <div className="flex flex-col">
          </div>

          {/* Header right */}
          <div className="flex items-center gap-3">
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 w-full min-w-0 p-4 lg:p-8 overflow-x-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
