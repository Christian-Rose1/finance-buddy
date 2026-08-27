export type StrategyTimestampState = string | null;

export type StrategyTimestampEvent =
  | { type: "refresh_started" }
  | { type: "refresh_failed" }
  | { type: "finalization_succeeded"; generatedAt: unknown };

export function normalizePersistedStrategyTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function formatPersistedStrategyTimestamp(value: unknown): { iso: string; label: string } | null {
  const iso = normalizePersistedStrategyTimestamp(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour = parsed.getUTCHours();
  const minute = String(parsed.getUTCMinutes()).padStart(2, "0");
  const hour12 = hour % 12 || 12;
  const meridiem = hour < 12 ? "AM" : "PM";
  return {
    iso,
    label: `${months[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()} at ${hour12}:${minute} ${meridiem} UTC`,
  };
}

export function transitionStrategyTimestamp(
  current: StrategyTimestampState,
  event: StrategyTimestampEvent,
): StrategyTimestampState {
  if (event.type === "finalization_succeeded") {
    return normalizePersistedStrategyTimestamp(event.generatedAt);
  }
  return current;
}
