import type { ParsedTransaction } from "@/lib/parser/chaseParser";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";

export class StatementTransactionConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementTransactionConversionError";
  }
}

/** Deterministically derives a stable transaction id from source-backed fields. */
export function stableStatementTransactionId(
  date: string,
  postingDate: string | null,
  merchant: string,
  amount: number,
  discriminator = ""
): string {
  const input =
    `${date}|${postingDate ?? ""}|${merchant}|${amount}|${discriminator}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `stx-${(hash >>> 0).toString(16)}`;
}

function toIsoDate(value: string, year: number): string {
  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new StatementTransactionConversionError(
      "Statement transaction date is invalid."
    );
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new StatementTransactionConversionError(
      "Statement transaction date is invalid."
    );
  }

  return `${year.toString().padStart(4, "0")}-${match[1]}-${match[2]}`;
}

function yearForStatementMonth(
  value: string,
  statementYear: number,
  statementClosingMonth?: number | null
): number {
  const month = Number(value.slice(0, 2));
  return statementClosingMonth !== undefined &&
    statementClosingMonth !== null &&
    month > statementClosingMonth
    ? statementYear - 1
    : statementYear;
}

/**
 * Maps a parsed Chase transaction (MM/DD date, no year) into the canonical
 * StatementTransaction shape with a full ISO date.
 *
 * The statement closing year MUST be passed explicitly by the caller; it is
 * never inferred from today's date or the upload date. When the closing month
 * is known, a later transaction month is assigned to the preceding year so a
 * December-to-January statement remains calendar-correct.
 */
export function toStatementTransaction(
  tx: ParsedTransaction,
  statementYear: number,
  statementClosingMonth?: number | null
): StatementTransaction {
  if (
    statementClosingMonth !== undefined &&
    statementClosingMonth !== null &&
    (!Number.isInteger(statementClosingMonth) ||
      statementClosingMonth < 1 ||
      statementClosingMonth > 12)
  ) {
    throw new StatementTransactionConversionError(
      "Statement closing month is invalid."
    );
  }

  const transactionYear = yearForStatementMonth(
    tx.date,
    statementYear,
    statementClosingMonth
  );
  const isoDate = toIsoDate(tx.date, transactionYear);
  const isoPostingDate = tx.postingDate
    ? toIsoDate(
        tx.postingDate,
        yearForStatementMonth(
          tx.postingDate,
          statementYear,
          statementClosingMonth
        )
      )
    : null;
  const merchant = tx.merchant.trim();

  if (!merchant || !Number.isFinite(tx.amount)) {
    throw new StatementTransactionConversionError(
      "Statement transaction is invalid."
    );
  }

  return {
    id: stableStatementTransactionId(
      isoDate,
      isoPostingDate,
      merchant,
      tx.amount
    ),
    date: isoDate,
    merchant,
    amount: tx.amount,
    currency: null,
    cardId: null,
    category: tx.category,
    confidence: 1,
  };
}
