/**
 * Safe server-held contract for an already resolved flight search location.
 * This does not prove live availability or that a flight endpoint accepts a
 * city identifier.
 */

import { normalizeSerpApiFlightLocationInput } from "./serpApiFlightLocationProjection";

export interface SerpApiFlightSearchLocation {
  readonly searchId: string;
  readonly kind: "airport" | "city";
  readonly acceptableAirportIds: readonly string[];
}

const AIRPORT_ID = /^[A-Z]{3}$/;
const LOCATION_ID = /^\/[mg]\/[A-Za-z0-9_-]{1,100}$/;

type ValidatedCandidate = {
  readonly locationId: string;
  readonly kind: "airport" | "city";
  readonly name: string;
  readonly airportIds: readonly string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCandidate(value: unknown): ValidatedCandidate | null {
  if (!isPlainObject(value)) return null;

  const locationId = value.locationId;
  const kind = value.kind;
  const name = normalizeSerpApiFlightLocationInput(value.name);
  const airportIds = value.airportIds;
  if (
    typeof locationId !== "string" ||
    (kind !== "airport" && kind !== "city") ||
    name === null ||
    !Array.isArray(airportIds) ||
    airportIds.length === 0 ||
    !airportIds.every(
      (airportId) => typeof airportId === "string" && AIRPORT_ID.test(airportId),
    )
  ) {
    return null;
  }

  if (
    (kind === "airport" && !AIRPORT_ID.test(locationId)) ||
    (kind === "city" && !LOCATION_ID.test(locationId))
  ) {
    return null;
  }

  return { locationId, kind, name, airportIds };
}

function sameCandidate(left: ValidatedCandidate, right: ValidatedCandidate): boolean {
  return (
    left.locationId === right.locationId &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.airportIds.length === right.airportIds.length &&
    left.airportIds.every((airportId, index) => airportId === right.airportIds[index])
  );
}

function dedupeAirportIds(airportIds: readonly string[]): string[] {
  return [...new Set(airportIds)];
}

/** Builds a minimal immutable contract from a resolved location projection. */
export function buildSerpApiFlightSearchLocation(
  projection: unknown,
): SerpApiFlightSearchLocation | null {
  if (!isPlainObject(projection) || projection.status !== "resolved") return null;
  if (!isPlainObject(projection.selected) || !Array.isArray(projection.candidates)) return null;
  if (projection.candidates.length !== 1) return null;

  const selected = validateCandidate(projection.selected);
  const candidate = validateCandidate(projection.candidates[0]);
  if (!selected || !candidate || !sameCandidate(selected, candidate)) return null;

  if (selected.kind === "airport") {
    if (
      selected.airportIds.length !== 1 ||
      selected.airportIds[0] !== selected.locationId
    ) {
      return null;
    }
    const acceptableAirportIds = Object.freeze([selected.locationId]);
    return Object.freeze({
      searchId: selected.locationId,
      kind: selected.kind,
      acceptableAirportIds,
    });
  }

  const acceptableAirportIds = dedupeAirportIds(selected.airportIds);
  if (acceptableAirportIds.length === 0) return null;
  return Object.freeze({
    searchId: selected.locationId,
    kind: selected.kind,
    acceptableAirportIds: Object.freeze(acceptableAirportIds),
  });
}
