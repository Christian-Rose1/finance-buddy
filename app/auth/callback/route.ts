import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/dashboard';

  if (!code) {
    return NextResponse.redirect(new URL('/login', requestUrl.origin));
  }

  const supabase = createServerClient();

  // Exchange the OAuth code for an authenticated session. The @supabase/ssr
  // server client writes the session into cookies (readable by both this route
  // and the browser client) before the redirect. If exchange fails, redirect
  // safely to /login without exposing auth errors or tokens.
  //
  // NOTE: the installed @supabase/auth-js (2.111.0) exposes
  // `exchangeCodeForSession(authCode, options?)` — NOT `exchangeCodeForTokens`.
  // Its JSDoc requires the PKCE `flowId` to be read from the reserved
  // `sb_flow_id` query param so the matching code verifier (stored in a
  // `<storageKey>-code-verifier` cookie by the browser client) can be resolved.
  const flowId = requestUrl.searchParams.get('sb_flow_id');
  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined
  );

  if (error) {
    console.error('Auth callback error:', error);
    return NextResponse.redirect(new URL('/login', requestUrl.origin));
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
