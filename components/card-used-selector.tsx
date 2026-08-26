"use client";

import { useId, useState } from "react";
import { confirmPurchaseCardAction } from "@/lib/purchases/actions";
import type { WalletCard } from "@/lib/wallet/types";

interface CardUsedSelectorProps {
  purchaseId: string;
  currentCardId: string | null;
  activeCards: WalletCard[];
}

export function CardUsedSelector({
  purchaseId,
  currentCardId,
  activeCards,
}: CardUsedSelectorProps) {
  const selectId = useId();
  const helpId = `${selectId}-help`;
  const feedbackId = `${selectId}-feedback`;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(currentCardId);
  const [confirmedCardId, setConfirmedCardId] = useState<string | null>(currentCardId);
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const handleChange = async (value: string) => {
    if (isPending) return;

    const cardId = value === "" ? null : value;
    const previousCardId = confirmedCardId;
    setSelectedCardId(cardId);
    setFeedback(null);
    setIsPending(true);

    try {
      await confirmPurchaseCardAction(purchaseId, cardId);
      setConfirmedCardId(cardId);
      setFeedback({
        kind: "success",
        message: cardId
          ? "Card used was saved."
          : "Card selection was cleared.",
      });
    } catch {
      setSelectedCardId(previousCardId);
      setFeedback({
        kind: "error",
        message: previousCardId
          ? "Card selection was not saved. Your previous card remains selected."
          : "Card selection was not saved. No card remains selected.",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="mt-4">
      <label
        htmlFor={selectId}
        className="mb-1 block text-sm font-medium text-slate-300"
      >
        Card used
      </label>
      <select
        id={selectId}
        className="w-full rounded-xl border border-white/10 bg-white/5 p-2 text-sm focus:border-emerald-400 focus:outline-none disabled:opacity-50"
        value={selectedCardId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        aria-busy={isPending}
        aria-describedby={`${helpId}${isPending || feedback ? ` ${feedbackId}` : ""}`}
      >
        <option value="">None / Unknown</option>
        {activeCards.map((card) => (
          <option key={card.id} value={card.id}>
            {card.name}
            {card.lastFour ? ` ending in ${card.lastFour}` : ""}
          </option>
        ))}
        {activeCards.length === 0 && (
          <option disabled>
            No active wallet cards available
          </option>
        )}
      </select>
      <p id={helpId} className="mt-1 text-xs text-slate-400">
        This marks the card actually used for this purchase and affects Money Found.
      </p>
      {isPending ? (
        <p
          id={feedbackId}
          className="mt-1 text-xs text-sky-300"
          role="status"
          aria-live="polite"
        >
          Saving card selection...
        </p>
      ) : feedback ? (
        <p
          id={feedbackId}
          className={`mt-1 text-xs ${
            feedback.kind === "success" ? "text-emerald-300" : "text-rose-300"
          }`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
