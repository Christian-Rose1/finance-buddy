/**
 * Hotel planning estimate contract (v1).
 *
 * A strict, customer-safe projection of SerpAPI Google Hotels observations for
 * a saved goal. Follows the existing hardened flight-planning-estimate
 * conventions:
 *
 * - Untrusted input is never returned as-is; the projector rebuilds a fresh
 *   customer-safe object and safely omits every hostile shape.
 * - Nightly prices and whole-stay totals are separate, independently validated
 *   fields. Neither is ever derived from the other; each carries its own
 *   explicit currency. Absent prices stay null.
 * - No points prices, transfer partners, fees, ratings, availability, or
 *   booking capability are ever fabricated. The trust disclosure is fixed.
 * - The API key, raw provider response, query strings, tokens, and provider
 *   metadata never appear in projected output.
 */

export const HOTEL_PLANNING_ESTIMATE_SCHEMA_VERSION = 1 as const;

/** Fixed trust labels; never model- or provider-authored. */
export const HOTEL_PLANNING_ESTIMATE_LABEL =
  "Hotel planning estimate" as const;
export const HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL =
  "Planning estimate" as const;
export const HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL =
  "Not customer-verified" as const;
export const HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL =
  "Search estimates only; not bookable; verify current price and availability before booking" as const;

export type HotelPlanningEstimateTrustStatus =
  | "search_estimate"
  | "price_unavailable";

export interface HotelPlanningEstimateOption {
  /** Stable option identifier (validated opaque string). */
  id: string;
  /** Validated property name. */
  propertyName: string;
  /** Searched-destination text as returned by the provider, when provided. */
  locationText: string | null;
  /** Nightly cash price when the provider explicitly establishes one. */
  nightlyPrice: number | null;
  /** Currency of `nightlyPrice`; non-null exactly when `nightlyPrice` is. */
  nightlyPriceCurrency: string | null;
  /** Whole-stay cash total when the provider explicitly establishes one. */
  totalPrice: number | null;
  /** Currency of `totalPrice`; non-null exactly when `totalPrice` is. */
  totalPriceCurrency: string | null;
  /** Guest rating when valid. */
  rating: number | null;
  /** Review count when valid. */
  reviewCount: number | null;
  /** Hotel class when valid. */
  hotelClass: number | null;
  /** Neighborhood or location description when valid. */
  neighborhood: string | null;
  /** Amenity strings, bounded, deduplicated, original order preserved. */
  amenities: string[];
  /** Property/source URL when returned and safe. */
  propertyUrl: string | null;
  /** Image URL when returned and safe. */
  imageUrl: string | null;
  /** Explicit availability/trust status of this option. */
  trustStatus: HotelPlanningEstimateTrustStatus;
}

export interface HotelPlanningEstimate {
  schemaVersion: typeof HOTEL_PLANNING_ESTIMATE_SCHEMA_VERSION;
  label: typeof HOTEL_PLANNING_ESTIMATE_LABEL;
  /** Searched destination (from the saved goal; never model-selected). */
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  travelers: number;
  currency: string;
  /** Ordered hotel options; deterministic order, at least one. */
  options: HotelPlanningEstimateOption[];
  /** Fixed disclosure that results are planning/search estimates. */
  disclosure: typeof HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL;
  evidenceLabel: typeof HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL;
  verificationLabel: typeof HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL;
  availabilityLabel: typeof HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL;
}

// ---------------------------------------------------------------------------
// Bounded-shape constants (repository conventions)
// ---------------------------------------------------------------------------

const MAX_OPTIONS = 10;
const MAX_AMENITIES = 12;
const MAX_TEXT = 120;
const MAX_URL = 300;
const MAX_PRICE = 1_000_000;
const MAX_TRAVELERS = 9;
const MAX_NIGHTS = 60;
const MAX_RATING = 5;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "label",
  "destination",
  "checkInDate",
  "checkOutDate",
  "nights",
  "travelers",
  "currency",
  "options",
  "disclosure",
  "evidenceLabel",
  "verificationLabel",
  "availabilityLabel",
]);

