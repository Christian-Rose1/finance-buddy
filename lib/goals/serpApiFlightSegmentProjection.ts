import type { NormalizedSerpApiFlightSegment } from "./serpApiFlightNormalizer";

const MAX_SEGMENTS = 8;
const MAX_CARRIER_LENGTH = 80;
const MAX_FLIGHT_NUMBER_LENGTH = 16;
const MAX_CABIN_LENGTH = 40;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function airportCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function providerTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) return null;
  return value;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > maxLength) return null;
  if (/https?:\/\/|www\.|data:/i.test(normalized)) return null;
  if (/^[A-Za-z0-9+/=_-]{40,}$/.test(normalized.replace(/\s/g, ""))) return null;
  return normalized;
}

function explicitOperatingCarrier(value: unknown): string | null {
  return boundedText(value, MAX_CARRIER_LENGTH);
}

export function projectSerpApiFlightSegments(raw: unknown): NormalizedSerpApiFlightSegment[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SEGMENTS) return null;
  const projected: NormalizedSerpApiFlightSegment[] = [];
  for (const value of raw) {
    if (!isPlainObject(value)) return null;
    const departure = isPlainObject(value.departure_airport) ? value.departure_airport : null;
    const arrival = isPlainObject(value.arrival_airport) ? value.arrival_airport : null;
    if (!departure || !arrival) return null;
    const departureAirport = airportCode(departure.id);
    const arrivalAirport = airportCode(arrival.id);
    const departureTime = providerTimestamp(departure.time);
    const arrivalTime = providerTimestamp(arrival.time);
    if (!departureAirport || !arrivalAirport || !departureTime || !arrivalTime) return null;
    if (projected.length > 0 && projected[projected.length - 1].arrivalAirport !== departureAirport) return null;
    const travelClass = value.travel_class === undefined || value.travel_class === null
      ? null
      : boundedText(value.travel_class, MAX_CABIN_LENGTH);
    if (value.travel_class !== undefined && value.travel_class !== null && travelClass === null) return null;
    projected.push({
      sequence: projected.length + 1,
      departureAirport,
      departureTime,
      arrivalAirport,
      arrivalTime,
      marketingCarrier: boundedText(value.airline, MAX_CARRIER_LENGTH),
      marketingFlightNumber: boundedText(value.flight_number, MAX_FLIGHT_NUMBER_LENGTH),
      cabin: travelClass,
      operatingCarrier: explicitOperatingCarrier(value.operating_carrier),
    });
  }
  return projected;
}
