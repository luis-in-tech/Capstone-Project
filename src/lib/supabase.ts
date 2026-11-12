import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env?.VITE_SUPABASE_URL?.trim() ?? '';
const rawAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

export const supabaseConfigError: string | null =
  !rawUrl || !rawAnonKey || rawUrl.includes('placeholder.supabase.co') || rawAnonKey === 'placeholder'
    ? 'Supabase configuration is missing or invalid. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.'
    : null;

export const isSupabaseConfigured = supabaseConfigError === null;

if (supabaseConfigError) {
  console.error(supabaseConfigError);
}

function createUnconfiguredClient(message: string): SupabaseClient {
  const throwConfigError = (): never => {
    throw new Error(message);
  };
  const handler: ProxyHandler<() => never> = {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return proxy;
    },
    apply() {
      return throwConfigError();
    },
  };
  const proxy: () => never = new Proxy(throwConfigError, handler);
  return proxy as unknown as SupabaseClient;
}

export const supabase: SupabaseClient = supabaseConfigError
  ? createUnconfiguredClient(supabaseConfigError)
  : createClient(rawUrl, rawAnonKey);