const OPTION_KEYS = new Set([
  "id",
  "propertyName",
  "locationText",
  "nightlyPrice",
  "nightlyPriceCurrency",
  "totalPrice",
  "totalPriceCurrency",
  "rating",
  "reviewCount",
  "hotelClass",
  "neighborhood",
  "amenities",
  "propertyUrl",
  "imageUrl",
  "trustStatus",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A present `lowest` price must be a displayed string; numbers, booleans,
 * arrays, and objects are hostile shapes that reject the response rather
 * than silently degrading to an absent (null) price.
 */
const malformedLowest = (container: unknown): boolean => {
  if (!isRecord(container)) return false;
  const lowest = container.lowest;
  return lowest !== undefined && lowest !== null && typeof lowest !== "string";
};

const onlyKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>) =>
  Object.keys(value).every((key) => keys.has(key));

const calendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

/** Safe bounded text: no control characters, no URL/token/metadata shapes. */
const safeNullableText = (value: unknown, max: number): string | null | undefined => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /(?:https?:\/\/|www\.|\/m\/|\/g\/|(?:provider|token|metadata|search|api)[_-]?key|api_key)/i.test(value)
  ) {
    return undefined;
  }
  return value;
};

/**
 * Safe https URL via structured parsing: https only, nonempty hostname, no
 * credentials, no query string, no fragment, numeric port 1-65535, no raw or
 * percent-encoded dot-segments, no control characters, bounded length.
 */
const safeNullableUrl = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_URL) {
    return undefined;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  if (!value.startsWith("https://")) return undefined;
  const rest = value.slice("https://".length);
  if (rest.length === 0) return undefined;
  // No credentials, query, fragment, or userinfo markers allowed.
  if (rest.includes("@") || rest.includes("?") || rest.includes("#")) return undefined;
  let authority = rest;
  let path = "";
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    authority = rest.slice(0, slash);
    path = rest.slice(slash);
  }
  if (authority.length === 0) return undefined;
  // Port: numeric, 1-65535, optional.
  let host = authority;
  const colon = authority.lastIndexOf(":");
  if (colon !== -1) {
    const port = authority.slice(colon + 1);
    if (!/^\d+$/.test(port)) return undefined;
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return undefined;
    host = authority.slice(0, colon);
  }
  // Host: nonempty, no control chars, valid label-ish shape (letters, digits,
  // dots, hyphens; no leading/trailing dot or hyphen).
  if (host.length === 0 || host.length > 253) return undefined;
  if (host.startsWith(".") || host.endsWith(".") || host.startsWith("-") || host.endsWith("-")) return undefined;
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return undefined;
  // Path: no raw or percent-encoded dot-segments, no query/fragment (already
  // rejected above), bounded length. Encoded content is decoded (bounded to two
  // rounds) so traversal, separators, and control characters cannot hide behind
  // percent-encoding; malformed escapes are rejected outright.
  if (path.length > 0) {
    if (!path.startsWith("/")) return undefined;
    if (path.length > MAX_URL) return undefined;
    const segments = path.split("/");
    for (const segment of segments) {
      if (segment === "." || segment === "..") return undefined;
      let decoded = segment;
      for (let round = 0; round < 2; round += 1) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          // Malformed percent escapes (e.g. "%ZZ") are hostile shapes.
          return undefined;
        }
        if (
          decoded === "." ||
          decoded === ".." ||
          decoded.includes("/") ||
          decoded.includes("\\") ||
          /[\u0000-\u001f\u007f]/.test(decoded)
        ) {
          return undefined;
        }
        // Reapply the encoded-dot-segment checks to the decoded segment so
        // double-encoded dot segments ("%252e%252e") cannot survive.
        if (/^%2e$/i.test(decoded) || /^%2e%2e$/i.test(decoded)) return undefined;
        if (decoded === segment) break; // fully decoded; further rounds are no-ops
      }
    }
  }
  return value;
};

const nonNegativePrice = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0 || value > MAX_PRICE) return undefined;
  return value;
};

const boundedInteger = (value: unknown, min: number, max: number): number | undefined => {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
};

