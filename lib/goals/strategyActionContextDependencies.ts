import { AsyncLocalStorage } from "node:async_hooks";

import { createServerClient } from "@/lib/supabase-server";
import { getWalletCardsForUser } from "@/lib/wallet/repository";
import { getPurchasesForUser } from "@/lib/purchases/repository";
import { getRewardPrograms, getCardProducts } from "@/lib/rewards/catalogRepository";
import { getGoalForUser } from "./repository";
import { getRewardAccountsForUser } from "./rewardAccountsRepository";

export interface StrategyActionContextDependencies {
  createServerClient: typeof createServerClient;
  getGoalForUser: typeof getGoalForUser;
  getRewardAccountsForUser: typeof getRewardAccountsForUser;
  getWalletCardsForUser: typeof getWalletCardsForUser;
  getPurchasesForUser: typeof getPurchasesForUser;
  getRewardPrograms: typeof getRewardPrograms;
  getCardProducts: typeof getCardProducts;
}

const productionDependencies: StrategyActionContextDependencies = Object.freeze({
  createServerClient,
  getGoalForUser,
  getRewardAccountsForUser,
  getWalletCardsForUser,
  getPurchasesForUser,
  getRewardPrograms,
  getCardProducts,
});
const testOverrides = new AsyncLocalStorage<StrategyActionContextDependencies>();

export function getStrategyActionContextDependencies(): StrategyActionContextDependencies {
  return testOverrides.getStore() ?? productionDependencies;
}

/** Request-local test seam; production/browser action arguments cannot select it. */
export function withStrategyActionContextDependenciesForTest<T>(
  dependencies: StrategyActionContextDependencies,
  operation: () => Promise<T>,
): Promise<T> {
  return testOverrides.run(Object.freeze(dependencies), operation);
}
