import type {
  Goal,
  RewardAccount,
} from "./types";
import type {
  PersonalizedStrategyContext,
  StrategyCardSpendingCategory,
  StrategySpendingCategory,
  StrategySource,
} from "./strategyTypes";
import type { WalletCard } from "../wallet/types";
import type { Purchase } from "../purchases/types";
import type { CardProduct } from "../rewards/catalogTypes";

/**
 * Builds a personalized strategy context from raw user and catalog data.
 * This context is the foundation for generating earning and redemption strategies.
 *
 * @param goal - The active user goal
 * @param rewardAccounts - User's reward program balances
 * @param walletCards - User's owned credit cards
 * @param purchases - User's historical purchase data
 * @param cardProducts - Shared catalog of card products
 * @returns A valid PersonalizedStrategyContext
 */
export function buildPersonalizedStrategyContext(
  goal: Goal,
  rewardAccounts: RewardAccount[],
  walletCards: WalletCard[],
  purchases: Purchase[],
  cardProducts: CardProduct[]
): PersonalizedStrategyContext {
  // 1. Map Wallet Cards
  // Map WalletCard to the context's wallet card shape. The context type only
  // supports a cardProductId link; when a card is linked, prefer the catalog
  // product's canonical name/issuer, otherwise keep the user-entered values.
  const mappedWalletCards = walletCards.map((card) => {
    const product = card.cardProductId
      ? cardProducts.find((p) => p.id === card.cardProductId)
      : undefined;

    return {
      id: card.id,
      name: product?.name ?? card.name,
      issuer: product?.issuer ?? card.issuer,
      rewardCurrency: card.rewardCurrency,
      cardProductId: card.cardProductId ?? "",
    };
  });

  // 2. Aggregate Spending
  // Accept only purchases with a finite, non-negative amount. Purchases
  // without a category are grouped under "uncategorized".
  const spendingMap = new Map<string, number>();
  const representedMonths = new Set<string>();

  purchases.forEach((p) => {
    if (!Number.isFinite(p.amount) || (p.amount as number) < 0) {
      return;
    }

    const category = p.category ?? "uncategorized";
    const current = spendingMap.get(category) || 0;
    spendingMap.set(category, current + (p.amount as number));

    // Track the distinct valid calendar months (YYYY-MM) represented by
    // accepted purchases so totals can be normalized to monthly averages.
    if (typeof p.date === "string") {
      const match = /^(\d{4})-(\d{2})/.exec(p.date);
      if (match) {
        const month = Number(match[2]);
        if (month >= 1 && month <= 12) {
          representedMonths.add(`${match[1]}-${match[2]}`);
        }
      }
    }
  });

  // Convert to StrategySpendingCategory array and sort.
  // monthlyAverage = category total / number of distinct represented months.
  // If no valid months are represented, return an empty array rather than
  // labeling aggregate totals as monthly data.
  const monthCount = representedMonths.size;
  const monthlySpendingByCategory: StrategySpendingCategory[] =
    monthCount === 0
      ? []
      : Array.from(spendingMap.entries())
          .map(([category, total]) => ({
            category,
            monthlyAverage: total / monthCount,
          }))
          .sort((a, b) => {
            if (b.monthlyAverage !== a.monthlyAverage) {
              return b.monthlyAverage - a.monthlyAverage;
            }
            return a.category.localeCompare(b.category);
          });

  // 3. Strategy Sources
  // Represent missing data honestly using the existing context status fields.
  const sources: StrategySource[] = [];

  // 4. Per-card attribution: monthly spending attributed to the wallet card
  // used for each purchase. Only purchases carrying a cardId that resolves to
  // one of the customer's wallet cards contribute. The wallet-wide category
  // aggregates above keep their existing semantics (all valid purchases,
  // attributed or not); the card lane is a per-card subset of those same
  // dollars. The two lanes feed different consumers, and the earn plan uses
  // ONLY the card lane, so each attributed dollar earns exactly once.
  const walletCardIds = new Set(walletCards.map((card) => card.id));
  const cardCategoryTotals = new Map<string, Map<string, number>>();
  const cardMonths = new Map<string, Set<string>>();

  purchases.forEach((p) => {
    if (!Number.isFinite(p.amount) || (p.amount as number) < 0) {
      return;
    }
    if (typeof p.cardId !== "string" || !walletCardIds.has(p.cardId)) {
      return;
    }

    const category = p.category ?? "uncategorized";
    let categories = cardCategoryTotals.get(p.cardId);
    if (!categories) {
      categories = new Map();
      cardCategoryTotals.set(p.cardId, categories);
    }
    categories.set(category, (categories.get(category) ?? 0) + (p.amount as number));

    if (typeof p.date === "string") {
      const match = /^(\d{4})-(\d{2})/.exec(p.date);
      if (match) {
        const month = Number(match[2]);
        if (month >= 1 && month <= 12) {
          const monthKey = `${match[1]}-${match[2]}`;
          let monthsSet = cardMonths.get(p.cardId);
          if (!monthsSet) {
            monthsSet = new Set();
            cardMonths.set(p.cardId, monthsSet);
          }
          monthsSet.add(monthKey);
        }
      }
    }
  });

  // Monthly averages per (card, category), normalized by the distinct valid
  // months represented among that card's own accepted purchases. Deterministic
  // order: card wallet order, then monthly-average descending, then category.
  const monthlySpendingByCategoryCard: StrategyCardSpendingCategory[] = [];
  for (const card of walletCards) {
    const categories = cardCategoryTotals.get(card.id);
    const monthCount = cardMonths.get(card.id)?.size ?? 0;
    if (!categories || monthCount === 0) continue;
    const cardEntries: StrategyCardSpendingCategory[] = Array.from(
      categories.entries(),
    ).map(([category, total]) => ({
      cardId: card.id,
      category,
      monthlyAverage: total / monthCount,
    }));
    cardEntries.sort((a, b) => {
      if (b.monthlyAverage !== a.monthlyAverage) {
        return b.monthlyAverage - a.monthlyAverage;
      }
      return a.category.localeCompare(b.category);
    });
    monthlySpendingByCategoryCard.push(...cardEntries);
  }

  // 5. Final Context Construction
  return {
    goal: { ...goal },
    rewardAccounts: rewardAccounts.map((acc) => ({ ...acc })), // Preserve manual balances as authoritative by not mutating
    walletCards: mappedWalletCards,
    monthlySpendingByCategory,
    monthlySpendingByCategoryCard:
      monthlySpendingByCategoryCard.length > 0 ? monthlySpendingByCategoryCard : null,
    awardOptions: [],
    cardOffers: [],
    sources,
    generatedAt: new Date().toISOString(),
  };
}
