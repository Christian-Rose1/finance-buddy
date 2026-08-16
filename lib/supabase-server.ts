import {
  createServerClient as createSupabaseServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-aware Supabase server client factory for Next.js 15 + @supabase/ssr.
 *
 * `cookies()` returns a Promise in Next.js 15; it must be awaited so the
 * resolved `ReadonlyRequestCookies` carries the correct per-request context.
 * The `@supabase/ssr` `getAll` / `setAll` (non-deprecated) interface is used.
 *
 * In Server Components the cookie store is sealed: writes throw
 * "Cookies can only be modified in a Server Action or Route Handler."
 * This happens when an expired session triggers a token refresh whose
 * `onAuthStateChange(TOKEN_REFRESHED)` event calls `applyServerStorage` →
 * `setAll`. The targeted catch below swallows only that expected error so
 * the in-memory session still refreshes for the current request.
 *
 * In Route Handlers (e.g. /auth/callback) the cookie store is mutable, so
 * `setAll` succeeds and OAuth code exchange + session persistence work.
 */
export async function createServerClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase environment variables are missing. Check your .env.local file."
    );
  }

  const cookieStore = await cookies();

  return createSupabaseServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          // The Next.js cookie store exposes per-cookie `set` (it has no
          // `setAll` method). In a Server Component the store is sealed and
          // `set` throws the read-only-cookie error caught below; in a Route
          // Handler or Server Action the store is mutable and the cookie is
          // persisted.
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes(
              "Cookies can only be modified in a Server Action or Route Handler"
            )
          ) {
            return;
          }
          throw error;
        }
      },
    },
  });
}
