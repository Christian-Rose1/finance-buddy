/**
 * SerpApi Flight HTTP Client v1 (composition only).
 *
 * Exactly two Google Flights requests (outbound then return), no retry,
 * fallback, pagination, booking, or logging. Uses injected fetch and clock
 * for testability.
 *
 * Trust rules:
 * - Party-total price is preserved unchanged (adults=2 → $1,736 stays $1,736).
 * - Never multiply by traveler count. Never create per-traveler value.
 * - API key, departure/booking tokens, raw response, request URL, search ID,
 *   headers, and provider metadata never appear in returned objects.
 * - Fixed safe error categories only.
 */

import {
  isValidSerpApiFlightSelectionRequest,
  serpApiTravelClassForCabin,
  selectSerpApiFlightOutbound,
  selectSerpApiFlightRoundTrip,
} from "./serpApiFlightSelection";
import {
  projectSerpApiFlightInitialBatchOutcome,
  projectSerpApiFlightReturnBatchOutcome,
  getSerpApiFlightDepartureToken,
} from "./serpApiFlightBatchProjection";
import {
  normalizeSerpApiFlightPartyTotal,
  type NormalizedSerpApiFlightObservation,
} from "./serpApiFlightNormalizer";
import type { SerpApiFlightSearchLocation } from "./serpApiFlightSearchLocation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SerpApiFlightRequest {
  origin: SerpApiFlightSearchLocation | string;
  destination: SerpApiFlightSearchLocation | string;
  outboundDate: string;
  returnDate: string;
  travelers: number;
  cabin: string;
  currency: string;
}

export type SerpApiFlightClientErrorCategory =
  | "invalid_request"
  | "provider_not_configured"
  | "http_failure"
  | "malformed_initial_response"
  | "no_eligible_outbound"
  | "malformed_return_response"
  | "no_compatible_return"
  | "normalization_failed";

