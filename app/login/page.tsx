"use client";

import { useState } from 'react';
import { createClient } from '@/lib/supabase';

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const baseUrl = window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : window.location.origin;

      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${baseUrl}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        console.error('Google sign-in failed:', error);
        throw error;
      }

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No redirect URL was returned by Supabase.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start Google sign-in.';
      console.error('Google sign-in error:', err);
      setError(message);
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Finance Buddy</p>
        <h1 className="mt-3 text-2xl font-semibold">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Continue with Google to access your dashboard.
        </p>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 font-medium text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {error ? (
          <p className="mt-4 text-sm text-rose-400">{error}</p>
        ) : null}
      </div>
    </main>
  );
}