function projectOptionUnsafe(raw: unknown): HotelPlanningEstimateOption | null {
  if (!isRecord(raw) || !onlyKeys(raw, OPTION_KEYS)) return null;
  const id = safeNullableText(raw.id, MAX_TEXT);
  const propertyName = safeNullableText(raw.propertyName, MAX_TEXT);
  if (id === undefined || id === null || propertyName === undefined || propertyName === null) {
    return null;
  }

  // Nightly and whole-stay prices are independent: each requires its own
  // explicit currency; neither is ever derived from the other.
  let nightlyPrice: number | null = null;
  let nightlyPriceCurrency: string | null = null;
  if (raw.nightlyPrice !== null) {
    const price = nonNegativePrice(raw.nightlyPrice);
    const currency = typeof raw.nightlyPriceCurrency === "string" && CURRENCY_PATTERN.test(raw.nightlyPriceCurrency)
      ? raw.nightlyPriceCurrency
      : null;
    if (price === undefined || currency === null) return null;
    nightlyPrice = price;
    nightlyPriceCurrency = currency;
  } else if (raw.nightlyPriceCurrency !== null) {
    return null;
  }

  let totalPrice: number | null = null;
  let totalPriceCurrency: string | null = null;
  if (raw.totalPrice !== null) {
    const price = nonNegativePrice(raw.totalPrice);
    const currency = typeof raw.totalPriceCurrency === "string" && CURRENCY_PATTERN.test(raw.totalPriceCurrency)
      ? raw.totalPriceCurrency
      : null;
    if (price === undefined || currency === null) return null;
    totalPrice = price;
    totalPriceCurrency = currency;
  } else if (raw.totalPriceCurrency !== null) {
    return null;
  }

  const rating = raw.rating === null
    ? null
    : (() => {
        const value = raw.rating;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_RATING) return undefined;
        return value;
      })();
  if (rating === undefined) return null;

  const reviewCount = raw.reviewCount === null
    ? null
    : boundedInteger(raw.reviewCount, 1, 10_000_000);
  if (reviewCount === undefined) return null;

  const hotelClass = raw.hotelClass === null
    ? null
    : boundedInteger(raw.hotelClass, 1, 5);
  if (hotelClass === undefined) return null;

  const locationText = safeNullableText(raw.locationText, MAX_TEXT);
  if (locationText === undefined) return null;
  const neighborhood = safeNullableText(raw.neighborhood, MAX_TEXT);
  if (neighborhood === undefined) return null;

  if (!Array.isArray(raw.amenities) || raw.amenities.length > MAX_AMENITIES) return null;
  const amenities: string[] = [];
  for (const item of raw.amenities) {
    const amenity = safeNullableText(item, MAX_TEXT);
    if (amenity === undefined || amenity === null) return null;
    if (!amenities.includes(amenity)) amenities.push(amenity);
  }

  const propertyUrl = safeNullableUrl(raw.propertyUrl);
  if (propertyUrl === undefined) return null;
  const imageUrl = safeNullableUrl(raw.imageUrl);
  if (imageUrl === undefined) return null;

  if (raw.trustStatus !== "search_estimate" && raw.trustStatus !== "price_unavailable") {
    return null;
  }

  return {
    id,
    propertyName,
    locationText,
    nightlyPrice,
    nightlyPriceCurrency,
    totalPrice,
    totalPriceCurrency,
    rating,
    reviewCount,
    hotelClass,
    neighborhood,
    amenities,
    propertyUrl,
    imageUrl,
    trustStatus: raw.trustStatus,
  };
}

