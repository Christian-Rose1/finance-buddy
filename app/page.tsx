import Link from 'next/link';
import { ArrowRight, Sparkles, Upload } from 'lucide-react';
import { Nav } from '@/components/nav';

export default function HomePage() {
  return (
    <main>
      <Nav />
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:py-24">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm text-sky-200">
            <Sparkles className="h-4 w-4" />
            MVP foundation ready
          </div>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Find the money your cards are already hiding.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-slate-300">
            Upload a Chase statement, see where your spending goes, and surface rewards and offers worth using.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="fb-btn">
              Open dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="/upload" className="fb-btn-secondary">
              <Upload className="mr-2 h-4 w-4" />
              Upload statement
            </Link>
          </div>
        </div>

        <div className="fb-card p-6">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Illustrative sample</p>
          <p className="mt-2 text-sm text-slate-400">
            Example values only. These are not calculated from your financial data.
          </p>
          <div className="mt-6 space-y-4">
            <Metric label="Example Money Found" value="$42.18" />
            <Metric label="Example Potential Rewards" value="$19.00" />
            <Metric label="Example Monthly Points" value="5,482" />
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
