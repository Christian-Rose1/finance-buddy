/**
 * SerpApi Google Hotels HTTP Client v1 (composition only).
 *
 * Exactly one Google Hotels request, no retry, fallback, pagination, booking,
 * or logging. Uses injected fetch and clock for testability; an optional
 * AbortSignal threads the caller's stage deadline into the transport.
 *
 * Trust rules:
 * - The request is built only from the validated saved-goal inputs passed by
 *   the caller. No model- or provider-selected search parameters exist.
 * - The untrusted provider body is projected exclusively through the accepted
 *   strict `projectSerpApiHotelEstimate`; only the validated customer-safe
 *   estimate is returned.
 * - API key, raw response, request URL, search metadata, headers, and provider
 *   details never appear in returned objects.
 * - Fixed safe error categories only.
 */

import {
  projectSerpApiHotelEstimate,
  type HotelPlanningEstimate,
} from "./hotelPlanningEstimate";
import type { Goal } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SerpApiHotelRequest {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  travelers: number;
  currency: string;
}

export type SerpApiHotelClientErrorCategory =
  | "invalid_request"
  | "provider_not_configured"
  | "http_failure"
  | "malformed_response"
  | "projection_rejected";

export interface SerpApiHotelClientResult {
  estimate: HotelPlanningEstimate | null;
  error: SerpApiHotelClientErrorCategory | null;
}

