/**
 * Seats.aero Partner API cached-search client v1 (server-only).
 *
 * Exactly one GET request per call, no retry, no fallback, no pagination, no
 * live-search, no booking, no logging. Mirrors the established SerpAPI client
 * conventions: injected fetch and clock, fixed safe error categories, and
 * zero provider details in any returned object.
 *
 * API contract (verified against the official OpenAPI spec at
 * developers.seats.aero/reference/cached-search plus field-level reference
 * notes distilled from the official docs):
 * - `GET https://seats.aero/partnerapi/search`
 * - `Partner-Authorization: {key}` header. Pro keys are documented as
 *   non-commercial; production commercial use requires a written agreement
 *   with Seats.aero (tracked as a separate product task, not a code task).
 * - Params: `origin_airport`, `destination_airport` (IATA), `start_date`/
 *   `end_date` (YYYY-MM-DD), `cabins` (plural, comma-delimited:
 *   economy/premium/business/first; the spec forbids combining it with the
 *   legacy singular `cabin`), optional `sources` (program slugs), optional
 *   `take` (10–1000).
 * - Response: `{ data: AvailabilityRow[], count, hasMore, cursor }`. Each row
 *   carries per-cabin fields keyed `Y`/`W`/`J`/`F` (`YAvailable`,
 *   `YMileageCost`, `YRemainingSeats`, `YTotalTaxes`, `YDirect`, ...), a
 *   `TaxesCurrency` field, the program slug in `Source` (mirrored in
 *   `Route.Source`), and `CreatedAt`/`UpdatedAt` freshness timestamps.
 *
 * Quirks handled here (documented provider behavior, not guesses):
 * - `MileageCost` is a numeric STRING ("33000") on search rows and `null`
 *   when a cabin is not offered; `"0"` appears as a sentinel for cabins that
 *   are not available or are hidden by dynamic-price filtering. A `"0"` cost
 *   is never projected as a price.
 * - Taxes are integers in MINOR currency units (18560 = 185.60) with a
 *   `TaxesCurrency` field; some programs report taxes without a currency, so
 *   a currency is optional but a present one must be valid.
 * - `RemainingSeats` of 0 is a crawl artifact meaning "not tracked", not
 *   "zero seats left"; only positive counts are projected.
 *
 * Trust rules:
 * - The request is built only from the strict typed inputs passed by the
 *   caller. No model- or browser-selected parameters exist.
 * - The untrusted provider body is projected exclusively through
 *   `projectSeatsAeroAvailability`; only validated, corridor-matched rows are
 *   returned. A row for a different corridor, a row outside the requested
 *   date window, or a structurally malformed present field rejects the whole
 *   response (fail-closed, matching the established hotel normalizer
 *   precedent). A valid row that simply has no usable price for the
 *   requested cabin is skipped, not rejected.
 * - API key, raw response, request URL, headers, provider metadata, and
 *   provider-hostile values never appear in returned objects.
 * - Fixed safe error categories only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SeatsAeroCabin = "economy" | "premium" | "business" | "first";

export interface SeatsAeroSearchRequest {
  originAirport: string;
  destinationAirport: string;
  cabin: SeatsAeroCabin;
  startDate: string;
  endDate: string;
  sources?: string[];
  take?: number;
}

export type SeatsAeroSearchDirection = "outbound" | "return";

export type SeatsAeroClientErrorCategory =
  | "invalid_request"
  | "provider_not_configured"
  | "http_failure"
  | "malformed_response"
  | "projection_rejected";

export interface SeatsAeroAvailabilityRow {
  /** Observed points price in the program's native points unit. */
  pointsRequired: number;
  /** Program slug reported by the provider, e.g. `united`, `aeroplan`. */
  source: string;
  /** Departure date of the observed award, YYYY-MM-DD. */
  departureDate: string;
  /** True when this row was observed on the return leg of the corridor. */
  isReturn: boolean;
  /** Observed taxes in MINOR currency units, when reported with a currency. */
  taxesMinorUnits: number | null;
  /** ISO 4217-style currency for `taxesMinorUnits`, when reported. */
  taxesCurrency: string | null;
  /** Positive remaining-seat count when the provider reports one; else null. */
  remainingSeats: number | null;
  /** True when the observed itinerary is nonstop in the requested cabin. */
  direct: boolean | null;
  /** ISO instant of the provider's last crawl update (freshness only). */
  updatedAt: string;
}

export interface SeatsAeroClientResult {
  rows: SeatsAeroAvailabilityRow[] | null;
  error: SeatsAeroClientErrorCategory | null;
}

export interface SeatsAeroClient {
  searchAvailability: (
    input: unknown,
    direction: SeatsAeroSearchDirection,
    signal?: AbortSignal,
  ) => Promise<SeatsAeroClientResult>;
}

