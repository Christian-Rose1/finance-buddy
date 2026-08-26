import { createServerClient } from "@/lib/supabase-server";
import { createHash } from "node:crypto";
import type {
  Purchase,
  PurchaseEvidence,
  PurchaseItem,
} from "@/lib/purchases/types";
import type { PurchaseFieldProvenance } from "@/lib/purchases/provenance";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Purchase persistence repository.
 *
 * Persists a canonical Purchase atomically via the `public.persist_purchase`
 * database RPC. The RPC inserts the parent `purchases` row plus all
 * `purchase_items` and `purchase_evidence` rows inside a single Postgres
 * transaction, so the write is atomic.
 *
 * After the RPC succeeds, the persisted Purchase is rehydrated by reading the
 * child `purchase_items` and `purchase_evidence` rows back and mapping them
 * into the existing Purchase TypeScript shape. These reads are for
 * rehydration only — they are not part of the atomic write.
 *
 * ## Ownership
 *
 * `user_id` is ALWAYS taken from the explicit `userId` argument. A `user_id`
 * value on the Purchase object is never trusted. The RPC enforces that
 * `p_user_id` equals `auth.uid()`, and the rehydration reads use the same
 * authenticated Supabase client, so RLS restricts them to the caller's rows.
 */

/** Maps a PurchaseItem (camelCase) to the RPC item payload (snake_case). */
function toItemPayload(item: PurchaseItem) {
  return {
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total: item.total,
    discount: item.discount,
    category: item.category,
    confidence: item.confidence,
  };
}