function projectHotelPlanningEstimateUnsafe(raw: unknown): HotelPlanningEstimate | null {
  if (!isRecord(raw) || !onlyKeys(raw, TOP_LEVEL_KEYS)) return null;
  if (raw.schemaVersion !== HOTEL_PLANNING_ESTIMATE_SCHEMA_VERSION) return null;
  if (
    raw.label !== HOTEL_PLANNING_ESTIMATE_LABEL ||
    raw.evidenceLabel !== HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL ||
    raw.verificationLabel !== HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL ||
    raw.availabilityLabel !== HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL ||
    raw.disclosure !== HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL
  ) {
    return null;
  }
  if (
    typeof raw.destination !== "string" ||
    raw.destination.length < 1 ||
    raw.destination.length > MAX_TEXT ||
    /[\u0000-\u001f\u007f]/.test(raw.destination)
  ) {
    return null;
  }
  if (
    !calendarDate(raw.checkInDate) ||
    !calendarDate(raw.checkOutDate) ||
    raw.checkOutDate <= raw.checkInDate
  ) {
    return null;
  }
  const checkInTime = Date.parse(`${raw.checkInDate}T00:00:00Z`);
  const checkOutTime = Date.parse(`${raw.checkOutDate}T00:00:00Z`);
  const nights = Math.round((checkOutTime - checkInTime) / 86_400_000);
  if (
    nights < 1 ||
    nights > MAX_NIGHTS ||
    raw.nights !== nights ||
    typeof raw.travelers !== "number" ||
    !Number.isInteger(raw.travelers) ||
    raw.travelers < 1 ||
    raw.travelers > MAX_TRAVELERS ||
    typeof raw.currency !== "string" ||
    !CURRENCY_PATTERN.test(raw.currency)
  ) {
    return null;
  }
  if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > MAX_OPTIONS) {
    return null;
  }
  const options: HotelPlanningEstimateOption[] = [];
  const seenIds = new Set<string>();
  for (const item of raw.options) {
    const option = projectOptionUnsafe(item);
    if (option === null || seenIds.has(option.id)) return null;
    seenIds.add(option.id);
    options.push(option);
  }
  return {
    schemaVersion: HOTEL_PLANNING_ESTIMATE_SCHEMA_VERSION,
    label: HOTEL_PLANNING_ESTIMATE_LABEL,
    destination: raw.destination,
    checkInDate: raw.checkInDate,
    checkOutDate: raw.checkOutDate,
    nights,
    travelers: raw.travelers,
    currency: raw.currency,
    options,
    disclosure: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
    evidenceLabel: HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL,
    verificationLabel: HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL,
    availabilityLabel: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
  };
}

