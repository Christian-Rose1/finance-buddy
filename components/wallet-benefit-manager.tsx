"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Power, PowerOff } from "lucide-react";
import type { ProductBenefit } from "@/lib/rewards/catalogTypes";
import type { WalletCard } from "@/lib/wallet/types";
import type { WalletBenefitOption } from "@/lib/wallet/benefitsRepository";
import {
  createWalletBenefitStateAction,
  setWalletBenefitActiveAction,
  updateWalletBenefitStateAction,
  type WalletBenefitActionState,
} from "@/lib/wallet/actions";

interface WalletBenefitManagerProps {
  card: WalletCard;
  benefits: WalletBenefitOption[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function dateInputValue(value: string | null): string {
  return value?.slice(0, 10) ?? "";
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function categoryNoun(category: string | null): string | null {
  if (!category) return null;
  const labels: Record<string, string> = {
    "travel:hotels": "hotel stays",
    "travel:airfare": "airline purchases",
    "food:dining": "dining purchases",
    "food:groceries": "grocery purchases",
    "shopping:electronics": "electronics purchases",
  };
  return labels[category] ?? (category.split(":")[1] ?? category).replace(/_/g, " ");
}

function extractChannel(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(
    /(?:booked|purchased) through ([A-Z][\w\s]+?)(?:[.,]|$)/i
  );
  return match ? match[1].trim() : null;
}

function benefitCondition(product: ProductBenefit): string | null {
  const parts: string[] = [];
  const category = categoryNoun(product.eligibleCategory);
  const channel = extractChannel(product.description);
  if (category) parts.push(`qualifying ${category}`);
  if (channel) parts.push(`booked through ${channel}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

function catalogLimit(product: ProductBenefit): number | null {
  return product.annualLimit ?? product.fixedValue;
}

function statusMessage(
  status: WalletBenefitActionState | null
): React.ReactNode {
  if (!status) return null;
  return (
    <p
      className={`mt-3 text-sm ${
        status.success ? "text-emerald-300" : "text-rose-300"
      }`}
      role={status.success ? "status" : "alert"}
      aria-live={status.success ? "polite" : "assertive"}
    >
      {status.success ? status.message : status.error}
    </p>
  );
}

export function WalletBenefitManager({
  card,
  benefits,
}: WalletBenefitManagerProps) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<
    Record<string, WalletBenefitActionState | null>
  >({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(
    productId: string,
    message: string,
    action: () => Promise<WalletBenefitActionState>
  ) {
    if (isPending) return;
    setPendingId(productId);
    setPendingMessage(message);
    setStatuses((current) => ({ ...current, [productId]: null }));
    startTransition(async () => {
      try {
        const result = await action();
        setStatuses((current) => ({ ...current, [productId]: result }));
        if (result.success) router.refresh();
      } catch {
        setStatuses((current) => ({
          ...current,
          [productId]: {
            success: false,
            error: "The benefit could not be updated. Please try again.",
          },
        }));
      } finally {
        setPendingId(null);
        setPendingMessage(null);
      }
    });
  }

  if (benefits.length === 0) {
    return (
      <p className="mt-4 border-t border-white/10 pt-4 text-sm text-slate-400">
        No catalog benefits are available for this linked product.
      </p>
    );
  }

  return (
    <section
      className="mt-4 border-t border-white/10 pt-4"
      aria-busy={isPending}
    >
      <h4 className="text-sm font-semibold text-white">Benefits</h4>
      <div className="mt-2 divide-y divide-white/10 border-y border-white/10">
        {benefits.map(({ product, state }) => {
          const limit = catalogLimit(product);
          const condition = benefitCondition(product);
          const pending = pendingId === product.id;
          return (
            <div key={product.id} className="py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h5 className="text-sm font-medium text-slate-100">
                      {product.title}
                    </h5>
                    {state ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          state.active
                            ? "bg-emerald-400/10 text-emerald-300"
                            : "bg-slate-700/50 text-slate-400"
                        }`}
                      >
                        {state.active ? "Active" : "Inactive"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">
                        Not tracked
                      </span>
                    )}
                    {!product.active ? (
                      <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">
                        Catalog inactive
                      </span>
                    ) : null}
                  </div>

                  {product.description ? (
                    <p className="mt-1 max-w-2xl text-sm text-slate-300">
                      {product.description}
                    </p>
                  ) : null}
                  {condition ? (
                    <p className="mt-1 text-xs text-sky-300">
                      Use on {condition}.
                    </p>
                  ) : null}
                  {limit !== null ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Catalog limit: {formatCurrency(limit)}
                      {product.periodType !== "none"
                        ? ` per ${product.periodType.replace("_", " ")}`
                        : ""}
                    </p>
                  ) : null}
                </div>

                {!state ? (
                  <button
                    type="button"
                    onClick={() =>
                      runAction(
                        product.id,
                        `Starting ${product.title} tracking...`,
                        () =>
                          createWalletBenefitStateAction(card.id, product.id)
                      )
                    }
                    disabled={isPending || !product.active}
                    className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    <Check aria-hidden="true" className="h-4 w-4" />
                    {pending ? "Starting..." : "Track benefit"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      runAction(
                        product.id,
                        `${state.active ? "Deactivating" : "Activating"} ${product.title}...`,
                        () =>
                          setWalletBenefitActiveAction(
                            card.id,
                            state.id,
                            !state.active
                          )
                      )
                    }
                    disabled={
                      isPending || (!product.active && !state.active)
                    }
                    className={`inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${
                      state.active
                        ? "border border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
                        : "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                    }`}
                  >
                    {state.active ? (
                      <PowerOff aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <Power aria-hidden="true" className="h-4 w-4" />
                    )}
                    {pending
                      ? "Updating..."
                      : state.active
                        ? "Deactivate"
                        : product.requiresActivation
                          ? "Activate"
                          : "Enable"}
                  </button>
                )}
              </div>

              {state ? (
                <form
                  action={(formData) =>
                    runAction(
                      product.id,
                      `Saving ${product.title} details...`,
                      () => updateWalletBenefitStateAction(formData)
                    )
                  }
                  className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2"
                >
                  <input type="hidden" name="walletCardId" value={card.id} />
                  <input type="hidden" name="benefitId" value={state.id} />

                  {limit !== null ? (
                    <>
                      <div className="space-y-1.5">
                        <label
                          htmlFor={`remaining-${state.id}`}
                          className="block text-xs font-medium text-slate-300"
                        >
                          Remaining value
                        </label>
                        <input
                          id={`remaining-${state.id}`}
                          name="remainingValue"
                          type="number"
                          min="0"
                          max={limit}
                          step="0.01"
                          defaultValue={state.remainingValue ?? ""}
                          required
                          disabled={isPending}
                          className="fb-input"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor={`used-${state.id}`}
                          className="block text-xs font-medium text-slate-300"
                        >
                          Used value
                        </label>
                        <input
                          id={`used-${state.id}`}
                          name="usedValue"
                          type="number"
                          min="0"
                          max={limit}
                          step="0.01"
                          defaultValue={state.usedValue}
                          required
                          disabled={isPending}
                          className="fb-input"
                        />
                      </div>
                    </>
                  ) : null}

                  {product.periodType !== "none" ? (
                    <>
                      <div className="space-y-1.5">
                        <label
                          htmlFor={`period-start-${state.id}`}
                          className="block text-xs font-medium text-slate-300"
                        >
                          Period start
                        </label>
                        <input
                          id={`period-start-${state.id}`}
                          name="periodStart"
                          type="date"
                          defaultValue={dateInputValue(state.periodStart)}
                          disabled={isPending}
                          className="fb-input"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor={`period-end-${state.id}`}
                          className="block text-xs font-medium text-slate-300"
                        >
                          Period end
                        </label>
                        <input
                          id={`period-end-${state.id}`}
                          name="periodEnd"
                          type="date"
                          defaultValue={dateInputValue(state.periodEnd)}
                          disabled={isPending}
                          className="fb-input"
                        />
                      </div>
                    </>
                  ) : null}

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`expires-${state.id}`}
                      className="block text-xs font-medium text-slate-300"
                    >
                      Expires
                    </label>
                    <input
                      id={`expires-${state.id}`}
                      name="expiresAt"
                      type="date"
                      defaultValue={dateInputValue(state.expiresAt)}
                      disabled={isPending}
                      className="fb-input"
                    />
                  </div>

                  <div className="flex flex-col items-stretch gap-2 min-[420px]:flex-row min-[420px]:items-end">
                    <button
                      type="submit"
                      disabled={isPending}
                      className="fb-btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pending ? "Saving..." : "Save details"}
                    </button>
                    {state.activatedAt ? (
                      <span className="pb-2 text-xs text-slate-400">
                        Activated {formatDate(state.activatedAt)}
                      </span>
                    ) : null}
                  </div>
                </form>
              ) : null}

              {pending ? (
                <p
                  className="mt-3 text-sm text-sky-300"
                  role="status"
                  aria-live="polite"
                >
                  {pendingMessage ?? "Updating benefit..."}
                </p>
              ) : (
                statusMessage(statuses[product.id] ?? null)
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
