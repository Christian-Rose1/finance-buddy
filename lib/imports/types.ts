import type { ReceiptExtraction } from "@/lib/receipts/types";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";

export const IMPORT_DRAFT_SIGNATURE_VERSION = 1 as const;

export type ImportDraftKind = "receipt" | "statement";
export type ImportDraftStatus =
  | "pending"
  | "confirming"
  | "failed"
  | "confirmed"
  | "discarded";

interface ImportDraftPayloadBase {
  version: typeof IMPORT_DRAFT_SIGNATURE_VERSION;
  kind: ImportDraftKind;
  storagePath: string | null;
}

export interface ReceiptImportDraftPayload extends ImportDraftPayloadBase {
  kind: "receipt";
  receipt: ReceiptExtraction;
  sourceId: string;
}

export interface StatementImportDraftPayload extends ImportDraftPayloadBase {
  kind: "statement";
  transactions: StatementTransaction[];
  statementDigest: string;
}

export type ImportDraftPayload =
  | ReceiptImportDraftPayload
  | StatementImportDraftPayload;

export interface SavedImportDraft {
  id: string;
  userId: string;
  signatureVersion: typeof IMPORT_DRAFT_SIGNATURE_VERSION;
  kind: ImportDraftKind;
  status: ImportDraftStatus;
  payload: ImportDraftPayload;
  serializedPayload: string;
  /** Present on drafts created after the database-confirmation migration. */
  serializedPersistencePayload?: string;
  payloadSignature: string;
  claimToken?: string | null;
  claimExpiresAt?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
