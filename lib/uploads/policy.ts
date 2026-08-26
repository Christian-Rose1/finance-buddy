export const MAX_RECEIPT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_STATEMENT_FILE_BYTES = 20 * 1024 * 1024;

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export function requestBodyIsTooLarge(
  contentLength: string | null,
  maxFileBytes: number
): boolean {
  if (contentLength === null) return false;

  const bytes = Number(contentLength);
  return (
    Number.isFinite(bytes) &&
    bytes > maxFileBytes + MULTIPART_OVERHEAD_BYTES
  );
}

export function normalizeOwnedStoragePath(
  value: FormDataEntryValue | null,
  userId: string
): { valid: true; path: string | null } | { valid: false; path: null } {
  if (value === null || value === "") {
    return { valid: true, path: null };
  }

  if (typeof value !== "string" || value.length > 1024) {
    return { valid: false, path: null };
  }

  const prefix = `${userId}/`;
  if (!value.startsWith(prefix)) {
    return { valid: false, path: null };
  }

  const segments = value.slice(prefix.length).split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return { valid: false, path: null };
  }

  return { valid: true, path: value };
}

/**
 * Storage paths arrive from the browser, so the analyzed bytes must be
 * compared with the private object before they become provenance.
 */
export async function storageObjectMatchesBytes(
  client: SupabaseClient,
  bucket: "receipts" | "statements",
  path: string,
  bytes: ArrayBuffer | Uint8Array
): Promise<boolean> {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) return false;

  const uploaded =
    bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (data.size !== uploaded.byteLength) return false;

  const stored = new Uint8Array(await data.arrayBuffer());
  const [uploadedDigest, storedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", uploaded as unknown as BufferSource),
    crypto.subtle.digest("SHA-256", stored as unknown as BufferSource),
  ]);
  if (uploadedDigest.byteLength !== storedDigest.byteLength) return false;
  const uploadedView = new Uint8Array(uploadedDigest);
  const storedView = new Uint8Array(storedDigest);
  return uploadedView.every((value, index) => value === storedView[index]);
}
import type { SupabaseClient } from "@supabase/supabase-js";
