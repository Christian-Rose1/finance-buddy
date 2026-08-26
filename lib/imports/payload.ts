import { normalizeOwnedStoragePath } from "@/lib/uploads/policy";
import { validateReceiptExtraction } from "@/lib/receipts/schema";
import { purchaseFromReceipt } from "@/lib/purchases/fromReceipt";
import { purchaseFromStatement } from "@/lib/purchases/fromStatement";
import { toPurchasePersistenceEnvelope } from "@/lib/purchases/repository";
import type { Purchase } from "@/lib/purchases/types";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";
import type {
  ImportDraftKind,
  ImportDraftPayload,
  ReceiptImportDraftPayload,
  StatementImportDraftPayload,
} from "./types";

export const MAX_IMPORT_DRAFT_PAYLOAD_BYTES = 1_000_000;

const SHA256_SOURCE_ID = /^sha256:[0-9a-f]{64}$/;
const SHA256_DIGEST = /^[0-9a-f]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validStoragePath(value: unknown, userId: string): value is string | null {
  if (value !== null && typeof value !== "string") {
    return false;
  }
  return normalizeOwnedStoragePath(value, userId).valid;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    year >= 1 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateStatementTransaction(
  value: unknown
): value is StatementTransaction {
  if (!isObject(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "id",
      "date",
      "merchant",
      "amount",
      "currency",
      "cardId",
      "category",
      "confidence",
    ])
  ) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    /^stx-[0-9a-f]+$/.test(value.id) &&
    isCalendarDate(value.date) &&
    typeof value.merchant === "string" &&
    value.merchant.trim().length > 0 &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    (value.currency === null ||
      (typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency))) &&
    value.cardId === null &&
    (value.category === null || typeof value.category === "string") &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1
  );
}

export function createReceiptImportDraftPayload(input: {
  receipt: ReceiptImportDraftPayload["receipt"];
  sourceId: string;
  storagePath: string | null;
}): ReceiptImportDraftPayload {
  return {
    version: 1,
    kind: "receipt",
    receipt: input.receipt,
    sourceId: input.sourceId,
    storagePath: input.storagePath,
  };
}

export function createStatementImportDraftPayload(input: {
  transactions: StatementTransaction[];
  statementDigest: string;
  storagePath: string | null;
}): StatementImportDraftPayload {
  return {
    version: 1,
    kind: "statement",
    transactions: input.transactions,
    statementDigest: input.statementDigest,
    storagePath: input.storagePath,
  };
}

export function validateImportDraftPayload(
  kind: ImportDraftKind,
  value: unknown,
  userId: string
): ImportDraftPayload {
  if (!isObject(value) || value.version !== 1 || value.kind !== kind) {
    throw new Error("Import draft payload is invalid.");
  }

  if (kind === "receipt") {
    if (
      !hasOnlyKeys(value, [
        "version",
        "kind",
        "receipt",
        "sourceId",
        "storagePath",
      ]) ||
      typeof value.sourceId !== "string" ||
      !SHA256_SOURCE_ID.test(value.sourceId) ||
      !validStoragePath(value.storagePath, userId)
    ) {
      throw new Error("Import draft payload is invalid.");
    }

    const receipt = validateReceiptExtraction(value.receipt);
    if (!receipt.success) {
      throw new Error("Import draft payload is invalid.");
    }

    return {
      version: 1,
      kind: "receipt",
      receipt: receipt.data,
      sourceId: value.sourceId,
      storagePath: value.storagePath,
    };
  }

  if (
    !hasOnlyKeys(value, [
      "version",
      "kind",
      "transactions",
      "statementDigest",
      "storagePath",
    ]) ||
    typeof value.statementDigest !== "string" ||
    !SHA256_DIGEST.test(value.statementDigest) ||
    !validStoragePath(value.storagePath, userId) ||
    !Array.isArray(value.transactions) ||
    value.transactions.length > 500 ||
    !value.transactions.every(validateStatementTransaction)
  ) {
    throw new Error("Import draft payload is invalid.");
  }

  const transactionIds = value.transactions.map((transaction) => transaction.id);
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new Error("Import draft payload is invalid.");
  }

  return {
    version: 1,
    kind: "statement",
    transactions: value.transactions,
    statementDigest: value.statementDigest,
    storagePath: value.storagePath,
  };
}

export function serializeImportDraftPayload(payload: ImportDraftPayload): string {
  const serialized = JSON.stringify(payload);
  if (
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    Buffer.byteLength(serialized, "utf8") > MAX_IMPORT_DRAFT_PAYLOAD_BYTES
  ) {
    throw new Error("Import draft payload is invalid.");
  }
  return serialized;
}

export function serializeImportPersistencePayload(
  payload: ImportDraftPayload
): string {
  const serialized = JSON.stringify(
    purchasesFromImportDraft(payload).map(toPurchasePersistenceEnvelope)
  );
  if (
    serialized.length === 0 ||
    Buffer.byteLength(serialized, "utf8") > MAX_IMPORT_DRAFT_PAYLOAD_BYTES
  ) {
    throw new Error("Import draft persistence payload is invalid.");
  }
  return serialized;
}

export function parseImportDraftPayload(
  kind: ImportDraftKind,
  serialized: string,
  userId: string
): ImportDraftPayload {
  if (Buffer.byteLength(serialized, "utf8") > MAX_IMPORT_DRAFT_PAYLOAD_BYTES) {
    throw new Error("Import draft payload is invalid.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Import draft payload is invalid.");
  }
  return validateImportDraftPayload(kind, parsed, userId);
}

export function purchasesFromImportDraft(payload: ImportDraftPayload): Purchase[] {
  const storage = payload.storagePath
    ? {
        bucket: payload.kind === "receipt" ? "receipts" : "statements",
        path: payload.storagePath,
      }
    : undefined;

  if (payload.kind === "receipt") {
    return [
      purchaseFromReceipt(payload.receipt, undefined, {
        sourceId: payload.sourceId,
        storage,
      }),
    ];
  }

  return payload.transactions.map((transaction) =>
    purchaseFromStatement(transaction, undefined, {
      sourceId: `sha256:${payload.statementDigest}:${transaction.id}`,
      storage,
    })
  );
}
