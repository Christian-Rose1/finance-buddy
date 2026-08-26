export type ParsedTransaction = {
  date: string;
  postingDate?: string | null;
  merchant: string;
  amount: number;
  category: string;
  rawLine: string;
};

const transactionLineRegex =
  /^(?<date>\d{2}\/\d{2})(?:\s+(?<postingDate>\d{2}\/\d{2}))?\s+(?<merchant>.+?)\s+(?<amount>-?\$?[\d,]+\.\d{2})$/;

const DATE_TOKEN_SOURCE = String.raw`\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})(?!\d)`;
const PERIOD_SEPARATOR_SOURCE = String.raw`(?:-|–|to)`;
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;
const MAX_MERCHANT_LENGTH = 300;
const MAX_STATEMENT_AMOUNT = 9_999_999_999.99;

export const CHASE_STATEMENT_FORMAT_DESCRIPTION =
  "text-based Chase credit-card statement PDF";

export interface ChaseStatementDateContext {
  closingYear: number;
  closingMonth: number | null;
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function statementHeaderLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  const firstTransactionIndex = lines.findIndex((line) =>
    transactionLineRegex.test(line)
  );

  return lines.slice(
    0,
    Math.min(firstTransactionIndex === -1 ? lines.length : firstTransactionIndex, 40)
  );
}

function fullYear(value: string): number | null {
  if (!/^\d{2}$|^\d{4}$/.test(value)) return null;

  const numeric = Number(value);
  const year = value.length === 2 ? 2000 + numeric : numeric;
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : null;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDatedToken(
  value: string
): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const year = fullYear(match[3]);
  const month = Number(match[1]);
  const day = Number(match[2]);

  if (year === null || !isCalendarDate(year, month, day)) return null;
  return { year, month, day };
}

function isCalendarMonthDay(value: string): boolean {
  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;

  // Leap year 2000 admits 02/29 while rejecting every impossible month/day.
  return isCalendarDate(2000, Number(match[1]), Number(match[2]));
}

/**
 * Returns true only for the currently supported deterministic statement
 * shape: a text-based Chase credit-card statement with a known section label.
 */
export function isSupportedChaseStatement(text: string): boolean {
  const headerText = statementHeaderLines(text).join("\n");
  const hasChaseIdentity = [
    /\bJPMORGAN\s+CHASE\s+BANK\b/i,
    /\bCHASE\s+(?:BANK\s+USA|CARD(?:MEMBER)?\s+SERVICES|CREDIT\s+CARD)\b/i,
    /^CHASE$/im,
  ].some((pattern) => pattern.test(headerText));
  const hasStatementStructure = [
    /\bACCOUNT\s+SUMMARY\b/i,
    /\bACCOUNT\s+ACTIVITY\b/i,
    /\bTRANSACTION\s+DETAIL\b/i,
    /\bPURCHASE\s+TRANSACTIONS\b/i,
    /\bOPENING\s*\/\s*CLOSING\s+DATE\b/i,
    /\bSTATEMENT\s+DATE\b/i,
  ].some((pattern) => pattern.test(headerText));

  return hasChaseIdentity && hasStatementStructure;
}

