/**
 * Deterministic earnings plan (R1).
 *
 * Projects the customer's own reward balances forward using ONLY:
 * - verified, active catalog earn rules for their own wallet-card products;
 * - their recorded monthly spending by category;
 * - their own recorded reward-account balances.
 *
 * Trust rules enforced here:
 * - Unverified catalog rates are omitted, never guessed (fail-closed gate).
 * - Points and miles stay in native program units and are never combined:
 *   a program whose contributing cards would mix currencies is omitted with
 *   a fixed warning rather than merged. Cash-back rates never contribute to
 *   point math and no cash value is assigned to points.
 * - Spending is attributed to the customer's self-owned programs; companion
 *   accounts are never combined with self earnings.
 * - Rates whose eligibility cannot be honored for aggregated category
 *   spending (merchant-specific rules, merchant exclusions) are skipped.
 * - The searched flight party-total is carried through unchanged; nightly or
 *   per-option hotel prices are never aggregated into a trip total.
 * - Every output string is fixed server-owned copy; nothing here is
 *   model- or provider-authored.
 *
 * Pure module: no I/O, no clocks (the current time is injected), no model.
 */

import type {
  EarnPlan,
  EarnPlanAccountProjection,
  EarnPlanCashGap,
  EarnPlanTripCash,
  PersonalizedStrategyContext,
  StrategySpendingCategory,
} from "./strategyTypes";
import type { CardProduct, EarningRule } from "@/lib/rewards/catalogTypes";
import { normalizeCategory } from "@/lib/rewards/categories";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";

/** Fixed customer-facing label. Never provider- or model-authored. */
export const EARN_PLAN_LABEL = "Earnings plan";

/** Fixed customer-facing disclosure. Never provider- or model-authored. */
export const EARN_PLAN_DISCLOSURE =
  "Projections use verified earn rates from the card catalog and your recorded spending. They are planning estimates, not guarantees; verify current prices and availability before acting.";

/** Fixed customer-facing warning strings. Never provider- or model-authored. */
export const EARN_PLAN_WARNING_HORIZON_CAPPED =
  "Your trip is more than 36 months away, so balances are shown without future earnings.";
export const EARN_PLAN_WARNING_UNVERIFIED_BALANCE =
  "Some reward balances still need confirmation, so projections that include them are provisional.";
export const EARN_PLAN_WARNING_CURRENCY_MISMATCH =
  "The searched flight total is in a different currency than your goal, so the cash comparison is omitted.";
export const EARN_PLAN_WARNING_MIXED_CURRENCY =
  "Some verified earn rates were omitted because their reward currency could not be kept separate.";
export const EARN_PLAN_WARNING_ACCOUNTS_TRUNCATED =
  "Some reward programs were omitted from this plan.";

/** Fixed single source label for the searched trip cash carried into the plan. */
export const EARN_PLAN_TRIP_CASH_SOURCE =
  "Searched flight total (party total, round trip)";

/** Whole calendar months projected forward at most; beyond this, no projection. */
export const EARN_PLAN_MAX_PROJECTION_MONTHS = 36;

/** Output bounds consistent with repository presentation conventions. */
const MAX_CARD_NAMES = 10;
const MAX_WARNINGS = 6;

/**
 * Maximum accounts in a built plan. This is the single source of truth; the
 * presentation validator's cap is locked to it so a freshly built plan always
 * round-trips its own strict projector.
 */
const MAX_EARN_PLAN_ACCOUNTS = 12;

/** A verified, active points/miles earn rate usable in deterministic projections. */
export interface VerifiedEarnRate {
  cardProductId: string;
  /** Canonical rule category; null means the rule is a base (all-purchase) rate. */
  category: EarningRule["eligibleCategory"];
  /** Verified points/miles per dollar. */
  pointsPerDollar: number;
  currency: "points" | "miles";
}

function safeNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Select the verified, active points/miles earn rates from untrusted catalog
 * rules. Fail-closed: a rule contributes only when it is an `earning_rate`
 * rule, active, verified (`lastVerifiedAt` present), denominated in points or
 * miles, carries a positive finite `rewardValue`, and its eligibility can be
 * honored against aggregated category spending (no merchant scoping or
 * exclusions). Cash-back rules never contribute to point projections.
 */