/** Maps a PurchaseEvidence (camelCase) to the RPC evidence payload (snake_case). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Converts a deterministic local evidence key into a stable UUID primary key. */
export function stableEvidenceUuid(value: string): string {
  if (UUID_PATTERN.test(value)) return value.toLowerCase();
  const hex = createHash("sha1")
    .update(`finance-buddy:evidence:${value}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = (parseInt(hex[16], 16) & 0x3 | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex
    .slice(12, 16)
    .join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function toEvidencePayload(evidence: PurchaseEvidence) {
  return {
    id: stableEvidenceUuid(evidence.id),
    type: evidence.type,
    source_id: evidence.sourceId,
    source_name: evidence.sourceName,
    confidence: evidence.confidence,
    verified: evidence.verified,
    metadata: evidence.metadata,
  };
}

function sourceKeyForPurchase(purchase: Purchase): string | null {
  return (
    purchase.evidence.find(
      (evidence) =>
        evidence.type === purchase.source && evidence.sourceId !== null
    )?.sourceId ?? null
  );
}

export function toPurchasePersistenceEnvelope(purchase: Purchase) {
  const evidenceIds = new Map(
    purchase.evidence.map((evidence) => [evidence.id, stableEvidenceUuid(evidence.id)])
  );
  const provenance = Object.fromEntries(
    Object.entries(purchase.provenance ?? {}).map(([field, value]) => [field, {
      ...value,
      evidenceIds: value.evidenceIds.map((id) => evidenceIds.get(id) ?? stableEvidenceUuid(id)),
    }])
  );
  return {
    purchase: {
      merchant: purchase.merchant,
      date: purchase.date,
      amount: purchase.amount,
      currency: purchase.currency,
      category: purchase.category,
      source: purchase.source,
      source_confidence: purchase.sourceConfidence,
      source_key: sourceKeyForPurchase(purchase),
      card_id: purchase.cardId,
      discount: purchase.discount,
      tax: purchase.tax,
      tip: purchase.tip,
      fees: purchase.fees,
      provenance,
      metadata: purchase.metadata,
    },
    items: purchase.items.map(toItemPayload),
    evidence: purchase.evidence.map(toEvidencePayload),
  };
}

/** Maps a purchase_items row (snake_case) to a PurchaseItem (camelCase). */
function toItem(row: Record<string, unknown>): PurchaseItem {
  return {
    name: (row.name as string | null) ?? null,
    quantity: (row.quantity as number | null) ?? null,
    unitPrice: (row.unit_price as number | null) ?? null,
    total: (row.total as number | null) ?? null,
    discount: (row.discount as number | null) ?? null,
    category: (row.category as string | null) ?? null,
    confidence: row.confidence as number,
  };
}

/** Maps a purchase_evidence row (snake_case) to a PurchaseEvidence (camelCase). */
function toEvidence(row: Record<string, unknown>): PurchaseEvidence {
  return {
    id: row.id as string,
    type: row.type as PurchaseEvidence["type"],
    sourceId: (row.source_id as string | null) ?? null,
    sourceName: (row.source_name as string | null) ?? null,
    confidence: row.confidence as number,
    verified: row.verified as boolean,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Converts the `purchases` row returned by the RPC into the parent fields of
 * the existing Purchase TypeScript shape. Items and evidence are filled in
 * separately during rehydration.
 */
function toPurchaseParent(row: Record<string, unknown>): Purchase {
  return {
    id: row.id as string,
    merchant: (row.merchant as string | null) ?? null,
    date: (row.date as string | null) ?? null,
    amount: (row.amount as number | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    source: row.source as Purchase["source"],
    sourceConfidence: row.source_confidence as number,
    cardId: (row.card_id as string | null) ?? null,
    items: [],
    discount: (row.discount as number | null) ?? null,
    tax: (row.tax as number | null) ?? null,
    tip: (row.tip as number | null) ?? null,
    fees: (row.fees as number | null) ?? null,
    evidence: [],
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    provenance: (row.provenance as Record<string, PurchaseFieldProvenance>) ?? {},
  };
}

/** Replace deterministic pre-persistence evidence IDs with database IDs. */
function rebindProvenance(
  purchase: Purchase,
  evidence: PurchaseEvidence[]
): void {
  const ids = new Map<string, string>();
  for (const item of evidence) {
    if (item.sourceId) ids.set(`evidence-${item.sourceId}`, item.id);
  }
  if (!purchase.provenance) return;
  for (const provenance of Object.values(purchase.provenance)) {
    provenance.evidenceIds = provenance.evidenceIds.map((id) => ids.get(id) ?? id);
  }
}

/**
 * Loads a single Purchase belonging to an authenticated user by its id.
 * Rehydrates the normalized child items and evidence rows.
 *
 * RLS is the security boundary: the query filters by both `id` and
 * `user_id`, so a missing Purchase or one owned by another user returns
 * `null`. No service-role credentials are used.
 *
 * @param purchaseId The Purchase id to load.
 * @param userId     The authenticated user id. This is the ONLY source of
 *                   truth for ownership.
 * @returns The Purchase in the canonical TypeScript shape, or `null` if it
 *          does not exist or does not belong to the user.
 * @throws If the database read fails. Errors are surfaced without exposing
 *         secrets or database internals.
 */
export async function getPurchaseForUser(
  purchaseId: string,
  userId: string
): Promise<Purchase | null> {
  const supabase = await createServerClient();

  const { data: purchaseRow, error: purchaseError } = await supabase
    .from("purchases")
    .select("*")
    .eq("id", purchaseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (purchaseError) {
    throw new Error("Failed to load purchase.");
  }

  if (!purchaseRow) {
    return null;
  }

  const purchase = toPurchaseParent(purchaseRow as Record<string, unknown>);

  const [itemsResult, evidenceResult] = await Promise.all([
    supabase.from("purchase_items").select("*").eq("purchase_id", purchase.id),
    supabase
      .from("purchase_evidence")
      .select("*")
      .eq("purchase_id", purchase.id),
  ]);

  if (itemsResult.error) {
    throw new Error("Failed to load purchase items.");
  }
  if (evidenceResult.error) {
    throw new Error("Failed to load purchase evidence.");
  }

  purchase.items = (itemsResult.data ?? []).map((row) =>
    toItem(row as Record<string, unknown>)
  );
  purchase.evidence = (evidenceResult.data ?? []).map((row) =>
    toEvidence(row as Record<string, unknown>)
  );
  rebindProvenance(purchase, purchase.evidence);

  return purchase;
}

/**
 * Loads all Purchases belonging to an authenticated user, newest-first by
 * purchase date. Each Purchase is rehydrated with its normalized child items
 * and evidence rows.
 *
 * RLS is the security boundary: the query filters by `user_id`, and the
 * authenticated cookie-aware server client can only see rows the current
 * session owns. No service-role credentials are used.
 *
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership; it is passed explicitly so callers remain
 *               aware of the user boundary.
 * @returns Array of Purchases in the canonical TypeScript shape. Statement
 *          Purchases legitimately have `items: []`.
 * @throws If the database read fails. Errors are surfaced without exposing
 *         secrets or database internals.
 */
export async function getPurchasesForUser(userId: string): Promise<Purchase[]> {
  const supabase = await createServerClient();

  const { data: purchaseRows, error: purchaseError } = await supabase
    .from("purchases")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false });

  if (purchaseError) {
    throw new Error("Failed to load purchases.");
  }

  if (!purchaseRows || purchaseRows.length === 0) {
    return [];
  }

  const purchases = purchaseRows.map((row) =>
    toPurchaseParent(row as Record<string, unknown>)
  );

  await hydratePurchasesChildren(supabase, purchases);

  return purchases;
}

/**
 * Persists a Purchase and its items/evidence atomically via the
 * `public.persist_purchase` RPC, then rehydrates the persisted Purchase by
 * reading back its child rows.
 *
 * @param purchase The canonical Purchase to persist.
 * @param userId   The authenticated user id. This is the ONLY source of
 *                 truth for `user_id`; any user_id on `purchase` is ignored.
 * @returns The persisted Purchase in the existing TypeScript shape, including
 *          the complete `items[]` and `evidence[]` arrays.
 * @throws If the RPC or rehydration fails. Errors are surfaced without
 *         exposing secrets or database internals.
 */
export async function persistPurchase(
  purchase: Purchase,
  userId: string,
  client?: SupabaseClient
): Promise<Purchase> {
  const supabase = client ?? (await createServerClient());
  const envelope = toPurchasePersistenceEnvelope(purchase);

  // --- Atomic write via the RPC ------------------------------------------
  const { data, error } = await supabase.rpc("persist_purchase", {
    p_user_id: userId,
    p_purchase: envelope.purchase,
    p_items: envelope.items,
    p_evidence: envelope.evidence,
  });

  if (error) {
    // Surface a clear, safe error. Do not leak the raw DB error, secrets, or
    // internal details to the caller.
    throw new Error("Failed to persist purchase.");
  }

  if (!data) {
    throw new Error("Failed to persist purchase: no purchase returned.");
  }

  const persisted = toPurchaseParent(data as Record<string, unknown>);

  // --- Rehydrate child rows (reads only, not part of the atomic write) ----
  const [itemsResult, evidenceResult] = await Promise.all([
    supabase
      .from("purchase_items")
      .select("*")
      .eq("purchase_id", persisted.id),
    supabase
      .from("purchase_evidence")
      .select("*")
      .eq("purchase_id", persisted.id),
  ]);

  if (itemsResult.error) {
    throw new Error("Failed to load persisted purchase items.");
  }
  if (evidenceResult.error) {
    throw new Error("Failed to load persisted purchase evidence.");
  }

  persisted.items = (itemsResult.data ?? []).map((row) =>
    toItem(row as Record<string, unknown>)
  );
  persisted.evidence = (evidenceResult.data ?? []).map((row) =>
    toEvidence(row as Record<string, unknown>)
  );
  rebindProvenance(persisted, persisted.evidence);

  return persisted;
}

/**
 * Persist a collection of Purchases in one database transaction.
 *
 * The database function validates ownership once and calls the idempotent
 * single-purchase writer for each entry. A failure rolls back the entire batch,
 * so statement imports cannot leave a partially persisted result.
 */
export async function persistPurchases(
  purchases: Purchase[],
  userId: string,
  client?: SupabaseClient
): Promise<Purchase[]> {
  if (purchases.length === 0) {
    return [];
  }

  const supabase = client ?? (await createServerClient());
  const { data, error } = await supabase.rpc("persist_purchases", {
    p_user_id: userId,
    p_purchases: purchases.map(toPurchasePersistenceEnvelope),
  });

  if (error || !Array.isArray(data) || data.length !== purchases.length) {
    throw new Error("Failed to persist purchases.");
  }

  const persisted = data.map((row) =>
    toPurchaseParent(row as Record<string, unknown>)
  );
  await hydratePurchasesChildren(supabase, persisted);
  return persisted;
}

/**
 * Loads and attaches child items and evidence to a collection of Purchases.
 * Performs one batched query per child table, scoped to the relevant
 * `purchase_id`s, then maps each row back onto its parent Purchase using the
 * existing `toItem`/`toEvidence` helpers.
 */
async function hydratePurchasesChildren(
  supabase: SupabaseClient,
  purchases: Purchase[]
): Promise<void> {
  const purchaseIds = purchases.map((p) => p.id);

  const [itemsResult, evidenceResult] = await Promise.all([
    supabase.from("purchase_items").select("*").in("purchase_id", purchaseIds),
    supabase.from("purchase_evidence").select("*").in("purchase_id", purchaseIds),
  ]);

  if (itemsResult.error) {
    throw new Error("Failed to load purchase items.");
  }
  if (evidenceResult.error) {
    throw new Error("Failed to load purchase evidence.");
  }

  const itemsByPurchase = groupBy(
    (itemsResult.data ?? []) as Record<string, unknown>[],
    (row) => row.purchase_id as string
  );
  const evidenceByPurchase = groupBy(
    (evidenceResult.data ?? []) as Record<string, unknown>[],
    (row) => row.purchase_id as string
  );

  for (const purchase of purchases) {
    purchase.items = (itemsByPurchase.get(purchase.id) ?? []).map((row) =>
      toItem(row)
    );
    purchase.evidence = (evidenceByPurchase.get(purchase.id) ?? []).map((row) =>
      toEvidence(row)
    );
    rebindProvenance(purchase, purchase.evidence);
  }
}

/** Groups an array of objects by a string key extracted from each element. */
function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
