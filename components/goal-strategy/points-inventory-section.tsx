import React from "react";
import { Sparkles } from "lucide-react";
import type { StrategyPointsInventoryItem } from "@/lib/goals/strategyTypes";
import {
  ORIGIN_LABELS,
  OWNER_TYPE_LABELS,
  VERIFICATION_LABELS,
  formatBalanceAsOf,
  formatPoints,
} from "./presentation";

function PointsInventoryList({
  accounts,
}: {
  accounts: StrategyPointsInventoryItem[];
}) {
  return (
    <ul className="mt-2 space-y-2">
      {accounts.map((account) => (
        <li
          key={account.accountId}
          className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
        >
          <p className="text-sm font-medium text-white">
            {account.programName ?? "Unknown reward program"}
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatPoints(account.balance)} points
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
            <span>Balance: {formatPoints(account.balance)}</span>
            <span>{OWNER_TYPE_LABELS[account.ownerType] ?? account.ownerType}</span>
            <span>
              {VERIFICATION_LABELS[account.verificationStatus] ??
                account.verificationStatus}
            </span>
            <span>{ORIGIN_LABELS[account.origin] ?? account.origin}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {account.ownerLabel} · Balance as of{" "}
            {formatBalanceAsOf(account.balanceAsOf)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function PointsInventorySection({
  inventory,
}: {
  inventory: StrategyPointsInventoryItem[];
}) {
  if (inventory.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <p className="text-sm text-slate-400">
          No reward balances are currently available for this strategy.
        </p>
      </div>
    );
  }

  const verified = inventory.filter(
    (account) => account.verificationStatus === "verified"
  );
  const unverified = inventory.filter(
    (account) => account.verificationStatus === "unverified"
  );

  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <Sparkles aria-hidden="true" className="h-4 w-4 text-sky-300" />
        Your points
      </p>

      {verified.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-300">
            Verified balances
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            These balances are marked verified in Finance Buddy.
          </p>
          <PointsInventoryList accounts={verified} />
        </div>
      ) : null}

      {unverified.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-300">
            Unverified balances
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Verify these balances before relying on them for booking decisions.
          </p>
          <PointsInventoryList accounts={unverified} />
        </div>
      ) : null}
    </div>
  );
}
