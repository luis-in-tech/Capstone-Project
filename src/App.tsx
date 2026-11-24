import { StaffAccessProvider, useStaffAccess } from './hooks/useStaffAccess';
import { canVisit, hasAdminRole } from './lib/staffPermissions';
import { useLocation, BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { classifyBatchQr } from './lib/receiptBatches';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useEffect, useRef, type ComponentType } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { ThemeProvider } from './components/ThemeProvider';
import { Toaster } from 'sonner';
import { supabase, supabaseConfigError } from './lib/supabase';
import { handleSupabaseError, OperationType } from './lib/supabaseErrorHandler';

function lazyNamed<TModule extends Record<string, unknown>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey,
) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[exportName] as ComponentType };
  });
}

const Auth = lazyNamed(() => import('./components/Auth'), 'Auth');
const About = lazyNamed(() => import('./components/About'), 'About');
const Onboarding = lazyNamed(() => import('./components/Onboarding'), 'Onboarding');
const Privacy = lazyNamed(() => import('./components/Privacy'), 'Privacy');
const Terms = lazyNamed(() => import('./components/Terms'), 'Terms');
const Dashboard = lazyNamed(() => import('./components/Dashboard'), 'Dashboard');
const Inventory = lazyNamed(() => import('./components/Inventory'), 'Inventory');
const SupplyChain = lazyNamed(() => import('./components/SupplyChain'), 'SupplyChain');
const Orders = lazyNamed(() => import('./components/Orders'), 'Orders');
const InventoryMovement = lazyNamed(() => import('./components/InventoryMovement'), 'InventoryMovement');
const Finance = lazyNamed(() => import('./components/Finance'), 'Finance');
const Settings = lazyNamed(() => import('./components/Settings'), 'Settings');
const LogisticsOptimizer = lazyNamed(() => import('./components/LogisticsOptimizer'), 'LogisticsOptimizer');
const Pricelist = lazyNamed(() => import('./components/Pricelist'), 'Pricelist');
const AdminPanel = lazyNamed(() => import('./components/AdminPanel'), 'AdminPanel');
const DelegationPanel = lazyNamed(() => import('./components/DelegationPanel'), 'DelegationPanel');

const RouteFallback = () => (
  <div className="min-h-[40vh] flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
  </div>
);

const FullScreenFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-zinc-950">
    <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
  </div>
);

