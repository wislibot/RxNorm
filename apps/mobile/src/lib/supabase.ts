import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

import { secureStoreStorage } from './storage';

export type AuthSession = Session | null;
export type AuthUser = User | null;

export type AppSupabaseClient = Pick<SupabaseClient, 'auth' | 'from' | 'rpc' | 'storage'>;

let clientSingleton: AppSupabaseClient | null = null;

function getRequiredEnv(name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required Expo environment variable: ${name}`);
  }
  return value;
}

export function createAppSupabaseClient(): AppSupabaseClient {
  return createClient(getRequiredEnv('EXPO_PUBLIC_SUPABASE_URL'), getRequiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: {
      storage: secureStoreStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export function getSupabaseClient() {
  if (!clientSingleton) {
    clientSingleton = createAppSupabaseClient();
  }
  return clientSingleton;
}
