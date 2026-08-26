import { NextRequest, NextResponse } from "next/server";
import { validateReceiptExtraction } from "@/lib/receipts/schema";
import { DEVELOPMENT_WALLET } from "@/lib/wallet/cards";
import { matchReceiptToWalletBenefits } from "@/lib/wallet/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development test endpoint for the deterministic wallet benefit matching
 * engine. This endpoint is unavailable in production; production requests
 * receive a 404 before the request body or development fixtures are used.
 *
 * Accepts a validated `ReceiptExtraction` JSON payload and returns the
 * `BenefitMatch[]` results from matching it against the development wallet
 * fixtures. This uses DEVELOPMENT TEST DATA only and is not connected to
 * any real card benefits.
 *
 * Request body:
 *   { "receipt": <ReceiptExtraction> }
 *
 * Response:
 *   { "ok": true, "benefits": BenefitMatch[] }
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const receipt =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).receipt
      : undefined;

  const result = validateReceiptExtraction(receipt);

  if (!result.success) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid receipt payload: ${result.error.message}`,
      },
      { status: 400 }
    );
  }

  const benefits = matchReceiptToWalletBenefits(result.data, DEVELOPMENT_WALLET);

  return NextResponse.json({ ok: true, benefits });
}