export function selectVerifiedPointEarnRates(
  rules: readonly EarningRule[] | null | undefined,
): Map<string, VerifiedEarnRate[]> {
  const byProduct = new Map<string, VerifiedEarnRate[]>();
  if (!Array.isArray(rules)) {
    return byProduct;
  }

  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    if (rule.type !== "earning_rate" || !rule.active) continue;
    if (rule.rewardCurrency !== "points" && rule.rewardCurrency !== "miles") {
      continue;
    }
    if (
      typeof rule.lastVerifiedAt !== "string" ||
      rule.lastVerifiedAt.trim().length === 0
    ) {
      continue;
    }
    // Aggregated category spending cannot respect merchant scoping or
    // exclusions, so such rates are omitted rather than approximated.
    if (rule.eligibleMerchant !== null) continue;
    if (Array.isArray(rule.excludedMerchants) && rule.excludedMerchants.length > 0) {
      continue;
    }

    const rate = safeNonNegativeNumber(rule.rewardValue);
    if (rate === null || rate === 0) continue;

    // Sanitized reconstruction: only the fields the projection needs travel
    // with the rate; catalog metadata never reaches the plan.
    const verified: VerifiedEarnRate = {
      cardProductId: rule.cardProductId,
      category: rule.eligibleCategory,
      pointsPerDollar: rate,
      currency: rule.rewardCurrency,
    };
    const list = byProduct.get(rule.cardProductId);
    if (list) {
      list.push(verified);
    } else {
      byProduct.set(rule.cardProductId, [verified]);
    }
  }

  return byProduct;
}

/**
 * True when a rule category applies to a spending category. Deterministic
 * wildcard semantics: a root-only rule (no leaf) covers every leaf under that
 * root; a leaf rule applies only to the exact same category. Root-level
 * spending is NOT covered by leaf-specific rules.
 */
export function ruleCategoryMatchesSpending(
  ruleCategory: string,
  spendCategory: string,
): boolean {
  if (ruleCategory === spendCategory) return true;
  return (
    !ruleCategory.includes(":") && spendCategory.startsWith(`${ruleCategory}:`)
  );
}

/**
 * Deterministic monthly points/miles for one card's verified rates against
 * recorded monthly spending. Spending categories are normalized through the
 * established legacy-to-canonical mapping; unrecognized categories only
 * receive the base rate. Each spending category's dollars count under at
 * most one rule. Selection is independent of catalog row order: an exact
 * category match beats a root wildcard, and the highest verified rate wins
 * among rules of the same specificity. Base rates follow the same rule: the
 * highest verified base rate applies.
 */
export function monthlyPointsForCard(
  rates: readonly VerifiedEarnRate[],
  spending: readonly StrategySpendingCategory[],
): number {
  if (rates.length === 0 || spending.length === 0) return 0;

  const categoryRates = rates.filter(
    (rate) => rate.category !== null && rate.category !== "other",
  );
  // Base rates are rules without a category plus rules encoded under the
  // canonical `other` category: the verified catalog records base "all other
  // purchases" rates under `other` (root-only, no leaves), and the rule's own
  // source quote defines them as applying to everything else.
  const baseRates = rates.filter(
    (rate) => rate.category === null || rate.category === "other",
  );
  const baseRate =
    baseRates.length > 0
      ? baseRates.reduce(
          (best, rate) => Math.max(best, rate.pointsPerDollar),
          0,
        )
      : null;

  let total = 0;
  for (const entry of spending) {
    const amount = safeNonNegativeNumber(entry.monthlyAverage);
    if (amount === null) continue;

    const canonical =
      typeof entry.category === "string" ? normalizeCategory(entry.category) : null;
    // Deterministic, order-independent selection: exact category match (1)
    // beats root wildcard (0); the highest rate wins within a tier.
    let best: { specificity: number; rate: number } | null = null;
    if (canonical !== null) {
      for (const rate of categoryRates) {
        if (rate.category === null) continue;
        if (!ruleCategoryMatchesSpending(rate.category, canonical)) continue;
        const specificity = rate.category === canonical ? 1 : 0;
        if (
          best === null ||
          specificity > best.specificity ||
          (specificity === best.specificity && rate.pointsPerDollar > best.rate)
        ) {
          best = { specificity, rate: rate.pointsPerDollar };
        }
      }
    }
    const appliedRate = best !== null ? best.rate : baseRate;
    if (appliedRate !== null) {
      total += amount * appliedRate;
    }
  }

  return total;
}

/**
 * Whole calendar months from `now` to the goal's earliest departure, computed
 * in UTC on calendar months (no time-of-day, timezone, or DST effects).
 * Returns null months when the input is not a real YYYY-MM-DD calendar date.
 * `capped` is true when the trip is more than MAX_PROJECTION_MONTHS away.
 */
