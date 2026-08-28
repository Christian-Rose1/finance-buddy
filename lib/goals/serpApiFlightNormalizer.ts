/**
 * Flight Party-Total Normalizer v1 (server-only, pure).
 *
 * Reconstructs one explicit SerpApi flight observation from already-selected
 * outbound and return segments plus the provider's returned round-trip price.
 * The output is rebuilt field-by-field through an allowlist, so extra URLs,
 * tokens, search IDs, provider metadata, and hostile nested values in the
 * input cannot survive into the observation.
 *
 * Critical price rule (authoritative 2026-08-28 correction): the returned
 * price is the total for the searched party. It is preserved unchanged —
 * an `adults=2` result of $1,736 remains $1,736 — never multiplied by the
 * traveler count, and no per-traveler value is created or inferred. A
 * per-traveler figure may exist only when the provider itself supplies an
 * explicit per-traveler field, which this input contract never carries.
 *
 * Rejection is total: any invalid route or date match, traveler count,
 * non-finite or negative price, malformed currency, or missing/malformed
 * flight segment yields `null`. Nothing partial is emitted.
 */

export type SerpApiFlightObservationUnknown =
  | "offer_expiry"
  | "tax_inclusion"
  | "operating_carrier";

export interface NormalizedSerpApiFlightSegment {
  /** 1-based position within its own leg. */
  sequence: number;
  departureAirport: string;
  /** Provider timestamp, strictly "YYYY-MM-DD HH:MM". Timezone is not inferred. */
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
  marketingCarrier: string | null;
  marketingFlightNumber: string | null;
  cabin: string | null;
  /** Present only when the provider explicitly supplies it. */
  operatingCarrier: string | null;
}

export interface NormalizedSerpApiFlightObservation {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  travelers: number;
  cabin: string;
  currency: string;
  outboundSegments: NormalizedSerpApiFlightSegment[];
  returnSegments: NormalizedSerpApiFlightSegment[];
  /** The provider-returned round-trip price, unchanged. Party total. */
  price: { amount: number; currency: string };
  priceCoverage: "searched_party_total";
  evidenceLevel: "web_observed_not_live";
  verificationRequired: true;
  /** ISO instant of server-side retrieval. Provenance only, never freshness. */
  retrievedAt: string;
  unknowns: SerpApiFlightObservationUnknown[];
}

/**
 * Every field is `unknown` on purpose: the normalizer reads only what it
 * validates, so hostile or unexpected shapes are stripped or rejected rather
 * than propagated.
 */
export interface SerpApiFlightNormalizerInput {
  origin: unknown;
  destination: unknown;
  outboundDate: unknown;
  returnDate: unknown;
  travelers: unknown;
  cabin: unknown;
  currency: unknown;
  outboundSegments: unknown;
  returnSegments: unknown;
  roundTripPrice: unknown;
  retrievedAt: unknown;
}

const MAX_SEGMENTS_PER_LEG = 8;
const MAX_TEXT_LENGTH = 80;
const MAX_TRAVELERS = 9;
const MAX_PRICE = 1_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactAirportCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const utc = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(utc)) return false;
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function exactDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return value;
}

function exactProviderTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return null;
  if (!isValidCalendarDate(year, month, day)) return null;
  return value;
}

/**
 * Bounded, plain text only. URLs and token-like opaque strings are treated as
 * hostile and stripped to `null` instead of propagated.
 */
function sanitizeBoundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed || collapsed.length > maxLength) return null;
  if (/https?:\/\/|www\.|data:/i.test(collapsed)) return null;
  if (/^[A-Za-z0-9+/=_-]{40,}$/.test(collapsed.replace(/\s/g, ""))) return null;
  return collapsed;
}

function exactIsoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function exactTravelerCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_TRAVELERS) return null;
  return value;
}

function exactPartyPrice(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_PRICE) return null;
  return value;
}

function exactCurrency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

interface RawSegmentFields {
  departureAirport: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
  marketingCarrier: string | null;
  marketingFlightNumber: string | null;
  cabin: string | null;
  operatingCarrier: string | null;
}

