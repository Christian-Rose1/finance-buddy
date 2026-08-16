"use client";

import { useState, useTransition } from "react";
import type {
  CardNetwork,
  RewardCurrency,
  WalletCard,
} from "@/lib/wallet/types";
import {
  createWalletCardAction,
  updateWalletCardAction,
  type WalletActionState,
} from "@/lib/wallet/actions";

const NETWORK_OPTIONS: { value: CardNetwork; label: string }[] = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "amex", label: "American Express" },
  { value: "discover", label: "Discover" },
  { value: "other", label: "Other" },
];

const REWARD_OPTIONS: { value: RewardCurrency; label: string }[] = [
  { value: "cashback", label: "Cashback" },
  { value: "points", label: "Points" },
  { value: "miles", label: "Miles" },
  { value: "none", label: "No rewards" },
];

interface WalletCardFormProps {
  mode: "create" | "edit";
  card?: WalletCard;
  onSuccess?: (state: WalletActionState) => void;
}

export function WalletCardForm({ mode, card, onSuccess }: WalletCardFormProps) {
  const [state, setState] = useState<WalletActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEdit = mode === "edit";
  const submitLabel = isEdit
    ? isPending
      ? "Saving changes…"
      : "Save changes"
    : isPending
      ? "Adding card…"
      : "Add card";

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const action = isEdit ? updateWalletCardAction : createWalletCardAction;
      const nextState = await action(state, formData);
      setState(nextState);

      if (nextState.success && onSuccess) {
        onSuccess(nextState);
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {isEdit && card ? (
        <input type="hidden" name="cardId" value={card.id} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="name" className="block text-sm font-medium text-slate-200">
            Card name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={card?.name ?? ""}
            placeholder="e.g., Chase Sapphire Preferred"
            className="fb-input"
            required
            maxLength={100}
            autoComplete="off"
            data-1p-ignore
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="issuer" className="block text-sm font-medium text-slate-200">
            Issuer
          </label>
          <input
            id="issuer"
            name="issuer"
            type="text"
            defaultValue={card?.issuer ?? ""}
            placeholder="e.g., Chase"
            className="fb-input"
            required
            maxLength={100}
            autoComplete="off"
            data-1p-ignore
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="network" className="block text-sm font-medium text-slate-200">
            Network
          </label>
          <select
            id="network"
            name="network"
            defaultValue={card?.network ?? "visa"}
            className="fb-input"
            required
          >
            {NETWORK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="rewardCurrency" className="block text-sm font-medium text-slate-200">
            Reward type
          </label>
          <select
            id="rewardCurrency"
            name="rewardCurrency"
            defaultValue={card?.rewardCurrency ?? "points"}
            className="fb-input"
            required
          >
            {REWARD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="lastFour" className="block text-sm font-medium text-slate-200">
          Last four digits <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id="lastFour"
          name="lastFour"
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          defaultValue={card?.lastFour ?? ""}
          placeholder="1234"
          className="fb-input sm:w-48"
          autoComplete="off"
          data-1p-ignore
        />
        <p className="text-xs text-slate-400">
          Finance Buddy never stores your full card number, CVV, or PIN.
        </p>
      </div>

      {state?.success === false ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-rose-100/80">{state.error}</p>
        </div>
      ) : null}

      {state?.success === true ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
          <p className="font-medium">Success</p>
          <p className="mt-1 text-emerald-100/80">{state.message}</p>
        </div>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="fb-btn disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
