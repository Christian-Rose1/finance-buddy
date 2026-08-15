import { NextRequest, NextResponse } from "next/server";
import { extractPdfText } from "@/lib/parser/pdfTextExtractor";
import { parseTransactions } from "@/lib/parser/chaseParser";
import { toStatementTransaction } from "@/lib/parser/toStatementTransaction";
import { purchaseFromStatement } from "@/lib/purchases/fromStatement";
import { persistPurchase } from "@/lib/purchases/repository";
import { createServerClient } from "@/lib/supabase-server";
import { StatementTransaction } from "@/lib/purchases/statementTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_PDF_TYPES = ["application/pdf"];

const MONTH_NAMES =
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)/i;

/** Validates a 2-digit year into a 2000s year (e.g. "26" → 2026). */
function fullYear(yy: string): number | null {
  const n = Number(yy);
  if (Number.isInteger(n) && n >= 0 && n <= 99) {
    return 2000 + n;
  }
  return null;
}

/**
 * Deterministically detects the statement year from PDF text.
 *
 * Chase statements commonly use 2-digit years (MM/DD/YY) in the header,
 * while also printing a month-name year like "July 2026" in the letterhead.
 *
 * Priority order:
 * 1. Labeled date with a 4-digit year: "Closing Date 06/22/2026"
 * 2. Statement-period range with 4-digit years: "05/11/2026 - 06/09/2026" → closing year
 * 3. Month-name + 4-digit year in the header: "July 2026"
 * 4. Labeled date with a 2-digit year: "Statement Date: 06/22/26" → 20YY
 * 5. Statement-period range with 2-digit years: "05/23/26 - 06/22/26" → closing year
 * 6. All 4-digit years in the document must agree (fallback)
 *
 * Returns null when no year can be determined confidently.
 */
function detectStatementYear(text: string): number | null {
  // Priority 1: labeled statement/closing date with a 4-digit year.
  const label4Re =
    /(?:closing\s+date|statement\s+date|account\s+period|billing\s+period)[^0-9]*\d{1,2}\/\d{1,2}\/(\d{4})/i;
  const label4Match = text.match(label4Re);
  if (label4Match?.[1]) {
    const year = Number(label4Match[1]);
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
      return year;
    }
  }

  // Priority 2: statement-period range with 4-digit years → closing year.
  const period4Re =
    /\d{1,2}\/\d{1,2}\/(\d{4})\s*(?:-|–|to)\s*\d{1,2}\/\d{1,2}\/(\d{4})/i;
  const period4Match = text.match(period4Re);
  if (period4Match?.[2]) {
    const year = Number(period4Match[2]);
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
      return year;
    }
  }

  // Priority 3: month-name + 4-digit year (e.g. "July 2026") in the header.
  const monthYearRe = new RegExp(
    `${MONTH_NAMES.source}\\s+(20\\d{2})`,
    "i"
  );
  const monthYearMatch = text.match(monthYearRe);
  if (monthYearMatch?.[1]) {
    const year = Number(monthYearMatch[1]);
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
      return year;
    }
  }

  // Priority 4: labeled statement/closing date with a 2-digit year (MM/DD/YY).
  const label2Re =
    /(?:closing\s+date|statement\s+date|account\s+period|billing\s+period)[^0-9]*\d{1,2}\/\d{1,2}\/(\d{2})/i;
  const label2Match = text.match(label2Re);
  if (label2Match?.[1]) {
    const year = fullYear(label2Match[1]);
    if (year !== null) return year;
  }

  // Priority 5: statement-period range with 2-digit years → closing year.
  const period2Re =
    /\d{1,2}\/\d{1,2}\/(\d{2})\s*(?:-|–|to)\s*\d{1,2}\/\d{1,2}\/(\d{2})/i;
  const period2Match = text.match(period2Re);
  if (period2Match?.[2]) {
    const year = fullYear(period2Match[2]);
    if (year !== null) return year;
  }

  // Priority 6: every 4-digit year in the document must agree.
  const years: number[] = [];
  const yearRe = /\b(20\d{2})\b/g;
  let m;
  while ((m = yearRe.exec(text)) !== null) {
    const y = Number(m[1]);
    if (y >= 2000 && y <= 2100) {
      years.push(y);
    }
  }
  if (years.length === 0) return null;
  if (years.every((y) => y === years[0])) return years[0];
  return null;
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request must be multipart/form-data." },
      { status: 400 }
    );
  }

  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "No file uploaded. Expected a form field named 'file'." },
      { status: 400 }
    );
  }

  if (!SUPPORTED_PDF_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unsupported file type "${file.type}". Expected application/pdf.`,
      },
      { status: 400 }
    );
  }

  let text: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    text = await extractPdfText(buffer);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `PDF text extraction failed: ${err.message}`
            : "PDF text extraction failed.",
      },
      { status: 500 }
    );
  }

  const year = detectStatementYear(text);
  if (year === null) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not determine the statement year from the PDF. " +
          "The statement must contain a clearly dated closing/statement date or period.",
      },
      { status: 400 }
    );
  }

  const parsed = parseTransactions(text);
  const statementTransactions = parsed.map((tx) => toStatementTransaction(tx, year));
  const purchases = statementTransactions.map((tx) => purchaseFromStatement(tx));

  // Persist each statement Purchase for the authenticated user. The server
  // client reads the Supabase session from request cookies, so browser and
  // server share the same authenticated session.
  const supabase = createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "Authentication required. Please sign in first." },
      { status: 401 }
    );
  }

  const persistedPurchases = [];
  for (const purchase of purchases) {
    try {
      persistedPurchases.push(await persistPurchase(purchase, user.id));
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to save one or more statement purchases. Please try again.",
          transactions: statementTransactions,
          purchases: persistedPurchases,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    transactions: statementTransactions,
    purchases: persistedPurchases,
  });
}
