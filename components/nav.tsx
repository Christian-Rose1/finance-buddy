import Link from 'next/link';

export function Nav() {
  return (
    <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3 text-base font-semibold tracking-tight text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-400/10 text-sky-300">
            FB
          </span>
          <span>Finance Buddy</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm text-slate-300">
          <Link href="/dashboard" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">
            Dashboard
          </Link>
          <Link href="/wallet" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">
            Wallet
          </Link>
          <Link href="/upload" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">
            Upload
          </Link>
        </nav>
      </div>
    </header>
  );
}
