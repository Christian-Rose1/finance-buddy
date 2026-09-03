import type { Goal } from "./types";
import { buildSerpApiFlightClient } from "./serpApiFlightClient";
import { buildSerpApiFlightLocationClient } from "./serpApiFlightLocationClient";
import { buildSerpApiFlightSearchLocation } from "./serpApiFlightSearchLocation";
import type { NormalizedSerpApiFlightObservation } from "./serpApiFlightNormalizer";
import type { SerpApiFlightLocationClientResult } from "./serpApiFlightLocationClient";
import type { SerpApiFlightClientResult, SerpApiFlightRequest } from "./serpApiFlightClient";

export interface FlightPlanningEstimateSegment {
  sequence: number;
  departureAirport: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
  marketingCarrier: string | null;
  marketingFlightNumber: string | null;
  cabin: string | null;
}

export const FLIGHT_PLANNING_ESTIMATE_UNKNOWNS = [
  "offer_expiry", "tax_inclusion", "operating_carrier", "current_availability",
  "bookability", "fare_expiry", "tax_breakdown",
] as const;
export type FlightPlanningEstimateUnknown = typeof FLIGHT_PLANNING_ESTIMATE_UNKNOWNS[number];

export interface FlightPlanningEstimate {
  label: "Flight planning estimate";
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  travelers: number;
  cabin: string;
  currency: string;
  total: number;
  priceCoverage: "searched_party_total";
  retrievedAt: string;
  outboundSegments: FlightPlanningEstimateSegment[];
  returnSegments: FlightPlanningEstimateSegment[];
  unknowns: FlightPlanningEstimateUnknown[];
  evidenceLabel: "Planning estimate";
  verificationLabel: "Not customer-verified";
  availabilityLabel: "Not live or bookable; verify before booking";
}

const ESTIMATE_KEYS = new Set(["label", "origin", "destination", "outboundDate", "returnDate", "travelers", "cabin", "currency", "total", "priceCoverage", "retrievedAt", "outboundSegments", "returnSegments", "unknowns", "evidenceLabel", "verificationLabel", "availabilityLabel"]);
const SEGMENT_KEYS = new Set(["sequence", "departureAirport", "departureTime", "arrivalAirport", "arrivalTime", "marketingCarrier", "marketingFlightNumber", "cabin"]);
const UNKNOWN_SET = new Set<string>(FLIGHT_PLANNING_ESTIMATE_UNKNOWNS);
const CABINS = new Set(["economy", "premium_economy", "business", "first"]);
const MAX_TOTAL = 1_000_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>) => Object.keys(value).every((key) => keys.has(key));
const calendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const dateTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) && calendarDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(`${value.replace(" ", "T")}:00Z`));
const timeValue = (value: string) => Date.parse(`${value.replace(" ", "T")}:00Z`);
const safeNullableText = (value: unknown, max: number): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || /(?:https?:\/\/|www\.|\/m\/|\/g\/|(?:provider|token|metadata|search)[_-]?id)/i.test(value)) return undefined;
  return value;
};

function projectSegments(raw: unknown, departureDate: string, requestedCabin: string): FlightPlanningEstimateSegment[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return null;
  const result: FlightPlanningEstimateSegment[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (!isRecord(value) || !onlyKeys(value, SEGMENT_KEYS) || value.sequence !== index + 1 || typeof value.departureAirport !== "string" || !/^[A-Z]{3}$/.test(value.departureAirport) || typeof value.arrivalAirport !== "string" || !/^[A-Z]{3}$/.test(value.arrivalAirport) || !dateTime(value.departureTime) || !dateTime(value.arrivalTime)) return null;
    if (index === 0 && value.departureTime.slice(0, 10) !== departureDate) return null;
    if (timeValue(value.arrivalTime) < timeValue(value.departureTime)) return null;
    if (index > 0 && (result[index - 1].arrivalAirport !== value.departureAirport || timeValue(value.departureTime) < timeValue(result[index - 1].arrivalTime))) return null;
    const marketingCarrier = safeNullableText(value.marketingCarrier, 80);
    const marketingFlightNumber = safeNullableText(value.marketingFlightNumber, 80);
    const cabin = safeNullableText(value.cabin, 30);
    if (marketingCarrier === undefined || marketingFlightNumber === undefined || cabin === undefined || (cabin !== null && cabin.toLowerCase() !== requestedCabin.toLowerCase())) return null;
    result.push({ sequence: index + 1, departureAirport: value.departureAirport, departureTime: value.departureTime, arrivalAirport: value.arrivalAirport, arrivalTime: value.arrivalTime, marketingCarrier, marketingFlightNumber, cabin });
  }
  return result;
}

