"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';

export default function TestPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Checking Supabase connection...');

  useEffect(() => {
    async function checkConnection() {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.getSession();

        if (error) {
          setStatus('error');
          setMessage(`Connection failed: ${error.message}`);
          return;
        }

        setStatus('success');
        setMessage('Supabase Connected');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setStatus('error');
        setMessage(`Connection failed: ${message}`);
      }
    }

    checkConnection();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Supabase Test</p>
        <h1 className="mt-3 text-2xl font-semibold">Connection Status</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          {status === 'success' ? (
            <span className="font-semibold text-emerald-400">Supabase Connected</span>
          ) : status === 'error' ? (
            <span className="font-semibold text-rose-400">{message}</span>
          ) : (
            <span className="text-slate-400">{message}</span>
          )}
        </p>
      </div>
    </main>
  );
}
