import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase-server";
import { getGoalForUser } from "./repository";
import { getRewardAccountsForUser } from "./rewardAccountsRepository";
import { getWalletCardsForUser } from "@/lib/wallet/repository";
import { getPurchasesForUser } from "@/lib/purchases/repository";
import {
  getRewardPrograms,
  getCardProducts,
} from "@/lib/rewards/catalogRepository";
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
export async function prepareGoalStrategyContext(
  goalId: string
): Promise<PrepareGoalStrategyContextResult> {
  if (typeof goalId !== "string" || goalId.trim().length === 0) {
    return { success: false, message: "A valid goal is required." };
  }

  const supabase = await createServerClient();
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
  const goal = await getGoalForUser(goalId, userId);
  if (!goal) {
    return {
      success: false,
      message: "We couldn't find that goal. It may have been removed.",
    };
  }

  const [
    rewardAccounts,
    walletCards,
    purchases,
    rewardPrograms,
    cardProducts,
  ] = await Promise.all([
    getRewardAccountsForUser(userId),
    getWalletCardsForUser(userId),
    getPurchasesForUser(userId),
    getRewardPrograms(),
    getCardProducts({ activeOnly: true }),
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