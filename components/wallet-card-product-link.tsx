"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WalletCard } from "@/lib/wallet/types";
import type { CardProduct } from "@/lib/rewards/catalogTypes";
import {
  linkWalletCardAction,
  type WalletActionState,
} from "@/lib/wallet/actions";
import { Link2, Unlink, X } from "lucide-react";
import { getProductLinkFeedback } from "./wallet-card-product-link-presentation";

interface WalletCardProductLinkProps {
  card: WalletCard;
  products: CardProduct[];
}

export function WalletCardProductLink({
  card,
  products,
}: WalletCardProductLinkProps) {
  const router = useRouter();
  const editorId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [linkedProductId, setLinkedProductId] = useState(card.cardProductId);
  const [status, setStatus] = useState<WalletActionState | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const linkedProduct = linkedProductId
    ? products.find((product) => product.id === linkedProductId)
    : null;

  function handleLink(productId: string | null) {
    if (isPending) return;

    setStatus(null);
    setPendingMessage(
      productId === null
        ? `Unlinking ${card.name}...`
        : `Linking ${card.name} to the selected product...`
    );
    startTransition(async () => {
      try {
        const result = await linkWalletCardAction(card.id, productId);
        setStatus(result);
        if (result.success) {
          setLinkedProductId(result.card.cardProductId);
          setIsEditing(false);
          router.refresh();
        }
      } catch {
        setStatus({
          success: false,
          error: "The card product link could not be updated. Please try again.",
        });
      } finally {
        setPendingMessage(null);
      }
    });
  }

  const feedback = getProductLinkFeedback(isPending, pendingMessage, status);

  return (
    <div className="mt-3" aria-busy={isPending}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          {linkedProduct ? (
            <p className="break-words text-slate-300">
              Linked to:{" "}
              <span className="font-medium text-white">{linkedProduct.name}</span>
            </p>
          ) : linkedProductId ? (
            <p className="text-amber-200">
              The linked product is not available in the current catalog.
            </p>
          ) : (
            <p className="text-slate-400">No catalog product linked.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setStatus(null);
              setIsEditing((current) => !current);
            }}
            disabled={isPending || (!isEditing && products.length === 0)}
            aria-expanded={isEditing}
            aria-controls={editorId}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isEditing ? (
              <X aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Link2 aria-hidden="true" className="h-4 w-4" />
            )}
            {isEditing
              ? "Close product chooser"
              : linkedProductId
                ? "Change"
                : "Link card product"}
          </button>
          {linkedProductId ? (
            <button
              type="button"
              onClick={() => handleLink(null)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Unlink aria-hidden="true" className="h-4 w-4" />
              {isPending ? "Unlinking..." : "Unlink"}
            </button>
          ) : null}
        </div>
      </div>

      {isEditing ? (
        <fieldset
          id={editorId}
          disabled={isPending}
          className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4"
        >
          <legend className="px-1 text-sm font-medium text-white">
            Choose a catalog product
          </legend>

          {products.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              No card products are available in the catalog yet.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {products.map((product) => {
                const isCurrent = product.id === linkedProductId;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleLink(product.id)}
                    disabled={isPending || isCurrent}
                    className="flex w-full flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="break-words font-medium text-white">
                      {product.name}
                      {isCurrent ? " (current)" : ""}
                    </span>
                    <span className="text-slate-400">{product.issuer}</span>
                  </button>
                );
              })}
            </div>
          )}

        </fieldset>
      ) : null}

      {feedback ? (
        <p
          className={`mt-2 text-sm ${
            feedback.kind === "success"
              ? "text-emerald-300"
              : feedback.kind === "error"
                ? "text-rose-300"
                : "text-sky-300"
          }`}
          role={feedback.kind === "error" ? "alert" : "status"}
          aria-live={feedback.kind === "error" ? "assertive" : "polite"}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
