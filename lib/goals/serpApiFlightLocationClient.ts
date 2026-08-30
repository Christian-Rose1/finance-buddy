/**
 * Server-side SerpApi Google Flights Autocomplete client.
 *
 * A saved three-letter airport identifier is resolved locally. Other safe
 * saved locations make at most one autocomplete request and pass the raw JSON
 * directly through the approved location projector. There is no retry,
 * fallback, logging, persistence, or browser/model projection in this module.
 */

import {
  normalizeSerpApiFlightLocationInput,
  projectSerpApiFlightLocation,
  type SerpApiFlightLocationProjection,
} from "./serpApiFlightLocationProjection";

export type SerpApiFlightLocationClientError =
  | "invalid_location"
  | "provider_not_configured"
  | "http_failure"
  | "malformed_response";

export interface SerpApiFlightLocationClientResult {
  readonly projection: SerpApiFlightLocationProjection | null;
  readonly error: SerpApiFlightLocationClientError | null;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

function buildAutocompleteUrl(location: string, apiKey: string): string {
  const params = new URLSearchParams({
    engine: "google_flights_autocomplete",
    q: location,
    gl: "us",
    hl: "en",
    exclude_regions: "true",
    api_key: apiKey,
  });
  return `https://serpapi.com/search?${params.toString()}`;
}

export function buildSerpApiFlightLocationClient(
  apiKey: string,
  fetchFn?: FetchFn,
) {
  const fetch = fetchFn ?? globalThis.fetch.bind(globalThis);

  async function resolveLocation(
    savedLocation: unknown,
  ): Promise<SerpApiFlightLocationClientResult> {
    const normalizedLocation = normalizeSerpApiFlightLocationInput(savedLocation);
    if (!normalizedLocation) {
      return { projection: null, error: "invalid_location" };
    }

    const localProjection = projectSerpApiFlightLocation(normalizedLocation);
    if (
      localProjection.status === "resolved" &&
      localProjection.selected.kind === "airport"
    ) {
      return { projection: localProjection, error: null };
    }

    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return { projection: null, error: "provider_not_configured" };
    }

    let response: Response;
    try {
      response = await fetch(buildAutocompleteUrl(normalizedLocation, apiKey), {
        method: "GET",
        cache: "no-store",
      });
    } catch {
      return { projection: null, error: "http_failure" };
    }

    if (!response.ok) {
      return { projection: null, error: "http_failure" };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { projection: null, error: "malformed_response" };
    }

    const projection = projectSerpApiFlightLocation(normalizedLocation, body);
    if (projection.status === "malformed_response") {
      return { projection: null, error: "malformed_response" };
    }

    return { projection, error: null };
  }

  return Object.freeze({ resolveLocation });
}

export function createSerpApiFlightLocationClient(fetchFn?: FetchFn) {
  return buildSerpApiFlightLocationClient(
    process.env.SERPAPI_API_KEY ?? "",
    fetchFn,
  );
}
