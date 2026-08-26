import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { createServerClient } from "@/lib/supabase-server";
import { getPurchaseForUser } from "@/lib/purchases/repository";
import { getWalletCardsForUser } from "@/lib/wallet/repository";
import {
  getCardProducts,
  getEarningRulesForProduct,
} from "@/lib/rewards/catalogRepository";
import {
  optimizePurchaseWithLinkedCards,
  type PurchaseOptimizationResult,
} from "@/lib/purchases/optimizePurchase";
import { getWalletBenefitsWithProducts } from "@/lib/wallet/benefitsRepository";
import {
  evaluateBenefitOpportunity,
  type BenefitOpportunity,
} from "@/lib/wallet/benefitOpportunity";
import {
  computeMoneyFound,
  type MoneyFoundResult,
} from "@/lib/purchases/moneyFound";
import type { Purchase } from "@/lib/purchases/types";
import { formatMoney } from "@/lib/purchases/formatMoney";
import type { WalletCard } from "@/lib/wallet/types";
import type { CardProduct, EarningRule } from "@/lib/rewards/catalogTypes";
import {
  ArrowLeft,
  Receipt,
  Calendar,
  CreditCard,
  Tag,
  Sparkles,
  Gift,
  Coins,
} from "lucide-react";
import { CardUsedSelector } from "@/components/card-used-selector";
import { BookingChannelSelector } from "../../../components/booking-channel-selector";

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

function formatRewardUnits(units: number): string {
  return Number.isInteger(units) ? String(units) : units.toFixed(2);
}

function formatStatus(status: string): string {
  switch (status) {
    case "confirmed_eligible":
      return "eligible";
    case "likely_eligible":
      return "likely eligible";
    case "unknown":
      return "cannot confirm";
    case "not_eligible":
      return "not eligible";
    default:
      return status;
  }
}

function formatBenefitStatus(status: BenefitOpportunity["status"]): string {
  switch (status) {
    case "confirmed_eligible":
      return "Eligible";
    case "likely_eligible":
      return "Likely eligible";
    case "insufficient_information":
      return "Cannot confirm";
    case "not_eligible":
      return "Not eligible";
    default:
      return status;
  }
}

async function loadPurchaseWithOptimization(id: string): Promise<{
  purchase: Purchase;
  optimization: PurchaseOptimizationResult | null;
  benefitOpportunities: BenefitOpportunity[];
  moneyFound: MoneyFoundResult;
  walletCards: WalletCard[];
} | null> {
  const supabase = await createServerClient();
  const {
    data: userData,
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect("/login");
  }

  const userId = userData.user.id;

  try {
    const purchase = await getPurchaseForUser(id, userId);
    if (!purchase) return null;

    const [walletCards, products] = await Promise.all([
      getWalletCardsForUser(userId),
      getCardProducts({ activeOnly: true }),
    ]);

    const linkedCards = walletCards.filter(
      (card) => card.active && card.cardProductId !== null
    );

    let optimization: PurchaseOptimizationResult | null = null;

    if (linkedCards.length > 0) {
      const rulesByProductId = await loadRulesForProducts(products, linkedCards);
      const productsById = new Map(products.map((p) => [p.id, p]));

      optimization = optimizePurchaseWithLinkedCards(
        purchase,
        walletCards,
        productsById,
        rulesByProductId
      );
    }

    // Load the user's active wallet benefit state (rehydrated with shared
    // product definitions) and evaluate each against this Purchase.
    const benefitOpportunities = await loadBenefitOpportunities(
      purchase,
      walletCards,
      userId
    );
    const trustedOptimization =
      optimization !== null && optimization.bestCardId !== null
        ? optimization
        : null;

    // Money Found = confirmed dollar value only (from optimization and from
    // confirmed benefit opportunities). Pure, deterministic, no DB writes.
    const moneyFound = computeMoneyFound(
      purchase,
      trustedOptimization,
      benefitOpportunities
    );

    return {
      purchase,
      optimization: trustedOptimization,
      benefitOpportunities,
      moneyFound,
      walletCards,
    };
  } catch {
    return null;
  }
}

/**
 * Load active wallet benefits for the user's cards and evaluate each against
 * the Purchase. Only benefits that are not clearly not_eligible are returned,
 * so the UI shows meaningful opportunities.
 */
