import type { RewardAccount } from "./types";
import type { StrategyPointsInventoryItem } from "./strategyTypes";

export interface RewardProgramName {
  id: string;
  name: string;
}

/**
 * Builds a deterministic, sanitized points inventory from reward accounts and
 * the reward-program catalog.
 *
 * Every account becomes exactly one row, preserving input order. No grouping,
 * aggregation, valuation, or transferability inference is performed. The
 * identity fields `userId` and `ownerKey` are intentionally excluded from the
 * client-facing inventory.
 *
 * @param rewardAccounts User reward accounts (each becomes one row).
 * @param rewardPrograms  Catalog reward programs, or an empty array if the
 *                        catalog is unavailable.
 * @returns A sanitized points inventory.
 */
export function buildPointsInventory(
  rewardAccounts: RewardAccount[],
  rewardPrograms: Array<{ id: string; name: string }>
): StrategyPointsInventoryItem[] {
  const programNamesById = new Map<string, string>();

  for (const program of rewardPrograms) {
    if (!programNamesById.has(program.id)) {
      programNamesById.set(program.id, program.name);
    }
  }

  return rewardAccounts.map((account) => ({
    accountId: account.id,
    rewardProgramId: account.rewardProgramId,
    programName: programNamesById.get(account.rewardProgramId) ?? null,
    ownerLabel: account.ownerLabel,
    ownerType: account.ownerType,
    balance: account.balance,
    balanceAsOf: account.balanceAsOf,
    origin: account.origin,
    verificationStatus: account.verificationStatus,
  }));
}