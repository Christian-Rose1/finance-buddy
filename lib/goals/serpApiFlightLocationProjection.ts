/**
 * Pure server-side projection for SerpApi Google Flights Autocomplete output.
 *
 * This module does not perform HTTP, read configuration, or choose among
 * ambiguous locations. Provider location IDs are retained only because a
 * future server-side flight request needs them; callers must not expose this
 * projection directly to the browser or a model.
 */

export interface SerpApiFlightLocationCandidate {
  readonly locationId: string;
  readonly kind: "airport" | "city";
  readonly name: string;
  readonly airportIds: readonly string[];
}

export type SerpApiFlightLocationProjection =
  | {
      readonly status: "resolved";
      readonly selected: SerpApiFlightLocationCandidate;
      readonly candidates: readonly SerpApiFlightLocationCandidate[];
    }
  | {
      readonly status: "ambiguous";
      readonly selected: null;
      readonly candidates: readonly SerpApiFlightLocationCandidate[];
    }
  | {
      readonly status: "unresolved" | "malformed_response";
      readonly selected: null;
      readonly candidates: readonly [];
    };

const MAX_LOCATION_LENGTH = 100;
const MAX_SUGGESTIONS = 25;
const MAX_AIRPORTS = 12;
const IATA_CODE = /^[A-Z]{3}$/;
const LOCATION_ID = /^\/[mg]\/[A-Za-z0-9_-]{1,100}$/;
const CONTROL_OR_URL = /[\u0000-\u001f\u007f]|https?:\/\//i;
const TOKEN_LIKE = /(?:api[_-]?key|access[_-]?token|departure[_-]?token|booking[_-]?token)/i;
const EMPTY_CANDIDATES: readonly [] = Object.freeze([]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeLocationText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_LOCATION_LENGTH ||
    CONTROL_OR_URL.test(value) ||
    TOKEN_LIKE.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizedMatchText(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function matchesSavedLocation(name: string, savedLocation: string): boolean {
  const expected = normalizedMatchText(savedLocation);
  const fullName = normalizedMatchText(name);
  const primaryName = normalizedMatchText(name.split(",", 1)[0] ?? "");
  return fullName === expected || primaryName === expected;
}

function projectAirportIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const airportIds: string[] = [];
  const seen = new Set<string>();

  for (const rawAirport of value.slice(0, MAX_AIRPORTS)) {
    if (!isPlainObject(rawAirport) || typeof rawAirport.id !== "string") continue;
    const airportId = rawAirport.id.trim().toUpperCase();
    if (!IATA_CODE.test(airportId) || seen.has(airportId)) continue;
    seen.add(airportId);
    airportIds.push(airportId);
  }

  return airportIds;
}

function projectCitySuggestion(
  value: unknown,
  savedLocation: string,
): SerpApiFlightLocationCandidate | null {
  if (!isPlainObject(value) || value.type !== "city") return null;

  const name = safeLocationText(value.name);
  if (!name || !matchesSavedLocation(name, savedLocation)) return null;
  if (typeof value.id !== "string" || !LOCATION_ID.test(value.id)) return null;

  const airportIds = projectAirportIds(value.airports);
  if (airportIds.length === 0) return null;

  return {
    locationId: value.id,
    kind: "city",
    name,
    airportIds,
  };
}

function isStructurallyValidSuggestion(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const name = safeLocationText(value.name);
  if (!name || typeof value.id !== "string" || !LOCATION_ID.test(value.id)) return false;
  if (value.type === "region") return true;
  return value.type === "city" && projectAirportIds(value.airports).length > 0;
}

function freezeCandidate(
  candidate: SerpApiFlightLocationCandidate,
): SerpApiFlightLocationCandidate {
  Object.freeze(candidate.airportIds);
  return Object.freeze(candidate);
}

function emptyProjection(
  status: "unresolved" | "malformed_response",
): SerpApiFlightLocationProjection {
  return Object.freeze({ status, selected: null, candidates: EMPTY_CANDIDATES });
}

/**
 * Resolves an explicit saved IATA code without provider data. Otherwise it
 * projects exact-name city matches and resolves only a unique candidate.
 */
export function projectSerpApiFlightLocation(
  savedLocation: unknown,
  rawResponse?: unknown,
): SerpApiFlightLocationProjection {
  const location = safeLocationText(savedLocation);
  if (!location) {
    return emptyProjection("unresolved");
  }

  const directAirportId = location.toUpperCase();
  if (IATA_CODE.test(directAirportId)) {
    const selected = freezeCandidate({
      locationId: directAirportId,
      kind: "airport",
      name: directAirportId,
      airportIds: [directAirportId],
    });
    return Object.freeze({
      status: "resolved",
      selected,
      candidates: Object.freeze([selected]),
    });
  }

  if (!isPlainObject(rawResponse) || !Array.isArray(rawResponse.suggestions)) {
    return emptyProjection("malformed_response");
  }

  const candidates: SerpApiFlightLocationCandidate[] = [];
  const seen = new Set<string>();
  const boundedSuggestions = rawResponse.suggestions.slice(0, MAX_SUGGESTIONS);
  let structurallyValidCount = 0;
  for (const rawSuggestion of boundedSuggestions) {
    if (isStructurallyValidSuggestion(rawSuggestion)) structurallyValidCount += 1;
    const candidate = projectCitySuggestion(rawSuggestion, location);
    if (!candidate || seen.has(candidate.locationId)) continue;
    seen.add(candidate.locationId);
    candidates.push(freezeCandidate(candidate));
  }
  Object.freeze(candidates);

  if (candidates.length === 0) {
    if (boundedSuggestions.length > 0 && structurallyValidCount === 0) {
      return emptyProjection("malformed_response");
    }
    return emptyProjection("unresolved");
  }
  if (candidates.length > 1) {
    return Object.freeze({ status: "ambiguous", selected: null, candidates });
  }
  return Object.freeze({ status: "resolved", selected: candidates[0], candidates });
}