type FetchFn = (
  url: string,
  init: RequestInit,
) => Response | Promise<Response>;
type ClockFn = () => Date;

// ---------------------------------------------------------------------------
// Request validation (fail-closed)
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const AIRPORT_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_SLUG_PATTERN = /^[a-z0-9_]{1,40}$/;
const MAX_SOURCES = 10;
const MIN_TAKE = 10;
const MAX_TAKE = 1000;

const CABIN_VALUES: readonly SeatsAeroCabin[] = [
  "economy",
  "premium",
  "business",
  "first",
];

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function normalizeSearchRequest(value: unknown): SeatsAeroSearchRequest | null {
  if (!isRecord(value)) return null;
  const origin = value.originAirport;
  if (typeof origin !== "string" || !AIRPORT_PATTERN.test(origin)) return null;

  const destination = value.destinationAirport;
  if (
    typeof destination !== "string" ||
    !AIRPORT_PATTERN.test(destination) ||
    destination === origin
  ) {
    return null;
  }

  const cabin = value.cabin;
  if (
    typeof cabin !== "string" ||
    !CABIN_VALUES.includes(cabin as SeatsAeroCabin)
  ) {
    return null;
  }

  if (
    !calendarDate(value.startDate) ||
    !calendarDate(value.endDate) ||
    (value.endDate as string) < (value.startDate as string)
  ) {
    return null;
  }

  let sources: string[] | undefined;
  if (value.sources !== undefined) {
    if (
      !Array.isArray(value.sources) ||
      value.sources.length < 1 ||
      value.sources.length > MAX_SOURCES ||
      !value.sources.every(
        (slug) => typeof slug === "string" && SOURCE_SLUG_PATTERN.test(slug),
      ) ||
      new Set(value.sources).size !== value.sources.length
    ) {
      return null;
    }
    sources = value.sources as string[];
  }

  let take: number | undefined;
  if (value.take !== undefined) {
    if (
      typeof value.take !== "number" ||
      !Number.isInteger(value.take) ||
      value.take < MIN_TAKE ||
      value.take > MAX_TAKE
    ) {
      return null;
    }
    take = value.take;
  }

  return {
    originAirport: origin,
    destinationAirport: destination,
    cabin: cabin as SeatsAeroCabin,
    startDate: value.startDate,
    endDate: value.endDate,
    sources,
    take,
  };
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

function corridorEndpoints(
  request: SeatsAeroSearchRequest,
  direction: SeatsAeroSearchDirection,
): { origin: string; destination: string } {
  return direction === "outbound"
    ? { origin: request.originAirport, destination: request.destinationAirport }
    : { origin: request.destinationAirport, destination: request.originAirport };
}

function buildRequestParams(
  request: SeatsAeroSearchRequest,
  direction: SeatsAeroSearchDirection,
): Array<[string, string]> {
  const { origin, destination } = corridorEndpoints(request, direction);
  const params: Array<[string, string]> = [
    ["origin_airport", origin],
    ["destination_airport", destination],
    ["start_date", request.startDate],
    ["end_date", request.endDate],
    // The official spec documents `cabins` (plural) as the cabin filter.
    ["cabins", request.cabin],
  ];
  if (request.sources && request.sources.length > 0) {
    params.push(["sources", request.sources.join(",")]);
  }
  if (request.take !== undefined) {
    params.push(["take", String(request.take)]);
  }
  return params;
}

function buildQueryString(params: Array<[string, string]>): string {
  return params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

// ---------------------------------------------------------------------------
// Response projection (untrusted → strict rows)
// ---------------------------------------------------------------------------

const MAX_ROWS = 1000;
const MAX_PROGRAM_SLUG_LENGTH = 40;
const MAX_POINTS = 10_000_000;
const MAX_SEATS = 9;
const MAX_TAXES_MINOR_UNITS = 100_000_000;
const MAX_ID_LENGTH = 128;

function exactIsoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function cabinPrefix(cabin: SeatsAeroCabin): "Y" | "W" | "J" | "F" {
  switch (cabin) {
    case "economy":
      return "Y";
    case "premium":
      return "W";
    case "business":
      return "J";
    case "first":
      return "F";
  }
}

/**
 * Read the requested cabin's fields off a raw row. Returns:
 * - `"unusable"` when the row is valid but carries no price claim for this
 *   cabin (cabin not offered: `Available: false`, `MileageCost: null`, or the
 *   `"0"` not-available sentinel);
 * - `"malformed"` when a present field violates the documented shape;
 * - otherwise the parsed cabin observation.
 */
function readCabinObservation(
  row: Record<string, unknown>,
  prefix: "Y" | "W" | "J" | "F",
): { kind: "unusable" } | { kind: "malformed" } | { kind: "price"; cost: number; remainingSeats: number | null; direct: boolean | null } {
  const available = row[`${prefix}Available`];
  if (typeof available !== "boolean") return { kind: "malformed" };

  const rawCost = row[`${prefix}MileageCost`];
  if (rawCost === null || rawCost === undefined) return { kind: "unusable" };
  if (typeof rawCost !== "string") return { kind: "malformed" };
  if (rawCost === "0") return { kind: "unusable" };
  if (!/^\d{1,7}$/.test(rawCost)) return { kind: "malformed" };
  const cost = Number(rawCost);
  if (!Number.isFinite(cost) || cost < 1 || cost > MAX_POINTS) {
    return { kind: "malformed" };
  }
  if (!available) return { kind: "unusable" };

  let remainingSeats: number | null = null;
  const rawSeats = row[`${prefix}RemainingSeats`];
  if (rawSeats !== null && rawSeats !== undefined) {
    if (
      typeof rawSeats !== "number" ||
      !Number.isInteger(rawSeats) ||
      rawSeats < 0 ||
      rawSeats > MAX_SEATS
    ) {
      return { kind: "malformed" };
    }
    // A crawl reports 0 when seat counts are not tracked; only a positive
    // count is a real observation.
    remainingSeats = rawSeats > 0 ? rawSeats : null;
  }

  let direct: boolean | null = null;
  const rawDirect = row[`${prefix}Direct`];
  if (typeof rawDirect === "boolean") {
    direct = rawDirect;
  } else if (rawDirect !== null && rawDirect !== undefined) {
    return { kind: "malformed" };
  }

  return { kind: "price", cost, remainingSeats, direct };
}

function readTaxes(
  row: Record<string, unknown>,
  prefix: "Y" | "W" | "J" | "F",
): { kind: "absent" } | { kind: "unpaired" } | { kind: "malformed" } | { kind: "present"; minorUnits: number; currency: string } {
  const rawTaxes = row[`${prefix}TotalTaxes`];
  if (rawTaxes === null || rawTaxes === undefined) return { kind: "absent" };
  if (
    typeof rawTaxes !== "number" ||
    !Number.isInteger(rawTaxes) ||
    rawTaxes < 0 ||
    rawTaxes > MAX_TAXES_MINOR_UNITS
  ) {
    return { kind: "malformed" };
  }

  const rawCurrency = row.TaxesCurrency;
  if (rawCurrency === null || rawCurrency === undefined) {
    // Documented provider quirk: some programs report taxes without a
    // currency. The amount cannot be displayed honestly without one, so the
    // observation is kept but taxes are not claimed.
    return { kind: "unpaired" };
  }
  if (typeof rawCurrency !== "string" || !/^[A-Z]{3}$/.test(rawCurrency)) {
    return { kind: "malformed" };
  }
  return { kind: "present", minorUnits: rawTaxes, currency: rawCurrency };
}

type RowProjection =
  | { kind: "row"; row: SeatsAeroAvailabilityRow }
  | { kind: "skip" }
  | { kind: "reject" };

function projectRow(
  value: unknown,
  request: SeatsAeroSearchRequest,
  direction: SeatsAeroSearchDirection,
): RowProjection {
  if (!isRecord(value)) return { kind: "reject" };

  const rowId = value.ID;
  if (
    typeof rowId !== "string" ||
    rowId.length === 0 ||
    rowId.length > MAX_ID_LENGTH
  ) {
    return { kind: "reject" };
  }

  const source = value.Source;
  if (
    typeof source !== "string" ||
    source.length === 0 ||
    source.length > MAX_PROGRAM_SLUG_LENGTH ||
    !SOURCE_SLUG_PATTERN.test(source)
  ) {
    return { kind: "reject" };
  }

  const route = value.Route;
  if (!isRecord(route)) return { kind: "reject" };
  if (route.Source !== source) return { kind: "reject" };
  const routeOrigin = route.OriginAirport;
  const routeDestination = route.DestinationAirport;
  if (
    typeof routeOrigin !== "string" ||
    !AIRPORT_PATTERN.test(routeOrigin) ||
    typeof routeDestination !== "string" ||
    !AIRPORT_PATTERN.test(routeDestination)
  ) {
    return { kind: "reject" };
  }

  // Corridor gate: a row must belong to the exact searched corridor for its
  // direction. A row for any other corridor is a contract violation and
  // rejects the response rather than being silently kept.
  const expected = corridorEndpoints(request, direction);
  if (
    routeOrigin !== expected.origin ||
    routeDestination !== expected.destination
  ) {
    return { kind: "reject" };
  }

  // Date gate: the row's departure must be a real calendar date inside the
  // requested window.
  const rawDate = value.Date;
  if (!calendarDate(rawDate)) return { kind: "reject" };
  const departureDate: string = rawDate;
  if (departureDate < request.startDate || departureDate > request.endDate) {
    return { kind: "reject" };
  }

  const prefix = cabinPrefix(request.cabin);
  const cabinObservation = readCabinObservation(value, prefix);
  if (cabinObservation.kind === "unusable") return { kind: "skip" };
  if (cabinObservation.kind === "malformed") return { kind: "reject" };

  const taxes = readTaxes(value, prefix);
  if (taxes.kind === "malformed") return { kind: "reject" };

  const updatedAt = exactIsoInstant(value.UpdatedAt);
  if (!updatedAt) return { kind: "reject" };

  return {
    kind: "row",
    row: {
      pointsRequired: cabinObservation.cost,
      source,
      departureDate,
      isReturn: direction === "return",
      taxesMinorUnits: taxes.kind === "present" ? taxes.minorUnits : null,
      taxesCurrency: taxes.kind === "present" ? taxes.currency : null,
      remainingSeats: cabinObservation.remainingSeats,
      direct: cabinObservation.direct,
      updatedAt,
    },
  };
}

/**
 * Strict projection of the untrusted cached-search body into customer-safe
 * availability rows for one corridor direction.
 *
 * Semantics:
 * - The body envelope must be an object with a finite non-negative integer
 *   `count`, a boolean `hasMore`, and a `data` array of at most MAX_ROWS
 *   rows; any envelope violation returns `null` (projection_rejected).
 * - `data` may be empty: a legitimate "no observed availability" result
 *   projects to an empty array, never an error.
 * - Every row must satisfy its own strict validation AND the corridor and
 *   date gates. One malformed or out-of-corridor row rejects the entire
 *   response — a partially believable result is worse than none.
 * - Rows that are valid but carry no usable price for the requested cabin
 *   (not offered, not available sentinel) are skipped, not rejected.
 */
export function projectSeatsAeroAvailability(
  body: unknown,
  request: SeatsAeroSearchRequest,
  direction: SeatsAeroSearchDirection,
): SeatsAeroAvailabilityRow[] | null {
  if (!isRecord(body)) return null;
  const { data, count, hasMore } = body;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 0 ||
    typeof hasMore !== "boolean" ||
    !Array.isArray(data) ||
    data.length > MAX_ROWS
  ) {
    return null;
  }
  // A count that disagrees with the actual page contents is present-but-
  // malformed envelope data; fail closed rather than trusting either value.
  if (count !== data.length) {
    return null;
  }

  const rows: SeatsAeroAvailabilityRow[] = [];
  for (const raw of data) {
    const projection = projectRow(raw, request, direction);
    if (projection.kind === "skip") continue;
    if (projection.kind === "reject") return null;
    rows.push(projection.row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function buildSeatsAeroClient(
  apiKey: string,
  fetchFn?: FetchFn,
  clockFn?: ClockFn,
): SeatsAeroClient {
  const fetch = fetchFn ?? globalThis.fetch.bind(globalThis);
  const clock = clockFn ?? (() => new Date());

  async function searchAvailability(
    input: unknown,
    direction: SeatsAeroSearchDirection,
    signal?: AbortSignal,
  ): Promise<SeatsAeroClientResult> {
    // 1. Validate runtime request
    const request = normalizeSearchRequest(input);
    if (!request) {
      return { rows: null, error: "invalid_request" };
    }

    // 2. Validate API key
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return { rows: null, error: "provider_not_configured" };
    }

    // 3. Make the single cached-search request for this corridor direction
    const url = `https://seats.aero/partnerapi/search?${buildQueryString(
      buildRequestParams(request, direction),
    )}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "Partner-Authorization": apiKey,
        },
        signal,
      });
    } catch {
      return { rows: null, error: "http_failure" };
    }

    if (!response.ok) {
      return { rows: null, error: "http_failure" };
    }

    // 4. Decode JSON safely
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { rows: null, error: "malformed_response" };
    }

    // 5. Project through the strict row projector; only validated,
    //    corridor-matched rows leave this boundary.
    const rows = projectSeatsAeroAvailability(body, request, direction);
    if (rows === null) {
      return { rows: null, error: "projection_rejected" };
    }

    return { rows, error: null };
  }

  return { searchAvailability };
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

export function createSeatsAeroClient(
  fetchFn?: FetchFn,
  clockFn?: ClockFn,
): SeatsAeroClient {
  const apiKey = process.env.SEATS_AERO_API_KEY ?? "";
  return buildSeatsAeroClient(apiKey, fetchFn, clockFn);
}
