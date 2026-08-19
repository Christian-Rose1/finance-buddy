"use client";

import { useState } from "react";
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
  const [selectedCardId, setSelectedCardId] = useState<string | null>(currentCardId);
  const [isPending, setIsPending] = useState(false);

  const handleChange = async (value: string) => {
    const cardId = value === "" ? null : value;
    setSelectedCardId(cardId);
    setIsPending(true);

    try {
      await confirmPurchaseCardAction(purchaseId, cardId);
    } catch (err) {
      console.error("Failed to confirm card:", err);
      // Revert on error
      setSelectedCardId(currentCardId);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-slate-300 mb-1">
        Card used
      </label>
      <select
        className="w-full rounded-border border border-white/10 bg-white/5 p-2 text-sm focus:border-emerald-400 focus:outline-none disabled:opacity-50"
        value={selectedCardId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
      >
        <option disabled value="">
          — Select the card you used —
        </option>
        {activeCards.length > 0 && (
          <>
            <option value="">
              None / Unknown
            </option>
            {activeCards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name} ••••{card.lastFour}
              </option>
            ))}
          </>
        )}
        {activeCards.length === 0 && (
          <option disabled>
            No active wallet cards
          </option>
        )}
      </select>
      <p className="mt-1 text-xs text-slate-400">
        This marks the card actually used for this purchase and affects Money Found.
      </p>
    </div>
  );
}