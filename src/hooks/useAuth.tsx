import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  updateRole: (role: 'admin' | 'secretary' | 'agent') => Promise<void>;
  updateProfileData: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      await supabase.auth.signOut();
      toast.warning('Session expired', {
        description: 'You were logged out due to 5 minutes of inactivity.',
        duration: 6000,
      });
    }, INACTIVITY_TIMEOUT_MS);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleUserChange(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUserChange(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUserChange = async (currentUser: User | null) => {
    setUser(currentUser);
    if (currentUser) {
      try {
        const { data: docSnap, error } = await supabase
          .from('users')
          .select('*')
          .eq('uid', currentUser.id)
          .maybeSingle();
        
        if (docSnap && !error) {
          setProfile(docSnap as UserProfile);
        } else {
          // If not found, create one
          const isAdmin = currentUser.email?.toLowerCase() === 'lancejsy16@gmail.com' || currentUser.email?.toLowerCase() === 'admin@example.com';
          const [firstName = '', ...lastNameParts] = (currentUser.user_metadata?.full_name || '').split(' ');
          const lastName = lastNameParts.join(' ');
          
          const newProfile: UserProfile = {
            uid: currentUser.id,
            email: currentUser.email || '',
            displayName: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
            firstName,
            lastName,
            photoUrl: currentUser.user_metadata?.avatar_url || '',
            role: isAdmin ? 'admin' : 'agent'
          };
          
          const { error: insertError } = await supabase.from('users').insert([newProfile]);
          if (insertError) throw insertError;
          setProfile(newProfile);
        }
      } catch (error) {
        handleSupabaseError(error, OperationType.GET, `users/${currentUser.id}`);
        setProfile({
          uid: currentUser.id,
          email: currentUser.email || '',
          displayName: currentUser.user_metadata?.full_name || 'User',
          role: 'agent'
        });
      }
    } else {
      setProfile(null);
    }
    setLoading(false);
    resetInactivityTimer(currentUser);
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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success('Logged in successfully');
    } catch (error: any) {
      console.error("Email sign-in error:", error);
      toast.error('Login failed', { description: error.message });
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      toast.success('Account created successfully');
    } catch (error: any) {
      console.error("Email sign-up error:", error);
      toast.error('Registration failed', { description: error.message });
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      toast.success('Reset email sent', { description: 'Please check your inbox for instructions.' });
    } catch (error: any) {
      console.error("Password reset error:", error);
      toast.error('Process failed', { description: 'Could not send reset email. Verify the address is correct.' });
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const updateRole = async (role: 'admin' | 'secretary' | 'agent') => {
    if (!user) return;
    if (role === 'admin' && profile?.role !== 'admin') {
      toast.error('Unauthorized', { description: 'Admin privileges cannot be self-assigned.' });
      return;
    }
    try {
      const { error } = await supabase
        .from('users')
        .update({ role })
        .eq('uid', user.id);
      if (error) throw error;
      setProfile(prev => prev ? { ...prev, role } : null);
      toast.success(`Role switched to ${role.toUpperCase()}`);
    } catch (error) {
      handleSupabaseError(error, OperationType.UPDATE, `users/${user.id}`);
    }
  };

  const updateProfileData = async (data: Partial<UserProfile>) => {
    if (!user) return;
    try {
      const updatedData = { ...data };
      if (data.firstName || data.lastName) {
        const currentFirstName = data.firstName ?? profile?.firstName ?? '';
        const currentLastName = data.lastName ?? profile?.lastName ?? '';
        updatedData.displayName = `${currentFirstName} ${currentLastName}`.trim() || profile?.displayName || '';
      }

      const { error } = await supabase
        .from('users')
        .update(updatedData)
        .eq('uid', user.id);
      
      if (error) throw error;
      setProfile(prev => prev ? { ...prev, ...updatedData } : null);
      toast.success('Profile updated successfully');
    } catch (error) {
      handleSupabaseError(error, OperationType.UPDATE, `users/${user.id}`);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, profile, loading, signIn, signInWithEmail, signUpWithEmail, resetPassword, logout, updateRole, updateProfileData 
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
