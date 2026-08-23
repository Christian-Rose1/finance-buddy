"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RewardAccount } from "@/lib/goals/types";
import type { RewardProgram } from "@/lib/rewards/catalogTypes";
import {
  createRewardAccountAction,
  updateRewardAccountAction,
  type RewardAccountActionState,
} from "@/lib/goals/rewardAccountActions";

interface RewardAccountManagerProps {
  accounts: RewardAccount[];
  programs: RewardProgram[];
}

/** Converts an ISO UTC timestamp to a `YYYY-MM-DD` date string for date inputs. */
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

/** Returns today's date as a `YYYY-MM-DD` string in the user's local timezone. */
function todayDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Formats a balance number for display. */
function formatBalance(balance: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(balance);
}

/** Formats an ISO timestamp as a readable date. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RewardAccountManager({
  accounts,
  programs,
}: RewardAccountManagerProps) {
  const router = useRouter();
  const [createState, setCreateState] = useState<RewardAccountActionState | null>(
    null
  );
  const [updateStates, setUpdateStates] = useState<
    Record<string, RewardAccountActionState | null>
  >({});
  const [isCreatePending, startCreateTransition] = useTransition();
  const [pendingUpdateId, setPendingUpdateId] = useState<string | null>(null);

  const programById = new Map(programs.map((p) => [p.id, p]));

  function handleCreate(formData: FormData) {
    startCreateTransition(async () => {
      const nextState = await createRewardAccountAction(formData);
      setCreateState(nextState);
      if (nextState.success) {
        router.refresh();
      }
    });
  }

  function handleUpdate(accountId: string, formData: FormData) {
    setPendingUpdateId(accountId);
    startCreateTransition(async () => {
      const nextState = await updateRewardAccountAction(formData);
      setUpdateStates((prev) => ({ ...prev, [accountId]: nextState }));
      setPendingUpdateId(null);
      if (nextState.success) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">
        Enter the balance shown in your rewards account. Your confirmed number
        is the source of truth.
      </p>

      {/* Existing balances */}
      {accounts.length > 0 ? (
        <div className="space-y-3">
          {accounts.map((account) => {
            const program = programById.get(account.rewardProgramId);
            const updateState = updateStates[account.id] ?? null;
            const isSaving = pendingUpdateId === account.id;
            return (
              <div
                key={account.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-white">
                      {program?.name ?? "Unknown program"}
                    </p>
                    <p className="text-sm text-slate-400">
                      {account.ownerLabel}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-white">
                      {formatBalance(account.balance)}
                    </p>
                    <p className="text-xs text-slate-400">
                      as of {formatDate(account.balanceAsOf)}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                    User confirmed
                  </span>
                </div>

                <form
                  action={(formData) => handleUpdate(account.id, formData)}
                  className="mt-4 space-y-3 border-t border-white/10 pt-4"
                >
                  <input type="hidden" name="accountId" value={account.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`balance-${account.id}`}
                        className="block text-sm font-medium text-slate-200"
                      >
                        Balance
                      </label>
                      <input
                        id={`balance-${account.id}`}
                        name="balance"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        defaultValue={account.balance}
                        className="fb-input"
                        required
                        disabled={isSaving}
                        autoComplete="off"
                        data-1p-ignore
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`balanceAsOf-${account.id}`}
                        className="block text-sm font-medium text-slate-200"
                      >
                        Balance as of
                      </label>
                      <input
                        id={`balanceAsOf-${account.id}`}
                        name="balanceAsOf"
                        type="date"
                        defaultValue={toDateInputValue(account.balanceAsOf)}
                        className="fb-input"
                        required
                        disabled={isSaving}
                      />
                    </div>
                  </div>

                  {updateState?.success === false ? (
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">
                      <p className="font-medium">Something went wrong</p>
                      <p className="mt-1 text-rose-100/80">{updateState.message}</p>
                    </div>
                  ) : null}

                  {updateState?.success === true ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">
                      <p className="font-medium">Balance updated</p>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="fb-btn disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSaving ? "Saving…" : "Update balance"}
                    </button>
                  </div>
                </form>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
          No balances yet. Add your first balance below.
        </div>
      )}

      {/* Add balance form */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <h3 className="text-base font-semibold text-white">Add a balance</h3>
        <p className="mt-1 text-sm text-slate-400">
          Enter the balance shown in your rewards account. Your confirmed number
          is the source of truth.
        </p>

        <form action={handleCreate} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="rewardProgramId"
              className="block text-sm font-medium text-slate-200"
            >
              Reward program
            </label>
            <select
              id="rewardProgramId"
              name="rewardProgramId"
              className="fb-input"
              required
              disabled={isCreatePending}
            >
              <option value="">Select a program…</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="ownerType"
              className="block text-sm font-medium text-slate-200"
            >
              Owner
            </label>
            <select
              id="ownerType"
              name="ownerType"
              className="fb-input"
              defaultValue="self"
              required
              disabled={isCreatePending}
            >
              <option value="self">Me</option>
              <option value="companion">Companion</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="ownerLabel"
              className="block text-sm font-medium text-slate-200"
            >
              Companion label <span className="text-slate-500">(optional)</span>
            </label>
            <input
              id="ownerLabel"
              name="ownerLabel"
              type="text"
              placeholder="e.g., Spouse"
              className="fb-input"
              maxLength={100}
              disabled={isCreatePending}
              autoComplete="off"
              data-1p-ignore
            />
            <p className="text-xs text-slate-400">
              Only needed when the owner is a companion.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="balance"
                className="block text-sm font-medium text-slate-200"
              >
                Balance
              </label>
              <input
                id="balance"
                name="balance"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className="fb-input"
                required
                disabled={isCreatePending}
                autoComplete="off"
                data-1p-ignore
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="balanceAsOf"
                className="block text-sm font-medium text-slate-200"
              >
                Balance as of
              </label>
              <input
                id="balanceAsOf"
                name="balanceAsOf"
                type="date"
                defaultValue={todayDateInputValue()}
                className="fb-input"
                required
                disabled={isCreatePending}
              />
            </div>
          </div>

          {createState?.success === false ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">
              <p className="font-medium">Something went wrong</p>
              <p className="mt-1 text-rose-100/80">{createState.message}</p>
            </div>
          ) : null}

          {createState?.success === true ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">
              <p className="font-medium">Balance added</p>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isCreatePending}
              className="fb-btn disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCreatePending ? "Adding…" : "Add balance"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}