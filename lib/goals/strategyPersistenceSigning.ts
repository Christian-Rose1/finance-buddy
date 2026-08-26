import { createHmac, timingSafeEqual } from "node:crypto";

export const SAVED_STRATEGY_SIGNATURE_VERSION = 1 as const;

export interface SavedStrategySignatureInput {
  version: typeof SAVED_STRATEGY_SIGNATURE_VERSION;
  goalId: string;
  userId: string;
  generatedAt: string;
  strategy: unknown;
}

function getSigningSecret(): Buffer {
  const secret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Strategy signing is not configured.");
  }
  return Buffer.from(secret, "utf-8");
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Saved strategy contains a non-finite number.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonicalize(item)
    );
  }

  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        normalized[key] = canonicalize(item);
      }
    }
    return normalized;
  }

  throw new Error("Saved strategy contains a non-JSON value.");
}

export function serializeSavedStrategy(strategy: unknown): string {
  return JSON.stringify(canonicalize(strategy));
}

function encodeField(value: string): Buffer {
  const bytes = Buffer.from(value, "utf-8");
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([lengthPrefix, bytes]);
}

function signingPayload(input: SavedStrategySignatureInput): Buffer {
  return Buffer.concat([
    encodeField(String(input.version)),
    encodeField(input.goalId),
    encodeField(input.userId),
    encodeField(input.generatedAt),
    encodeField(serializeSavedStrategy(input.strategy)),
  ]);
}

export function signSavedStrategy(input: SavedStrategySignatureInput): string {
  return createHmac("sha256", getSigningSecret())
    .update(signingPayload(input))
    .digest("hex");
}

export function verifySavedStrategy(
  input: SavedStrategySignatureInput,
  signature: string
): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  const expected = Buffer.from(signSavedStrategy(input), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
