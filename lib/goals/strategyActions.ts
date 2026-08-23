"use server";

/**
 * Server actions for personalized goal strategy generation.
 *
 * Security:
 * - The authenticated user is resolved exclusively from the cookie-aware
 *   server Supabase client. No userId is ever accepted from the client.
 * - The goal is loaded with an ownership check (getGoalForUser).
 * - A fully validated generated strategy is persisted as the latest saved
 *   strategy for the goal. A save failure never discards the generated
 *   strategy and never changes a previously saved strategy.
 */

import { createServerClient } from "@/lib/supabase-server";
import { getGoalForUser } from "./repository";
import { getRewardAccountsForUser } from "./rewardAccountsRepository";
import { getWalletCardsForUser } from "@/lib/wallet/repository";
import { getPurchasesForUser } from "@/lib/purchases/repository";
import { getRewardPrograms, getCardProducts } from "@/lib/rewards/catalogRepository";
import { buildPersonalizedStrategyContext } from "./strategyContextBuilder";
import {
  generateAutomatedStrategy,
  type StrategyRewardProgram,
} from "./automatedStrategyPlanner";
import { saveLatestStrategy } from "./strategyRepository";
import type { PersonalizedStrategy } from "./strategyTypes";

export type GenerateGoalStrategyResult =
  | {
      success: true;
      strategy: PersonalizedStrategy;
      saved: boolean;
      saveMessage: string | null;
    }
  | { success: false; message: string };

/**
 * Generate a personalized points strategy for one of the authenticated
 * user's goals.
 *
 * Data flow:
 *   authenticated user
 *   → owned goal + reward accounts + wallet cards + purchases
 *   → shared reward program / card product catalog
 *   → buildPersonalizedStrategyContext
 *   → generateAutomatedStrategy (research + interpretation + strategy)
 *
 * Only reward programs connected to the customer — through a reward account
 * or through a wallet card linked to a card product — are passed to the
 * planner as research targets. The complete reward-program catalog is passed
 * separately so sourced transfer-partner options may reference any real
 * catalog program without implying customer ownership.
 */
export async function generateGoalStrategyAction(
  goalId: string
): Promise<GenerateGoalStrategyResult> {
  try {
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

    // Ownership-checked goal load. Returns null when the goal does not
    // exist or belongs to another user.
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

    const strategy = await generateAutomatedStrategy(
      context,
      customerRewardPrograms,
      catalogRewardPrograms
    );

    // Persist the fully validated strategy as the latest saved strategy for
    // this goal. A save failure is caught separately so the generated strategy
    // is still returned and a previously saved strategy is never changed.
    try {
      await saveLatestStrategy(
        goalId,
        userId,
        strategy,
        context.generatedAt,
        supabase
      );
      return { success: true, strategy, saved: true, saveMessage: null };
    } catch (saveError) {
      const safeSaveMessage =
        saveError instanceof Error
          ? `${saveError.name}: ${saveError.message}`
          : "Unknown error";
      if (process.env.STRATEGY_DEBUG === "1") {
        console.error("[strategy-save-error]", safeSaveMessage);
      }
      return {
        success: true,
        strategy,
        saved: false,
        saveMessage:
          "Your strategy was generated but couldn't be saved. Your previously saved strategy, if any, was not changed.",
      };
    }
  } catch (error) {
    const safeMessage =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Unknown error";
    if (process.env.STRATEGY_DEBUG === "1") {
      console.error("[strategy-build-error]", safeMessage);
    }
    // Deliberately generic: never leak internal/database details to the client.
    return {
      success: false,
      message:
        process.env.STRATEGY_DEBUG === "1"
          ? `[server-action-error] ${safeMessage}`
          : "We couldn't build your strategy right now. Please try again in a moment.",
    };
  }
}
