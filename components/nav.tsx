import Link from 'next/link';

export function Nav() {
  return (
    <header className="border-b border-white/10 bg-black/20 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-base font-semibold tracking-tight text-white">
          Finance Buddy
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-300">
          <Link href="/dashboard" className="hover:text-white">
            Dashboard
          </Link>
          <Link href="/upload" className="hover:text-white">
            Upload
          </Link>
        </nav>
      </div>
    </header>
  );
}
