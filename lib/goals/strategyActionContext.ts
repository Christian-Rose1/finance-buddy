import type { SupabaseClient } from "@supabase/supabase-js";
import { getStrategyActionContextDependencies } from "./strategyActionContextDependencies";
import { buildPersonalizedStrategyContext } from "./strategyContextBuilder";
import type { StrategyRewardProgram } from "./automatedStrategyPlanner";
import type { PersonalizedStrategyContext } from "./strategyTypes";

/**
 * Everything required to generate (and later persist) a goal strategy, resolved
 * from the authenticated server session and the shared catalogs.
 */
export interface PreparedGoalStrategyContext {
  supabase: SupabaseClient;
  userId: string;
  context: PersonalizedStrategyContext;
  customerRewardPrograms: StrategyRewardProgram[];
  catalogRewardPrograms: StrategyRewardProgram[];
}

export type PrepareGoalStrategyContextResult =
  | { success: true; prepared: PreparedGoalStrategyContext }
  | { success: false; message: string };

/**
 * Resolve the authenticated user, their owned goal, their wallets/accounts/
 * purchases, the shared catalogs, and build the personalized strategy context.
 *
 * Expected validation/auth/ownership failures return the safe failure union.
 * Repository/database/context-building exceptions are intentionally NOT caught
 * here; the calling server action's outer catch handles them.
 */
/**
 * Best-effort load for the R2 award-benchmark catalog inputs. These catalogs
 * ENHANCE plans (benchmark options, transfer funding) but must never take
 * down the core flight/hotel/finalization pipeline: on load failure the
 * context simply carries empty arrays (no benchmark options, no transfer
 * funding — the fail-safe direction; nothing is invented) and a fixed,
 * debug-gated diagnostic is emitted. No error details, identifiers, or
 * provider data are ever logged.
 */
async function bestEffortCatalogLoad<T>(
  catalogName: "award_benchmarks" | "airport_region_map" | "transfer_partners",
  load: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await load();
  } catch {
    if (process.env.STRATEGY_DEBUG === "1") {
      console.error(
        "[strategy-context]",
        JSON.stringify({ category: "award_benchmark_catalog_unavailable", catalogName }),
      );
    }
    return [];
  }
}

export async function prepareGoalStrategyContext(
  goalId: string
): Promise<PrepareGoalStrategyContextResult> {
  if (typeof goalId !== "string" || goalId.trim().length === 0) {
    return { success: false, message: "A valid goal is required." };
  }

  const dependencies = getStrategyActionContextDependencies();
  const supabase = await dependencies.createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return {
      success: false,
      message: "You need to be signed in to build a strategy.",
    };
  }

  const userId = userData.user.id;

  // Ownership-checked goal load. Returns null when the goal does not exist
  // or belongs to another user.
  const goal = await dependencies.getGoalForUser(goalId, userId);
  if (!goal) {
    return {
      success: false,
      message: "We couldn't find that goal. It may have been removed.",
    };
  }

  // Earning rules depend on the wallet-card product links, so the wallet-card
  // fetch starts immediately and the rules query chains off it — everything
  // still runs concurrently in a single Promise.all.
  const walletCardsPromise = dependencies.getWalletCardsForUser(userId);
  const [
    rewardAccounts,
    purchases,
    rewardPrograms,
    cardProducts,
    walletCards,
    earningRules,
    awardPriceBenchmarks,
    airportRegionEntries,
    verifiedTransferPartners,
  ] = await Promise.all([
    dependencies.getRewardAccountsForUser(userId),
    dependencies.getPurchasesForUser(userId),
    dependencies.getRewardPrograms(),
    dependencies.getCardProducts({ activeOnly: true }),
    walletCardsPromise,
    walletCardsPromise.then((cards) =>
      dependencies.getEarningRulesForProducts(
        cards
          .map((card) => card.cardProductId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
        { activeOnly: true }
      )
    ),
    bestEffortCatalogLoad("award_benchmarks", () =>
      dependencies.getAwardPriceBenchmarks(),
    ),
    bestEffortCatalogLoad("airport_region_map", () =>
      dependencies.getAirportRegionEntries(),
    ),
    bestEffortCatalogLoad("transfer_partners", () =>
      dependencies.getVerifiedTransferPartners(),
    ),
  ]);

  // Reward programs connected to the customer:
  // 1. Programs with a reward account (tracked balance).
  // 2. Programs behind card products linked to the user's wallet cards.
  const connectedProgramIds = new Set<string>();
  for (const account of rewardAccounts) {
    if (account.rewardProgramId) {
      connectedProgramIds.add(account.rewardProgramId);
    }
  }

  const cardProductById = new Map(cardProducts.map((p) => [p.id, p]));
  for (const card of walletCards) {
    if (!card.cardProductId) continue;
    const product = cardProductById.get(card.cardProductId);
    if (product?.rewardProgramId) {
      connectedProgramIds.add(product.rewardProgramId);
    }
  }

  const customerRewardPrograms: StrategyRewardProgram[] = rewardPrograms
    .filter((program) => connectedProgramIds.has(program.id))
    .map((program) => ({ id: program.id, name: program.name }));

  // Complete reward-program catalog, passed separately so sourced
  // transfer-partner options may reference any real catalog program.
  // These are never added to rewardAccounts and do not imply ownership.
  const catalogRewardPrograms: StrategyRewardProgram[] = rewardPrograms.map(
    (program) => ({ id: program.id, name: program.name })
  );

  const context = buildPersonalizedStrategyContext(
    goal,
    rewardAccounts,
    walletCards,
    purchases,
    cardProducts
  );

  // Attach verified-catalog earning inputs for the deterministic earn plan.
  // Only rules for products linked to the customer's own wallet cards are
  // included; the rules themselves remain catalog data and never imply
  // ownership. Attached post-construction so the context builder contract is
  // unchanged.
  const cardProductByIdForRules = new Map(cardProducts.map((p) => [p.id, p]));
  const linkedProductIds = new Set(
    walletCards
      .map((card) => card.cardProductId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const walletCardProgramIds: Record<string, string | null> = {};
  for (const card of walletCards) {
    const programId = card.cardProductId
      ? cardProductByIdForRules.get(card.cardProductId)?.rewardProgramId ?? null
      : null;
    walletCardProgramIds[card.id] = programId;
  }
  context.earningRules = earningRules.filter((rule) =>
    linkedProductIds.has(rule.cardProductId)
  );
  context.walletCardProgramIds = walletCardProgramIds;
  context.awardPriceBenchmarks = awardPriceBenchmarks;
  context.airportRegionEntries = airportRegionEntries;
  context.verifiedTransferPartners = verifiedTransferPartners;

  return {
    success: true,
    prepared: {
      supabase,
      userId,
      context,
      customerRewardPrograms,
      catalogRewardPrograms,
    },
  };
}
