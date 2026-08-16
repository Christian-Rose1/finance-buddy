import { NextRequest, NextResponse } from "next/server";
import { OllamaReceiptExtractionProvider } from "@/lib/receipts/ollamaProvider";
import { validateReceiptExtraction } from "@/lib/receipts/schema";
import { categorizeReceiptItems } from "@/lib/receipts/categorizer";
import { calculateSavingsOpportunities } from "@/lib/receipts/savings";
import { purchaseFromReceipt } from "@/lib/purchases/fromReceipt";
import { persistPurchase } from "@/lib/purchases/repository";
import { createServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Maps an unknown error to a safe, client-facing message (no env/model leakage). */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Receipt extraction failed.";
}

export async function POST(request: NextRequest) {
  let provider: OllamaReceiptExtractionProvider;

  try {
    provider = new OllamaReceiptExtractionProvider();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(err) },
      { status: 500 }
    );
  }

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
  const storagePath = formData.get("storagePath");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "No file uploaded. Expected a form field named 'file'." },
      { status: 400 }
    );
  }

  if (file.type === "application/pdf") {
    return NextResponse.json(
      {
        ok: false,
        error: "PDF receipt extraction is not yet supported by the Ollama provider. Upload a JPEG, PNG, or WebP image.",
      },
      { status: 415 }
    );
  }

  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unsupported file type "${file.type}". Supported types: JPEG, PNG, WebP.`,
      },
      { status: 400 }
    );
  }

  let extraction;
  try {
    const data = await file.arrayBuffer();

    extraction = await provider.extractReceipt({
      data,
      mimeType: file.type,
      filename: file.name,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(err) },
      { status: 500 }
    );
  }

  // Defense in depth: the provider validates internally, but re-validate
  // before returning so the contract is guaranteed to the caller.
  const result = validateReceiptExtraction(extraction);

  if (!result.success) {
    return NextResponse.json(
      {
        ok: false,
        error: `Extraction produced invalid data: ${result.error.message}`,
      },
      { status: 500 }
    );
  }

  // Assign a spending category to each line item. Every other receipt
  // field is preserved exactly as returned by the provider.
  const categorized = {
    ...result.data,
    items: categorizeReceiptItems(result.data.items),
  };

  // Re-validate the final receipt after categorization.
  const finalResult = validateReceiptExtraction(categorized);

  if (!finalResult.success) {
    return NextResponse.json(
      {
        ok: false,
        error: `Categorized receipt failed validation: ${finalResult.error.message}`,
      },
      { status: 500 }
    );
  }

  // Compute the savings summary for the validated, categorized receipt.
  const savings = calculateSavingsOpportunities(finalResult.data);

  // Build stable Storage identity for the uploaded receipt, if available.
  const uploadedStoragePath =
    typeof storagePath === "string" && storagePath.length > 0
      ? storagePath
      : null;

  // Create a Purchase from the validated receipt data.
  const purchase = purchaseFromReceipt(finalResult.data, undefined, {
    sourceId: uploadedStoragePath ?? undefined,
    storage: uploadedStoragePath
      ? { bucket: "receipts", path: uploadedStoragePath }
      : undefined,
  });

  // Persist the Purchase for the authenticated user. The server client reads
  // the Supabase session from request cookies, so browser and server share the
  // same authenticated session.
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "Authentication required. Please sign in first." },
      { status: 401 }
    );
  }

  let persistedPurchase;
  try {
    persistedPurchase = await persistPurchase(purchase, user.id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to save purchase. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    receipt: finalResult.data,
    savings,
    purchase: persistedPurchase,
  });
}
