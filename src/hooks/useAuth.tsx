import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, supabaseConfigError } from '../lib/supabase';
import { UserProfile } from '../types';
import { clearLocalCaches } from '../lib/supabaseAdapter';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  profileError: string | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  retryProfile: () => Promise<void>;
  updateRole: (role: 'admin' | 'secretary' | 'agent', targetUid?: string) => Promise<void>;
  updateProfileData: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedUidRef = useRef<string | null>(null);
  const authSeqRef = useRef(0);
  const inFlightProfileRef = useRef<{ uid: string; seq: number; promise: Promise<void> } | null>(null);
  const isMountedRef = useRef(true);

  const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  const clearInactivityTimer = () => {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current);
      inactivityTimer.current = null;
    }
  };

  const resetInactivityTimer = (currentUser: User | null) => {
    clearInactivityTimer();
    if (!currentUser) return;
    inactivityTimer.current = setTimeout(async () => {
      clearLocalCaches();
      loadedUidRef.current = null;
      inFlightProfileRef.current = null;
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error('Inactivity signOut failed:', err);
      }
      toast.warning('Session expired', {
        description: 'You were logged out due to 5 minutes of inactivity.',
        duration: 6000,
      });
    }, INACTIVITY_TIMEOUT_MS);
  };

  useEffect(() => {
    isMountedRef.current = true;
    if (!isSupabaseConfigured) {
      setUser(null);
      setProfile(null);
      setProfileError(supabaseConfigError || 'Supabase configuration is missing.');
      setLoading(false);
      return () => {
        isMountedRef.current = false;
      };
    }

    const initialSeq = authSeqRef.current;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMountedRef.current && authSeqRef.current === initialSeq) {
        handleUserChange(session?.user ?? null, { seq: initialSeq });
      }
    }).catch((err) => {
      console.error('Failed to retrieve auth session:', err);
      if (isMountedRef.current && authSeqRef.current === initialSeq) {
        setProfileError('Unable to verify session. Please retry.');
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMountedRef.current) return;
      const nextSeq = ++authSeqRef.current;
      const nextUser = session?.user ?? null;
      if (event === 'SIGNED_OUT' || !nextUser) {
        handleUserChange(null, { force: true, seq: nextSeq });
        return;
      }
      if (event === 'USER_UPDATED' || loadedUidRef.current !== nextUser.id) {
        handleUserChange(nextUser, { force: event === 'USER_UPDATED', seq: nextSeq });
      } else {
        setUser(nextUser);
        resetInactivityTimer(nextUser);
      }
    });

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleUserChange = async (currentUser: User | null, options: { force?: boolean; seq?: number } = {}) => {
    if (!isMountedRef.current) return;
    const activeSeq = options.seq ?? authSeqRef.current;
    setUser(currentUser);

    if (!currentUser) {
      clearLocalCaches();
      loadedUidRef.current = null;
      inFlightProfileRef.current = null;
      setProfile(null);
      setProfileError(null);
      setLoading(false);
      resetInactivityTimer(null);
      return;
    }

    if (!options.force && inFlightProfileRef.current?.uid === currentUser.id) {
      await inFlightProfileRef.current.promise;
      return;
    }

    if (!options.force && loadedUidRef.current === currentUser.id) {
      setLoading(false);
      resetInactivityTimer(currentUser);
      return;
    }

    const fetchPromise = (async () => {
      try {
        const { data: docSnap, error } = await supabase
          .from('users')
          .select('*')
          .eq('uid', currentUser.id)
          .maybeSingle();

        if (error) {
          throw error;
        }
        if (!isMountedRef.current || authSeqRef.current !== activeSeq) return;

        if (docSnap) {
          loadedUidRef.current = currentUser.id;
          setProfile(docSnap as UserProfile);
          setProfileError(null);
        } else {
          // Profile row genuinely does not exist yet: provision default 'agent' profile
          const [firstName = '', ...lastNameParts] = (currentUser.user_metadata?.full_name || '').split(' ');
          const lastName = lastNameParts.join(' ');

          const newProfile: UserProfile = {
            uid: currentUser.id,
            email: currentUser.email || '',
            displayName: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
            firstName,
            lastName,
            photoUrl: currentUser.user_metadata?.avatar_url || '',
            role: 'agent'
          };

          const { data: insertedSnap, error: insertError } = await supabase
            .from('users')
            .insert([newProfile])
            .select()
            .maybeSingle();
          if (insertError) throw insertError;
          if (!isMountedRef.current || authSeqRef.current !== activeSeq) return;
          loadedUidRef.current = currentUser.id;
          setProfile((insertedSnap as UserProfile) || newProfile);
          setProfileError(null);
        }
      } catch (error) {
        handleSupabaseError(error, OperationType.GET, `users/${currentUser.id}`);
        if (!isMountedRef.current || authSeqRef.current !== activeSeq) return;
        // Preserve already-verified profile if refreshing for same user, but never downgrade/fabricate a default role
        setProfile(prev => (prev?.uid === currentUser.id ? prev : null));
        setProfileError('Failed to verify your user profile from the server. Please retry.');
      } finally {
        if (inFlightProfileRef.current?.uid === currentUser.id && inFlightProfileRef.current.seq === activeSeq) {
          inFlightProfileRef.current = null;
        }
        if (isMountedRef.current && authSeqRef.current === activeSeq) {
          setLoading(false);
          resetInactivityTimer(currentUser);
        }
      }
    })();

    inFlightProfileRef.current = { uid: currentUser.id, seq: activeSeq, promise: fetchPromise };
    await fetchPromise;
  };

  const retryProfile = async () => {
    if (!user) return;
    setLoading(true);
    await handleUserChange(user, { force: true });
  };

  useEffect(() => {
    let lastActivity = Date.now();
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivity > 10000) {
        lastActivity = now;
        resetInactivityTimer(user);
      }
    };

    if (user) {
      ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }));
    }

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, handleActivity));
      clearInactivityTimer();
    };
  }, [user]);

  const signIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
      if (error) throw error;
    } catch (error: any) {
      console.error("Sign-in error:", error);
      toast.error('Authentication failed', { description: error.message || 'An unexpected error occurred during sign-in.' });
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      toast.success('Logged in successfully');
    } catch (error: any) {
      console.error("Email sign-in error:", error);
      toast.error('Login failed', { description: error?.message || 'Unable to sign in.' });
      throw error;
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      toast.success('Reset email sent', { description: 'Please check your inbox for instructions.' });
    } catch (error: any) {
      console.error("Password reset error:", error);
      toast.error('Process failed', { description: 'Could not send reset email. Verify the address is correct.' });
      throw error;
    }
  };

  const logout = async () => {
    clearInactivityTimer();
    clearLocalCaches();
    authSeqRef.current++;
    loadedUidRef.current = null;
    inFlightProfileRef.current = null;
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } finally {
      if (isMountedRef.current) {
        setUser(null);
        setProfile(null);
        setProfileError(null);
      }
    }
  };

  const updateRole = async (role: 'admin' | 'secretary' | 'agent', targetUid?: string) => {
    if (!user) {
      toast.error('Authentication required', { description: 'Please sign in to update roles.' });
      throw new Error('Authentication required');
    }

    // Strict Server/Client RBAC: Only an authenticated administrator can modify roles
    if (profile?.role !== 'admin') {
      toast.error('Unauthorized', {
        description: 'You do not have permission to modify system roles. Contact an administrator.',
      });
      throw new Error('Unauthorized role update');
    }

    const targetId = targetUid || user.id;

    // Safety Guard: Prevent the active administrator from accidentally locking themselves out
    if (targetId === user.id && role !== 'admin') {
      toast.error('Action blocked', {
        description: 'You cannot remove your own administrator privileges.',
      });
      throw new Error('Cannot remove own administrator privileges');
    }

    try {
      const { data: updated, error } = await supabase
        .from('users')
        .update({ role })
        .eq('uid', targetId)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error('User role update did not affect any record.');
      if (targetId === user.id) {
        setProfile(prev => (prev ? { ...prev, role } : null));
      }
      toast.success(`Role updated to ${role.toUpperCase()}`);
    } catch (error) {
      handleSupabaseError(error, OperationType.UPDATE, `users/${targetId}`);
      throw error;
    }
  };

  const updateProfileData = async (data: Partial<UserProfile>) => {
    if (!user) throw new Error('Authentication required');
    try {
      const { uid: _uid, role: _role, email: _email, ...safeFields } = data as Partial<UserProfile> & { id?: string };
      delete (safeFields as { id?: string }).id;
      const updatedData: Partial<UserProfile> = { ...safeFields };
      if (safeFields.firstName !== undefined || safeFields.lastName !== undefined) {
        const currentFirstName = safeFields.firstName ?? profile?.firstName ?? '';
        const currentLastName = safeFields.lastName ?? profile?.lastName ?? '';
        updatedData.displayName = `${currentFirstName} ${currentLastName}`.trim() || profile?.displayName || '';
      }

      const { data: updatedRow, error } = await supabase
        .from('users')
        .update(updatedData)
        .eq('uid', user.id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!updatedRow) throw new Error('Profile record could not be updated.');
      setProfile(prev => prev ? { ...prev, ...(updatedRow as Partial<UserProfile>), ...updatedData } : null);
      toast.success('Profile updated successfully');
    } catch (error) {
      handleSupabaseError(error, OperationType.UPDATE, `users/${user.id}`);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{
      user, profile, profileError, loading, signIn, signInWithEmail, resetPassword, logout, retryProfile, updateRole, updateProfileData
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
