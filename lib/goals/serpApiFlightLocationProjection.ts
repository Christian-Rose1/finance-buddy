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

export type FlightLocationFailureReason =
  | "ambiguous_matches"
  | "empty_suggestions"
  | "no_matching_city"
  | "matching_city_rejected";

export interface FlightLocationDiagnostic {
  readonly reason?: FlightLocationFailureReason;
  // Only proves that the inspected suggestion set was truncated, not that
  // a usable candidate was omitted or the outcome would have differed.
  readonly suggestionLimit?: "suggestions_truncated";
}

export type SerpApiFlightLocationProjection = { readonly diagnostic?: FlightLocationDiagnostic } & (
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
    });

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

export function normalizeSerpApiFlightLocationInput(value: unknown): string | null {
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

/**
 * Second-tier match for qualified saved locations (e.g. "Denver, CO" against
 * the provider's canonical "Denver, Colorado"). The suggestion must carry the
 * same primary name and a qualifier compatible with the saved qualifier by
 * prefix in either direction, with at least two characters on the shorter
 * side. A suggestion without a qualifier can never confirm a qualified saved
 * location, and a saved location without a qualifier never reaches this tier
 * (the exact primary-name rule already covers it). This tier only widens the
 * candidate set: multiple lenient matches still return `ambiguous` and are
 * never selected among.
 */
function matchesSavedLocationLenient(name: string, savedLocation: string): boolean {
  const savedCommaIndex = savedLocation.indexOf(",");
  if (savedCommaIndex === -1) return false;
  const nameCommaIndex = name.indexOf(",");
  if (nameCommaIndex === -1) return false;
  if (
    normalizedMatchText(savedLocation.slice(0, savedCommaIndex)) !==
    normalizedMatchText(name.slice(0, nameCommaIndex))
  ) {
    return false;
  }
  const savedQualifier = normalizedMatchText(savedLocation.slice(savedCommaIndex + 1));
  const nameQualifier = normalizedMatchText(name.slice(nameCommaIndex + 1));
  if (savedQualifier.length < 2 || nameQualifier.length < 2) return false;
  return nameQualifier.startsWith(savedQualifier) || savedQualifier.startsWith(nameQualifier);
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
  nameMatches: (name: string, savedLocation: string) => boolean = matchesSavedLocation,
): SerpApiFlightLocationCandidate | null {
  if (!isPlainObject(value) || value.type !== "city") return null;

  const name = normalizeSerpApiFlightLocationInput(value.name);
  if (!name || !nameMatches(name, savedLocation)) return null;
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
  const name = normalizeSerpApiFlightLocationInput(value.name);
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
  diagnostic?: FlightLocationDiagnostic,
): SerpApiFlightLocationProjection {
  return Object.freeze({ status, selected: null, candidates: EMPTY_CANDIDATES, ...(diagnostic ? { diagnostic: Object.freeze(diagnostic) } : {}) });
}

/**
 * Resolves an explicit saved IATA code without provider data. Otherwise it
 * projects exact-name city matches and resolves only a unique candidate;
 * when nothing matches exactly, a lenient second tier accepts the same
 * primary name with a prefix-compatible qualifier (e.g. "Denver, CO" →
 * "Denver, Colorado"), and a lone structurally-valid city suggestion is the
 * provider's authoritative interpretation of the saved string. Lenient
 * matching and single-suggestion resolution only ever avoid a false
 * no-match: multiple candidates still fail closed without selecting.
 */
export function projectSerpApiFlightLocation(
  savedLocation: unknown,
  rawResponse?: unknown,
): SerpApiFlightLocationProjection {
  const location = normalizeSerpApiFlightLocationInput(savedLocation);
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

  const exactCandidates: SerpApiFlightLocationCandidate[] = [];
  const lenientCandidates: SerpApiFlightLocationCandidate[] = [];
  const seenExact = new Set<string>();
  const seenLenient = new Set<string>();
  const boundedSuggestions = rawResponse.suggestions.slice(0, MAX_SUGGESTIONS);
  const suggestionLimit = rawResponse.suggestions.length > MAX_SUGGESTIONS
    ? "suggestions_truncated" as const : undefined;
  let exactMatchRejected = false;
  let lenientMatchRejected = false;
  let structurallyValidCount = 0;
  let validCityCount = 0;
  let singleValidCity: unknown = null;
  for (const rawSuggestion of boundedSuggestions) {
    if (isStructurallyValidSuggestion(rawSuggestion)) {
      structurallyValidCount += 1;
      if (isPlainObject(rawSuggestion) && rawSuggestion.type === "city") {
        validCityCount += 1;
        singleValidCity = rawSuggestion;
      }
    }
    const exactCandidate = projectCitySuggestion(rawSuggestion, location);
    if (exactCandidate) {
      if (!seenExact.has(exactCandidate.locationId)) {
        seenExact.add(exactCandidate.locationId);
        exactCandidates.push(freezeCandidate(exactCandidate));
      }
      continue;
    }
    if (isPlainObject(rawSuggestion) && rawSuggestion.type === "city") {
      const name = normalizeSerpApiFlightLocationInput(rawSuggestion.name);
      if (name && matchesSavedLocation(name, location)) {
        exactMatchRejected = true;
        continue;
      }
    }
    // Exact matches always take precedence: the lenient qualifier tier is
    // consulted only when no exact candidate exists and no exact match was
    // rejected as malformed, so a malformed exact match keeps its own
    // diagnostic instead of being masked by a lenient resolve.
    const lenientCandidate = projectCitySuggestion(rawSuggestion, location, matchesSavedLocationLenient);
    if (lenientCandidate) {
      if (!seenLenient.has(lenientCandidate.locationId)) {
        seenLenient.add(lenientCandidate.locationId);
        lenientCandidates.push(freezeCandidate(lenientCandidate));
      }
      continue;
    }
    if (isPlainObject(rawSuggestion) && rawSuggestion.type === "city") {
      const name = normalizeSerpApiFlightLocationInput(rawSuggestion.name);
      if (name && matchesSavedLocationLenient(name, location)) lenientMatchRejected = true;
    }
  }
  const useLenient = exactCandidates.length === 0 && !exactMatchRejected;
  const candidates = useLenient ? lenientCandidates : exactCandidates;
  const matchingCityRejected = exactMatchRejected || (useLenient && lenientMatchRejected);
  Object.freeze(candidates);

  if (candidates.length === 0) {
    if (boundedSuggestions.length > 0 && structurallyValidCount === 0) {
      return emptyProjection("malformed_response", Object.freeze({
        ...(matchingCityRejected ? { reason: "matching_city_rejected" as const } : {}),
        ...(suggestionLimit ? { suggestionLimit } : {}),
      }));
    }
    // Provider-authoritative single-city resolution: when no name tier
    // matched but the provider's own disambiguation returned exactly one
    // usable city suggestion, that suggestion IS the interpretation of the
    // saved string (e.g. "Raleigh, NC" → "Raleigh, North Carolina"). This is
    // how the provider resolves free-text for its own autocomplete; nothing
    // is invented. Multiple candidates and malformed exact matches still
    // fail closed below.
    if (!exactMatchRejected && validCityCount === 1 && singleValidCity) {
      const selected = projectCitySuggestion(singleValidCity, location, () => true);
      if (selected) {
        const frozenSelected = freezeCandidate(selected);
        return Object.freeze({
          status: "resolved",
          selected: frozenSelected,
          candidates: Object.freeze([frozenSelected]),
          ...(suggestionLimit ? { diagnostic: Object.freeze({ suggestionLimit }) } : {}),
        });
      }
    }
    return emptyProjection("unresolved", Object.freeze({
      reason: boundedSuggestions.length === 0 ? "empty_suggestions"
        : matchingCityRejected ? "matching_city_rejected" : "no_matching_city",
      ...(suggestionLimit ? { suggestionLimit } : {}),
    }));
  }
  if (candidates.length > 1) {
    return Object.freeze({ status: "ambiguous", selected: null, candidates, diagnostic: Object.freeze({ reason: "ambiguous_matches" as const, ...(suggestionLimit ? { suggestionLimit } : {}) }) });
  }
  return Object.freeze({ status: "resolved", selected: candidates[0], candidates, ...(suggestionLimit ? { diagnostic: Object.freeze({ suggestionLimit }) } : {}) });
}
