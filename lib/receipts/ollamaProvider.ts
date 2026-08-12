/**
 * Ollama receipt extraction provider.
 *
 * Server-side only.
 *
 * Supported inputs:
 * - image/jpeg
 * - image/png
 * - image/webp
 */

import type {
  ReceiptExtractionOptions,
  ReceiptExtractionProvider,
  ReceiptInput,
} from "./provider";
import type {
  ReceiptExtraction,
  ReceiptItem,
} from "./types";
import { validateReceiptExtraction } from "./schema";

const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const DEFAULT_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_SNIPPET_LENGTH = 300;

export class ReceiptExtractionError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly model: string,
    readonly status?: number,
    readonly details?: string
  ) {
    super(message);
    this.name = "ReceiptExtractionError";
  }
}

function parseModelResponse(
  raw: string,
  model: string
): unknown {
  const trimmed = raw.trim();

  const fencedMatch = trimmed.match(
    /```(?:json)?\s*([\s\S]*?)```/
  );

  const candidate = fencedMatch
    ? fencedMatch[1].trim()
    : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace > firstBrace
    ) {
      try {
        return JSON.parse(
          candidate.slice(firstBrace, lastBrace + 1)
        );
      } catch {
        // Fall through.
      }
    }
  }

  throw new ReceiptExtractionError(
    "Ollama model did not return valid JSON. See details for a truncated response.",
    "ollama",
    model,
    undefined,
    `Response (truncated to ${DIAGNOSTIC_SNIPPET_LENGTH} chars): ${trimmed.slice(
      0,
      DIAGNOSTIC_SNIPPET_LENGTH
    )}`
  );
}

function normalizeDate(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(
    /^(\d{2})\/(\d{2})\/(\d{2})$/
  );

  if (!match) {
    return null;
  }

  const [, month, day, year] = match;

  const numericYear = Number(year);

  const fullYear =
    numericYear >= 70
      ? 1900 + numericYear
      : 2000 + numericYear;

  return `${fullYear.toString().padStart(4, "0")}-${month}-${day}`;
}

function normalizeNumber(
  value: unknown
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  return value;
}

function isDiscountItemName(
  name: string | null
): boolean {
  if (!name) {
    return false;
  }

  return /coupon|discount|promo|promotion|savings|markdown|rebate|instant savings/i.test(
    name
  );
}

function normalizeItem(
  item: unknown
): {
  item: ReceiptItem | null;
  discount: number;
} {
  if (!item || typeof item !== "object") {
    return {
      item: null,
      discount: 0,
    };
  }

  const source = item as Record<string, unknown>;

  const name =
    typeof source.name === "string"
      ? source.name.trim() || null
      : null;

  const price =
    normalizeNumber(source.price) ??
    normalizeNumber(source.unit_price);

  let quantity =
    typeof source.quantity === "number" &&
    Number.isFinite(source.quantity) &&
    source.quantity >= 0
      ? source.quantity
      : null;

  const explicitTotal =
    normalizeNumber(source.total);

  let discount = 0;

  /*
   * Coupons and discount lines are not products.
   * Capture their value as a receipt-level discount instead.
   */
  if (isDiscountItemName(name)) {
    if (price !== null) {
      discount = Math.abs(price);
    }

    return {
      item: null,
      discount,
    };
  }

  /*
   * Most receipt models omit quantity.
   * If a normal positive-priced item has no quantity,
   * treat it as one item.
   */
  if (
    quantity === null &&
    price !== null
  ) {
    quantity = 1;
  }

  const total =
    explicitTotal ??
    (
      price !== null &&
      quantity !== null
        ? price * quantity
        : price
    );

  const confidence =
    typeof source.confidence === "number" &&
    Number.isFinite(source.confidence) &&
    source.confidence >= 0 &&
    source.confidence <= 1
      ? source.confidence
      : 0.8;

  return {
    item: {
      name,
      quantity,
      unit_price: price,
      total,
      discount: null,
      category:
        typeof source.category === "string"
          ? source.category
          : null,
      confidence,
    },
    discount: 0,
  };
}

function normalizeModelOutput(
  value: unknown
): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const source =
    value as Record<string, unknown>;

  const rawItems = Array.isArray(source.items)
    ? source.items
    : [];

  const normalizedItems: ReceiptItem[] = [];

  let discoveredItemDiscount = 0;

  for (const rawItem of rawItems) {
    const normalized =
      normalizeItem(rawItem);

    if (normalized.item) {
      normalizedItems.push(
        normalized.item
      );
    }

    discoveredItemDiscount +=
      normalized.discount;
  }

  const modelDiscount =
    normalizeNumber(source.discount);

  const discount =
    modelDiscount !== null
      ? Math.abs(modelDiscount)
      : discoveredItemDiscount > 0
        ? discoveredItemDiscount
        : null;

  const confidence =
    typeof source.confidence === "number" &&
    Number.isFinite(source.confidence) &&
    source.confidence >= 0 &&
    source.confidence <= 1
      ? source.confidence
      : 0.8;

  return {
    merchant:
      typeof source.merchant === "string"
        ? source.merchant.trim() || null
        : null,

    transaction_date:
      normalizeDate(
        source.transaction_date
      ),

    currency:
      typeof source.currency === "string"
        ? source.currency
            .trim()
            .toUpperCase() || null
        : null,

    items: normalizedItems,

    subtotal:
      normalizeNumber(source.subtotal),

    tax:
      normalizeNumber(source.tax),

    tip:
      normalizeNumber(source.tip),

    discount,

    total:
      normalizeNumber(source.total),

    confidence,

    source: "ollama",
  };
}

