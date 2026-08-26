/**
 * Extraction-provider abstraction for the receipt-intelligence pipeline.
 *
 * Defines the contract that any local or hosted vision/OCR model provider
 * must implement (e.g. Ollama, a hosted API, a future fine-tuned model).
 * The rest of the application depends only on this interface, so providers
 * can be swapped without changing application code.
 */

import type { ReceiptExtraction } from "./types";

/**
 * Model-agnostic receipt input: the raw file bytes plus identifying metadata.
 * Works for receipt images (JPEG/PNG/WebP) and text-based receipt PDFs.
 */
export interface ReceiptInput {
  /**
   * Raw file bytes. Use a `Uint8Array` (or `Buffer`, which extends it)
   * for both images and PDFs.
   */
  data: ArrayBuffer | Uint8Array;

  /**
   * MIME type of the file. One of:
   * - `image/jpeg`
   * - `image/png`
   * - `image/webp`
   * - `application/pdf`
   */
  mimeType: string;

  /** Original filename, when available. Providers must not send or log it. */
  filename?: string | null;
}

/** Optional per-call controls for a provider. */
export interface ReceiptExtractionOptions {
  /** Abort signal to cancel a long-running extraction. */
  signal?: AbortSignal;

  /** Requested timeout in milliseconds (provider-dependent). */
  timeoutMs?: number;
}

/**
 * A provider that extracts structured receipt data from raw input.
 *
 * Implementations translate provider-specific results (vision model output,
 * OCR text, etc.) into the canonical `ReceiptExtraction` type. The
 * application never sees provider internals.
 */
export interface ReceiptExtractionProvider {
  /**
   * Stable identifier for this provider, e.g. `"ollama"` or `"openai-vision"`.
   * Used for logging and for the `ReceiptExtraction.source` field.
   */
  readonly name: string;

  /**
   * Extracts structured receipt data from the provided input.
   *
   * @param input - The receipt file (image or PDF) to extract.
   * @param options - Optional per-call controls (abort, timeout).
   * @returns A canonical `ReceiptExtraction`.
   *
   * Note: implementations should produce data that satisfies
   * `validateReceiptExtraction` from `./schema`. Callers may validate
   * the result before persisting or displaying it.
   */
  extractReceipt(
    input: ReceiptInput,
    options?: ReceiptExtractionOptions
  ): Promise<ReceiptExtraction>;
}