export interface SerpApiHotelClient {
  fetchHotelEstimate: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<SerpApiHotelClientResult>;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
type ClockFn = () => Date;

// ---------------------------------------------------------------------------
// Request validation (fail-closed; mirrors the estimate contract's bounds)
// ---------------------------------------------------------------------------

const MAX_DESTINATION = 120;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

function normalizeHotelRequest(value: unknown): SerpApiHotelRequest | null {
  if (!isRecord(value)) return null;
  const { destination, checkInDate, checkOutDate, travelers, currency } = value;
  if (
    typeof destination !== "string" ||
    destination.length < 1 ||
    destination.length > MAX_DESTINATION ||
    /[\u0000-\u001f\u007f]/.test(destination) ||
    !calendarDate(checkInDate) ||
    !calendarDate(checkOutDate) ||
    (checkOutDate as string) <= (checkInDate as string) ||
    typeof travelers !== "number" ||
    !Number.isInteger(travelers) ||
    travelers < 1 ||
    travelers > 9 ||
    typeof currency !== "string" ||
    !CURRENCY_PATTERN.test(currency)
  ) {
    return null;
  }
  return {
    destination,
    checkInDate,
    checkOutDate,
    travelers,
    currency,
  };
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

function buildRequestParams(request: SerpApiHotelRequest, apiKey: string): Record<string, string> {
  return {
    engine: "google_hotels",
    q: request.destination,
    check_in_date: request.checkInDate,
    check_out_date: request.checkOutDate,
    adults: String(request.travelers),
    currency: request.currency,
    gl: "us",
    hl: "en",
    api_key: apiKey,
  };
}

function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function buildSerpApiHotelClient(
  apiKey: string,
  fetchFn?: FetchFn,
  clockFn?: ClockFn,
): SerpApiHotelClient {
  const fetch = fetchFn ?? globalThis.fetch.bind(globalThis);
  const clock = clockFn ?? (() => new Date());

  async function fetchHotelEstimate(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<SerpApiHotelClientResult> {
    // 1. Validate runtime request
    const request = normalizeHotelRequest(input);
    if (!request) {
      return { estimate: null, error: "invalid_request" };
    }

    // 2. Validate API key
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return { estimate: null, error: "provider_not_configured" };
    }

    // 3. Make the single Google Hotels request
    const url = `https://serpapi.com/search?${buildQueryString(buildRequestParams(request, apiKey))}`;
    let response: Response;
    try {
      response = await fetch(url, { method: "GET", signal });
    } catch {
      return { estimate: null, error: "http_failure" };
    }

    if (!response.ok) {
      return { estimate: null, error: "http_failure" };
    }

    // 4. Capture the injected server clock and decode JSON safely
    const retrievedAt = clock().toISOString();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { estimate: null, error: "malformed_response" };
    }

    // 5. Project through the accepted strict estimator; only the validated
    //    customer-safe estimate ever leaves this boundary.
    const estimate = projectSerpApiHotelEstimate({
      destination: request.destination,
      checkInDate: request.checkInDate,
      checkOutDate: request.checkOutDate,
      travelers: request.travelers,
      currency: request.currency,
      retrievedAt,
      response: body,
    });
    if (!estimate) {
      return { estimate: null, error: "projection_rejected" };
    }

    return { estimate, error: null };
  }

  return { fetchHotelEstimate };
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

export function createSerpApiHotelClient(fetchFn?: FetchFn, clockFn?: ClockFn): SerpApiHotelClient {
  const apiKey = process.env.SERPAPI_API_KEY ?? "";
  return buildSerpApiHotelClient(apiKey, fetchFn, clockFn);
}

// ---------------------------------------------------------------------------
// Saved-goal entry point (the production hotel stage's only estimate source)
// ---------------------------------------------------------------------------

/** Fixed, allowlisted diagnostic categories; never provider or goal content. */
export type SerpApiHotelEstimateDiagnosticCategory =
  | "invalid_saved_goal_shape"
  | `hotel_client_${SerpApiHotelClientErrorCategory}`
  | "unexpected_hotel_estimate_failure";

/** Emits only one fixed prefix and one allowlisted category. */
export function logSerpApiHotelEstimateDiagnostic(
  category: SerpApiHotelEstimateDiagnosticCategory,
): void {
  if (process.env.STRATEGY_DEBUG === "1") {
    console.error(`[hotel-planning-estimate] ${JSON.stringify({ category })}`);
  }
}

/**
 * Builds the hotel planning estimate for a saved goal through the SerpAPI
 * Google Hotels client. The saved goal is the sole request authority: the
 * destination, earliest departure (check-in), latest return (check-out),
 * traveler count, and currency are read directly from it; no model- or
 * provider-selected parameter exists. Any invalid goal shape, missing key,
 * network/HTTP/JSON failure, or rejected projection yields null and a fixed
 * diagnostic category.
 */
export async function buildSerpApiHotelEstimateFromGoal(
  goal: Goal,
): Promise<HotelPlanningEstimate | null> {
  try {
    if (
      !isRecord(goal) ||
      !Array.isArray(goal.destinations) ||
      goal.destinations.length !== 1 ||
      typeof goal.destinations[0] !== "string"
    ) {
      logSerpApiHotelEstimateDiagnostic("invalid_saved_goal_shape");
      return null;
    }
    // Resolve the goal's travel window to concrete hotel dates: the earliest
    // departure is the check-in and the latest return is the check-out.
    const checkInDate = typeof goal.earliestDeparture === "string" ? goal.earliestDeparture : null;
    const checkOutDate = typeof goal.latestReturn === "string" ? goal.latestReturn : null;
    const travelers = typeof goal.travelerCount === "number" ? goal.travelerCount : null;
    const currency = typeof goal.currency === "string" ? goal.currency : null;
    if (!checkInDate || !checkOutDate || travelers === null || currency === null) {
      logSerpApiHotelEstimateDiagnostic("invalid_saved_goal_shape");
      return null;
    }
    const client = createSerpApiHotelClient();
    const outcome = await client.fetchHotelEstimate({
      destination: goal.destinations[0],
      checkInDate,
      checkOutDate,
      travelers,
      currency,
    });
    if (outcome.error) {
      logSerpApiHotelEstimateDiagnostic(`hotel_client_${outcome.error}`);
      return null;
    }
    return outcome.estimate;
  } catch {
    logSerpApiHotelEstimateDiagnostic("unexpected_hotel_estimate_failure");
    return null;
  }
}
