import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Nav } from '@/components/nav';
import { PurchaseHistory } from '@/components/purchase-history';
import { SignOutButton } from '@/components/sign-out-button';
import { createServerClient } from '@/lib/supabase-server';
import { getPurchasesForUser } from '@/lib/purchases/repository';
import { getWalletCardsForUser } from '@/lib/wallet/repository';
import { getWalletBenefitsWithProducts } from '@/lib/wallet/benefitsRepository';
import type { WalletBenefitDisplay } from '@/lib/wallet/benefitsRepository';
import { summarizeSpending } from '@/lib/purchases/spendingSummary';
import { formatMoney } from '@/lib/purchases/formatMoney';
import {
  BarChart3,
  CircleDollarSign,
  FileUp,
  LayoutGrid,
  Lightbulb,
  ShoppingBag,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

const sidebarItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid, active: true },
  { label: 'Goals', href: '/goals', icon: Target, active: false },
  { label: 'Wallet', href: '/wallet', icon: Wallet, active: false },
  { label: 'Add data', href: '/upload', icon: FileUp, active: false },
] as const;

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
  total: number | null;
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
    let total: number | null = null;

    for (const card of activeCards) {
      const displays: WalletBenefitDisplay[] =
        await getWalletBenefitsWithProducts(card.id, userId);

      for (const { product, state } of displays) {
        // Only active benefits count as currently-available value.
        if (!state.active) continue;
        // Dedupe by benefit row id (a benefit belongs to one card).
        if (seen.has(state.id)) continue;
        seen.add(state.id);

        // ProductBenefit currently has no authoritative currency field. Do not
        // display or aggregate a numeric value under an invented USD label.
      }
    }

    // Round to cents.
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
        total: null,
        items: [],
        error: 'Unable to load your purchases right now.',
      },
      error: 'Unable to load your purchases right now.',
    };
  }
}

export default async function DashboardPage() {
  const { purchases, availableBenefits, error } = await loadDashboardData();

  const spending = summarizeSpending(purchases);
  const categoryTotals = spending.categoryTotals;
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

            <nav className="space-y-2" aria-label="Dashboard shortcuts">
              {sidebarItems.map(({ label, href, icon: Icon, active }) => (
                <Link
                  key={label}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium transition ${
                    active
                      ? 'bg-sky-400/12 text-sky-200 shadow-inner shadow-sky-400/10'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className={`rounded-xl p-2 ${active ? 'bg-sky-400/15' : 'bg-white/5'}`}>
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  {label}
                </Link>
              ))}
            </nav>

            <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-sm text-sky-200">
              <p className="font-medium">Dashboard data</p>
              <p className="mt-1 text-sky-100/80">
                {error
                  ? 'Some dashboard data could not be loaded.'
                  : hasPurchases
                    ? `${purchases.length} purchase${purchases.length === 1 ? '' : 's'} loaded.`
                    : 'No purchases loaded yet.'}
              </p>
            </div>
          </aside>

          <section className="space-y-6">
            <div className="fb-card p-4 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm text-slate-400">Dashboard</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    Your financial overview
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400 sm:text-base">
                    Review loaded purchases, spending categories, and available card benefits in one place.
                  </p>
                </div>
                <SignOutButton />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: 'Total Spending',
                  value:
                    spending.total !== null && spending.currency !== null
                      ? formatMoney(spending.total, spending.currency)
                      : 'Not available',
                  icon: CircleDollarSign,
                  accent: 'text-emerald-300',
                },
                { label: 'Purchases', value: String(purchases.length), icon: ShoppingBag, accent: 'text-sky-300' },
                { label: 'Top Category', value: categoryTotals[0]?.category ?? '—', icon: Target, accent: 'text-amber-300' },
                { label: 'Categories', value: String(categoryTotals.length), icon: Wallet, accent: 'text-violet-300' },
              ].map(({ label, value, icon: Icon, accent }) => (
                <div key={label} className="fb-card p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-400">{label}</p>
                    <span className={`rounded-2xl bg-white/5 p-2 ${accent}`}>
                    <Icon aria-hidden="true" className="h-4 w-4" />
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
                    <CircleDollarSign aria-hidden="true" className="h-4 w-4" />
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
                    <Wallet aria-hidden="true" className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-5 text-3xl font-semibold text-white">
                  {availableBenefits.error
                    ? 'Not calculated'
                    : availableBenefits.total === null
                      ? 'Currency unknown'
                      : formatMoney(availableBenefits.total, 'USD')}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Unclaimed benefit balances on cards you own — not yet applied to any purchase.
                </p>
                {availableBenefits.items.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {availableBenefits.items.map((item) => (
                      <div
                        key={item.title}
                        className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5"
                      >
                        <span className="min-w-0 break-words text-sm text-slate-300">{item.title}</span>
                        <span className="shrink-0 text-sm font-medium text-sky-300">
                          {formatMoney(item.remaining, 'USD')}
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
                    <Lightbulb aria-hidden="true" className="h-4 w-4" />
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
                    Add purchases from a statement to update your spending totals and categories.
                  </p>
                </div>
                <Link
                  href="/upload"
                  className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:opacity-90"
                >
                  <FileUp aria-hidden="true" className="mr-2 h-5 w-5" />
                  Upload statement
                </Link>
              </div>
            </div>

            {error ? (
              <div
                className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200"
                role="alert"
              >
                <p className="font-medium">Something went wrong</p>
                <p className="mt-1 text-rose-100/80">{error}</p>
              </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="fb-card p-4 sm:p-6">
                {!hasPurchases ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <ShoppingBag aria-hidden="true" className="h-5 w-5 text-sky-300" />
                      <h2 className="text-lg font-semibold text-white">Purchase History</h2>
                    </div>
                    <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-6 text-center">
                      <p className="font-medium text-white">No purchases yet</p>
                      <p className="mt-2 text-sm text-slate-400">
                        Upload a receipt or statement to start building your dashboard.
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-3">
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
                  <BarChart3 aria-hidden="true" className="h-5 w-5 text-sky-300" />
                  <h2 className="text-lg font-semibold text-white">Category spending</h2>
                </div>

                {!hasPurchases ? (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-6 text-center">
                    <p className="text-sm text-slate-400">
                      Categories will appear here once you have added purchases.
                    </p>
                  </div>
                ) : spending.status !== 'single_currency' ? (
                  <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                    <p className="text-sm text-amber-100/80">
                      Spending totals are unavailable because one or more purchases
                      have an unknown currency or use different currencies.
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
                            {formatMoney(item.total, spending.currency)}
                          </p>
                        </div>
                        <div className="rounded-full bg-white/5 px-3 py-1 text-sm text-emerald-300">
                          <TrendingUp aria-hidden="true" className="mr-1 inline h-4 w-4" />
                          {((item.total / Math.max(spending.total ?? 0, 1)) * 100).toFixed(0)}%
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
