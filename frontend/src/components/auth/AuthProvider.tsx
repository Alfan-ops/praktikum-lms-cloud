import React, { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../utils/supabase/info';
import { logger } from '../utils/logger'; // Import logger

const supabaseUrl = `https://${projectId}.supabase.co`;
const supabaseAnonKey = publicAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface User {
  id: string;
  email: string;
  user_metadata: {
    name?: string;
    role?: 'admin' | 'student';
    nim?: string;
    department?: string;
    semester?: number;
    major?: string;
  };
}

// --- NEW: Type for auth headers ---
type AuthHeader = { [key: string]: string };

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, userData: any) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (userData: any) => Promise<{ error?: string }>;
  getAuthHeader: (isFormData?: boolean) => AuthHeader; // <-- ADD THIS
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // --- NEW: Auth Header Function ---
  const getAuthHeader = (isFormData: boolean = false): AuthHeader => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;

    if (!token) {
      logger.warn('Auth token not found for API call');
      return isFormData ? {} : { 'Content-Type': 'application/json' };
    }
    
    if (isFormData) {
      // Don't set Content-Type, browser does it with boundary
      return { 'Authorization': `Bearer ${token}` };
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user as User || null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user as User || null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        return { error: error.message };
      }
      
      return {};
    } catch (error) {
      return { error: 'An unexpected error occurred' };
    }
  };

  const signUp = async (email: string, password: string, userData: any) => {
    try {
      // Use server endpoint for user creation
      const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a2395876/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({
          email,
          password,
          userData
        })
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.error || 'Signup failed' };
      }

      return {};
    } catch (error) {
      console.error('Signup error:', error);
      return { error: 'An unexpected error occurred during signup' };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const updateProfile = async (userData: any) => {
    try {
      const { error } = await supabase.auth.updateUser({
        data: userData
      });
      
      if (error) {
        return { error: error.message };
      }
      
      return {};
    } catch (error) {
      return { error: 'An unexpected error occurred' };
    }
  };

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signOut,
    updateProfile,
    getAuthHeader, // <-- ADD THIS
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}