function projectFlightPlanningEstimateUnsafe(raw: unknown): FlightPlanningEstimate | null {
  if (!isRecord(raw) || !onlyKeys(raw, ESTIMATE_KEYS) || raw.label !== "Flight planning estimate" || raw.evidenceLabel !== "Planning estimate" || raw.verificationLabel !== "Not customer-verified" || raw.availabilityLabel !== "Not live or bookable; verify before booking") return null;
  if (typeof raw.origin !== "string" || !/^[A-Z]{3}$/.test(raw.origin) || typeof raw.destination !== "string" || !/^[A-Z]{3}$/.test(raw.destination) || raw.origin === raw.destination || !calendarDate(raw.outboundDate) || !calendarDate(raw.returnDate) || raw.returnDate < raw.outboundDate) return null;
  const travelers = raw.travelers;
  if (typeof travelers !== "number" || !Number.isInteger(travelers) || travelers < 1 || travelers > 9 || typeof raw.total !== "number" || !Number.isFinite(raw.total) || raw.total < 0 || raw.total > MAX_TOTAL || raw.priceCoverage !== "searched_party_total" || typeof raw.cabin !== "string" || !CABINS.has(raw.cabin) || typeof raw.currency !== "string" || !/^[A-Z]{3}$/.test(raw.currency) || typeof raw.retrievedAt !== "string" || Number.isNaN(Date.parse(raw.retrievedAt))) return null;
  const outboundSegments = projectSegments(raw.outboundSegments, raw.outboundDate, raw.cabin);
  const returnSegments = projectSegments(raw.returnSegments, raw.returnDate, raw.cabin);
  if (!outboundSegments || !returnSegments || outboundSegments[0].departureAirport !== raw.origin || outboundSegments.at(-1)?.arrivalAirport !== raw.destination || returnSegments[0].departureAirport !== raw.destination || returnSegments.at(-1)?.arrivalAirport !== raw.origin) return null;
  if (timeValue(returnSegments[0].departureTime) < timeValue(outboundSegments[outboundSegments.length - 1].arrivalTime)) return null;
  if (!Array.isArray(raw.unknowns) || raw.unknowns.length > FLIGHT_PLANNING_ESTIMATE_UNKNOWNS.length || raw.unknowns.some((value) => typeof value !== "string" || !UNKNOWN_SET.has(value)) || new Set(raw.unknowns).size !== raw.unknowns.length) return null;
  const selected = new Set<string>();
  for (const value of raw.unknowns) {
    if (typeof value !== "string") return null;
    selected.add(value);
  }
  const unknowns = FLIGHT_PLANNING_ESTIMATE_UNKNOWNS.filter((value) => selected.has(value));
  return { label: "Flight planning estimate", origin: raw.origin, destination: raw.destination, outboundDate: raw.outboundDate, returnDate: raw.returnDate, travelers, cabin: raw.cabin, currency: raw.currency, total: raw.total, priceCoverage: "searched_party_total", retrievedAt: raw.retrievedAt, outboundSegments, returnSegments, unknowns, evidenceLabel: "Planning estimate", verificationLabel: "Not customer-verified", availabilityLabel: "Not live or bookable; verify before booking" };
}

/** Strictly reconstructs untrusted data and safely omits every hostile shape. */
export function projectFlightPlanningEstimate(raw: unknown): FlightPlanningEstimate | null {
  try {
    return projectFlightPlanningEstimateUnsafe(raw);
  } catch {
    return null;
  }
}

export interface FlightPlanningEstimateDependencies {
  resolveLocation: (value: unknown) => Promise<SerpApiFlightLocationClientResult>;
  fetchFlight: (value: SerpApiFlightRequest) => Promise<SerpApiFlightClientResult>;
}

function segment(value: NormalizedSerpApiFlightObservation["outboundSegments"][number]): FlightPlanningEstimateSegment {
  return {
    sequence: value.sequence,
    departureAirport: value.departureAirport,
    departureTime: value.departureTime,
    arrivalAirport: value.arrivalAirport,
    arrivalTime: value.arrivalTime,
    marketingCarrier: value.marketingCarrier,
    marketingFlightNumber: value.marketingFlightNumber,
    cabin: value.cabin,
  };
}

export async function buildFlightPlanningEstimate(
  goal: Goal,
  dependencies: FlightPlanningEstimateDependencies = {
    resolveLocation: buildSerpApiFlightLocationClient(process.env.SERPAPI_API_KEY ?? "").resolveLocation,
    fetchFlight: buildSerpApiFlightClient(process.env.SERPAPI_API_KEY ?? "").fetchFlight,
  },
): Promise<FlightPlanningEstimate | null> {
  try {
    if (goal.origin.length !== 1 || goal.destinations.length !== 1 || !goal.earliestDeparture || !goal.latestReturn || goal.cabinPreference === "flexible") return null;
    const [originResult, destinationResult] = await Promise.all([
      dependencies.resolveLocation(goal.origin[0]),
      dependencies.resolveLocation(goal.destinations[0]),
    ]);
    if (!originResult.projection || originResult.projection.status !== "resolved" || !destinationResult.projection || destinationResult.projection.status !== "resolved") return null;
    const origin = buildSerpApiFlightSearchLocation(originResult.projection);
    const destination = buildSerpApiFlightSearchLocation(destinationResult.projection);
    if (!origin || !destination) return null;
    const result = await dependencies.fetchFlight({ origin, destination, outboundDate: goal.earliestDeparture, returnDate: goal.latestReturn, travelers: goal.travelerCount, cabin: goal.cabinPreference, currency: goal.currency });
    if (!result.observation || result.error) return null;
    const observation = result.observation;
    return projectFlightPlanningEstimate({
    label: "Flight planning estimate",
    origin: observation.origin,
    destination: observation.destination,
    outboundDate: observation.outboundDate,
    returnDate: observation.returnDate,
    travelers: observation.travelers,
    cabin: observation.cabin,
    currency: observation.currency,
    total: observation.price.amount,
    priceCoverage: observation.priceCoverage,
    retrievedAt: observation.retrievedAt,
    outboundSegments: observation.outboundSegments.map(segment),
    returnSegments: observation.returnSegments.map(segment),
    unknowns: [...observation.unknowns, "current_availability", "bookability", "fare_expiry", "tax_breakdown"],
    evidenceLabel: "Planning estimate",
    verificationLabel: "Not customer-verified",
    availabilityLabel: "Not live or bookable; verify before booking",
    });
  } catch {
    return null;
  }
}
