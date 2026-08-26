import { createHmac, timingSafeEqual } from "node:crypto";
import type { ImportDraftKind, ImportDraftStatus } from "./types";

export interface ImportDraftSignatureInput {
  version: 1;
  draftId: string;
  userId: string;
  kind: ImportDraftKind;
  status: ImportDraftStatus;
  expiresAt: string;
  payload: string;
  persistencePayload?: string;
  claimToken?: string | null;
  claimExpiresAt?: string | null;
}

function getSigningSecret(): Buffer {
  const secret = process.env.IMPORT_DRAFT_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Import draft signing is not configured.");
  }
  return Buffer.from(secret, "utf8");
}

function encodeField(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function signingPayload(input: ImportDraftSignatureInput): Buffer {
  return Buffer.concat([
    encodeField("finance-buddy/import-draft"),
    encodeField(String(input.version)),
    encodeField(input.draftId),
    encodeField(input.userId),
    encodeField(input.kind),
    encodeField(input.status),
    encodeField(input.expiresAt),
    encodeField(input.payload),
    encodeField(input.persistencePayload ?? ""),
    encodeField(input.claimToken ?? ""),
    encodeField(input.claimExpiresAt ?? ""),
  ]);
}

export function signImportDraft(input: ImportDraftSignatureInput): string {
  return createHmac("sha256", getSigningSecret())
    .update(signingPayload(input))
    .digest("hex");
}

export function verifyImportDraftSignature(
  input: ImportDraftSignatureInput,
  signature: string
): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;

  const expected = Buffer.from(signImportDraft(input), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
