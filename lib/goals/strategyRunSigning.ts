import { createHmac, timingSafeEqual } from "node:crypto";

export type StrategyRunSignatureStage = "run" | "flight" | "hotel";

export interface StrategyRunSignatureInput {
  version: 1;
  runId: string;
  goalId: string;
  userId: string;
  expiresAt: string;
  stage: StrategyRunSignatureStage;
  payload: string;
}

function getSigningSecret(): Buffer {
  const secret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Strategy-run signing is not configured.");
  }
  return Buffer.from(secret, "utf-8");
}

function encodeField(value: string): Buffer {
  const bytes = Buffer.from(value, "utf-8");
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([lengthPrefix, bytes]);
}

function buildSigningPayload(input: StrategyRunSignatureInput): Buffer {
  const fields: Buffer[] = [
    encodeField(String(input.version)),
    encodeField(input.runId),
    encodeField(input.goalId),
    encodeField(input.userId),
    encodeField(input.expiresAt),
    encodeField(input.stage),
    encodeField(input.payload),
  ];
  return Buffer.concat(fields);
}

export function signStrategyRunPayload(input: StrategyRunSignatureInput): string {
  const secret = getSigningSecret();
  const payload = buildSigningPayload(input);
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return hmac.digest("hex").toLowerCase();
}

export function verifyStrategyRunPayload(
  input: StrategyRunSignatureInput,
  signature: string,
): boolean {
  const secret = getSigningSecret();

  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  const expectedHex = signStrategyRunPayload(input);
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(signature, "hex");

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

export function serializeStrategyRunPayload(value: unknown): string {
  let result: string;
  try {
    result = JSON.stringify(value);
  } catch {
    throw new Error("Strategy-run payload could not be serialized.");
  }

  if (typeof result !== "string" || result.length === 0) {
    throw new Error("Strategy-run payload could not be serialized.");
  }

  return result;
}

export function parseStrategyRunPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("Strategy-run payload could not be parsed.");
  }
}