export interface SerpApiFlightClientResult {
  observation: NormalizedSerpApiFlightObservation | null;
  error: SerpApiFlightClientErrorCategory | null;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
type ClockFn = () => Date;
interface EffectiveSerpApiFlightRequest {
  origin: SerpApiFlightSearchLocation;
  destination: SerpApiFlightSearchLocation;
  outboundDate: string;
  returnDate: string;
  travelers: number;
  cabin: string;
  currency: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const AIRPORT_ID = /^[A-Z]{3}$/;
const LOCATION_ID = /^\/[mg]\/[A-Za-z0-9_-]{1,100}$/;
const MAX_AIRPORTS = 12;

function isValidSearchLocation(value: unknown): value is SerpApiFlightSearchLocation {
  if (!isPlainObject(value)) return false;
  const searchId = value.searchId;
  const kind = value.kind;
  const airports = value.acceptableAirportIds;
  if (
    typeof searchId !== "string" ||
    (kind !== "airport" && kind !== "city") ||
    !Array.isArray(airports) ||
    airports.length === 0 ||
    airports.length > MAX_AIRPORTS ||
    !airports.every((airportId) => typeof airportId === "string" && AIRPORT_ID.test(airportId)) ||
    new Set(airports).size !== airports.length
  ) return false;
  if (kind === "airport") return AIRPORT_ID.test(searchId) && airports.length === 1 && airports[0] === searchId;
  return LOCATION_ID.test(searchId);
}

function effectiveLocation(value: unknown): SerpApiFlightSearchLocation | null {
  if (typeof value === "string") {
    if (!AIRPORT_ID.test(value)) return null;
    return Object.freeze({
      searchId: value,
      kind: "airport" as const,
      acceptableAirportIds: Object.freeze([value]),
    });
  }
  if (!isValidSearchLocation(value)) return null;
  return Object.freeze({
    searchId: value.searchId,
    kind: value.kind,
    acceptableAirportIds: Object.freeze([...value.acceptableAirportIds]),
  });
}

function normalizeRequest(value: unknown): EffectiveSerpApiFlightRequest | null {
  if (!isPlainObject(value)) return null;
  const origin = effectiveLocation(value.origin);
  const destination = effectiveLocation(value.destination);
  if (!origin || !destination) return null;
  const request: EffectiveSerpApiFlightRequest = {
    origin,
    destination,
    outboundDate: value.outboundDate as string,
    returnDate: value.returnDate as string,
    travelers: value.travelers as number,
    cabin: value.cabin as string,
    currency: value.currency as string,
  };
  if (!validLocations(request)) return null;
  return isValidSerpApiFlightSelectionRequest({
    origin: request.origin.searchId,
    destination: request.destination.searchId,
    originAirportIds: request.origin.acceptableAirportIds,
    destinationAirportIds: request.destination.acceptableAirportIds,
    outboundDate: request.outboundDate,
    returnDate: request.returnDate,
    travelers: request.travelers,
    cabin: request.cabin,
    currency: request.currency,
  }) ? request : null;
}

function validLocations(
  request: EffectiveSerpApiFlightRequest,
): boolean {
  if (!isValidSearchLocation(request.origin) || !isValidSearchLocation(request.destination)) return false;
  return request.origin.searchId !== request.destination.searchId &&
    !request.origin.acceptableAirportIds.some((airportId) =>
      request.destination.acceptableAirportIds.includes(airportId),
    );
}

function buildRequestParams(
  req: EffectiveSerpApiFlightRequest,
  apiKey: string,
  departureToken?: string | null,
): Record<string, string> {
  const params: Record<string, string> = {
    engine: "google_flights",
    type: "1",
    departure_id: req.origin.searchId,
    arrival_id: req.destination.searchId,
    outbound_date: req.outboundDate,
    return_date: req.returnDate,
    adults: String(req.travelers),
    currency: req.currency,
    travel_class: serpApiTravelClassForCabin(req.cabin)!,
    gl: "us",
    hl: "en",
    deep_search: "true",
    api_key: apiKey,
  };
  if (departureToken) {
    params.departure_token = departureToken;
  }
  return params;
}

function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function jsonSafe(response: Response): Promise<unknown> {
  return response.json();
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function buildSerpApiFlightClient(apiKey: string, fetchFn?: FetchFn, clockFn?: ClockFn) {
  const fetch = fetchFn ?? globalThis.fetch.bind(globalThis);
  const clock = clockFn ?? (() => new Date());

  async function fetchFlight(
    input: unknown,
  ): Promise<SerpApiFlightClientResult> {
    // 1. Validate runtime request
    let request: EffectiveSerpApiFlightRequest | null;
    try {
      request = normalizeRequest(input);
    } catch {
      return { observation: null, error: "invalid_request" };
    }
    if (!request) {
      return { observation: null, error: "invalid_request" };
    }

    // 2. Validate API key
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return { observation: null, error: "provider_not_configured" };
    }

    // 3. Map cabin through shared function
    const travelClass = serpApiTravelClassForCabin(request.cabin);
    if (!travelClass) {
      return { observation: null, error: "invalid_request" };
    }

    // 4. Make initial Google Flights request
    const initialParams = buildRequestParams(request, apiKey);
    const initialQueryString = buildQueryString(initialParams);
    const initialUrl = `https://serpapi.com/search?${initialQueryString}`;

    let initialResponse: Response;
    try {
      initialResponse = await fetch(initialUrl, { method: "GET" });
    } catch {
      return { observation: null, error: "http_failure" };
    }

    if (!initialResponse.ok) {
      return { observation: null, error: "http_failure" };
    }

    // 5. Capture injected server clock immediately after response
    const initialReceivedAt = clock();

    // 6. Decode JSON safely
    let initialBody: unknown;
    try {
      initialBody = await jsonSafe(initialResponse);
    } catch {
      return { observation: null, error: "malformed_initial_response" };
    }

    // 7. Project initial outcome
    const initialOutcome = projectSerpApiFlightInitialBatchOutcome(
      initialBody,
      initialReceivedAt.toISOString(),
    );

    // 8. Map projection outcomes
    if (initialOutcome.status === "malformed_response") {
      return { observation: null, error: "malformed_initial_response" };
    }
    if (initialOutcome.status === "no_eligible_outbound") {
      return { observation: null, error: "no_eligible_outbound" };
    }

    // 9. Select outbound
    const selectorRequest = {
      origin: request.origin.searchId,
      destination: request.destination.searchId,
      originAirportIds: request.origin.acceptableAirportIds,
      destinationAirportIds: request.destination.acceptableAirportIds,
      outboundDate: request.outboundDate,
      returnDate: request.returnDate,
      travelers: request.travelers,
      cabin: request.cabin,
      currency: request.currency,
    };
    const outboundSelection = selectSerpApiFlightOutbound(initialOutcome.batch.candidates, selectorRequest);
    if (!outboundSelection) {
      return { observation: null, error: "no_eligible_outbound" };
    }

    // 10. Retrieve private departure token using selector's exact sourceIndex
    const departureToken = getSerpApiFlightDepartureToken(
      initialOutcome.batch,
      outboundSelection.sourceIndex,
    );

    // 11. Make token-bound return request
    const returnParams = buildRequestParams(request, apiKey, departureToken);
    const returnQueryString = buildQueryString(returnParams);
    const returnUrl = `https://serpapi.com/search?${returnQueryString}`;

    let returnResponse: Response;
    try {
      returnResponse = await fetch(returnUrl, { method: "GET" });
    } catch {
      return { observation: null, error: "http_failure" };
    }

    if (!returnResponse.ok) {
      return { observation: null, error: "http_failure" };
    }

    // 12. Capture second injected server receipt time
    const returnReceivedAt = clock();

    // 13. Decode JSON safely
    let returnBody: unknown;
    try {
      returnBody = await jsonSafe(returnResponse);
    } catch {
      return { observation: null, error: "malformed_return_response" };
    }

    // 14. Project return outcome
    const returnOutcome = projectSerpApiFlightReturnBatchOutcome(
      returnBody,
      returnReceivedAt.toISOString(),
    );

    // 15. Map projection outcomes
    if (returnOutcome.status === "malformed_response") {
      return { observation: null, error: "malformed_return_response" };
    }
    if (returnOutcome.status === "no_return_options") {
      return { observation: null, error: "no_compatible_return" };
    }

    // 16. Select completed round trip
    const roundTripSelection = selectSerpApiFlightRoundTrip({
      outboundResults: initialOutcome.batch.candidates,
      request: selectorRequest,
      returnOptionsForSelectedOutbound: returnOutcome.batch.candidates,
    });

    if (!roundTripSelection) {
      return { observation: null, error: "no_compatible_return" };
    }

    // 17. Pass exact selector output to normalizer
    const observation = normalizeSerpApiFlightPartyTotal(roundTripSelection);

    if (!observation) {
      return { observation: null, error: "normalization_failed" };
    }

    // 18. Return safe observation only
    return { observation, error: null };
  }

  return { fetchFlight };
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

export function createSerpApiFlightClient(fetchFn?: FetchFn, clockFn?: ClockFn) {
  const apiKey = process.env.SERPAPI_API_KEY ?? "";
  return buildSerpApiFlightClient(apiKey, fetchFn, clockFn);
}
