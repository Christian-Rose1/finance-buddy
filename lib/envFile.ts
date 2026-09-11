/**
 * Server-side `.env.local` loading for standalone scripts.
 *
 * Next.js loads `.env.local` automatically for the app, but standalone tsx
 * scripts do not inherit that behavior. This module provides a minimal,
 * bounded, secret-safe loader so scripts can use the same local configuration
 * the app uses, without adding a dependency.
 *
 * Safety rules:
 * - Values are never logged, echoed, or included in errors. The only signal
 *   callers get is a count of newly-set entries.
 * - Existing `process.env` entries always win; the loader never overrides
 *   them, so an explicitly provided shell variable keeps precedence.
 * - Inputs are bounded (file size, line length) to reject pathological files.
 * - A missing or unreadable file is NOT an error: scripts may legitimately
 *   run with a shell-provided environment and no `.env.local` at all.
 * - Parsing follows common dotenv conventions: `KEY=VALUE` per line, optional
 *   `export ` prefix, surrounding quotes stripped, whitespace-prefixed inline
 *   comments stripped for unquoted values, BOM tolerated.
 */

import { readFileSync, statSync } from "node:fs";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINE_LENGTH = 4096;

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ParsedEnvEntry {
  key: string;
  value: string;
}

/**
 * Normalizes a raw value: strips surrounding quotes (keeping everything
 * inside them, including comment markers), or strips a whitespace-prefixed
 * inline comment for unquoted values. Never throws; never echoes input.
 */
function normalizeValue(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed[0];
  if (
    (first === '"' || first === "'") &&
    trimmed.length >= 2 &&
    trimmed.endsWith(first)
  ) {
    return trimmed.slice(1, -1);
  }
  const commentAt = trimmed.indexOf(" #");
  const withoutComment = commentAt === -1 ? trimmed : trimmed.slice(0, commentAt);
  return withoutComment.trim();
}

/**
 * Parses env-file text into entries. Malformed lines are skipped, never
 * thrown; oversized input yields no entries. Pure: no filesystem or
 * environment access, no logging.
 */
export function parseEnvFile(text: string): ParsedEnvEntry[] {
  if (typeof text !== "string" || text.length > MAX_FILE_BYTES) return [];
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const entries: ParsedEnvEntry[] = [];
  for (const rawLine of withoutBom.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.length > MAX_LINE_LENGTH) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith("export ")) {
      key = key.slice("export ".length).trim();
    }
    if (!KEY_PATTERN.test(key)) continue;
    const value = normalizeValue(line.slice(eq + 1));
    entries.push({ key, value });
  }
  return entries;
}

/**
 * Loads an env file into `process.env`, skipping entries that already exist.
 * Returns the number of newly-set entries. A missing, unreadable, oversized,
 * or non-regular file contributes zero entries and never throws. Values are
 * never logged or exposed.
 */
export function loadEnvFileIntoProcess(filePath: string): number {
  let size: number;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return 0;
    size = stat.size;
  } catch {
    return 0;
  }
  if (size > MAX_FILE_BYTES) return 0;

  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return 0;
  }

  let loaded = 0;
  for (const { key, value } of parseEnvFile(text)) {
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded += 1;
  }
  return loaded;
}
