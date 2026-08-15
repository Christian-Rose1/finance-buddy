import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr';

// Browser client. Uses @supabase/ssr's createBrowserClient so it shares the
// SAME cookie-based session store as the server client (lib/supabase-server.ts).
// The previous @supabase/supabase-js client stored the session in localStorage,
// which the @supabase/ssr server client could not read — causing signed-in
// users to appear unauthenticated in server contexts.
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing. Check your .env.local file.');
  }

  return createSupabaseBrowserClient(supabaseUrl, supabaseAnonKey);
}
