import type { SupabaseClient } from "@supabase/supabase-js";
import { purchasesFromImportDraft } from "./payload";
import {
  claimImportDraft,
  getImportDraft,
  ImportDraftError,
  markImportDraftConfirmed,
  markImportDraftDiscarded,
  markImportDraftFailed,
  persistClaimedImportDraft,
} from "./repository";
import type { ImportDraftKind, SavedImportDraft } from "./types";
import type { Purchase } from "@/lib/purchases/types";

export interface ImportWorkflowDependencies {
  loadDraft: typeof getImportDraft;
  markConfirmed: typeof markImportDraftConfirmed;
  markDiscarded: typeof markImportDraftDiscarded;
  persistReceipt?: (
    purchase: Purchase,
    userId: string,
    client?: SupabaseClient
  ) => Promise<Purchase>;
  persistStatement?: (
    purchases: Purchase[],
    userId: string,
    client?: SupabaseClient
  ) => Promise<Purchase[]>;
  now: () => number;
  claimDraft?: typeof claimImportDraft;
  markFailed?: typeof markImportDraftFailed;
  persistClaimedDraft?: typeof persistClaimedImportDraft;
}

const DEFAULT_DEPENDENCIES: ImportWorkflowDependencies = {
  loadDraft: getImportDraft,
  markConfirmed: markImportDraftConfirmed,
  markDiscarded: markImportDraftDiscarded,
  now: Date.now,
  claimDraft: claimImportDraft,
  markFailed: markImportDraftFailed,
  persistClaimedDraft: persistClaimedImportDraft,
};

interface ActiveConfirmation {
  claimed: boolean;
  cancelInjectedPersistence?: () => void;
}

const activeConfirmations = new Map<string, ActiveConfirmation>();

async function removeDraftStorage(
  draft: SavedImportDraft,
  client: SupabaseClient
): Promise<void> {
  const path = draft.payload.storagePath;
  if (!path) return;

  const bucket = draft.kind === "receipt" ? "receipts" : "statements";
  try {
    await client.storage.from(bucket).remove([path]);
  } catch {
    // Draft cleanup is best effort; the database lifecycle cleanup remains
    // authoritative when Storage is temporarily unavailable.
  }
}

export interface ConfirmImportDraftResult {
  draftId: string;
  purchaseCount: number;
  alreadyConfirmed: boolean;
}

function purchaseCount(draft: SavedImportDraft): number {
  return draft.payload.kind === "receipt" ? 1 : draft.payload.transactions.length;
}

async function requiredDraft(
  draftId: string,
  kind: ImportDraftKind,
  userId: string,
  client: SupabaseClient,
  dependencies: ImportWorkflowDependencies
): Promise<SavedImportDraft> {
  const draft = await dependencies.loadDraft(draftId, userId, kind, client);
  if (!draft) {
    throw new ImportDraftError("not_found", "Import draft was not found.");
  }
  return draft;
}

export async function confirmImportDraft(
  draftId: string,
  kind: ImportDraftKind,
  userId: string,
  client: SupabaseClient,
  dependencyOverrides: Partial<ImportWorkflowDependencies> = {}
): Promise<ConfirmImportDraftResult> {
  const activeKey = `${userId}:${kind}:${draftId}`;
  if (activeConfirmations.has(activeKey)) {
    throw new ImportDraftError(
      "in_progress",
      "Import confirmation is already in progress."
    );
  }
  const active: ActiveConfirmation = { claimed: false };
  activeConfirmations.set(activeKey, active);

  try {
    return await confirmImportDraftClaimed(
      draftId,
      kind,
      userId,
      client,
      dependencyOverrides,
      active
    );
  } finally {
    activeConfirmations.delete(activeKey);
  }
}

