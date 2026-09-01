import {
  normalizeSerpApiFlightPartyTotal,
  type NormalizedSerpApiFlightSegment,
  type SerpApiFlightNormalizerInput,
} from "./serpApiFlightNormalizer";

export interface SerpApiFlightSelectionRequest {
  readonly origin: string;
  readonly destination: string;
  readonly outboundDate: string;
  readonly returnDate: string;
  readonly travelers: number;
  readonly cabin: string;
  readonly currency: string;
  readonly originAirportIds?: readonly string[];
  readonly destinationAirportIds?: readonly string[];
}

export interface SerpApiFlightSelectionResult {
  segments: unknown;
  roundTripPrice: unknown;
  retrievedAt: unknown;
  durationMinutes: unknown;
  sourceLabel?: unknown;
}

export interface SerpApiFlightSelectionInput {
  outboundResults: readonly SerpApiFlightSelectionResult[];
  request: SerpApiFlightSelectionRequest;
  /** Return options already obtained for the selected outbound by a future server HTTP client. */
  returnOptionsForSelectedOutbound: readonly SerpApiFlightSelectionResult[];
}

const MAX_TRAVELERS = 9;
const MAX_PRICE = 1_000_000;
const MAX_SEGMENTS_PER_LEG = 8;
const MAX_AIRPORTS = 12;
const AIRPORT_ID = /^[A-Z]{3}$/;
const LOCATION_ID = /^\/[mg]\/[A-Za-z0-9_-]{1,100}$/;

type AirportScope = readonly string[];

interface FlightSelectionScopeInput {
  readonly origin?: unknown;
  readonly destination?: unknown;
  readonly originAirportIds?: unknown;
  readonly destinationAirportIds?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAirportCode(value: unknown): value is string {
  return typeof value === "string" && AIRPORT_ID.test(value);
}

function isSearchIdentifier(value: unknown): value is string {
  return isAirportCode(value) || (typeof value === "string" && LOCATION_ID.test(value));
}

function validAirportScope(value: unknown): value is AirportScope {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_AIRPORTS &&
    value.every((airportId) => isAirportCode(airportId)) &&
    new Set(value).size === value.length
  );
}

function scopeFor(
  identifier: string,
  scope: unknown,
): AirportScope | null {
  if (isAirportCode(identifier)) {
    if (scope === undefined) return [identifier];
    return Array.isArray(scope) &&
      scope.length === 1 &&
      scope[0] === identifier
      ? [identifier]
      : null;
  }
  if (!validAirportScope(scope)) return null;
  return [...scope];
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function serpApiTravelClassForCabin(cabin: unknown): string | null {
  if (typeof cabin !== "string") return null;
  switch (cabin) {
    case "economy": return "1";
    case "premium_economy": return "2";
    case "business": return "3";
    case "first": return "4";
    default: return null;
  }
}

function validatedScopes(request: FlightSelectionScopeInput): {
  origin: AirportScope;
  destination: AirportScope;
} | null {
  if (!isSearchIdentifier(request.origin) || !isSearchIdentifier(request.destination)) return null;
  if (request.origin === request.destination) return null;

  const origin = scopeFor(request.origin, request.originAirportIds);
  const destination = scopeFor(request.destination, request.destinationAirportIds);
  if (!origin || !destination || origin.some((airportId) => destination.includes(airportId))) return null;
  return { origin, destination };
}

export function isValidSerpApiFlightSelectionRequest(request: unknown): request is SerpApiFlightSelectionRequest {
  if (!isPlainObject(request)) return false;
  if (
    !isCalendarDate(request.outboundDate) ||
    !isCalendarDate(request.returnDate) ||
    request.returnDate < request.outboundDate ||
    typeof request.travelers !== "number" ||
    !Number.isInteger(request.travelers) ||
    request.travelers < 1 ||
    request.travelers > MAX_TRAVELERS ||
    !isCurrency(request.currency) ||
    serpApiTravelClassForCabin(request.cabin) === null
  ) return false;
  return validatedScopes(request) !== null;
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE;
}

function validDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeSegments(value: unknown): NormalizedSerpApiFlightSegment[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SEGMENTS_PER_LEG) return null;
  const segments: NormalizedSerpApiFlightSegment[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) return null;
    const departureAirport = isAirportCode(raw.departureAirport) ? raw.departureAirport : null;
    const arrivalAirport = isAirportCode(raw.arrivalAirport) ? raw.arrivalAirport : null;
    const departureTime = typeof raw.departureTime === "string" ? raw.departureTime : null;
    const arrivalTime = typeof raw.arrivalTime === "string" ? raw.arrivalTime : null;
    if (!departureAirport || !arrivalAirport || !departureTime || !arrivalTime) return null;
    const cabin = raw.cabin === null ? null : typeof raw.cabin === "string" ? raw.cabin : null;
    if (raw.cabin !== null && cabin === null) return null;
    if (segments.length > 0 && segments[segments.length - 1].arrivalAirport !== departureAirport) return null;
    segments.push({
      sequence: segments.length + 1,
      departureAirport,
      departureTime,
      arrivalAirport,
      arrivalTime,
      marketingCarrier: typeof raw.marketingCarrier === "string" ? raw.marketingCarrier : null,
      marketingFlightNumber: typeof raw.marketingFlightNumber === "string" ? raw.marketingFlightNumber : null,
      cabin,
      operatingCarrier: typeof raw.operatingCarrier === "string" ? raw.operatingCarrier : null,
    });
  }
  return segments;
}

function segmentDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2} /.test(value) ? value.slice(0, 10) : null;
}

function explicitCabinConflicts(value: NormalizedSerpApiFlightSegment, requested: string): boolean {
  return value.cabin !== null && value.cabin.toLowerCase() !== requested.toLowerCase();
}

function compatible(
  result: SerpApiFlightSelectionResult,
  request: SerpApiFlightSelectionRequest,
  outbound: boolean,
  scopes: { origin: AirportScope; destination: AirportScope },
): NormalizedSerpApiFlightSegment[] | null {
  if (!validPrice(result.roundTripPrice) || !validDuration(result.durationMinutes)) return null;
  const segments = normalizeSegments(result.segments);
  if (!segments) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const startScope = outbound ? scopes.origin : scopes.destination;
  const endScope = outbound ? scopes.destination : scopes.origin;
  const expectedDate = outbound ? request.outboundDate : request.returnDate;
  if (!startScope.includes(first.departureAirport) || !endScope.includes(last.arrivalAirport)) return null;
  if (segmentDate(first.departureTime) !== expectedDate) return null;
  if (segments.some((segment) => explicitCabinConflicts(segment, request.cabin))) return null;
  return segments;
}

function compareResults(a: SerpApiFlightSelectionResult, b: SerpApiFlightSelectionResult): number {
  const priceDifference = (a.roundTripPrice as number) - (b.roundTripPrice as number);
  if (priceDifference !== 0) return priceDifference;
  return (a.durationMinutes as number) - (b.durationMinutes as number);
}

interface SelectedFlightCandidate {
  result: SerpApiFlightSelectionResult;
  segments: NormalizedSerpApiFlightSegment[];
  sourceIndex: number;
}

function choose(
  results: readonly SerpApiFlightSelectionResult[],
  request: SerpApiFlightSelectionRequest,
  outbound: boolean,
  scopes: { origin: AirportScope; destination: AirportScope },
): SelectedFlightCandidate | null {
  let selected: SelectedFlightCandidate | null = null;
  results.forEach((result, sourceIndex) => {
    const segments = compatible(result, request, outbound, scopes);
    if (!segments) return;
    if (selected === null || compareResults(result, selected.result) < 0) {
      selected = { result, segments, sourceIndex };
    }
  });
  return selected;
}

export interface SelectedOutboundFlight {
  outboundSegments: NormalizedSerpApiFlightSegment[];
  sourceIndex: number;
}

export function selectSerpApiFlightOutbound(
  outboundResults: readonly SerpApiFlightSelectionResult[],
  request: SerpApiFlightSelectionRequest,
): SelectedOutboundFlight | null {
  if (!isValidSerpApiFlightSelectionRequest(request)) return null;
  const scopes = validatedScopes(request)!;
  const selected = choose(outboundResults, request, true, scopes);
  if (!selected) return null;
  return { outboundSegments: selected.segments, sourceIndex: selected.sourceIndex };
}

/** Selects one complete round trip without exposing provider metadata or search identifiers. */
export function selectSerpApiFlightRoundTrip(
  input: SerpApiFlightSelectionInput,
): SerpApiFlightNormalizerInput | null {
  if (!isValidSerpApiFlightSelectionRequest(input.request)) return null;
  const scopes = validatedScopes(input.request)!;
  const outbound = choose(input.outboundResults, input.request, true, scopes);
  const selectedReturn = choose(input.returnOptionsForSelectedOutbound, input.request, false, scopes);
  if (!outbound || !selectedReturn) return null;

  return {
    origin: outbound.segments[0].departureAirport,
    destination: outbound.segments[outbound.segments.length - 1].arrivalAirport,
    outboundDate: input.request.outboundDate,
    returnDate: input.request.returnDate,
    travelers: input.request.travelers,
    cabin: input.request.cabin,
    currency: input.request.currency,
    outboundSegments: outbound.segments,
    returnSegments: selectedReturn.segments,
    roundTripPrice: selectedReturn.result.roundTripPrice,
    retrievedAt: selectedReturn.result.retrievedAt,
  };
}

export { normalizeSerpApiFlightPartyTotal };
