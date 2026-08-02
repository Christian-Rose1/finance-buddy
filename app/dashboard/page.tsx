import { Nav } from '@/components/nav';
import {
  ArrowUpRight,
  BarChart3,
  CircleDollarSign,
  FileUp,
  LayoutGrid,
  Lightbulb,
  ReceiptText,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

const sidebarItems = [
  { label: 'Dashboard', icon: LayoutGrid, active: true },
  { label: 'Statements', icon: ReceiptText, active: false },
  { label: 'Insights', icon: Lightbulb, active: false },
  { label: 'Settings', icon: Settings, active: false },
];

const metrics = [
  { label: 'Money Found', value: '$1,842', icon: CircleDollarSign, accent: 'text-emerald-300' },
  { label: 'Finance Buddy Score', value: '92', icon: Sparkles, accent: 'text-sky-300' },
  { label: 'Potential Rewards Missed', value: '$324', icon: Target, accent: 'text-amber-300' },
  { label: 'Monthly Spend', value: '$6,284', icon: Wallet, accent: 'text-violet-300' },
];

const recommendations = [
  {
    title: 'Recover duplicate card charges',
    detail: 'Two recurring charges from your last statement appear to be duplicates. Saving about $48 monthly.',
  },
  {
    title: 'Unlock higher travel rewards',
    detail: 'Switching one hotel booking to your travel card could earn an extra 2.3% back.',
  },
  {
    title: 'Increase emergency fund transfer',
    detail: 'A $150 automatic transfer would keep your savings target on pace this month.',
  },
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-transparent text-slate-100">
      <Nav />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="fb-card flex h-fit flex-col gap-5 p-5">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Workspace</p>
              <p className="mt-2 text-lg font-semibold text-white">Cashflow OS</p>
              <p className="mt-1 text-sm text-slate-400">A calm view of what matters most.</p>
            </div>

            <nav className="space-y-2">
              {sidebarItems.map(({ label, icon: Icon, active }) => (
                <button
                  key={label}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium transition ${
                    active
                      ? 'bg-sky-400/12 text-sky-200 shadow-inner shadow-sky-400/10'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className={`rounded-xl p-2 ${active ? 'bg-sky-400/15' : 'bg-white/5'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {label}
                </button>
              ))}
            </nav>

            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
              <p className="font-medium">Your plan is healthy</p>
              <p className="mt-1 text-emerald-100/80">You are pacing 8% ahead of your target savings goal.</p>
            </div>
          </aside>

          <section className="space-y-6">
            <div className="fb-card p-4 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm text-slate-400">Good afternoon</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    Your money is working harder than ever.
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400 sm:text-base">
                    Track reward opportunities, spending trends, and statement uploads from one elegant control center.
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                >
                  Sign out
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map(({ label, value, icon: Icon, accent }) => (
                <div key={label} className="fb-card p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-400">{label}</p>
                    <span className={`rounded-2xl bg-white/5 p-2 ${accent}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="mt-5 text-3xl font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="fb-card overflow-hidden p-4 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-sky-300">Upload statement</p>
                  <h2 className="mt-1 text-xl font-semibold text-white">Bring in your latest statement in one click.</h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400">
                    We will surface missed rewards, duplicate charges, and smart savings opportunities in seconds.
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:opacity-90"
                >
                  <FileUp className="mr-2 h-5 w-5" />
                  Upload statement
                </button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="fb-card p-4 sm:p-6">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-sky-300" />
                  <h2 className="text-lg font-semibold text-white">Priority actions</h2>
                </div>

                <div className="mt-5 space-y-3">
                  {recommendations.map((item) => (
                    <div key={item.title} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{item.title}</p>
                          <p className="mt-1 text-sm text-slate-400">{item.detail}</p>
                        </div>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-400/10 text-sky-300">
                          <ArrowUpRight className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="fb-card p-4 sm:p-6">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-sky-300" />
                  <h2 className="text-lg font-semibold text-white">This month at a glance</h2>
                </div>

                <div className="mt-5 space-y-3">
                  {[
                    { label: 'Spend pacing', value: '+12.3% vs last month', tone: 'text-emerald-300' },
                    { label: 'Cash-back recovery', value: '$186 available', tone: 'text-sky-300' },
                    { label: 'Card utilization', value: '74% healthy balance', tone: 'text-violet-300' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm text-slate-400">{item.label}</p>
                        <p className="mt-1 text-sm font-medium text-white">{item.value}</p>
                      </div>
                      <div className={`rounded-full bg-white/5 px-3 py-1 text-sm ${item.tone}`}>
                        <TrendingUp className="mr-1 inline h-4 w-4" />
                        Live
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}