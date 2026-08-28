import type { SerpApiFlightSelectionResult } from "./serpApiFlightSelection";
import { projectSerpApiFlightResult } from "./serpApiFlightResultProjection";

const MAX_TOKEN_LENGTH = 160;

export interface SerpApiFlightProjectedBatch {
  readonly candidates: readonly SerpApiFlightSelectionResult[];
}

const departureTokens = new WeakMap<object, readonly string[]>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDepartureToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TOKEN_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function providerResults(response: unknown): Record<string, unknown>[] {
  if (!isPlainObject(response)) return [];
  const best = Array.isArray(response.best_flights) ? response.best_flights : [];
  const other = Array.isArray(response.other_flights) ? response.other_flights : [];
  return [...best, ...other].filter(isPlainObject);
}

function project(
  response: unknown,
  retrievedAt: unknown,
  requireToken: boolean,
): SerpApiFlightProjectedBatch | null {
  const candidates: SerpApiFlightSelectionResult[] = [];
  const tokens: string[] = [];
  for (const raw of providerResults(response)) {
    const candidate = projectSerpApiFlightResult(raw, retrievedAt);
    if (!candidate || (requireToken && !validDepartureToken(raw.departure_token))) continue;
    candidates.push(candidate);
    if (requireToken) tokens.push(raw.departure_token as string);
  }
  if (candidates.length === 0) return null;
  const frozenCandidates = Object.freeze(candidates);
  const batch = Object.freeze({ candidates: frozenCandidates });
  if (requireToken) departureTokens.set(batch, Object.freeze(tokens));
  return batch;
}

export function projectSerpApiFlightInitialBatch(
  response: unknown,
  retrievedAt: unknown,
): SerpApiFlightProjectedBatch | null {
  return project(response, retrievedAt, true);
}

export function projectSerpApiFlightReturnBatch(
  response: unknown,
  retrievedAt: unknown,
): SerpApiFlightProjectedBatch | null {
  return project(response, retrievedAt, false);
}

export function getSerpApiFlightDepartureToken(
  batch: SerpApiFlightProjectedBatch,
  candidateIndex: number,
): string | null {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0) return null;
  const tokens = departureTokens.get(batch);
  return tokens && candidateIndex < tokens.length ? tokens[candidateIndex] : null;
}