export function monthsUntilDeparture(
  earliestDeparture: string | null | undefined,
  now: Date,
): { months: number | null; capped: boolean } {
  if (typeof earliestDeparture !== "string") {
    return { months: null, capped: false };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(earliestDeparture)) {
    return { months: null, capped: false };
  }
  const target = new Date(`${earliestDeparture}T00:00:00.000Z`);
  if (
    Number.isNaN(target.getTime()) ||
    target.toISOString().slice(0, 10) !== earliestDeparture
  ) {
    return { months: null, capped: false };
  }

  const rawMonths =
    (target.getUTCFullYear() - now.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - now.getUTCMonth());
  if (rawMonths <= 0) {
    return { months: 0, capped: false };
  }
  if (rawMonths > EARN_PLAN_MAX_PROJECTION_MONTHS) {
    return { months: null, capped: true };
  }
  return { months: rawMonths, capped: false };
}

/**
 * Build the deterministic earnings plan, or null when nothing verifiable
 * supports one (no wallet cards with verified rates linked to a program).
 */
export function buildEarnPlan(
  context: PersonalizedStrategyContext,
  catalogProgramNames: ReadonlyMap<string, string>,
  flightEstimate: FlightPlanningEstimate | null,
  now: Date = new Date(),
): EarnPlan | null {
  const ratesByProduct = selectVerifiedPointEarnRates(context.earningRules);
  if (ratesByProduct.size === 0) return null;

  // Real card attribution: the customer's own purchase records say which card
  // was used for each purchase. Fail-closed — when no accepted purchase
  // carries a card attribution, no plan is produced rather than falling back
  // to crediting wallet-wide category totals to every card.
  const cardSpending = Array.isArray(context.monthlySpendingByCategoryCard)
    ? context.monthlySpendingByCategoryCard
    : null;
  if (!cardSpending || cardSpending.length === 0) return null;

  // Pass 1: contributing currencies per card from its verified rates. A card
  // whose verified rates mix currencies is omitted from the plan entirely
  // (with a fixed warning) so its spend never enters either currency lane.
  const cardCurrencies = new Map<string, Set<"points" | "miles">>();
  let omittedMixedCurrency = false;
  for (const card of context.walletCards) {
    const rates = ratesByProduct.get(card.cardProductId) ?? [];
    if (rates.length === 0) continue;
    const currencies = new Set(rates.map((rate) => rate.currency));
    if (currencies.size !== 1) {
      omittedMixedCurrency = true;
      continue;
    }
    const currency = currencies.values().next().value;
    if (!currency) continue;
    let set = cardCurrencies.get(card.id);
    if (!set) {
      set = new Set();
      cardCurrencies.set(card.id, set);
    }
    set.add(currency);
  }

  // Pass 2: monthly earn per (card, currency). Each attributed spending entry
  // earns on its own card only, in that card's verified currency lane; the
  // two currencies are never added together at the card level.
  const monthlyByCardCurrency = new Map<string, number>();
  for (const entry of cardSpending) {
    if (typeof entry.cardId !== "string") continue;
    const currencies = cardCurrencies.get(entry.cardId);
    if (!currencies) continue;
    const amount = safeNonNegativeNumber(entry.monthlyAverage);
    if (amount === null) continue;
    const card = context.walletCards.find((item) => item.id === entry.cardId);
    if (!card) continue;
    const rates = ratesByProduct.get(card.cardProductId) ?? [];
    if (rates.length === 0) continue;
    const canonical =
      typeof entry.category === "string" ? normalizeCategory(entry.category) : null;
    for (const currency of currencies) {
      const laneRates = rates.filter((rate) => rate.currency === currency);
      const monthly = monthlyPointsForCard(laneRates, [
        { category: canonical ?? "uncategorized", monthlyAverage: amount },
      ]);
      const key = `${entry.cardId}:${currency}`;
      monthlyByCardCurrency.set(key, (monthlyByCardCurrency.get(key) ?? 0) + monthly);
    }
  }
  for (const [key, value] of monthlyByCardCurrency) {
    monthlyByCardCurrency.set(key, round2(value));
  }

  // Group contributing cards by linked reward program (wallet order).
  const programIds = context.walletCardProgramIds ?? {};
  const groupOrder: string[] = [];
  const cardsByProgram = new Map<string, string[]>();
  for (const card of context.walletCards) {
    const programId = programIds[card.id];
    if (typeof programId !== "string" || programId.length === 0) continue;
    if (!cardCurrencies.has(card.id)) continue;
    const cards = cardsByProgram.get(programId);
    if (cards) {
      cards.push(card.id);
    } else {
      cardsByProgram.set(programId, [card.id]);
      groupOrder.push(programId);
    }
  }

  const months = monthsUntilDeparture(context.goal.earliestDeparture, now);

  let accountsTruncated = false;
  const accounts: EarnPlanAccountProjection[] = [];
  for (const programId of groupOrder) {
    // Deterministic cap: the first MAX_EARN_PLAN_ACCOUNTS program groups in
    // wallet order are kept; anything beyond is omitted with a fixed warning
    // so a built plan always passes the presentation validator's cap.
    if (accounts.length >= MAX_EARN_PLAN_ACCOUNTS) {
      accountsTruncated = true;
      break;
    }
    const cardIds = cardsByProgram.get(programId) ?? [];
    // A program whose contributing cards would mix currencies is omitted
    // rather than merged; its cards' currencies stay separate and the
    // customer sees a fixed warning instead of a combined number.
    const programCurrencies = new Set(
      cardIds.flatMap((cardId) => [...(cardCurrencies.get(cardId) ?? [])]),
    );
    if (programCurrencies.size !== 1) {
      omittedMixedCurrency = true;
      continue;
    }
    // All contributing cards share one currency (checked above).
    const currency = programCurrencies.values().next().value;
    if (!currency) {
      omittedMixedCurrency = true;
      continue;
    }

    // The customer's self-owned account for this program. Companion accounts
    // are never combined with self earnings; if several self accounts exist,
    // the first in recorded order is used deterministically.
    const account =
      context.rewardAccounts.find(
        (candidate) =>
          candidate.rewardProgramId === programId &&
          candidate.ownerType === "self",
      ) ?? null;

    // Monthly earn: sum each contributing card's own attributed spend in
    // this currency lane only. A card contributes nothing here when its
    // verified rates are all in the other currency.
    const monthlyPoints = round2(
      cardIds.reduce(
        (sum, cardId) =>
          sum + (monthlyByCardCurrency.get(`${cardId}:${currency}`) ?? 0),
        0,
      ),
    );
    const currentBalance = account
      ? (safeNonNegativeNumber(account.balance) ?? 0)
      : 0;
    const projectedBalance =
      months.months === null
        ? null
        : round2(currentBalance + monthlyPoints * months.months);

    // "Based on" names only the cards whose attributed spend actually
    // contributed earn in this currency lane, preserving wallet order.
    const cardNames = cardIds
      .filter((cardId) => (monthlyByCardCurrency.get(`${cardId}:${currency}`) ?? 0) > 0)
      .map((cardId) => {
        const card = context.walletCards.find((item) => item.id === cardId);
        return card && typeof card.name === "string" ? card.name : "";
      })
      .filter((name) => name.length > 0)
      .slice(0, MAX_CARD_NAMES);

    accounts.push({
      key: `earn-${accounts.length + 1}`,
      programName: catalogProgramNames.get(programId) ?? null,
      ownerType: "self",
      ownerLabel: account ? account.ownerLabel : "You",
      rewardCurrencyLabel: currency,
      currentBalance,
      balanceVerification: account ? account.verificationStatus : "no_account",
      monthlyPoints,
      monthsProjected: months.months,
      projectedBalance,
      horizonCapped: months.capped,
      cardNames,
    });
  }

  if (accounts.length === 0) return null;

  // Warnings are fixed server-owned strings, bounded and deduplicated.
  const warnings: string[] = [];
  if (months.capped) warnings.push(EARN_PLAN_WARNING_HORIZON_CAPPED);
  if (
    accounts.some(
      (item) =>
        item.balanceVerification === "unverified" ||
        item.balanceVerification === "no_account",
    )
  ) {
    warnings.push(EARN_PLAN_WARNING_UNVERIFIED_BALANCE);
  }
  if (omittedMixedCurrency) warnings.push(EARN_PLAN_WARNING_MIXED_CURRENCY);
  if (accountsTruncated) warnings.push(EARN_PLAN_WARNING_ACCOUNTS_TRUNCATED);

  // Searched cash: the flight planning estimate's observed round-trip
  // party-total, carried through unchanged. Hotel results are per-property
  // and per-night/per-stay; they are never aggregated into a trip total.
  let tripCash: EarnPlanTripCash | null = null;
  let cashGap: EarnPlanCashGap | null = null;
  if (flightEstimate) {
    const total = safeNonNegativeNumber(flightEstimate.total);
    const currency =
      typeof flightEstimate.currency === "string"
        ? flightEstimate.currency.trim().toUpperCase()
        : "";
    if (total !== null && /^[A-Z]{3}$/.test(currency)) {
      const goalCurrency =
        typeof context.goal.currency === "string"
          ? context.goal.currency.trim().toUpperCase()
          : "";
      if (currency === goalCurrency) {
        tripCash = {
          amount: total,
          currency,
          sources: [EARN_PLAN_TRIP_CASH_SOURCE],
        };
        const budget = safeNonNegativeNumber(context.goal.maximumCashBudget);
        if (budget !== null) {
          cashGap = {
            currency,
            tripTotal: total,
            cashBudget: budget,
            remaining: round2(budget - total),
          };
        }
      } else {
        warnings.push(EARN_PLAN_WARNING_CURRENCY_MISMATCH);
      }
    }
  }

  return {
    schemaVersion: 1,
    label: EARN_PLAN_LABEL,
    disclosure: EARN_PLAN_DISCLOSURE,
    accounts,
    tripCash,
    cashGap,
    warnings: Array.from(new Set(warnings)).slice(0, MAX_WARNINGS),
  };
}

