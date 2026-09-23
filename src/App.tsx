import { StaffAccessProvider, useStaffAccess } from './hooks/useStaffAccess';
import { canVisit } from './lib/staffPermissions';
import { useLocation } from 'react-router-dom';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdminPanel } from './components/AdminPanel';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { Auth } from './components/Auth';
import { LandingPage } from './components/LandingPage';
import { About } from './components/About';
import { Onboarding } from './components/Onboarding';
import { Privacy } from './components/Privacy';
import { Terms } from './components/Terms';
import { Dashboard } from './components/Dashboard';
import { Inventory } from './components/Inventory';
import { SupplyChain } from './components/SupplyChain';
import { Orders } from './components/Orders';
import { Finance } from './components/Finance';
import { InventoryMovement } from './components/InventoryMovement';
import { Settings } from './components/Settings';
import { Pricelist } from './components/Pricelist';
import { LogisticsOptimizer } from './components/LogisticsOptimizer';
import { DelegationPanel } from './components/DelegationPanel';
import { ThemeProvider } from './components/ThemeProvider';
import { Toaster } from 'sonner';
import { useEffect } from 'react';
import { supabase } from './lib/supabase';
import { handleSupabaseError, OperationType } from './lib/supabaseErrorHandler';

function ProtectedRoute({ children, allowedRoles, fallbackPath = "/inventory" }: { children: React.ReactNode, allowedRoles?: string[], fallbackPath?: string }) {
  const { user, profile, loading } = useAuth();
  const access = useStaffAccess();
  const location = useLocation();
  
  if (loading || (user && access.loading)) return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
  
  if (!user) return <Navigate to="/login" replace />;
  
  if (access.error) return <Layout><div role="alert" className="rounded-xl border p-6"><h1 className="font-semibold">Permissions could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">Reload the page to try again.</p><button className="mt-4 underline" onClick={() => window.location.reload()}>Retry</button></div></Layout>;
  if (access.revoked && location.pathname !== '/settings') return <Layout><div className="rounded-xl border p-8 text-center"><h1 className="text-xl font-semibold">Your access has been deactivated</h1><p className="mt-2 text-sm text-muted-foreground">Contact an administrator to restore your access.</p></div></Layout>;
  if (!canVisit(location.pathname, access.permissions)) return <Navigate to="/inventory" replace />;
  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <Layout>{children}</Layout>;
}

function AppContent() {
  const { user, profile } = useAuth();
  const access = useStaffAccess();

  // Seed initial warehouses if empty
  useEffect(() => {
    const seedWarehouses = async () => {
      if (access.loading || access.revoked || access.error || !(profile?.role === 'admin')) return;
      try {
        const { data: snap, error } = await supabase.from('warehouses').select('*');
        if (error) throw error;
        if (!snap || snap.length === 0) {
          await supabase.from('warehouses').insert({ name: 'Valenzuela A (Main)', location: 'Hub 1' });
          await supabase.from('warehouses').insert({ name: 'Valenzuela B (Sub)', location: 'Hub 2' });
        }
      } catch (e) {
        handleSupabaseError(e, OperationType.WRITE, 'warehouses');
      }
    };
    if (user && profile) seedWarehouses();
  }, [user, profile, access.loading, access.revoked, access.error, access.hasDelegation]);

  const defaultPath = (profile?.role === 'admin') ? '/admin' : '/inventory';

  return (
    <Routes>
      {/* Root: always redirect — never show the landing page on open */}
      <Route path="/" element={<Navigate to={user ? defaultPath : "/login"} replace />} />

      {/* Auth routes — redirect to dashboard if already logged in */}
      <Route path="/login" element={user ? <Navigate to={defaultPath} replace /> : <Auth />} />
      <Route path="/signup" element={user ? <Navigate to={defaultPath} replace /> : <Auth />} />

      {/* Public informational pages — kept accessible without login */}
      <Route path="/about" element={<About />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />

      {/* Onboarding — only for unauthenticated users */}
      <Route path="/onboarding" element={user ? <Navigate to={defaultPath} replace /> : <Onboarding />} />
      
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
        <ProtectedRoute allowedRoles={['admin']}>
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

      {/* Catch-all: send unauthenticated users to login, authenticated to defaultPath */}
      <Route path="*" element={<Navigate to={user ? defaultPath : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
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
