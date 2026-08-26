import type {
  Goal,
  RewardAccount,
} from "./types";
import type {
  PersonalizedStrategyContext,
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
  const mappedWalletCards = walletCards.filter((card) => card.active).map((card) => {
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

    // Spending from another currency, or with no currency, cannot safely be
    // used to personalize a goal denominated in the goal currency.
    if (
      typeof p.currency !== "string" ||
      p.currency.trim().toUpperCase() !== goal.currency.trim().toUpperCase()
    ) {
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

  // 4. Final Context Construction
  return {
    goal: { ...goal },
    rewardAccounts: rewardAccounts.map((acc) => ({ ...acc })), // Preserve manual balances as authoritative by not mutating
    walletCards: mappedWalletCards,
    monthlySpendingByCategory,
    awardOptions: [],
    cardOffers: [],
    sources,
    generatedAt: new Date().toISOString(),
  };
}
