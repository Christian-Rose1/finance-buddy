import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Nav } from '@/components/nav';
import { PurchaseHistory } from '@/components/purchase-history';
import { createServerClient } from '@/lib/supabase-server';
import { getPurchasesForUser } from '@/lib/purchases/repository';
import { getWalletCardsForUser } from '@/lib/wallet/repository';
import { getWalletBenefitsWithProducts } from '@/lib/wallet/benefitsRepository';
import type { Purchase } from '@/lib/purchases/types';
import type { WalletBenefitDisplay } from '@/lib/wallet/benefitsRepository';
import {
  BarChart3,
  CircleDollarSign,
  FileUp,
  LayoutGrid,
  Lightbulb,
  ReceiptText,
  Settings,
  ShoppingBag,
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

function formatCurrency(value: number, currency: string | null): string {
  const code = currency && currency.length === 3 ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function computeTotalSpending(purchases: Purchase[]): number {
  return purchases.reduce((sum, purchase) => {
    const amount = purchase.amount;
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
      return sum;
    }
    return sum + amount;
  }, 0);
}

function computeCategoryTotals(
  purchases: Purchase[]
): { category: string; total: number }[] {
  const map = new Map<string, number>();
  for (const purchase of purchases) {
    if (!purchase.category) continue;
    const amount = purchase.amount;
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
      continue;
    }
    map.set(purchase.category, (map.get(purchase.category) ?? 0) + amount);
  }
  return Array.from(map.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

// =============================================================================
// Available benefits aggregation (dashboard-wide view)
//
// Sums `remainingValue` of ACTIVE benefits for the user's active wallet cards.
// Each benefit row is distinct (one per card), so summing across cards does not
// double-count. We additionally dedupe by benefit row id as a safety net and
// skip inactive benefits / negative-or-zero balances.
//
// This is "available / unclaimed benefit value" — it is NOT Money Found. It is
// the balance still available to be applied to future qualifying purchases.
// =============================================================================

interface AvailableBenefitItem {
  title: string;
  remaining: number;
}

interface AvailableBenefitsResult {
  total: number;
  items: AvailableBenefitItem[];
  error: string | null;
}

async function loadAvailableBenefits(
  userId: string
): Promise<AvailableBenefitsResult> {
  try {
    const cards = await getWalletCardsForUser(userId);
    const activeCards = cards.filter((card) => card.active);

    const items: AvailableBenefitItem[] = [];
    const seen = new Set<string>();
    let total = 0;

    for (const card of activeCards) {
      const displays: WalletBenefitDisplay[] =
        await getWalletBenefitsWithProducts(card.id, userId);

      for (const { product, state } of displays) {
        // Only active benefits count as currently-available value.
        if (!state.active) continue;
        // Dedupe by benefit row id (a benefit belongs to one card).
        if (seen.has(state.id)) continue;
        seen.add(state.id);

        if (state.remainingValue !== null && state.remainingValue > 0) {
          items.push({ title: product.title, remaining: state.remainingValue });
          total += state.remainingValue;
        }
      }
    }

    // Round to cents.
    total = Math.round(total * 100) / 100;

    return { total, items, error: null };
  } catch {
    return {
      total: 0,
      items: [],
      error: 'Unable to load your wallet benefits right now.',
    };
  }
}

async function loadDashboardData() {
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect('/login');
  }

  const userId = userData.user.id;

  try {
    const [purchases, availableBenefits] = await Promise.all([
      getPurchasesForUser(userId),
      loadAvailableBenefits(userId),
    ]);
    return { purchases, availableBenefits, error: null };
  } catch {
    return {
      purchases: [],
      availableBenefits: {
        total: 0,
        items: [],
        error: 'Unable to load your purchases right now.',
      },
      error: 'Unable to load your purchases right now.',
    };
  }
}

export default async function DashboardPage() {
  const { purchases, availableBenefits, error } = await loadDashboardData();

  const totalSpending = computeTotalSpending(purchases);
  const categoryTotals = computeCategoryTotals(purchases);
  const hasPurchases = purchases.length > 0;

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
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                >
                  Sign out
                </Link>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: 'Total Spending',
                  value: formatCurrency(totalSpending, 'USD'),
                  icon: CircleDollarSign,
                  accent: 'text-emerald-300',
                },
                { label: 'Purchases', value: String(purchases.length), icon: ShoppingBag, accent: 'text-sky-300' },
                { label: 'Top Category', value: categoryTotals[0]?.category ?? '—', icon: Target, accent: 'text-amber-300' },
                { label: 'Monthly Spend', value: '$6,284', icon: Wallet, accent: 'text-violet-300' },
              ].map(({ label, value, icon: Icon, accent }) => (
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

            {/* ---- Value Summary (MVP) ---- */}
            <div className="grid gap-4 md:grid-cols-3">
              {/* 1. Confirmed Money Found */}
              <div className="fb-card p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">Confirmed Money Found</p>
                  <span className="rounded-2xl bg-white/5 p-2 text-emerald-300">
                    <CircleDollarSign className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-5 text-3xl font-semibold text-amber-300">Not calculated yet</p>
                <p className="mt-2 text-xs text-slate-500">
                  Money you&apos;ve already earned on past purchases. Only confirmed, merchant-matched cashback and confirmed benefit value count. Computed per purchase on the Purchase Detail page; not yet rolled up to the dashboard.
                </p>
              </div>

              {/* 2. Available benefits (unclaimed balances on cards you own) */}
              <div className="fb-card p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">Available benefits</p>
                  <span className="rounded-2xl bg-white/5 p-2 text-sky-300">
                    <Wallet className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-5 text-3xl font-semibold text-white">
                  {availableBenefits.error
                    ? 'Not calculated'
                    : formatCurrency(availableBenefits.total, 'USD')}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Unclaimed benefit balances on cards you own — not yet applied to any purchase.
                </p>
                {availableBenefits.items.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {availableBenefits.items.map((item) => (
                      <div
                        key={item.title}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-1.5"
                      >
                        <span className="text-sm text-slate-300">{item.title}</span>
                        <span className="text-sm font-medium text-sky-300">
                          {formatCurrency(item.remaining, 'USD')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* 3. Potential opportunities */}
              <div className="fb-card p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">Potential opportunities</p>
                  <span className="rounded-2xl bg-white/5 p-2 text-amber-300">
                    <Lightbulb className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-5 text-3xl font-semibold text-amber-300">Not calculated yet</p>
                <p className="mt-2 text-xs text-slate-500">
                  Could-be savings from likely or unverifiable benefit matches. Not confirmed, so never counted as Money Found.
                </p>
              </div>
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
                <Link
                  href="/upload"
                  className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:opacity-90"
                >
                  <FileUp className="mr-2 h-5 w-5" />
                  Upload statement
                </Link>
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
                <p className="font-medium">Something went wrong</p>
                <p className="mt-1 text-rose-100/80">{error}</p>
              </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="fb-card p-4 sm:p-6">
                {!hasPurchases ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="h-5 w-5 text-sky-300" />
                      <h2 className="text-lg font-semibold text-white">Purchase History</h2>
                    </div>
                    <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-6 text-center">
                      <p className="font-medium text-white">No purchases yet</p>
                      <p className="mt-2 text-sm text-slate-400">
                        Upload a receipt or statement to start building your dashboard.
                      </p>
                      <div className="mt-4 flex justify-center gap-3">
                        <Link href="/upload" className="fb-btn">
                          Upload now
                        </Link>
                        <Link href="/receipts" className="fb-btn-secondary">
                          Add receipt
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : (
                  <PurchaseHistory purchases={purchases} />
                )}
              </section>

              <section className="fb-card p-4 sm:p-6">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-sky-300" />
                  <h2 className="text-lg font-semibold text-white">Category spending</h2>
                </div>

                {!hasPurchases ? (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-6 text-center">
                    <p className="text-sm text-slate-400">
                      Categories will appear here once you have added purchases.
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    {categoryTotals.slice(0, 6).map((item) => (
                      <div
                        key={item.category}
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm text-slate-400">{item.category}</p>
                          <p className="mt-1 text-sm font-medium text-white">
                            {formatCurrency(item.total, 'USD')}
                          </p>
                        </div>
                        <div className="rounded-full bg-white/5 px-3 py-1 text-sm text-emerald-300">
                          <TrendingUp className="mr-1 inline h-4 w-4" />
                          {((item.total / Math.max(totalSpending, 1)) * 100).toFixed(0)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
