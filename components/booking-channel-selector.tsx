"use client";

import { useState, useTransition } from "react";
import { Gift } from "lucide-react";
import { confirmPurchaseBookingChannelAction } from "../lib/purchases/actions";

interface BookingChannelSelectorProps {
  purchaseId: string;
  currentChannel: string | null;
}

export function BookingChannelSelector({
  purchaseId,
  currentChannel,
}: BookingChannelSelectorProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = (channel: "chase_travel" | null) => {
    setError(null);
    startTransition(async () => {
      try {
        await confirmPurchaseBookingChannelAction(purchaseId, channel);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update.");
      }
    });
  };

  const isChaseTravel = currentChannel === "chase_travel";

  return (
    <div className="mt-8 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-emerald-300" />
        <h2 className="text-lg font-semibold text-white">
          Was this booked through Chase Travel?
        </h2>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={() => handleConfirm("chase_travel")}
          disabled={isPending || isChaseTravel}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            isChaseTravel
              ? "bg-emerald-500 text-white"
              : "bg-white/5 text-slate-300 hover:bg-white/10"
          } disabled:opacity-50`}
        >
          {isChaseTravel ? "Confirmed Chase Travel" : "Yes — Chase Travel"}
        </button>

        <button
          onClick={() => handleConfirm(null)}
          disabled={isPending || !isChaseTravel}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            !isChaseTravel
              ? "bg-slate-700 text-white"
              : "bg-white/5 text-slate-300 hover:bg-white/10"
          } disabled:opacity-50`}
        >
          No / Unknown
        </button>
      </div>
    </div>
  );
}