async function loadBenefitOpportunities(
  purchase: Purchase,
  walletCards: WalletCard[],
  userId: string
): Promise<BenefitOpportunity[]> {
  const activeCards = walletCards.filter((card) => card.active);

  const displaysPerCard = await Promise.all(
    activeCards.map((card) => getWalletBenefitsWithProducts(card.id, userId))
  );

  const opportunities: BenefitOpportunity[] = [];
  for (const displays of displaysPerCard) {
    for (const { product, state } of displays) {
      const opportunity = evaluateBenefitOpportunity(purchase, product, state);
      if (opportunity.status !== "not_eligible") {
        opportunities.push(opportunity);
      }
    }
  }

  return opportunities;
}

async function loadRulesForProducts(
  products: CardProduct[],
  linkedCards: WalletCard[]
): Promise<Map<string, EarningRule[]>> {
  const linkedProductIds = new Set(
    linkedCards.map((card) => card.cardProductId!)
  );
  const rulesByProductId = new Map<string, EarningRule[]>();

  await Promise.all(
    Array.from(linkedProductIds).map(async (productId) => {
      const product = products.find((p) => p.id === productId);
      if (!product) return;

      const rules = await getEarningRulesForProduct(productId, {
        activeOnly: true,
      });
      rulesByProductId.set(productId, rules);
    })
  );

  return rulesByProductId;
}

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await loadPurchaseWithOptimization(id);

  if (!result) {
    notFound();
  }

  const {
    purchase,
    optimization,
    benefitOpportunities,
    moneyFound,
    walletCards,
  } = result;
  const hasItems = purchase.items.length > 0;
  const hasExtraCharges =
    purchase.discount !== null ||
    purchase.tax !== null ||
    purchase.tip !== null ||
    purchase.fees !== null;

  const hasRewardUnits =
    optimization !== null &&
    optimization.bestEstimatedRewardUnits !== null &&
    optimization.bestEstimatedRewardUnits > 0;
  const hasDollarValue =
    optimization !== null &&
    optimization.bestEstimatedValue !== null &&
    optimization.bestEstimatedValue > 0;

  const bookingChannel = (purchase.metadata?.bookingChannel as string) || null;

  return (
    <main className="min-h-screen bg-transparent text-slate-100">
      <Nav />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        </div>

        <div className="fb-card p-6 sm:p-8">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              <span className="capitalize">{purchase.source}</span> Purchase
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {purchase.merchant ?? "Unknown merchant"}
            </h1>
            <p className="mt-1 text-xl font-medium text-emerald-300">
              {purchase.amount !== null && !Number.isNaN(purchase.amount)
                ? formatMoney(purchase.amount, purchase.currency)
                : "—"}
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Calendar className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-wider">
                  Date
                </p>
              </div>
              <p className="mt-2 text-sm font-medium text-white">
                {formatDate(purchase.date)}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Tag className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-wider">
                  Category
                </p>
              </div>
              <p className="mt-2 text-sm font-medium text-white">
                {purchase.category ?? "—"}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Receipt className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-wider">
                  Source
                </p>
              </div>
              <p className="mt-2 text-sm font-medium text-white capitalize">
                {purchase.source}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <CreditCard className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-wider">
                  Evidence
                </p>
              </div>
              <p className="mt-2 text-sm font-medium text-white">
                {purchase.evidence.length} record
                {purchase.evidence.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {/* Card used selector */}
          <CardUsedSelector
            purchaseId={id}
            currentCardId={purchase.cardId}
            activeCards={walletCards.filter((card) => card.active)}
          />

          {/* Booking channel selector */}
          <BookingChannelSelector
            purchaseId={id}
            currentChannel={bookingChannel}
          />

          {hasExtraCharges && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-white">
                Additional charges
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {purchase.discount !== null && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs text-slate-400">Discount</p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {formatMoney(purchase.discount, purchase.currency)}
                    </p>
                  </div>
                )}
                {purchase.tax !== null && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs text-slate-400">Tax</p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {formatMoney(purchase.tax, purchase.currency)}
                    </p>
                  </div>
                )}
                {purchase.tip !== null && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs text-slate-400">Tip</p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {formatMoney(purchase.tip, purchase.currency)}
                    </p>
                  </div>
                )}
                {purchase.fees !== null && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs text-slate-400">Fees</p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {formatMoney(purchase.fees, purchase.currency)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {hasItems && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-white">Items</h2>
              <div className="mt-4 space-y-3">
                {purchase.items.map((item) => (
                  <div
                    key={`${item.name ?? "item"}-${item.category ?? "none"}-${
                      item.total ?? "0"
                    }`}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                  >
                    <div>
                      <p className="font-medium text-white">
                        {item.name ?? "Unnamed item"}
                      </p>
                      {item.category ? (
                        <p className="mt-1 text-xs text-slate-400">
                          {item.category}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">
                        {item.total !== null && !Number.isNaN(item.total)
                          ? formatMoney(item.total, purchase.currency)
                          : "—"}
                      </p>
                      {item.quantity !== null && item.unitPrice !== null ? (
                        <p className="mt-1 text-xs text-slate-400">
                          {item.quantity} ×{" "}
                          {formatMoney(item.unitPrice, purchase.currency)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {optimization && (
            <div className="mt-8 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-sky-300" />
                <h2 className="text-lg font-semibold text-white">
                  Best card for this purchase
                </h2>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-slate-400">Recommended card</p>
                <p className="mt-1 text-base font-semibold text-white">
                  {optimization.bestCardName ?? "Unknown card"}
                </p>

                {hasRewardUnits ? (
                  <p className="mt-2 text-sm text-emerald-300">
                    Estimated rewards:{" "}
                    {formatRewardUnits(
                      optimization.bestEstimatedRewardUnits as number
                    )}{" "}
                    {optimization.bestRewardCurrency}
                  </p>
                ) : hasDollarValue ? (
                  <p className="mt-2 text-sm text-emerald-300">
                    Estimated reward value:{" "}
                    {formatMoney(
                      optimization.bestEstimatedValue,
                      purchase.currency
                    )}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">
                    Dollar value not estimated
                  </p>
                )}
              </div>

              {optimization.recommendation ? (
                <p className="mt-4 text-sm text-slate-300">
                  {optimization.recommendation}
                </p>
              ) : null}

              {optimization.matches.length > 0 && (
                <div className="mt-4 space-y-2">
                  {optimization.matches
                    .filter((match) => match.cardId === optimization.bestCardId)
                    .map((match) => (
                      <div
                        key={match.benefitId}
                        className="rounded-2xl border border-white/10 bg-white/5 p-3"
                      >
                        <p className="text-sm font-medium text-white">
                          {match.benefitTitle}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatStatus(match.status)} — {match.reason}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {benefitOpportunities.length > 0 && (
            <div className="mt-8 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
              <div className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-emerald-300" />
                <h2 className="text-lg font-semibold text-white">
                  Benefit opportunities
                </h2>
              </div>
              <div className="mt-4 space-y-2">
                {benefitOpportunities.map((opportunity) => (
                  <div
                    key={opportunity.walletBenefitId}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-white">
                        {opportunity.title}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          opportunity.status === "confirmed_eligible" ||
                          opportunity.status === "likely_eligible"
                            ? "bg-emerald-400/10 text-emerald-300"
                            : "bg-amber-400/10 text-amber-200"
                        }`}
                      >
                        {formatBenefitStatus(opportunity.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {opportunity.reason}
                    </p>
                    {(opportunity.status === "confirmed_eligible" ||
                      opportunity.status === "likely_eligible") &&
                    opportunity.usableValue !== null ? (
                      <p className="mt-2 text-sm font-medium text-emerald-300">
                        Usable value:{" "}
                        {formatMoney(
                          opportunity.usableValue,
                          purchase.currency
                        )}
                      </p>
                    ) : null}
                    {opportunity.status === "insufficient_information" &&
                    opportunity.potentialValue !== null ? (
                      <p className="mt-2 text-sm font-medium text-amber-200">
                        Up to{" "}
                        {formatMoney(
                          opportunity.potentialValue,
                          purchase.currency
                        )}{" "}
                        if booked through Chase Travel
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {moneyFound.total > 0 && (
            <div className="mt-8 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
              <div className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-300" />
                <h2 className="text-lg font-semibold text-white">
                  Money Found
                </h2>
              </div>
              <p className="mt-2 text-2xl font-extrabold text-emerald-300">
                {formatMoney(moneyFound.total, moneyFound.currency)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Confirmed value only — does not include potential or likely-only
                savings.
              </p>

              {moneyFound.items.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {moneyFound.items.map((item) => (
                    <div
                      key={`${item.source}-${item.benefitId}`}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <span className="text-sm text-slate-300">
                        {item.description}
                      </span>
                      <span className="text-sm font-medium text-emerald-300">
                        {formatMoney(item.value, item.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {moneyFound.total === 0 ? (
            <p className="mt-8 text-xs text-slate-500">
              No confirmed savings found for this purchase.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
