"use client";

import { useState, useTransition } from "react";
import type { WalletCard } from "@/lib/wallet/types";
import type { CardProduct } from "@/lib/rewards/catalogTypes";
import { linkWalletCardAction } from "@/lib/wallet/actions";
import { Link2, Unlink } from "lucide-react";

interface WalletCardProductLinkProps {
  card: WalletCard;
  products: CardProduct[];
}

export function WalletCardProductLink({
  card,
  products,
}: WalletCardProductLinkProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const linkedProduct = card.cardProductId
    ? products.find((p) => p.id === card.cardProductId)
    : null;

  function handleLink(productId: string | null) {
    startTransition(async () => {
      const result = await linkWalletCardAction(card.id, productId);
      if (result.success) {
        setStatus(result.message ?? "Updated.");
        setIsEditing(false);
      } else {
        setStatus(result.error);
      }
    });
  }

  if (!isEditing) {
    return (
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {linkedProduct ? (
            <p className="text-slate-300">
              Linked to: <span className="font-medium text-white">{linkedProduct.name}</span>
            </p>
          ) : (
            <p className="text-slate-400">No catalog product linked.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {linkedProduct ? (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Link2 className="h-4 w-4" />
                Change
              </button>
              <button
                type="button"
                onClick={() => handleLink(null)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Unlink className="h-4 w-4" />
                Unlink
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              disabled={isPending || products.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Link2 className="h-4 w-4" />
              Link card product
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
      <p className="text-sm font-medium text-white">Choose a catalog product</p>

      {products.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">
          No card products are available in the catalog yet.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => handleLink(product.id)}
              disabled={isPending || product.id === card.cardProductId}
              className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="font-medium text-white">{product.name}</span>
              <span className="text-slate-400">{product.issuer}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          disabled={isPending}
          className="text-sm text-slate-400 hover:text-white"
        >
          Cancel
        </button>
      </div>

      {status ? (
        <p
          className={`mt-3 text-sm ${
            status.startsWith("Failed") ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
