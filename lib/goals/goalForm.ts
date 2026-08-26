import type {
  CabinPreference,
  GoalStatus,
  OptimizationPriority,
} from "./types";
import type { CreateGoalInput, UpdateGoalInput } from "./repository";

const MAX_TITLE_LENGTH = 100;
const MAX_LOCATIONS = 10;
const MAX_LOCATION_LENGTH = 100;
const MAX_TRAVELERS = 50;
const MAX_NIGHTS = 365;
const MAX_CASH_BUDGET = 9_999_999_999.99;

const CABIN_PREFERENCES: CabinPreference[] = [
  "economy",
  "premium_economy",
  "business",
  "first",
  "flexible",
];

const OPTIMIZATION_PRIORITIES: OptimizationPriority[] = [
  "lowest_cash",
  "best_experience",
  "simplest",
  "balanced",
];

const GOAL_STATUSES: GoalStatus[] = [
  "draft",
  "active",
  "paused",
  "completed",
];

export type GoalFormValidationResult =
  | { valid: true; data: CreateGoalInput | UpdateGoalInput }
  | { valid: false; error: string };

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseLocations(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    )
  );
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalPositiveInteger(
  value: string,
  label: string
): { value: number | null; error?: string } {
  if (!value) return { value: null };

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_NIGHTS) {
    return {
      value: null,
      error: `${label} must be a whole number between 1 and ${MAX_NIGHTS}.`,
    };
  }

  return { value: parsed };
}

export function validateGoalFormData(
  formData: FormData,
  mode: "create" | "update"
): GoalFormValidationResult {
  const title = textValue(formData, "title");
  if (!title) {
    return { valid: false, error: "Title is required." };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return {
      valid: false,
      error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
    };
  }

  const origin = parseLocations(textValue(formData, "origins"));
  if (origin.length === 0) {
    return { valid: false, error: "At least one origin is required." };
  }

  const destinations = parseLocations(textValue(formData, "destinations"));
  if (destinations.length === 0) {
    return { valid: false, error: "At least one destination is required." };
  }

  if (origin.length > MAX_LOCATIONS || destinations.length > MAX_LOCATIONS) {
    return {
      valid: false,
      error: `Use no more than ${MAX_LOCATIONS} origins or destinations.`,
    };
  }

  if (
    [...origin, ...destinations].some(
      (location) => location.length > MAX_LOCATION_LENGTH
    )
  ) {
    return {
      valid: false,
      error: `Each location must be ${MAX_LOCATION_LENGTH} characters or fewer.`,
    };
  }

  const travelerCount = Number(textValue(formData, "travelerCount"));
  if (
    !Number.isInteger(travelerCount) ||
    travelerCount <= 0 ||
    travelerCount > MAX_TRAVELERS
  ) {
    return {
      valid: false,
      error: `Traveler count must be a whole number between 1 and ${MAX_TRAVELERS}.`,
    };
  }

  const minimumNightsResult = optionalPositiveInteger(
    textValue(formData, "minimumNights"),
    "Minimum nights"
  );
  if (minimumNightsResult.error) {
    return { valid: false, error: minimumNightsResult.error };
  }

  const maximumNightsResult = optionalPositiveInteger(
    textValue(formData, "maximumNights"),
    "Maximum nights"
  );
  if (maximumNightsResult.error) {
    return { valid: false, error: maximumNightsResult.error };
  }

  const minimumNights = minimumNightsResult.value;
  const maximumNights = maximumNightsResult.value;
  if (
    minimumNights !== null &&
    maximumNights !== null &&
    maximumNights < minimumNights
  ) {
    return {
      valid: false,
      error: "Maximum nights cannot be less than minimum nights.",
    };
  }

  const maximumCashBudgetRaw = textValue(formData, "maximumCashBudget");
  let maximumCashBudget: number | null = null;
  if (maximumCashBudgetRaw) {
    maximumCashBudget = Number(maximumCashBudgetRaw);
    if (
      !Number.isFinite(maximumCashBudget) ||
      maximumCashBudget < 0 ||
      maximumCashBudget > MAX_CASH_BUDGET
    ) {
      return {
        valid: false,
        error: "Maximum cash budget must be a valid non-negative USD amount.",
      };
    }
  }

  const earliestDepartureRaw = textValue(formData, "earliestDeparture");
  const latestReturnRaw = textValue(formData, "latestReturn");
  if (earliestDepartureRaw && !validDate(earliestDepartureRaw)) {
    return {
      valid: false,
      error: "Earliest departure must be a valid date.",
    };
  }
  if (latestReturnRaw && !validDate(latestReturnRaw)) {
    return { valid: false, error: "Latest return must be a valid date." };
  }
  if (
    earliestDepartureRaw &&
    latestReturnRaw &&
    latestReturnRaw < earliestDepartureRaw
  ) {
    return {
      valid: false,
      error: "Latest return cannot be before earliest departure.",
    };
  }

  const cabinPreference = textValue(formData, "cabinPreference") as CabinPreference;
  if (!CABIN_PREFERENCES.includes(cabinPreference)) {
    return { valid: false, error: "Invalid cabin preference." };
  }

  const optimizationPriority = textValue(
    formData,
    "optimizationPriority"
  ) as OptimizationPriority;
  if (!OPTIMIZATION_PRIORITIES.includes(optimizationPriority)) {
    return { valid: false, error: "Invalid optimization priority." };
  }

  const status =
    mode === "update"
      ? (textValue(formData, "status") as GoalStatus)
      : "draft";
  if (!GOAL_STATUSES.includes(status)) {
    return { valid: false, error: "Invalid goal status." };
  }

  return {
    valid: true,
    data: {
      title,
      status,
      origin,
      destinations,
      earliestDeparture: earliestDepartureRaw || null,
      latestReturn: latestReturnRaw || null,
      minimumNights,
      maximumNights,
      travelerCount,
      cabinPreference,
      optimizationPriority,
      maximumCashBudget,
      currency: "USD",
      allowNewCards: formData.get("allowNewCards") === "on",
    },
  };
}
