export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  publicAppUrl: string;
}

export function getAppEnv(): AppEnv {
  return {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
    publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL ?? "",
  };
}