/** Strictly reconstructs untrusted data and safely omits every hostile shape. */
export function projectHotelPlanningEstimate(raw: unknown): HotelPlanningEstimate | null {
  try {
    return projectHotelPlanningEstimateUnsafe(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SerpAPI Google Hotels response projection
// ---------------------------------------------------------------------------

/** Google Hotels property group: the only per-property unit this milestone consumes. */
export interface SerpApiHotelProperty {
  /** Documented property category; only hotels are consumed. */
  type: "hotel";
  name: string;
  /** Nightly rate as displayed, when present. */
  ratePerNight: { lowest: string | null } | null;
  /** Whole-stay total as displayed, when present. */
  totalRate: { lowest: string | null } | null;
  /** Overall guest rating, when present. */
  rating: number | null;
  /** Review count, when present. */
  reviews: number | null;
  /** Numeric hotel class, from the documented extracted_hotel_class field. */
  hotelClass: number | null;
  /** Amenity strings, when present. */
  amenities: string[] | null;
  /** Property link, when present. */
  link: string | null;
  /** Original image URL, when present. */
  images: Array<{ thumbnail: string | null }> | null;
}

/**
 * Parses a complete displayed monetary string, fail-closed.
 *
 * Accepted grammar (whole string must match exactly):
 *   [currency-symbol-or-code]? digits [grouping] [decimal-part] [currency-symbol-or-code]?
 * - digits: 1-9 followed by digits or separators; no leading zero group longer
 *   than "0.x" decimal forms.
 * - grouping: exactly one convention per string — space-separated 3-digit
 *   groups ("1 234 567") or comma/period-separated 3-digit groups
 *   ("1,234,567" / "1.234.567"). Mixed or irregular groups ("1,2,3",
 *   "1,23,456", "12,34,56") are rejected as ambiguous.
 * - decimal part: exactly one decimal separator; the last separator is the
 *   decimal point; at most two decimal digits ("1.234,56", "1,234.56",
 *   "123.45").
 * - currency: an optional leading/trailing symbol ($ or €) or exactly one
 *   ISO-4217-style 3-letter code ("USD", "EUR"). Alphabetic text anywhere
 *   else, exponent notation, signs, and partial numbers are rejected.
 *
 * Returns null for any rejected string; never guesses.
 */
export function parseDisplayedPrice(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;
  // Reject control characters outright.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

  // Optional leading currency symbol or ISO-4217-style code. A code must be
  // all-caps and separated from the digits ("USD 100", "USD100" is rejected —
  // it is indistinguishable from attached alphabetic text).
  let rest = trimmed;
  if (rest.startsWith("$") || rest.startsWith("€")) rest = rest.slice(1);
  else {
    const codeMatch = rest.match(/^([A-Z]{3})\s+(?=\d)/);
    if (codeMatch) rest = rest.slice(codeMatch[0].length - 1); // keep the separator space for the digit check
  }
  // Optional trailing currency symbol or code (same rules, mirrored).
  let tail = rest;
  if (tail.endsWith("$") || tail.endsWith("€")) tail = tail.slice(0, -1);
  else {
    const codeMatch = tail.match(/(?<=\d) ([A-Z]{3})$/);
    if (codeMatch) tail = tail.slice(0, tail.length - codeMatch[0].length);
  }
  rest = tail.trim();
  if (rest.length === 0) return null;

  // Reject signs and exponent notation before structural parsing.
  if (/[+-]/.test(rest) || /[eE]/.test(rest)) return null;
  // Any residual letter anywhere is rejected (e.g. "12abc", "abc12").
  if (/[A-Za-z]/.test(rest)) return null;

  // Split into digit/separator structure and count separators.
  if (!/^[\d.,\s]*$/.test(rest)) return null;
  if (/\d\s{2,}\d/.test(rest)) return null; // only single spaces may separate groups
  const dotCount = (rest.match(/\./g) ?? []).length;
  const commaCount = (rest.match(/,/g) ?? []).length;
  const spaceCount = (rest.match(/ /g) ?? []).length;

  // Case 0: no separators at all — a plain integer.
  if (dotCount === 0 && commaCount === 0 && spaceCount === 0) {
    if (!/^\d+$/.test(rest)) return null;
    return boundedParsedPrice(rest);
  }

  // Case A: only spaces — 3-digit space groups with an optional final
  // dot-or-comma decimal part of 1-2 digits ("1 234", "1 234.56", "1 234,56").
  if (spaceCount > 0) {
    if (!/^\d{1,3}(?: \d{3})*(?:[.,]\d{1,2})?$/.test(rest)) return null;
    const numeric = rest.replace(/ /g, "").replace(/([.,])\d{1,2}$/, (match) => `.${match.slice(1)}`);
    if (!/^\d+(?:\.\d{1,2})?$/.test(numeric)) return null;
    return boundedParsedPrice(numeric);
  }

  // Case B: only dots or only commas — either grouping (3-digit groups with
  // optional final 1-2 decimal digits) or pure decimal. Disambiguate strictly:
  // the final separator is the decimal separator only if it is followed by
  // exactly 1-2 digits AND all earlier separators are 3-digit groups.
  if (dotCount + commaCount > 0 && spaceCount === 0 && (dotCount === 0 || commaCount === 0)) {
    const sep = dotCount > 0 ? "." : ",";
    const parts = rest.split(sep);
    // All parts must be digit groups; first part nonempty.
    if (parts.some((part) => !/^\d+$/.test(part)) || parts[0].length === 0) return null;
    const lastPart = parts[parts.length - 1];
    const earlierGroups = parts.slice(0, -1);
    const lastIsDecimal = lastPart.length <= 2 && (lastPart.length !== 3 || earlierGroups.length === 0);
    if (lastIsDecimal) {
      // Earlier parts must be 3-digit groups (or a single leading group).
      if (earlierGroups.some((group) => group.length !== 3) || (earlierGroups.length > 0 && earlierGroups[0].length === 0)) return null;
      if (earlierGroups.length === 0 && lastPart.length === 3 && parts.length === 1) {
        // A lone 3-digit token with the separator is impossible here.
        return null;
      }
      const numeric = `${earlierGroups.join("")}.${lastPart}`;
      return boundedParsedPrice(numeric);
    }
    // Pure grouping: every group after the first must be exactly 3 digits;
    // the first (most significant) group may be 1-3 digits but must not be
    // the single digit 0 ("0,001" is not a monetary grouping form).
    if (parts.some((part, index) => index > 0 && part.length !== 3)) return null;
    if (parts[0].length < 1 || parts[0].length > 3) return null;
    if (parts[0] === "0") return null;
    return boundedParsedPrice(parts.join(""));
  }

  // Case C: mixed dot+comma (European or US style with both separators).
  if (dotCount > 0 && commaCount > 0 && spaceCount === 0) {
    const decimalSep = rest.lastIndexOf(".") > rest.lastIndexOf(",") ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    const [whole, decimal, ...extra] = rest.split(decimalSep);
    if (extra.length > 0) return null; // more than one decimal separator
    if (decimal === undefined || !/^\d{1,2}$/.test(decimal)) return null;
    if (whole === undefined || whole.length === 0) return null;
    const groups = whole.split(groupSep);
    if (groups.some((part) => !/^\d+$/.test(part))) return null;
    if (groups.length > 1 && groups.some((part, index) => index > 0 && part.length !== 3)) return null;
    const numeric = `${groups.join("")}.${decimal}`;
    return boundedParsedPrice(numeric);
  }

  return null;
}

/** Applies the positive/finite/maximum rules to an already-structured number. */
function boundedParsedPrice(numeric: string): number | null {
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_PRICE) return null;
  return parsed;
}

function parseGoogleHotelsPropertiesUnsafe(
  body: unknown,
): { properties: SerpApiHotelProperty[] } | null {
  if (!isRecord(body)) return null;
  const shape = body as { properties?: unknown };
  if (!Array.isArray(shape.properties) || shape.properties.length === 0) return null;
  const properties: SerpApiHotelProperty[] = [];
  for (const item of shape.properties) {
    if (!isRecord(item)) return null;
    // Documented categories are "hotel" and "vacation rental". Vacation
    // rentals are a different lodging category and are excluded from the
    // customer-facing result: they are skipped here, never projected. Any
    // other or malformed category shape rejects the response.
    if (item.type === "vacation rental") continue;
    if (item.type !== "hotel" || typeof item.name !== "string" || item.name.length === 0) {
      return null;
    }
    // A present rate container that is neither an object nor null is a
    // malformed rate structure, not absence. Likewise, a present `lowest`
    // that is not a string (number, boolean, array, object) is malformed and
    // must reject the response rather than silently become "absent".
    if (
      (item.rate_per_night !== undefined && item.rate_per_night !== null && !isRecord(item.rate_per_night)) ||
      (item.total_rate !== undefined && item.total_rate !== null && !isRecord(item.total_rate)) ||
      malformedLowest(item.rate_per_night) ||
      malformedLowest(item.total_rate)
    ) {
      return null;
    }
    // Optional numeric/string fields must be either valid or absent — a
    // present-but-hostile value (e.g. overall_rating: "high") rejects the
    // response rather than being silently coerced to null. The documented
    // string `hotel_class` ("5-star hotel") is provider display text: it is
    // neither used as the numeric class nor treated as hostile.
    if (
      (item.overall_rating !== undefined && item.overall_rating !== null && (typeof item.overall_rating !== "number" || !Number.isFinite(item.overall_rating))) ||
      (item.reviews !== undefined && item.reviews !== null && (typeof item.reviews !== "number" || !Number.isFinite(item.reviews))) ||
      (item.extracted_hotel_class !== undefined && item.extracted_hotel_class !== null && (typeof item.extracted_hotel_class !== "number" || !Number.isFinite(item.extracted_hotel_class))) ||
      (item.amenities !== undefined && item.amenities !== null && !Array.isArray(item.amenities)) ||
      (item.link !== undefined && item.link !== null && typeof item.link !== "string") ||
      (item.images !== undefined && item.images !== null && !Array.isArray(item.images))
    ) {
      return null;
    }
    if (item.amenities !== undefined && item.amenities !== null && (item.amenities as unknown[]).some((a) => typeof a !== "string")) {
      return null;
    }
    const images = Array.isArray(item.images) ? item.images : null;
    properties.push({
      type: "hotel",
      name: item.name,
      ratePerNight: isRecord(item.rate_per_night) && typeof item.rate_per_night.lowest === "string"
        ? { lowest: item.rate_per_night.lowest }
        : null,
      totalRate: isRecord(item.total_rate) && typeof item.total_rate.lowest === "string"
        ? { lowest: item.total_rate.lowest }
        : null,
      rating: typeof item.overall_rating === "number" ? item.overall_rating : null,
      reviews: typeof item.reviews === "number" ? item.reviews : null,
      hotelClass: typeof item.extracted_hotel_class === "number" ? item.extracted_hotel_class : null,
      amenities: Array.isArray(item.amenities) ? (item.amenities as string[]) : null,
      link: typeof item.link === "string" ? item.link : null,
      images: images === null
        ? null
        : images.map((image) => ({
            thumbnail: isRecord(image) && typeof image.thumbnail === "string" ? image.thumbnail : null,
          })),
    });
  }
  return { properties };
}

export interface SerpApiHotelEstimateInput {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  travelers: number;
  currency: string;
  retrievedAt: string;
  /** Untrusted parsed Google Hotels JSON body. */
  response: unknown;
}

/**
 * Projects a raw Google Hotels response into the strict customer-safe
 * estimate. Returns null when no trustworthy option survives validation.
 */
export function projectSerpApiHotelEstimate(
  input: SerpApiHotelEstimateInput,
): HotelPlanningEstimate | null {
  try {
    const parsed = parseGoogleHotelsPropertiesUnsafe(input.response);
    if (parsed === null) return null;
    // Currency is the requested saved-goal currency supplied to the
    // projector; provider display symbols are parsed by the strict displayed-
    // price grammar but never invent or override the currency.
    const currency = input.currency;
    const options: HotelPlanningEstimateOption[] = [];
    for (const property of parsed.properties) {
      const nightlyRaw = property.ratePerNight?.lowest ?? null;
      const totalRaw = property.totalRate?.lowest ?? null;
      // A present-but-unparseable displayed price is a hostile shape: it must
      // reject the response rather than silently degrade to "absent".
      const nightly = nightlyRaw === null ? null : parseDisplayedPrice(nightlyRaw);
      if (nightlyRaw !== null && nightly === null) return null;
      const total = totalRaw === null ? null : parseDisplayedPrice(totalRaw);
      if (totalRaw !== null && total === null) return null;
      const image = property.images?.find((candidate) => candidate.thumbnail !== null)?.thumbnail ?? null;
      options.push({
        id: `serpapi-hotel-${options.length + 1}`,
        propertyName: property.name,
        locationText: null,
        nightlyPrice: nightly,
        nightlyPriceCurrency: nightly === null ? null : currency,
        totalPrice: total,
        totalPriceCurrency: total === null ? null : currency,
        rating: property.rating ?? null,
        reviewCount: property.reviews ?? null,
        hotelClass: property.hotelClass ?? null,
        neighborhood: null,
        amenities: property.amenities ?? [],
        propertyUrl: property.link ?? null,
        imageUrl: image,
        trustStatus: nightly === null && total === null ? "price_unavailable" : "search_estimate",
      });
    }
    if (options.length === 0) return null;
    return projectHotelPlanningEstimateUnsafe({
      schemaVersion: HOTEL_PLANNING_ESTIMATE_SCHEMA_VERSION,
      label: HOTEL_PLANNING_ESTIMATE_LABEL,
      destination: input.destination,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      nights: Math.round(
        (Date.parse(`${input.checkOutDate}T00:00:00Z`) - Date.parse(`${input.checkInDate}T00:00:00Z`)) / 86_400_000,
      ),
      travelers: input.travelers,
      currency,
      options,
      disclosure: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
      evidenceLabel: HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL,
      verificationLabel: HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL,
      availabilityLabel: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
    });
  } catch {
    return null;
  }
}

/** Narrow stage-literal accessor used by diagnostics. */
export type HotelPlanningEstimateStage = "hotel";
