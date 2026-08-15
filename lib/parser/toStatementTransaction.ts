import type { ParsedTransaction } from "@/lib/parser/chaseParser";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";

/** Deterministically derives a stable transaction id from its parsed fields. */
function stableTransactionId(
  date: string,
  merchant: string,
  amount: number
): string {
  const input = `${date}|${merchant}|${amount}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `stx-${(hash >>> 0).toString(16)}`;
}

/**
 * Maps a parsed Chase transaction (MM/DD date, no year) into the canonical
 * StatementTransaction shape with a full ISO date.
 *
 * The statement year MUST be passed explicitly by the caller — it is never
 * inferred from today's date or the upload date.
 */
export function toStatementTransaction(
  tx: ParsedTransaction,
  year: number
): StatementTransaction {
  const [month, day] = tx.date.split("/");
  const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

  return {
    id: stableTransactionId(tx.date, tx.merchant, tx.amount),
    date: isoDate,
    merchant: tx.merchant,
    amount: tx.amount,
    currency: null,
    cardId: null,
    category: tx.category,
    confidence: 1,
  };
}