function AuthenticatedLayout() {
  const { user, profile, profileError, loading, retryProfile, logout } = useAuth();
  const access = useStaffAccess();
  const location = useLocation();

  if (loading || (user && !profile && !profileError) || (user && profile && access.loading)) return <FullScreenFallback />;

  if (user && !profile && profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 text-white">
        <div role="alert" className="max-w-md rounded-xl border border-white/15 bg-zinc-900 p-6 space-y-4">
          <h1 className="text-lg font-semibold">Profile verification failed</h1>
          <p className="text-sm text-zinc-300">{profileError}</p>
          <div className="flex gap-3">
            <button type="button" className="rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900" onClick={() => retryProfile()}>Retry</button>
            <button type="button" className="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white" onClick={() => logout()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to={location.pathname === '/transfers' && new URLSearchParams(location.search).has('batch') ? `/login?receipt=${encodeURIComponent(location.pathname + location.search)}` : '/login'} replace />;

  if (access.error) return <Layout><div role="alert" className="rounded-xl border p-6"><h1 className="font-semibold">Permissions could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">Reload the page to try again.</p><button className="mt-4 underline" onClick={() => window.location.reload()}>Retry</button></div></Layout>;
  if (access.revoked && location.pathname !== '/settings') return <Layout><div className="rounded-xl border p-8 text-center"><h1 className="text-xl font-semibold">Your access has been deactivated</h1><p className="mt-2 text-sm text-muted-foreground">Contact an administrator to restore your access.</p></div></Layout>;

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function ProtectedRoute({ children, allowedRoles, fallbackPath }: { children: React.ReactNode, allowedRoles?: string[], fallbackPath?: string }) {
  const { user, profile } = useAuth();
  const access = useStaffAccess();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;

  const defaultFallback = hasAdminRole(profile) ? '/admin' : '/inventory';
  if (!canVisit(location.pathname, access.permissions)) return <Navigate to={defaultFallback} replace />;
  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to={fallbackPath || defaultFallback} replace />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      {children}
    </Suspense>
  );
}

function AppContent() {
  const location = useLocation();
  const { user, profile, profileError, loading, retryProfile, logout } = useAuth();
  const access = useStaffAccess();
  const warehousesSeededForUidRef = useRef<string | null>(null);

  // Seed initial warehouses if empty (checked at most once per browser session)
  useEffect(() => {
    const seedWarehouses = async () => {
      if (!user || !profile || access.loading || access.revoked || access.error || !hasAdminRole(profile)) return;
      if (warehousesSeededForUidRef.current === profile.uid) return;
      warehousesSeededForUidRef.current = profile.uid;
      try {
        if (typeof window !== 'undefined' && window.sessionStorage?.getItem('activepro_warehouses_checked') === '1') {
          return;
        }
        const { data: snap, error } = await supabase.from('warehouses').select('id').limit(1);
        if (error) throw error;
        if (!snap || snap.length === 0) {
          const { error: insertError } = await supabase.from('warehouses').insert([
            { name: 'Valenzuela A (Main)', location: 'Hub 1' },
            { name: 'Valenzuela B (Sub)', location: 'Hub 2' },
          ]);
          if (insertError) throw insertError;
        }
        if (typeof window !== 'undefined') {
          window.sessionStorage?.setItem('activepro_warehouses_checked', '1');
        }
      } catch (e) {
        warehousesSeededForUidRef.current = null;
        handleSupabaseError(e, OperationType.WRITE, 'warehouses');
      }
    };
    if (!user || !profile) return;
    const timer = window.setTimeout(() => {
      void seedWarehouses();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [user?.id, profile?.uid, profile?.role, access.loading, access.revoked, access.error]);

  // Wait for user & profile data before computing redirection to prevent race condition
  if (loading || (user && !profile && !profileError) || (user && profile && access.loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (user && !profile && profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 text-white">
        <div role="alert" className="max-w-md rounded-xl border border-white/15 bg-zinc-900 p-6 space-y-4">
          <h1 className="text-lg font-semibold">Profile verification failed</h1>
          <p className="text-sm text-zinc-300">{profileError}</p>
          <div className="flex gap-3">
            <button type="button" className="rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900" onClick={() => retryProfile()}>Retry</button>
            <button type="button" className="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white" onClick={() => logout()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  // Admin lands on Operational Overview (/admin); Secretary, Staff, Agent land on Inventory (/inventory)
  const defaultPath = hasAdminRole(profile) ? '/admin' : '/inventory';
  const receiptReturn = new URLSearchParams(location.search).get('receipt');
  const receiptOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://activepro.local';
  const receiptCheck = receiptReturn ? classifyBatchQr(receiptReturn, receiptOrigin) : null;
  const loginDestination = receiptReturn && receiptCheck?.kind === 'batch'
    ? receiptReturn
    : defaultPath;

  return (
    <Suspense fallback={<FullScreenFallback />}>
    <Routes>
      {/* Root: always redirect — never show the landing page on open */}
      <Route path="/" element={<Navigate to={user ? defaultPath : "/login"} replace />} />

      {/* Auth routes — redirect to respective landing page if already logged in */}
      <Route path="/login" element={user ? <Navigate to={loginDestination} replace /> : <Auth />} />
      <Route path="/signup" element={<Navigate to={user ? defaultPath : '/login'} replace />} />

      {/* Public informational pages — kept accessible without login */}
      <Route path="/about" element={<About />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />

      {/* Onboarding — only for unauthenticated users */}
      <Route path="/onboarding" element={user ? <Navigate to={defaultPath} replace /> : <Onboarding />} />
      
      <Route element={<AuthenticatedLayout />}>
        <Route path="/dashboard" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <Dashboard />
          </ProtectedRoute>
        } />

        <Route path="/inventory" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary', 'agent', 'staff']}>
            <Inventory />
          </ProtectedRoute>
        } />

        <Route path="/supply-chain" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary', 'agent', 'staff']}>
            <SupplyChain />
          </ProtectedRoute>
        } />

        <Route path="/orders" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary', 'agent', 'staff']}>
            <Orders />
          </ProtectedRoute>
        } />

        <Route path="/transfers" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary', 'agent', 'staff']}>
            <InventoryMovement />
          </ProtectedRoute>
        } />

        <Route path="/finance" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary', 'agent', 'staff']}>
            <Finance />
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary', 'agent', 'staff']}>
            <Settings />
          </ProtectedRoute>
        } />

        <Route path="/logistics" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary']}>
            <LogisticsOptimizer />
          </ProtectedRoute>
        } />

        <Route path="/pricelist" element={
          <ProtectedRoute allowedRoles={['admin', 'secretary', 'agent', 'staff']}>
            <Pricelist />
          </ProtectedRoute>
        } />

        <Route path="/admin" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminPanel />
          </ProtectedRoute>
        } />

        <Route path="/delegation" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <DelegationPanel />
          </ProtectedRoute>
        } />
      </Route>

      {/* Catch-all: send unauthenticated users to login, authenticated to defaultPath */}
      <Route path="*" element={<Navigate to={user ? defaultPath : "/login"} replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  if (supabaseConfigError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 text-white">
        <div role="alert" className="max-w-lg rounded-xl border border-red-500/40 bg-zinc-900 p-6 space-y-2">
          <h1 className="text-lg font-semibold text-red-400">Configuration Error</h1>
          <p className="text-sm text-zinc-200">{supabaseConfigError}</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <StaffAccessProvider><AppContent /></StaffAccessProvider>
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
