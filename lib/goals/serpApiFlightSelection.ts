import {
  normalizeSerpApiFlightPartyTotal,
  type NormalizedSerpApiFlightSegment,
  type SerpApiFlightNormalizerInput,
} from "./serpApiFlightNormalizer";

export interface SerpApiFlightSelectionRequest {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  travelers: number;
  cabin: string;
  currency: string;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAirportCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function isValidRequest(request: SerpApiFlightSelectionRequest): boolean {
  return (
    isAirportCode(request.origin) &&
    isAirportCode(request.destination) &&
    request.origin !== request.destination &&
    isDate(request.outboundDate) &&
    isDate(request.returnDate) &&
    request.returnDate >= request.outboundDate &&
    Number.isInteger(request.travelers) &&
    request.travelers >= 1 &&
    request.travelers <= MAX_TRAVELERS &&
    typeof request.cabin === "string" &&
    request.cabin.trim().length > 0 &&
    isCurrency(request.currency)
  );
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
): NormalizedSerpApiFlightSegment[] | null {
  if (!validPrice(result.roundTripPrice) || !validDuration(result.durationMinutes)) return null;
  const segments = normalizeSegments(result.segments);
  if (!segments) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const expectedStart = outbound ? request.origin : request.destination;
  const expectedEnd = outbound ? request.destination : request.origin;
  const expectedDate = outbound ? request.outboundDate : request.returnDate;
  if (first.departureAirport !== expectedStart || last.arrivalAirport !== expectedEnd) return null;
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
): SelectedFlightCandidate | null {
  let selected: SelectedFlightCandidate | null = null;
  results.forEach((result, sourceIndex) => {
    const segments = compatible(result, request, outbound);
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
  if (!isValidRequest(request)) return null;
  const selected = choose(outboundResults, request, true);
  if (!selected) return null;
  return { outboundSegments: selected.segments, sourceIndex: selected.sourceIndex };
}

/**
 * Selects one complete round trip from independently shaped phase results
 * without exposing provider identity or opaque selection values. Returns the
 * exact input contract of the approved party-total normalizer, or null when no
 * safe complete trip exists.
 */
export function selectSerpApiFlightRoundTrip(
  input: SerpApiFlightSelectionInput,
): SerpApiFlightNormalizerInput | null {
  if (!isValidRequest(input.request)) return null;
  const outbound = choose(input.outboundResults, input.request, true);
  const selectedReturn = choose(input.returnOptionsForSelectedOutbound, input.request, false);
  if (!outbound || !selectedReturn) return null;

  return {
    origin: input.request.origin,
    destination: input.request.destination,
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
