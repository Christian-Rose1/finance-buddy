"use client";

import { useState, useTransition } from "react";
import type { WalletCard } from "@/lib/wallet/types";
import type { CardProduct } from "@/lib/rewards/catalogTypes";
import {
  deleteWalletCardAction,
  toggleWalletCardAction,
  type WalletActionState,
} from "@/lib/wallet/actions";
import { WalletCardForm } from "./wallet-card-form";
import { WalletCardProductLink } from "./wallet-card-product-link";
import {
  CreditCard,
  Trash2,
  Power,
  PowerOff,
  Pencil,
  Circle,
} from "lucide-react";

interface WalletCardListProps {
  cards: WalletCard[];
  products: CardProduct[];
}

function networkLabel(network: WalletCard["network"]): string {
  switch (network) {
    case "visa":
      return "Visa";
    case "mastercard":
      return "Mastercard";
    case "amex":
      return "American Express";
    case "discover":
      return "Discover";
    default:
      return "Other";
  }
}

function rewardLabel(currency: WalletCard["rewardCurrency"]): string {
  switch (currency) {
    case "cashback":
      return "Cashback";
    case "points":
      return "Points";
    case "miles":
      return "Miles";
    default:
      return "No rewards";
  }
}

export function WalletCardList({ cards, products }: WalletCardListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-8 text-center">
        <p className="font-medium text-white">Your wallet is empty</p>
        <p className="mt-2 text-sm text-slate-400">
          Add the credit cards you carry so Finance Buddy can build your
          personalized wallet.
        </p>
      </div>
    );
  }

  function handleToggle(card: WalletCard) {
    startTransition(async () => {
      const nextState = await toggleWalletCardAction(card.id, !card.active);
      setStatus(nextState);
    });
  }

  function handleDelete(cardId: string) {
    if (!confirm("Remove this card from your wallet? This cannot be undone.")) {
      return;
    }

    startTransition(async () => {
      const nextState = await deleteWalletCardAction(cardId);
      setStatus(nextState);
      if (nextState.success) {
        setEditingId(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      {status?.success === false ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-rose-100/80">{status.error}</p>
        </div>
      ) : null}

      {status?.success === true ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
          <p className="font-medium">Success</p>
          <p className="mt-1 text-emerald-100/80">{status.message}</p>
        </div>
      ) : null}

      {cards.map((card) => (
        <div
          key={card.id}
          className="fb-card overflow-hidden"
        >
          {editingId === card.id ? (
            <div className="border-b border-white/10 bg-slate-950/40 p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">
                  Edit card
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="text-sm text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <WalletCardForm
                mode="edit"
                card={card}
                onSuccess={() => setEditingId(null)}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-start gap-4">
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
                  card.active
                    ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                    : "border-slate-700 bg-slate-900 text-slate-500"
                }`}
              >
                <CreditCard className="h-5 w-5" />
              </span>

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-white">
                    {card.name}
                  </h3>
                  {card.active ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      <Circle className="h-2 w-2 fill-current" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/50 px-2 py-0.5 text-xs font-medium text-slate-400">
                      <Circle className="h-2 w-2 fill-current" />
                      Inactive
                    </span>
                  )}
                </div>

                <p className="mt-1 text-sm text-slate-400">
                  {card.issuer} · {networkLabel(card.network)}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                    {rewardLabel(card.rewardCurrency)}
                  </span>
                  {card.lastFour ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      •••• {card.lastFour}
                    </span>
                  ) : null}
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 capitalize">
                    {card.source}
                  </span>
                </div>

                <WalletCardProductLink card={card} products={products} />
              </div>
            </div>

            <div className="flex items-center gap-2 sm:flex-col sm:items-end">
              <button
                type="button"
                onClick={() => setEditingId(card.id)}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>

              <button
                type="button"
                onClick={() => handleToggle(card)}
                disabled={isPending}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  card.active
                    ? "border border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
                    : "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                }`}
              >
                {card.active ? (
                  <>
                    <PowerOff className="h-4 w-4" />
                    Deactivate
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4" />
                    Activate
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleDelete(card.id)}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