function extractSegmentFields(raw: unknown): RawSegmentFields | null {
  if (!isPlainObject(raw)) return null;
  const departure = isPlainObject(raw.departure_airport) ? raw.departure_airport : null;
  const arrival = isPlainObject(raw.arrival_airport) ? raw.arrival_airport : null;
  const departureAirport = exactAirportCode(departure?.id);
  const arrivalAirport = exactAirportCode(arrival?.id);
  const departureTime = exactProviderTimestamp(departure?.time);
  const arrivalTime = exactProviderTimestamp(arrival?.time);
  if (!departureAirport || !arrivalAirport || !departureTime || !arrivalTime) {
    return null;
  }
  return {
    departureAirport,
    departureTime,
    arrivalAirport,
    arrivalTime,
    marketingCarrier: sanitizeBoundedText(raw.airline, MAX_TEXT_LENGTH),
    marketingFlightNumber: sanitizeBoundedText(raw.flight_number, 16),
    cabin: sanitizeBoundedText(raw.travel_class, 40),
    operatingCarrier: sanitizeBoundedText(raw.operating_carrier, MAX_TEXT_LENGTH),
  };
}

function normalizeLeg(
  rawSegments: unknown,
): NormalizedSerpApiFlightSegment[] | null {
  if (!Array.isArray(rawSegments)) return null;
  if (rawSegments.length < 1 || rawSegments.length > MAX_SEGMENTS_PER_LEG) {
    return null;
  }
  const segments: NormalizedSerpApiFlightSegment[] = [];
  for (const raw of rawSegments) {
    const fields = extractSegmentFields(raw);
    if (!fields) return null;
    segments.push({ sequence: segments.length + 1, ...fields });
  }
  return segments;
}

function cabinMatchesRequested(
  segments: NormalizedSerpApiFlightSegment[],
  requestedCabin: string,
): boolean {
  const expected = requestedCabin.toLowerCase();
  return segments.every(
    (segment) =>
      segment.cabin === null || segment.cabin.toLowerCase() === expected,
  );
}

/**
 * Returns exactly one reconstructed observation, or `null` when any
 * contract rule fails. The function never throws and never performs I/O.
 */
export function normalizeSerpApiFlightPartyTotal(
  input: SerpApiFlightNormalizerInput,
): NormalizedSerpApiFlightObservation | null {
  const origin = exactAirportCode(input.origin);
  const destination = exactAirportCode(input.destination);
  if (!origin || !destination || origin === destination) return null;

  const outboundDate = exactDateOnly(input.outboundDate);
  const returnDate = exactDateOnly(input.returnDate);
  if (!outboundDate || !returnDate) return null;
  if (returnDate < outboundDate) return null;

  const travelers = exactTravelerCount(input.travelers);
  if (travelers === null) return null;

  const cabin = sanitizeBoundedText(input.cabin, 40);
  if (!cabin) return null;

  const currency = exactCurrency(input.currency);
  if (!currency) return null;

  const priceAmount = exactPartyPrice(input.roundTripPrice);
  if (priceAmount === null) return null;

  const retrievedAt = exactIsoInstant(input.retrievedAt);
  if (!retrievedAt) return null;

  const outboundSegments = normalizeLeg(input.outboundSegments);
  const returnSegments = normalizeLeg(input.returnSegments);
  if (!outboundSegments || !returnSegments) return null;

  if (!cabinMatchesRequested(outboundSegments, cabin)) return null;
  if (!cabinMatchesRequested(returnSegments, cabin)) return null;

  const outboundFirst = outboundSegments[0];
  const outboundLast = outboundSegments[outboundSegments.length - 1];
  const returnFirst = returnSegments[0];
  const returnLast = returnSegments[returnSegments.length - 1];

  if (outboundFirst.departureAirport !== origin) return null;
  if (outboundLast.arrivalAirport !== destination) return null;
  if (!outboundFirst.departureTime.startsWith(`${outboundDate} `)) return null;

  if (returnFirst.departureAirport !== destination) return null;
  if (returnLast.arrivalAirport !== origin) return null;
  if (!returnFirst.departureTime.startsWith(`${returnDate} `)) return null;

  const allSegments = [...outboundSegments, ...returnSegments];
  const unknowns: SerpApiFlightObservationUnknown[] = [
    "offer_expiry",
    "tax_inclusion",
  ];
  if (allSegments.some((segment) => segment.operatingCarrier === null)) {
    unknowns.push("operating_carrier");
  }

  return {
    origin,
    destination,
    outboundDate,
    returnDate,
    travelers,
    cabin,
    currency,
    outboundSegments,
    returnSegments,
    price: { amount: priceAmount, currency },
    priceCoverage: "searched_party_total",
    evidenceLevel: "web_observed_not_live",
    verificationRequired: true,
    retrievedAt,
    unknowns,
  };
}
