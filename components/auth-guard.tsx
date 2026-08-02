"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();

        if (!isMounted) return;

        if (error || !data.user) {
          router.replace('/login');
          return;
        }

        setReady(true);
      } catch {
        if (isMounted) {
          router.replace('/login');
        }
      }
    }

    checkSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <p className="text-sm text-slate-400">Checking your session…</p>
      </div>
    );
  }

  return <>{children}</>;
}
