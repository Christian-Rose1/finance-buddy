import { parse } from "csv-parse/sync";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";
import { stableStatementTransactionId } from "./toStatementTransaction";

const MAX_MERCHANT_LENGTH = 300;
const MAX_CATEGORY_LENGTH = 100;
const MAX_STATEMENT_AMOUNT = 9_999_999_999.99;
const FALLBACK_CURRENCY_CODES = [
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "EUR",
  "GBP",
  "HKD",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "NZD",
  "SGD",
  "USD",
] as const;
const DOLLAR_SYMBOL_CURRENCIES = new Set(["USD"]);

type ParsedMoney = {
  amount: number;
  currencySymbol: "$" | null;
};

type HeaderRole =
  | "date"
  | "postingDate"
  | "merchant"
  | "amount"
  | "debit"
  | "credit"
  | "currency"
  | "category"
  | "transactionType";

type HeaderAliasRole = HeaderRole | "contextualPostedDate";

const HEADER_ALIASES: Readonly<Record<string, HeaderAliasRole>> = {
  date: "date",
  "transaction date": "date",
  "purchase date": "date",
  "trans date": "date",
  "post date": "postingDate",
  "posting date": "postingDate",
  "posted date": "contextualPostedDate",
  description: "merchant",
  "transaction description": "merchant",
  merchant: "merchant",
  "merchant name": "merchant",
  "merchant description": "merchant",
  payee: "merchant",
  amount: "amount",
  "transaction amount": "amount",
  debit: "debit",
  "debit amount": "debit",
  credit: "credit",
  "credit amount": "credit",
  currency: "currency",
  "currency code": "currency",
  category: "category",
  "transaction category": "category",
  type: "transactionType",
  "transaction type": "transactionType",
  direction: "transactionType",
};

function currencyCodes(): ReadonlySet<string> {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "currency") => string[];
    }
  ).supportedValuesOf;

  if (typeof supportedValuesOf === "function") {
    try {
      return new Set(supportedValuesOf.call(Intl, "currency"));
    } catch {
      // Fall through to the deliberately small ISO 4217 subset below.
    }
  }

  return new Set(FALLBACK_CURRENCY_CODES);
}

const VALID_CURRENCY_CODES = currencyCodes();

export type CsvStatementParseErrorCode =
  | "empty_file"
  | "invalid_csv"
  | "invalid_headers"
  | "invalid_row"
  | "no_transactions";

export class CsvStatementParseError extends Error {
  constructor(
    readonly code: CsvStatementParseErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CsvStatementParseError";
  }
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseCalendarDate(value: string, field: string, row: number): string {
  const trimmed = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (usMatch) {
    year = Number(usMatch[3]);
    month = Number(usMatch[1]);
    day = Number(usMatch[2]);
  } else {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} has an invalid ${field}; use YYYY-MM-DD or MM/DD/YYYY.`
    );
  }

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    year < 1900 ||
    year > 2100 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} has an invalid ${field}.`
    );
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseMoney(
  value: string,
  row: number,
  field: string,
  allowSigned: boolean
): ParsedMoney {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(?<open>\()?(?<sign>[+-]?)(?<currency>\$)?(?<number>(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?<close>\))?$/
  );

  if (
    !match?.groups ||
    Boolean(match.groups.open) !== Boolean(match.groups.close) ||
    (match.groups.open && match.groups.sign) ||
    (!allowSigned && (match.groups.open || match.groups.sign))
  ) {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} has an invalid ${field} amount.`
    );
  }

  const magnitude = Number(match.groups.number.replace(/,/g, ""));
  if (!Number.isFinite(magnitude) || magnitude > MAX_STATEMENT_AMOUNT) {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} has an invalid ${field} amount.`
    );
  }

  return {
    amount:
      match.groups.open || match.groups.sign === "-" ? -magnitude : magnitude,
    currencySymbol: match.groups.currency === "$" ? "$" : null,
  };
}

function optionalCurrency(value: string, row: number): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!VALID_CURRENCY_CODES.has(normalized)) {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} has an invalid currency code.`
    );
  }
  return normalized;
}

function optionalCategory(value: string, row: number): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_CATEGORY_LENGTH) {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} has an invalid category.`
    );
  }
  return normalized;
}

function headerIndexes(header: string[]): Map<HeaderRole, number> {
  const normalizedHeaders = header.map(normalizeHeader);
  if (
    normalizedHeaders.some((value) => value.length === 0) ||
    new Set(normalizedHeaders).size !== normalizedHeaders.length
  ) {
    throw new CsvStatementParseError(
      "invalid_headers",
      "CSV headers must be non-empty and unique."
    );
  }

  const indexes = new Map<HeaderRole, number>();
  const hasExplicitDate = normalizedHeaders.some(
    (headerName) => HEADER_ALIASES[headerName] === "date"
  );
  const hasContextualPostedDate = normalizedHeaders.some(
    (headerName) => HEADER_ALIASES[headerName] === "contextualPostedDate"
  );
  const hasExplicitPostingDate = normalizedHeaders.some(
    (headerName) => HEADER_ALIASES[headerName] === "postingDate"
  );
  if (!hasExplicitDate && hasContextualPostedDate && hasExplicitPostingDate) {
    throw new CsvStatementParseError(
      "invalid_headers",
      "CSV date headers are ambiguous."
    );
  }

  normalizedHeaders.forEach((headerName, index) => {
    const aliasRole = HEADER_ALIASES[headerName];
    if (!aliasRole) return;

    const role: HeaderRole =
      aliasRole === "contextualPostedDate"
        ? hasExplicitDate
          ? "postingDate"
          : "date"
        : aliasRole;
    if (indexes.has(role)) {
      throw new CsvStatementParseError(
        "invalid_headers",
        "CSV contains multiple headers for the same required field."
      );
    }
    indexes.set(role, index);
  });

  const hasAmount = indexes.has("amount");
  const hasDebit = indexes.has("debit");
  const hasCredit = indexes.has("credit");
  if (
    !indexes.has("date") ||
    !indexes.has("merchant") ||
    (hasAmount === (hasDebit || hasCredit)) ||
    (!hasAmount && (!hasDebit || !hasCredit))
  ) {
    throw new CsvStatementParseError(
      "invalid_headers",
      "CSV requires date, description or merchant, and either amount or both debit and credit columns."
    );
  }

  return indexes;
}