/** Detects a closing date context only from calendar-valid statement text. */
export function detectChaseStatementDateContext(
  text: string
): ChaseStatementDateContext | null {
  const headerText = statementHeaderLines(text).join("\n");
  const labeledPeriod = new RegExp(
    `(?:account\\s+period|billing\\s+period)[\\s\\S]{0,80}?(${DATE_TOKEN_SOURCE})\\s*${PERIOD_SEPARATOR_SOURCE}\\s*(${DATE_TOKEN_SOURCE})`,
    "i"
  ).exec(headerText);

  if (labeledPeriod) {
    const start = parseDatedToken(labeledPeriod[1]);
    const end = parseDatedToken(labeledPeriod[2]);
    return start && end
      ? { closingYear: end.year, closingMonth: end.month }
      : null;
  }

  const labeledDate = new RegExp(
    `(?:closing\\s+date|statement\\s+date)[^0-9]{0,40}(${DATE_TOKEN_SOURCE})`,
    "i"
  ).exec(headerText);

  if (labeledDate) {
    const closingDate = parseDatedToken(labeledDate[1]);
    return closingDate
      ? {
          closingYear: closingDate.year,
          closingMonth: closingDate.month,
        }
      : null;
  }

  const period = new RegExp(
    `(${DATE_TOKEN_SOURCE})\\s*${PERIOD_SEPARATOR_SOURCE}\\s*(${DATE_TOKEN_SOURCE})`,
    "i"
  ).exec(headerText);

  if (period) {
    const start = parseDatedToken(period[1]);
    const end = parseDatedToken(period[2]);
    return start && end
      ? { closingYear: end.year, closingMonth: end.month }
      : null;
  }

  const nonLegalHeaderText = statementHeaderLines(text)
    .filter((line) => !/\b(?:copyright|all rights reserved|legal)\b/i.test(line))
    .join("\n");
  const monthYearMatch = nonLegalHeaderText.match(
    new RegExp(`(${MONTH_NAMES.join("|")})\\s+(20\\d{2})`, "i")
  );
  if (monthYearMatch?.[1] && monthYearMatch[2]) {
    const year = fullYear(monthYearMatch[2]);
    const month = MONTH_NAMES.indexOf(
      monthYearMatch[1].toLowerCase() as (typeof MONTH_NAMES)[number]
    );
    return year !== null && month >= 0
      ? { closingYear: year, closingMonth: month + 1 }
      : null;
  }

  return null;
}

/** Detects the statement closing year for callers that do not need rollover. */
export function detectChaseStatementYear(text: string): number | null {
  return detectChaseStatementDateContext(text)?.closingYear ?? null;
}

function isNoiseLine(
  merchant: string,
  rawLine: string
) {
  const upperMerchant = merchant.toUpperCase();
  const upperLine = rawLine.toUpperCase();

  return [
    /PAYMENT THANK YOU/i,
    /TRANSACTION FEE/i,
    /CASH ADVANCE INTEREST/i,
    /INTEREST CHARGED/i,
    /TOTAL FEES/i,
    /TOTAL INTEREST/i,
    /YEAR-TO-DATE/i,
    /OPENING\/CLOSING DATE/i,
    /STATEMENT DATE/i,
    /ACCOUNT NUMBER/i,
    /CREDIT ACCESS LINE/i,
    /AVAILABLE CREDIT/i,
    /AVAILABLE FOR CASH/i,
    /PREVIOUS BALANCE/i,
    /PAYMENTS, CREDITS/i,
    /PURCHASES/i,
    /CASH ADVANCES/i,

    // Confirmed Chase cash-advance indicator.
    // Do NOT broadly filter all VENMO transactions because
    // ordinary Venmo transactions cannot be distinguished
    // reliably from cash advances using the extracted PDF text.
    /VISA DIRECT/i,

    /BALANCE TRANSFERS/i,
    /EURO/i,
    /CANADIAN DOLLAR/i,
    /SWISS FRANC/i,
    /EXCHG RATE/i,
    /PAGE \d+ OF \d+/i,
    /AUTOPAY IS ON/i,
    /FIS33339/i,
    /CARDMEMBER SERVICE/i,
    /P\.O\. BOX/i,
    /MINIMUM PAYMENT/i,
    /LATE PAYMENT WARNING/i,
    /MINIMUM PAYMENT WARNING/i,
    /ANNUAL PERCENTAGE RATE/i,
  ].some(
    (pattern) =>
      pattern.test(upperMerchant) ||
      pattern.test(upperLine)
  );
}

