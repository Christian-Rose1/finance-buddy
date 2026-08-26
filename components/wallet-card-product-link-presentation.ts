import type { WalletActionState } from "@/lib/wallet/actions";

export interface ProductLinkFeedback {
  kind: "pending" | "success" | "error";
  message: string;
}

export function getProductLinkFeedback(
  isPending: boolean,
  pendingMessage: string | null,
  status: WalletActionState | null
): ProductLinkFeedback | null {
  if (isPending) {
    return {
      kind: "pending",
      message: pendingMessage ?? "Updating card product link...",
    };
  }
  if (!status) return null;
  if (status.success) {
    return {
      kind: "success",
      message: status.message ?? "Card product link updated.",
    };
  }
  return { kind: "error", message: status.error };
}
