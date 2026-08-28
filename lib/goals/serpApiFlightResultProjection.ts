import type { SerpApiFlightSelectionResult } from "./serpApiFlightSelection";
import { projectSerpApiFlightSegments } from "./serpApiFlightSegmentProjection";

const MAX_PRICE = 1_000_000;
const MAX_DURATION_MINUTES = 24 * 60 * 7;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRetrievedAt(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 40) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE;
}

function validDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MINUTES;
}

export function projectSerpApiFlightResult(
  raw: unknown,
  retrievedAt: unknown,
): SerpApiFlightSelectionResult | null {
  if (!isPlainObject(raw)) return null;
  const segments = projectSerpApiFlightSegments(raw.flights);
  const normalizedRetrievedAt = normalizeRetrievedAt(retrievedAt);
  if (!segments || !validPrice(raw.price) || !validDuration(raw.total_duration) || !normalizedRetrievedAt) return null;
  return {
    segments,
    roundTripPrice: raw.price,
    durationMinutes: raw.total_duration,
    retrievedAt: normalizedRetrievedAt,
  };
}