// ---------------------------------------------------------------------------
// Strict persisted-shape re-projection (presentation boundary)
// ---------------------------------------------------------------------------

/** Output bounds for the persisted-shape validator. */
const MAX_ACCOUNTS = MAX_EARN_PLAN_ACCOUNTS;
const MAX_WARNINGS_PROJECTED = 6;
const MAX_CARD_NAMES_PROJECTED = 10;
const MAX_LABEL_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSafeLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_LABEL_LENGTH &&
    !/(?:https?:\/\/|www\.)/i.test(value)
  );
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegativeFinite(value: unknown): value is number | null {
  return value === null || isNonNegativeFinite(value);
}

function isFixedWarning(value: unknown): boolean {
  return (
    value === EARN_PLAN_WARNING_HORIZON_CAPPED ||
    value === EARN_PLAN_WARNING_UNVERIFIED_BALANCE ||
    value === EARN_PLAN_WARNING_CURRENCY_MISMATCH ||
    value === EARN_PLAN_WARNING_MIXED_CURRENCY ||
    value === EARN_PLAN_WARNING_ACCOUNTS_TRUNCATED
  );
}

/**
 * Strict re-projection of a persisted earn plan (untrusted input). Rebuilds a
 * fresh customer-safe object, rejecting any unknown key, malformed value, or
 * unfixed warning string. Returns null when the shape cannot be trusted.
 */