function requiredCell(
  record: string[],
  indexes: Map<HeaderRole, number>,
  role: HeaderRole,
  row: number
): string {
  const index = indexes.get(role);
  const value = index === undefined ? "" : record[index]?.trim() ?? "";
  if (!value) {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} is missing ${role === "merchant" ? "description or merchant" : role}.`
    );
  }
  return value;
}

function optionalCell(
  record: string[],
  indexes: Map<HeaderRole, number>,
  role: HeaderRole
): string {
  const index = indexes.get(role);
  return index === undefined ? "" : record[index]?.trim() ?? "";
}

function rowAmount(
  record: string[],
  indexes: Map<HeaderRole, number>,
  row: number
): ParsedMoney {
  if (indexes.has("amount")) {
    return parseMoney(requiredCell(record, indexes, "amount", row), row, "amount", true);
  }

  const debit = optionalCell(record, indexes, "debit");
  const credit = optionalCell(record, indexes, "credit");
  if ((!debit && !credit) || (debit && credit)) {
    throw new CsvStatementParseError(
      "invalid_row",
      `CSV row ${row} must contain exactly one debit or credit amount.`
    );
  }

  if (debit) {
    return parseMoney(debit, row, "debit", false);
  }

  const parsedCredit = parseMoney(credit, row, "credit", false);
  return {
    ...parsedCredit,
    amount: -parsedCredit.amount,
  };
}

function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new CsvStatementParseError(
      "invalid_csv",
      "Statement CSV files must use UTF-8 text encoding."
    );
  }
}

export function parseCsvStatement(buffer: Buffer): StatementTransaction[] {
  if (buffer.length === 0) {
    throw new CsvStatementParseError("empty_file", "The statement CSV is empty.");
  }

  let records: string[][];
  try {
    records = parse(decodeCsv(buffer), {
      bom: true,
      columns: false,
      relax_column_count: false,
      skip_empty_lines: false,
      trim: false,
    }) as string[][];
  } catch (error) {
    if (error instanceof CsvStatementParseError) throw error;
    throw new CsvStatementParseError(
      "invalid_csv",
      "The statement CSV is malformed."
    );
  }

  if (records.length === 0) {
    throw new CsvStatementParseError("empty_file", "The statement CSV is empty.");
  }

  const indexes = headerIndexes(records[0]);
  if (records.length === 1) {
    throw new CsvStatementParseError(
      "no_transactions",
      "No transactions were found in the statement CSV."
    );
  }

  return records.slice(1).map((record, index) => {
    const row = index + 2;
    if (record.every((value) => value.trim().length === 0)) {
      throw new CsvStatementParseError(
        "invalid_row",
        `CSV row ${row} is empty.`
      );
    }

    const date = parseCalendarDate(
      requiredCell(record, indexes, "date", row),
      "transaction date",
      row
    );
    const postingDateValue = optionalCell(record, indexes, "postingDate");
    const postingDate = postingDateValue
      ? parseCalendarDate(postingDateValue, "posting date", row)
      : null;
    const merchant = requiredCell(record, indexes, "merchant", row);
    if (merchant.length > MAX_MERCHANT_LENGTH) {
      throw new CsvStatementParseError(
        "invalid_row",
        `CSV row ${row} has an invalid description or merchant.`
      );
    }

    const parsedAmount = rowAmount(record, indexes, row);
    const transactionType = optionalCell(record, indexes, "transactionType");
    const amount = normalizeCsvAmount(parsedAmount.amount, transactionType, row);
    const currency = optionalCurrency(
      optionalCell(record, indexes, "currency"),
      row
    );
    if (
      parsedAmount.currencySymbol &&
      currency !== null &&
      !DOLLAR_SYMBOL_CURRENCIES.has(currency)
    ) {
      throw new CsvStatementParseError(
        "invalid_row",
        `CSV row ${row} has contradictory amount and currency values.`
      );
    }
    const category = optionalCategory(
      optionalCell(record, indexes, "category"),
      row
    );

    return {
      id: stableStatementTransactionId(
        date,
        postingDate,
        merchant,
        amount,
        `csv-row-${row}`
      ),
      date,
      merchant,
      amount,
      currency,
      cardId: null,
      category,
      categorySource: category === null ? undefined : "statement",
      confidence: 1,
    };
  });
}

function normalizeCsvAmount(amount: number, type: string, row: number): number {
  if (!type.trim()) return amount;
  const creditLike = /refund|return|credit|payment|reversal|deposit|cashback/i.test(type);
  const debitLike = /sale|purchase|debit|charge|withdrawal/i.test(type);
  if (!creditLike && !debitLike) {
    throw new CsvStatementParseError("invalid_row", `CSV row ${row} has an unsupported transaction type.`);
  }
  // Canonical policy: purchases/debits are positive; refunds/credits are negative.
  return creditLike ? -Math.abs(amount) : Math.abs(amount);
}
