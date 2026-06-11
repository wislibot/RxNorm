import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { AppLanguage } from '../lib/i18n';
import { getSupabaseClient, type AppSupabaseClient, type AuthSession, type AuthUser } from '../lib/supabase';
import { PREFERRED_LANGUAGE_KEY, secureStoreStorage, type AppStorage } from '../lib/storage';
import { isStaff, getStaffHospitals, type StaffHospital } from '../api/staff';

type AuthContextValue = {
  isLoading: boolean;
  session: AuthSession;
  user: AuthUser;
  preferredLanguage: AppLanguage | null;
  needsLanguageSelection: boolean;
  isStaffUser: boolean;
  staffHospitals: StaffHospital[];
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ requiresEmailVerification: boolean }>;
  signOut: () => Promise<void>;
  setPreferredLanguage: (language: AppLanguage) => Promise<void>;
};

type AuthProviderProps = {
  children: React.ReactNode;
  client?: AppSupabaseClient;
  storage?: AppStorage;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readUserPreferredLanguage(user: AuthUser): AppLanguage | null {
  const preferredLanguage = user?.user_metadata?.preferred_language;
  return preferredLanguage === 'zh-TW' || preferredLanguage === 'en' ? preferredLanguage : null;
}

async function resolvePreferredLanguage(storage: AppStorage, user: AuthUser) {
  const stored = await storage.getItem(PREFERRED_LANGUAGE_KEY);
  if (stored === 'en' || stored === 'zh-TW') {
    return stored;
  }
  return readUserPreferredLanguage(user);
}

export function AuthProvider({ children, client = getSupabaseClient(), storage = secureStoreStorage }: AuthProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<AuthSession>(null);
  const [user, setUser] = useState<AuthUser>(null);
  const [preferredLanguage, setPreferredLanguageState] = useState<AppLanguage | null>(null);
  const [needsLanguageSelection, setNeedsLanguageSelection] = useState(false);
  const [isStaffUser, setIsStaffUser] = useState(false);
  const [staffHospitals, setStaffHospitals] = useState<StaffHospital[]>([]);
  const syncSessionState = useCallback(
    async (nextSession: AuthSession) => {
      const nextUser = nextSession?.user ?? null;
      const language = await resolvePreferredLanguage(storage, nextUser);
      setSession(nextSession);
      setUser(nextUser);
      setPreferredLanguageState(language);
      setNeedsLanguageSelection(Boolean(nextUser) && !language);

      // Detect staff role
      if (nextUser) {
        try {
          console.log('[AuthProvider] Checking staff role for user:', nextUser.id);
          const staff = await isStaff();
          console.log('[AuthProvider] isStaff result:', staff);
          setIsStaffUser(staff);
          if (staff) {
            const hospitals = await getStaffHospitals();
            console.log('[AuthProvider] Staff hospitals:', hospitals);
            setStaffHospitals(hospitals);
          } else {
            setStaffHospitals([]);
          }
        } catch (err) {
          console.error('[AuthProvider] Staff detection error:', err);
          setIsStaffUser(false);
          setStaffHospitals([]);
        }
      } else {
        setIsStaffUser(false);
        setStaffHospitals([]);
      }

      setIsLoading(false);
    },
    [storage],
  );

  useEffect(() => {
    let isMounted = true;
    void client.auth.getSession().then(async ({ data }) => {
      if (!isMounted) {
        return;
      }
      await syncSessionState(data.session ?? null);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      void syncSessionState(nextSession ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [client, storage]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      session,
      user,
      preferredLanguage,
      needsLanguageSelection,
      isStaffUser,
      staffHospitals,
      async signIn(email, password) {
        setIsLoading(true);
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          setIsLoading(false);
          throw error;
        }
        await syncSessionState(data.session ?? null);
      },
      async signUp(email, password) {
        setIsLoading(true);
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) {
          setIsLoading(false);
          throw error;
        }
        const requiresEmailVerification = !data.session;
        await syncSessionState(data.session ?? null);
        return { requiresEmailVerification };
      },
      async signOut() {
        setIsLoading(true);
        const { error } = await client.auth.signOut();
        if (error) {
          setIsLoading(false);
          throw error;
        }
        setPreferredLanguageState(null);
        setNeedsLanguageSelection(false);
        setIsStaffUser(false);
        setStaffHospitals([]);
        setIsLoading(false);
      },
      async setPreferredLanguage(language) {
        await storage.setItem(PREFERRED_LANGUAGE_KEY, language);
        if (user) {
          // No dedicated profiles table exists yet, so we persist the server-side preference in auth metadata.
          await client.auth.updateUser({
            data: {
              preferred_language: language,
            },
          });
        }
        setPreferredLanguageState(language);
        setNeedsLanguageSelection(false);
      },
    }),
    [client, isLoading, isStaffUser, needsLanguageSelection, preferredLanguage, session, staffHospitals, storage, syncSessionState, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
