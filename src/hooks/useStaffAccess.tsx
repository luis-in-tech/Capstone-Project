import { Fragment, createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { collection, db, onSnapshot, query, where } from '../lib/supabaseAdapter';
import { resolvePermissions } from '../lib/staffPermissions';
import type { StaffDelegation } from '../types';

const AccessContext = createContext({ permissions: resolvePermissions(null), loading: true, revoked: false, error: false, hasDelegation: false });
export function StaffAccessProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [state, setState] = useState<{ uid: string; delegation?: StaffDelegation; loading: boolean; error: boolean }>({ uid: '', loading: true, error: false });
  useEffect(() => {
    if (!profile || profile.role === 'admin') return;
    setState({ uid: profile.uid, loading: true, error: false });
    return onSnapshot(query(collection(db, 'delegations'), where('staffEmail', '==', profile.email.toLowerCase())), snap => {
      setState({ uid: profile.uid, delegation: snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffDelegation))[0], loading: false, error: false });
    }, () => setState({ uid: profile.uid, loading: false, error: true }));
  }, [profile?.uid, profile?.role, profile?.email]);
  const admin = profile?.role === 'admin';
  const loading = !profile || (!admin && (state.uid !== profile.uid || state.loading));
  const error = !admin && state.error;
  const revoked = !admin && state.delegation?.active === false;
  const permissions = resolvePermissions(profile, admin ? undefined : state.delegation);
  return <AccessContext.Provider value={{ permissions, loading, revoked, error, hasDelegation: !admin && !!state.delegation }}>{children}</AccessContext.Provider>;
}
export const useStaffAccess = () => useContext(AccessContext);
