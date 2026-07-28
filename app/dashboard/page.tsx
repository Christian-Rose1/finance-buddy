import { Nav } from '@/components/nav';
import { BarChart3, FileUp, MessageSquare, ShieldCheck } from 'lucide-react';

const recommendations = [
  { title: 'Activate Shell offer', detail: 'Worth about $8.20. Expires tomorrow.' },
  { title: 'Use Whole Foods offer', detail: 'Likely saves $11.00 on your next grocery trip.' },
  { title: 'Dining spend up 18%', detail: 'You spent more at restaurants than last month.' },
];

export default function DashboardPage() {
  return (
    <main>
      <Nav />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <section className="fb-card p-6">
            <p className="text-sm text-slate-400">Good afternoon</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Your Finance Buddy dashboard</h1>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <Stat label="Money Found" value="$42" />
              <Stat label="Finance Buddy Score" value="83" />
              <Stat label="Points Earned" value="5,482" />
            </div>
            <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-black/20 p-6">
              <div className="flex items-center gap-3 text-slate-200">
                <FileUp className="h-5 w-5 text-sky-300" />
                Upload your first Chase statement
              </div>
              <p className="mt-2 text-sm text-slate-400">
                This starter repo is set up for statement upload, analysis, and recommendations.
              </p>
            </div>
          </section>

          <section className="fb-card p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <MessageSquare className="h-4 w-4 text-sky-300" />
              Recent recommendations
            </div>
            <div className="mt-4 space-y-3">
              {recommendations.map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              No Plaid, no browser automation, no card credentials.
            </div>
          </section>
        </div>

        <section className="mt-6 fb-card p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <BarChart3 className="h-4 w-4 text-sky-300" />
            Monthly overview
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            {['Groceries $842', 'Dining $630', 'Travel $511', 'Gas $291'].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}