const EXTRACTION_PROMPT = `Read this receipt and return ONLY valid JSON.

Use exactly these top-level fields:

merchant
transaction_date
currency
items
subtotal
tax
tip
discount
total
confidence
source

Each item should contain:

name
price
quantity

Rules:
- Extract every purchased product you can read.
- Do not treat coupons, promotions, discounts, or savings as products.
- Put the total value of discounts already applied on the receipt in "discount".
- transaction_date should be the receipt date.
- currency should be a 3-letter code when identifiable.
- quantity should be positive for purchased items.
- Use null when a value cannot be determined.
- source must be "ollama".
- Output JSON only.
- Do not explain anything.`;

export class OllamaReceiptExtractionProvider
  implements ReceiptExtractionProvider
{
  readonly name = "ollama" as const;

  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    baseUrl?: string,
    model?: string
  ) {
    if (
      typeof process === "undefined" ||
      !process.env
    ) {
      throw new ReceiptExtractionError(
        "Ollama provider can only run in a server environment.",
        "ollama",
        model ?? "unknown"
      );
    }

    this.baseUrl = (
      baseUrl ??
      process.env.OLLAMA_BASE_URL ??
      ""
    ).replace(/\/+$/, "");

    this.model =
      model ??
      process.env.OLLAMA_RECEIPT_MODEL ??
      "";

    if (!this.baseUrl) {
      throw new ReceiptExtractionError(
        "OLLAMA_BASE_URL environment variable is required.",
        "ollama",
        this.model || "unknown"
      );
    }

    if (!this.model) {
      throw new ReceiptExtractionError(
        "OLLAMA_RECEIPT_MODEL environment variable is required.",
        "ollama",
        "unknown"
      );
    }
  }

  async extractReceipt(
    input: ReceiptInput,
    options?: ReceiptExtractionOptions
  ): Promise<ReceiptExtraction> {
    if (
      !SUPPORTED_IMAGE_TYPES.includes(
        input.mimeType
      )
    ) {
      throw new ReceiptExtractionError(
        `Unsupported receipt type: ${input.mimeType}`,
        "ollama",
        this.model
      );
    }

    const imageBase64 =
      Buffer.from(
        input.data instanceof Uint8Array
          ? input.data
          : new Uint8Array(input.data)
      ).toString("base64");

    const controller =
      new AbortController();

    const timeoutMs =
      options?.timeoutMs ??
      DEFAULT_TIMEOUT_MS;

    const timeoutId = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    const onCallerAbort = () =>
      controller.abort();

    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);

        throw new ReceiptExtractionError(
          "Extraction aborted by caller.",
          "ollama",
          this.model
        );
      }

      options.signal.addEventListener(
        "abort",
        onCallerAbort,
        { once: true }
      );
    }

    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.model,

            messages: [
              {
                role: "user",
                content:
                  EXTRACTION_PROMPT,
                images: [
                  imageBase64,
                ],
              },
            ],

            stream: false,
            format: "json",
            think: false,

            options: {
              temperature: 0,
              num_predict: 1024,
              num_ctx: 8192,
            },
          }),
        }
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ReceiptExtractionError(
          `Ollama extraction ${
            options?.timeoutMs
              ? "timed out"
              : "was aborted"
          } after ${
            options?.timeoutMs ??
            DEFAULT_TIMEOUT_MS
          }ms.`,
          "ollama",
          this.model
        );
      }

      throw new ReceiptExtractionError(
        `Failed to reach Ollama at ${this.baseUrl}. ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
        "ollama",
        this.model
      );
    } finally {
      clearTimeout(timeoutId);

      options?.signal?.removeEventListener(
        "abort",
        onCallerAbort
      );
    }

    if (!response.ok) {
      throw new ReceiptExtractionError(
        `Ollama returned HTTP ${response.status}.`,
        "ollama",
        this.model,
        response.status
      );
    }

    let payload: {
      message?: {
        content?: unknown;
      };
    };

    try {
      payload =
        await response.json();
    } catch {
      throw new ReceiptExtractionError(
        "Ollama returned a non-JSON response.",
        "ollama",
        this.model,
        response.status
      );
    }

    const rawText =
      typeof payload.message?.content ===
      "string"
        ? payload.message.content.trim()
        : "";

    if (!rawText) {
      throw new ReceiptExtractionError(
        "Ollama response was missing the model text output.",
        "ollama",
        this.model,
        response.status
      );
    }

    const parsed =
      parseModelResponse(
        rawText,
        this.model
      );

    const normalized =
      normalizeModelOutput(parsed);

    const result =
      validateReceiptExtraction(
        normalized
      );

    if (!result.success) {
      const keys =
        typeof normalized ===
          "object" &&
        normalized !== null
          ? Object.keys(
              normalized
            )
          : [];

      throw new ReceiptExtractionError(
        `Model output failed receipt validation at "${result.error.path}": ${result.error.message}. ` +
          `Top-level fields returned: ${
            keys.join(", ") ||
            "(none)"
          }.`,
        "ollama",
        this.model,
        response.status,
        `Model response (truncated to ${DIAGNOSTIC_SNIPPET_LENGTH} chars): ${rawText.slice(
          0,
          DIAGNOSTIC_SNIPPET_LENGTH
        )}`
      );
    }

    return {
      ...result.data,
      source: "ollama",
    };
  }
}