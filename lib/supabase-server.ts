import {
  createServerClient as createSupabaseServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";

export function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase environment variables are missing. Check your .env.local file."
    );
  }

  const cookieStore = cookies();

  return createSupabaseServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      async get(name: string) {
        return (await cookieStore).get(name)?.value;
      },
      async set(name: string, value: string, options: CookieOptions) {
        (await cookieStore).set(name, value, options);
      },
      async remove(name: string, options: CookieOptions) {
        (await cookieStore).set(name, "", { ...options, maxAge: 0 });
      },
    },
  });
}