function categorizeMerchant(merchant: string) {
  const upper = merchant.toUpperCase();

  if (
    /WHOLEFDS|WHOLE FOODS|SAFEWAY|COSTCO|INSTACART|TRADER JOE|LEEVERS LOCAVORE|SPROUTS|NATURALIA|TARGET|WALGREENS/i.test(
      upper
    )
  ) {
    return "Groceries";
  }

  if (
    /STARBUCKS|COFFEE|BAKERY|BAGEL|TAQUERIA|SUSHI|RESTAURANT|CAFE|ICE CREAM|BISTRO|DINING|FOOD|DANG SOFT SERVE|LITTLE MAN|ODELLS|MOONFLOWER|HUCKLEBERRY|MIDDLESTATE|JOY HILL|CLEMENTINES|PAPUSAS|TAKI|CHILI S|PARKING/i.test(
      upper
    )
  ) {
    return "Dining";
  }

  if (
    /AIRBNB|WESTJET|UBER|LIME|VEO|PARKINGCOM|RENTAPPLICATION|TRIP|FLIGHT|HOTEL|TRANSPORT|YYC|CDG|PARIS|LISBOA|GRINDELWALD|ANDERMATT/i.test(
      upper
    )
  ) {
    return "Travel / Transportation";
  }

  if (
    /APPLE\.COM\/BILL|COMCAST|KINDLE|NUULY|PROGRESSIVE|SUBSCRIP|STREAM|INS/i.test(
      upper
    )
  ) {
    return "Bills & Subscriptions";
  }

  if (
    /GAP|NEW BALANCE|MADEWELL|MICHAELS|YOGA BOX|FOXY NAILS|EYEBROW|UPS STORE|USPS|BLANK BARBERS|SHOP|TARGET\.COM|MERCADO|MART/i.test(
      upper
    )
  ) {
    return "Shopping";
  }

  if (
    /HEATING|PROPERT|SCHOOL BUS|APF\*|SERVICE NAVIGO|SELECTA|FLEUX|BOULANGERIE|PHARMACIE|LIME\*RIDE|SASQUATCH|COSTCO BY IN CAR|INSTACART.COM/i.test(
      upper
    )
  ) {
    return "Home / Services";
  }

  return "Other";
}

export function parseTransactions(
  text: string
): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  const transactions: ParsedTransaction[] = [];

  for (const line of lines) {
    if (line.length > MAX_MERCHANT_LENGTH + 40) {
      continue;
    }

    const match = line.match(transactionLineRegex);

    if (!match?.groups) {
      continue;
    }

    const date = match.groups.date;
    const merchant = match.groups.merchant.trim();
    const amount = Number(
      match.groups.amount.replace(/[$,]/g, "")
    );

    if (
      !isCalendarMonthDay(date) ||
      (match.groups.postingDate &&
        !isCalendarMonthDay(match.groups.postingDate)) ||
      merchant.length === 0 ||
      merchant.length > MAX_MERCHANT_LENGTH ||
      !Number.isFinite(amount) ||
      Math.abs(amount) > MAX_STATEMENT_AMOUNT
    ) {
      continue;
    }

    if (isNoiseLine(merchant, line)) {
      continue;
    }

    transactions.push({
      date,
      postingDate: match.groups.postingDate ?? null,
      merchant,
      amount,
      category: categorizeMerchant(merchant),
      rawLine: line,
    });
  }

  /*
   * pdf-parse sometimes emits identical physical transaction
   * rows multiple times, particularly around foreign-currency
   * transactions.
   *
   * Deduplicate exact date + posting date + merchant + amount matches while
   * preserving the first occurrence.
   *
   * This behavior was verified against the real Chase test
   * statement and removed 15 duplicated extracted rows.
   */
  const seen = new Set<string>();
  const deduplicated: ParsedTransaction[] = [];

  for (const transaction of transactions) {
    const key =
      `${transaction.date}|` +
      `${transaction.postingDate ?? ""}|` +
      `${transaction.merchant}|` +
      `${transaction.amount}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduplicated.push(transaction);
  }

  return deduplicated;
}