async function confirmImportDraftClaimed(
  draftId: string,
  kind: ImportDraftKind,
  userId: string,
  client: SupabaseClient,
  dependencyOverrides: Partial<ImportWorkflowDependencies>,
  active: ActiveConfirmation
): Promise<ConfirmImportDraftResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  let draft = await requiredDraft(
    draftId,
    kind,
    userId,
    client,
    dependencies
  );

  if (draft.status === "confirmed") {
    return {
      draftId,
      purchaseCount: purchaseCount(draft),
      alreadyConfirmed: true,
    };
  }
  if (draft.status === "discarded") {
    throw new ImportDraftError("discarded", "Import draft was discarded.");
  }
  if (new Date(draft.expiresAt).getTime() <= dependencies.now()) {
    await removeDraftStorage(draft, client);
    throw new ImportDraftError("expired", "Import draft expired. Please import again.");
  }

  const purchases = purchasesFromImportDraft(draft.payload);
  const usesInjectedPersistence =
    dependencyOverrides.persistReceipt !== undefined ||
    dependencyOverrides.persistStatement !== undefined;

  if (!usesInjectedPersistence) {
    if (!dependencies.claimDraft) {
      throw new ImportDraftError("save_failed", "Import could not be claimed.");
    }
    draft = await dependencies.claimDraft(draft, client);
    active.claimed = true;
  } else {
    // In-memory adapters use this mutable batch as their transaction input.
    // Clearing it models rollback if discard wins before that adapter commits.
    active.cancelInjectedPersistence = () => {
      purchases.length = 0;
    };
  }

  try {
    if (!usesInjectedPersistence) {
      if (!dependencies.persistClaimedDraft) {
        throw new Error("Database confirmation is unavailable.");
      }
      draft = await dependencies.persistClaimedDraft(draft, client);
    } else if (draft.kind === "receipt") {
      if (!dependencies.persistReceipt) {
        throw new Error("Injected receipt persistence is unavailable.");
      }
      await dependencies.persistReceipt(purchases[0], userId, client);
    } else {
      if (!dependencies.persistStatement) {
        throw new Error("Injected statement persistence is unavailable.");
      }
      await dependencies.persistStatement(purchases, userId, client);
    }
    if (usesInjectedPersistence && purchases.length === 0) {
      throw new ImportDraftError("discarded", "Import draft was discarded.");
    }
  } catch {
    if (!usesInjectedPersistence && dependencies.markFailed) {
      try {
        await dependencies.markFailed(draft, client);
      } catch {
        // A stale claim remains retryable after its short lease expires.
      }
    }
    throw new ImportDraftError(
      "save_failed",
      "Failed to save approved purchases. Please retry."
    );
  }

  if (usesInjectedPersistence) {
    try {
      await dependencies.markConfirmed(draft, client);
    } catch {
      // Purchases use stable source keys, so a retry can safely finish this
      // transition without creating duplicates.
      throw new ImportDraftError(
        "save_failed",
        "Failed to finish the import. Please retry."
      );
    }
  }

  return {
    draftId,
    purchaseCount: purchases.length,
    alreadyConfirmed: false,
  };
}

export async function discardImportDraft(
  draftId: string,
  kind: ImportDraftKind,
  userId: string,
  client: SupabaseClient,
  dependencyOverrides: Partial<ImportWorkflowDependencies> = {}
): Promise<{ draftId: string; alreadyDiscarded: boolean }> {
  const activeKey = `${userId}:${kind}:${draftId}`;
  const active = activeConfirmations.get(activeKey);
  if (active?.claimed) {
    throw new ImportDraftError(
      "in_progress",
      "Import confirmation is already in progress."
    );
  }

  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const draft = await requiredDraft(
    draftId,
    kind,
    userId,
    client,
    dependencies
  );

  if (draft.status === "discarded") {
    return { draftId, alreadyDiscarded: true };
  }
  if (draft.status === "confirmed") {
    throw new ImportDraftError(
      "already_confirmed",
      "Approved purchases have already been saved."
    );
  }
  if (draft.status === "confirming") {
    throw new ImportDraftError(
      "in_progress",
      "Import confirmation is already in progress."
    );
  }

  await dependencies.markDiscarded(draft, client);
  await removeDraftStorage(draft, client);
  active?.cancelInjectedPersistence?.();
  return { draftId, alreadyDiscarded: false };
}
