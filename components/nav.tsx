'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav() {
  const pathname = usePathname();

  const isDashboard = pathname === '/dashboard';
  const isGoals = pathname === '/goals' || pathname.startsWith('/goals/');
  const isWallet = pathname === '/wallet' || pathname.startsWith('/wallet/');
  const isAddData = pathname === '/upload' || pathname === '/receipts';

  const linkClass = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-2 transition ${
      active ? 'bg-sky-400/10 text-sky-300' : 'hover:bg-white/10 hover:text-white'
    }`;

  return (
    <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3 text-base font-semibold tracking-tight text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-400/10 text-sky-300">
            FB
          </span>
          <span>Finance Buddy</span>
        </Link>
        <nav className="flex items-center gap-2 overflow-x-auto text-sm text-slate-300">
          <Link
            href="/dashboard"
            aria-current={isDashboard ? 'page' : undefined}
            className={linkClass(isDashboard)}
          >
            Dashboard
          </Link>
          <Link
            href="/goals"
            aria-current={isGoals ? 'page' : undefined}
            className={linkClass(isGoals)}
          >
            Goals
          </Link>
          <Link
            href="/wallet"
            aria-current={isWallet ? 'page' : undefined}
            className={linkClass(isWallet)}
          >
            Wallet
          </Link>
          <Link
            href="/upload"
            aria-current={isAddData ? 'page' : undefined}
            className={linkClass(isAddData)}
          >
            Add Data
          </Link>
        </nav>
      </div>
    </header>
  );
}
