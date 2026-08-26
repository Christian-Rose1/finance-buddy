import { categorizeMerchant } from "@/lib/parser/chaseParser";
import type { ParsedTransaction } from "@/lib/parser/chaseParser";

/**
 * Generic card-statement CSV parser.
 *
 * Parses a bank/card activity CSV export of any common format by detecting
 * the columns from the header row instead of hard-coding a per-issuer layout.
 * Verified against real Chase ("Download activity") and Apple Card
 * ("Apple Card Transactions") exports.
 *
 * Column detection (case-insensitive):
 * - date:      "Transaction Date", "Posting Date", "Posted Date", "Date", …
 *              (falls back to any *date* header except "Clearing Date")
 * - merchant:  "Merchant" or "Payee", falling back to "Description"/"Memo"
 * - amount:    any header starting with "Amount" (e.g. "Amount (USD)")
 * - type:      "Type" / "Transaction Type"
 * - indicator: "Details" or "Debit/Credit" (an explicit DEBIT/CREDIT column)
 *
 * Conventions:
 * - Dates may be MM/DD/YYYY, MM/DD/YY, or YYYY-MM-DD. Every row keeps its
 *   own year, so exports spanning year boundaries parse correctly.
 * - Rows whose Type marks account maintenance (payments, fees, interest,
 *   adjustments, cash advances, checks, and issuer-specific noise such as
 *   Apple Card "Debit" Daily-Cash adjustments or "Other" ACH deposits) are
 *   skipped. Purchase-like rows ("Sale", "Purchase", "Credit", "Pending *")
 *   are kept; refunds/credits are kept as negative amounts.
 * - Sign normalization: when an explicit DEBIT/CREDIT indicator column
 *   exists (Chase), debits become positive purchases and credits become
 *   negative. Without one (Apple Card and most exports), amounts are taken
 *   as-is, which already follows the statement convention: purchases
 *   positive, refunds negative.
 * - categorizeMerchant provides the same deterministic category vocabulary
 *   as the PDF path, regardless of issuer. Issuer-provided category columns
 *   are intentionally ignored to keep one consistent vocabulary downstream.
 */

export type ParsedCsvTransaction = ParsedTransaction & {
  year: number;
};

/**
 * Row types that represent account maintenance rather than purchases.
 * "Debit" and "Other" are skipped because the issuers verified so far use
 * them for Daily-Cash adjustments and ACH deposits, never purchases.
 */
const NON_PURCHASE_TYPES =
  /^(payment|fee|interest|adjustment|balance transfer|cash advance|check|debit|other)$/i;

const DATE_HEADER_CANDIDATES = [
  "transaction date",
  "posting date",
  "posted date",
  "post date",
  "trans date",
  "transaction posted date",
  "date",
];

const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * Splits CSV text into rows of fields, honoring RFC 4180 quoting:
 * quoted fields may contain commas, newlines, and escaped quotes ("").
 */
export function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Maps a header row to column indexes, matched case-insensitively. */
function findColumns(header: string[]) {
  const cells = header.map((cell) => cell.trim().toLowerCase());
  const exact = (...names: string[]): number =>
    cells.findIndex((cell) => names.includes(cell));

  let date = exact(...DATE_HEADER_CANDIDATES);
  if (date === -1) {
    // Fallback: any date-like header, but never a clearing/posted-settlement
    // date when a transaction date is what purchases are dated by.
    date = cells.findIndex(
      (cell) => cell.includes("date") && !cell.includes("clearing")
    );
  }

  return {
    date,
    merchant: exact("merchant", "payee"),
    description: exact("description", "memo"),
    amount: cells.findIndex((cell) => cell.startsWith("amount")),
    type: exact("type", "transaction type"),
    indicator: exact("details", "debit/credit"),
  };
}

/** Parses MM/DD/YYYY, MM/DD/YY, or YYYY-MM-DD into date parts. */
export function parseCsvDate(
  value: string
): { month: number; day: number; year: number } | null {
  const trimmed = value.trim();

  let month: number;
  let day: number;
  let yearText: string;

  const slash = trimmed.match(SLASH_DATE_RE);
  const iso = trimmed.match(ISO_DATE_RE);

  if (slash) {
    month = Number(slash[1]);
    day = Number(slash[2]);
    yearText = slash[3];
  } else if (iso) {
    yearText = iso[1];
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }

  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { month, day, year };
}

/** Parses a currency amount like "-1,234.56" or "$12.00". */
export function parseAmount(value: string): number | null {
  const amount = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Normalizes an amount to the statement convention (purchases positive,
 * credits/refunds negative). When the format has an explicit DEBIT/CREDIT
 * indicator column, it is authoritative. Without one, amounts are taken
 * as-is: verified exports (e.g. Apple Card) already follow this convention.
 */
function normalizeAmount(amount: number, indicator: string | null): number {
  const normalized = indicator?.trim().toUpperCase() ?? "";
  if (normalized === "DEBIT") {
    return Math.abs(amount);
  }
  if (normalized === "CREDIT") {
    return -Math.abs(amount);
  }
  return amount;
}

export function parseStatementCsvTransactions(
  csvText: string
): ParsedCsvTransaction[] {
  // Strip a UTF-8 BOM if present (common in bank CSV exports).
  const text = csvText.replace(/^\uFEFF/, "");
  const rows = splitCsvRows(text).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );

  if (rows.length === 0) {
    throw new Error("The CSV file is empty.");
  }

  const columns = findColumns(rows[0]);
  if (
    columns.date === -1 ||
    columns.amount === -1 ||
    (columns.merchant === -1 && columns.description === -1)
  ) {
    throw new Error(
      "Unrecognized CSV format. Could not find the required columns: a " +
        "transaction/posting date, a description or merchant, and an amount."
    );
  }

  const transactions: ParsedCsvTransaction[] = [];

  for (const row of rows.slice(1)) {
    const type = columns.type !== -1 ? row[columns.type]?.trim() ?? "" : "";
    if (NON_PURCHASE_TYPES.test(type)) {
      continue;
    }

    const date = parseCsvDate(row[columns.date]?.trim() ?? "");
    if (date === null) {
      continue;
    }

    const merchantColumn =
      columns.merchant !== -1 ? row[columns.merchant]?.trim() ?? "" : "";
    const descriptionColumn =
      columns.description !== -1 ? row[columns.description]?.trim() ?? "" : "";
    const merchant = (merchantColumn || descriptionColumn)
      .replace(/\s+/g, " ")
      .trim();

    if (!merchant) {
      continue;
    }

    const amount = parseAmount(row[columns.amount]?.trim() ?? "");
    if (amount === null) {
      continue;
    }

    const indicator =
      columns.indicator !== -1 ? row[columns.indicator] ?? null : null;

    const month = String(date.month).padStart(2, "0");
    const day = String(date.day).padStart(2, "0");

    transactions.push({
      date: `${month}/${day}`,
      merchant,
      amount: normalizeAmount(amount, indicator),
      category: categorizeMerchant(merchant),
      rawLine: row.join(","),
      year: date.year,
    });
  }

  return transactions;
}