export function projectEarnPlan(value: unknown): EarnPlan | null {
  if (!isRecord(value)) return null;

  const keys = Object.keys(value);
  const allowed = new Set([
    "schemaVersion",
    "label",
    "disclosure",
    "accounts",
    "tripCash",
    "cashGap",
    "warnings",
  ]);
  if (keys.some((key) => !allowed.has(key))) return null;
  if (value.schemaVersion !== 1) return null;
  if (value.label !== EARN_PLAN_LABEL) return null;
  if (value.disclosure !== EARN_PLAN_DISCLOSURE) return null;
  if (!Array.isArray(value.warnings)) return null;
  if (value.warnings.length > MAX_WARNINGS_PROJECTED) return null;
  if (!value.warnings.every(isFixedWarning)) return null;
  if (!Array.isArray(value.accounts) || value.accounts.length === 0) return null;
  if (value.accounts.length > MAX_ACCOUNTS) return null;

  const accounts: EarnPlanAccountProjection[] = [];
  for (const raw of value.accounts) {
    if (!isRecord(raw)) return null;
    const accountKeys = Object.keys(raw);
    const accountAllowed = new Set([
      "key",
      "programName",
      "ownerType",
      "ownerLabel",
      "rewardCurrencyLabel",
      "currentBalance",
      "balanceVerification",
      "monthlyPoints",
      "monthsProjected",
      "projectedBalance",
      "horizonCapped",
      "cardNames",
    ]);
    if (accountKeys.some((key) => !accountAllowed.has(key))) return null;
    if (!isSafeLabel(raw.key)) return null;
    if (raw.programName !== null && !isSafeLabel(raw.programName)) return null;
    if (raw.ownerType !== "self") return null;
    if (!isSafeLabel(raw.ownerLabel)) return null;
    if (raw.rewardCurrencyLabel !== "points" && raw.rewardCurrencyLabel !== "miles") {
      return null;
    }
    if (!isNonNegativeFinite(raw.currentBalance)) return null;
    if (
      raw.balanceVerification !== "verified" &&
      raw.balanceVerification !== "unverified" &&
      raw.balanceVerification !== "no_account"
    ) {
      return null;
    }
    if (!isNonNegativeFinite(raw.monthlyPoints)) return null;
    if (
      raw.monthsProjected !== null &&
      (typeof raw.monthsProjected !== "number" ||
        !Number.isInteger(raw.monthsProjected) ||
        raw.monthsProjected < 0 ||
        raw.monthsProjected > EARN_PLAN_MAX_PROJECTION_MONTHS)
    ) {
      return null;
    }
    if (
      raw.projectedBalance !== null &&
      !isNonNegativeFinite(raw.projectedBalance)
    ) {
      return null;
    }
    if (typeof raw.horizonCapped !== "boolean") return null;
    // monthsProjected and projectedBalance must be null together.
    if ((raw.monthsProjected === null) !== (raw.projectedBalance === null)) {
      return null;
    }
    if (!Array.isArray(raw.cardNames)) return null;
    if (raw.cardNames.length > MAX_CARD_NAMES_PROJECTED) return null;
    if (!raw.cardNames.every((name) => isSafeLabel(name))) return null;

    accounts.push({
      key: raw.key,
      programName: raw.programName,
      ownerType: "self",
      ownerLabel: raw.ownerLabel,
      rewardCurrencyLabel: raw.rewardCurrencyLabel,
      currentBalance: raw.currentBalance,
      balanceVerification: raw.balanceVerification,
      monthlyPoints: raw.monthlyPoints,
      monthsProjected: raw.monthsProjected,
      projectedBalance: raw.projectedBalance,
      horizonCapped: raw.horizonCapped,
      cardNames: [...raw.cardNames],
    });
  }

  let tripCash: EarnPlanTripCash | null = null;
  if (value.tripCash !== null) {
    if (!isRecord(value.tripCash)) return null;
    const cashKeys = Object.keys(value.tripCash);
    const cashAllowed = new Set(["amount", "currency", "sources"]);
    if (cashKeys.some((key) => !cashAllowed.has(key))) return null;
    if (!isNonNegativeFinite(value.tripCash.amount)) return null;
    if (
      typeof value.tripCash.currency !== "string" ||
      !/^[A-Z]{3}$/.test(value.tripCash.currency)
    ) {
      return null;
    }
    if (!Array.isArray(value.tripCash.sources)) return null;
    if (value.tripCash.sources.length !== 1) return null;
    if (value.tripCash.sources[0] !== EARN_PLAN_TRIP_CASH_SOURCE) return null;
    tripCash = {
      amount: value.tripCash.amount,
      currency: value.tripCash.currency,
      sources: [EARN_PLAN_TRIP_CASH_SOURCE],
    };
  }

  let cashGap: EarnPlanCashGap | null = null;
  if (value.cashGap !== null) {
    if (!isRecord(value.cashGap)) return null;
    const gapKeys = Object.keys(value.cashGap);
    const gapAllowed = new Set(["currency", "tripTotal", "cashBudget", "remaining"]);
    if (gapKeys.some((key) => !gapAllowed.has(key))) return null;
    if (
      typeof value.cashGap.currency !== "string" ||
      !/^[A-Z]{3}$/.test(value.cashGap.currency)
    ) {
      return null;
    }
    if (!isNonNegativeFinite(value.cashGap.tripTotal)) return null;
    if (!isNonNegativeFinite(value.cashGap.cashBudget)) return null;
    // remaining may be negative (trip exceeds budget) but must be finite.
    if (
      typeof value.cashGap.remaining !== "number" ||
      !Number.isFinite(value.cashGap.remaining)
    ) {
      return null;
    }
    if (
      Math.abs(
        value.cashGap.cashBudget -
          value.cashGap.tripTotal -
          value.cashGap.remaining,
      ) > 0.01
    ) {
      return null;
    }
    cashGap = {
      currency: value.cashGap.currency,
      tripTotal: value.cashGap.tripTotal,
      cashBudget: value.cashGap.cashBudget,
      remaining: value.cashGap.remaining,
    };
  }

  return {
    schemaVersion: 1,
    label: EARN_PLAN_LABEL,
    disclosure: EARN_PLAN_DISCLOSURE,
    accounts,
    tripCash,
    cashGap,
    warnings: [...value.warnings],
  };
}
