import type { ReceiptExtraction, ReceiptItem } from "./types";

export class ReceiptValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = "ReceiptValidationError";
  }
}

export type ReceiptValidationResult =
  | {
      success: true;
      data: ReceiptExtraction;
    }
  | {
      success: false;
      error: ReceiptValidationError;
    };

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function isNullableString(
  value: unknown
): value is string | null {
  return (
    value === null ||
    typeof value === "string"
  );
}

function isNullableNonNegativeNumber(
  value: unknown
): value is number | null {
  return (
    value === null ||
    (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
    )
  );
}

function isConfidence(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isCurrency(
  value: unknown
): value is string | null {
  return (
    value === null ||
    (
      typeof value === "string" &&
      /^[A-Z]{3}$/.test(value)
    )
  );
}

function isIsoDate(
  value: unknown
): value is string | null {
  if (value === null) {
    return true;
  }

  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  );
}

function validateItem(
  value: unknown,
  index: number
): ReceiptValidationError | null {
  const path = `items[${index}]`;

  if (!isObject(value)) {
    return new ReceiptValidationError(
      "Item must be an object.",
      path
    );
  }

  if (!isNullableString(value.name)) {
    return new ReceiptValidationError(
      "name must be a string or null.",
      `${path}.name`
    );
  }

  if (!isNullableNonNegativeNumber(value.quantity)) {
    return new ReceiptValidationError(
      "quantity must be a non-negative number or null.",
      `${path}.quantity`
    );
  }

  if (!isNullableNonNegativeNumber(value.unit_price)) {
    return new ReceiptValidationError(
      "unit_price must be a non-negative number or null.",
      `${path}.unit_price`
    );
  }

  if (!isNullableNonNegativeNumber(value.total)) {
    return new ReceiptValidationError(
      "total must be a non-negative number or null.",
      `${path}.total`
    );
  }

  if (!isNullableNonNegativeNumber(value.discount)) {
    return new ReceiptValidationError(
      "discount must be a non-negative number or null.",
      `${path}.discount`
    );
  }

  if (!isNullableString(value.category)) {
    return new ReceiptValidationError(
      "category must be a string or null.",
      `${path}.category`
    );
  }

  if (!isConfidence(value.confidence)) {
    return new ReceiptValidationError(
      "confidence must be a number between 0 and 1.",
      `${path}.confidence`
    );
  }

  return null;
}

export function validateReceiptExtraction(
  value: unknown
): ReceiptValidationResult {
  if (!isObject(value)) {
    return {
      success: false,
      error: new ReceiptValidationError(
        "Receipt extraction must be an object.",
        "$"
      ),
    };
  }

  if (!isNullableString(value.merchant)) {
    return {
      success: false,
      error: new ReceiptValidationError(
        "merchant must be a string or null.",
        "merchant"
      ),
    };
  }

  if (!isIsoDate(value.transaction_date)) {
    return {
      success: false,
      error: new ReceiptValidationError(
        "transaction_date must be YYYY-MM-DD or null.",
        "transaction_date"
      ),
    };
  }

  if (!isCurrency(value.currency)) {
    return {
      success: false,
      error: new ReceiptValidationError(
        "currency must be a 3-letter uppercase code or null.",
        "currency"
      ),
    };
  }

  if (!Array.isArray(value.items)) {
    return {
      success: false,
      error: new ReceiptValidationError(
        "items must be an array.",
        "items"
      ),
    };
  }

  for (
    let index = 0;
    index < value.items.length;
    index += 1
  ) {
    const itemError = validateItem(
      value.items[index],
      index
    );

    if (itemError !== null) {
      return {
        success: false,
        error: itemError,
      };
    }
  }

  const moneyFields = [
    "subtotal",
    "tax",
    "tip",
    "discount",
    "total",
  ] as const;

  for (const field of moneyFields) {
    if (
      !isNullableNonNegativeNumber(
        value[field]
      )
    ) {
      return {
        success: false,
        error: new ReceiptValidationError(
          `${field} must be a non-negative number or null.`,
          field
        ),
      };
    }
  }

  if (!isConfidence(value.confidence)) {
    return {
      success: false,
      error: new ReceiptValidationError(
        "confidence must be a number between 0 and 1.",
        "confidence"
      ),
    };
  }

  if (
    typeof value.source !== "string" ||
    value.source.trim().length === 0
  ) {
    return {
      success: false,
      error: new ReceiptValidationError(
        "source must be a non-empty string.",
        "source"
      ),
    };
  }

  const items: ReceiptItem[] =
    value.items.map(
      (item) => item as ReceiptItem
    );

  return {
    success: true,
    data: {
      merchant: value.merchant,
      transaction_date:
        value.transaction_date,
      currency: value.currency,
      items,
      subtotal:
        value.subtotal as number | null,
      tax: value.tax as number | null,
      tip: value.tip as number | null,
      discount:
        value.discount as number | null,
      total:
        value.total as number | null,
      confidence:
        value.confidence as number,
      source: value.source as string,
    },
  };
}