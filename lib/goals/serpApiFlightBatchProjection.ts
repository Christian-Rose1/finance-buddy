import type { SerpApiFlightSelectionResult } from "./serpApiFlightSelection";
import { projectSerpApiFlightResult } from "./serpApiFlightResultProjection";

// SerpApi departure tokens are opaque runtime values. The 1024-character cap
// is finite and comfortably covers the observed 276–356-character tokens
// while still bounding memory and request construction.
const MAX_TOKEN_LENGTH = 1024;

export interface SerpApiFlightProjectedBatch {
  readonly candidates: readonly SerpApiFlightSelectionResult[];
}

export type SerpApiFlightInitialBatchOutcome =
  | { readonly status: "ok"; readonly batch: SerpApiFlightProjectedBatch }
  | { readonly status: "malformed_response" }
  | { readonly status: "no_eligible_outbound" };

export type SerpApiFlightReturnBatchOutcome =
  | { readonly status: "ok"; readonly batch: SerpApiFlightProjectedBatch }
  | { readonly status: "malformed_response" }
  | { readonly status: "no_return_options" };

const departureTokens = new WeakMap<object, readonly string[]>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDepartureToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TOKEN_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function resultArrays(response: unknown): { best: unknown[]; other: unknown[] } | null {
  if (!isPlainObject(response)) return null;
  const hasBest = Object.prototype.hasOwnProperty.call(response, "best_flights");
  const hasOther = Object.prototype.hasOwnProperty.call(response, "other_flights");
  if (!hasBest && !hasOther) return null;
  if (hasBest && !Array.isArray(response.best_flights)) return null;
  if (hasOther && !Array.isArray(response.other_flights)) return null;
  return {
    best: hasBest ? response.best_flights as unknown[] : [],
    other: hasOther ? response.other_flights as unknown[] : [],
  };
}

function projectOutcome(
  response: unknown,
  retrievedAt: unknown,
  requireToken: boolean,
): { batch: SerpApiFlightProjectedBatch | null; structurallyValid: number; eligible: number; malformedEnvelope: boolean; emptyArrays: boolean } {
  const arrays = resultArrays(response);
  if (!arrays) return { batch: null, structurallyValid: 0, eligible: 0, malformedEnvelope: true, emptyArrays: false };
  const candidates: SerpApiFlightSelectionResult[] = [];
  const tokens: string[] = [];
  let structurallyValid = 0;
  for (const raw of [...arrays.best, ...arrays.other]) {
    if (!isPlainObject(raw)) continue;
    const candidate = projectSerpApiFlightResult(raw, retrievedAt);
    if (!candidate) continue;
    structurallyValid += 1;
    if (requireToken && !validDepartureToken(raw.departure_token)) continue;
    candidates.push(candidate);
    if (requireToken) tokens.push(raw.departure_token as string);
  }
  if (candidates.length === 0) return { batch: null, structurallyValid, eligible: 0, malformedEnvelope: false, emptyArrays: arrays.best.length === 0 && arrays.other.length === 0 };
  const frozenCandidates = Object.freeze(candidates);
  const batch = Object.freeze({ candidates: frozenCandidates });
  if (requireToken) departureTokens.set(batch, Object.freeze(tokens));
  return { batch, structurallyValid, eligible: candidates.length, malformedEnvelope: false, emptyArrays: false };
}

export function projectSerpApiFlightInitialBatchOutcome(response: unknown, retrievedAt: unknown): SerpApiFlightInitialBatchOutcome {
  const outcome = projectOutcome(response, retrievedAt, true);
  if (outcome.malformedEnvelope) return { status: "malformed_response" };
  if (outcome.batch) return { status: "ok", batch: outcome.batch };
  if (outcome.emptyArrays || outcome.structurallyValid > 0) return { status: "no_eligible_outbound" };
  return { status: "malformed_response" };
}

export function projectSerpApiFlightReturnBatchOutcome(response: unknown, retrievedAt: unknown): SerpApiFlightReturnBatchOutcome {
  const outcome = projectOutcome(response, retrievedAt, false);
  if (outcome.malformedEnvelope) return { status: "malformed_response" };
  if (outcome.batch) return { status: "ok", batch: outcome.batch };
  if (outcome.emptyArrays || outcome.structurallyValid > 0) return { status: "no_return_options" };
  return { status: "malformed_response" };
}

export function projectSerpApiFlightInitialBatch(response: unknown, retrievedAt: unknown): SerpApiFlightProjectedBatch | null {
  const outcome = projectSerpApiFlightInitialBatchOutcome(response, retrievedAt);
  return outcome.status === "ok" ? outcome.batch : null;
}

export function projectSerpApiFlightReturnBatch(response: unknown, retrievedAt: unknown): SerpApiFlightProjectedBatch | null {
  const outcome = projectSerpApiFlightReturnBatchOutcome(response, retrievedAt);
  return outcome.status === "ok" ? outcome.batch : null;
}

export function getSerpApiFlightDepartureToken(batch: SerpApiFlightProjectedBatch, candidateIndex: number): string | null {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0) return null;
  const tokens = departureTokens.get(batch);
  return tokens && candidateIndex < tokens.length ? tokens[candidateIndex] : null;
}
