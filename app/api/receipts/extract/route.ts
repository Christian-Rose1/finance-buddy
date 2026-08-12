import { NextRequest, NextResponse } from "next/server";
import { OllamaReceiptExtractionProvider } from "@/lib/receipts/ollamaProvider";
import { validateReceiptExtraction } from "@/lib/receipts/schema";

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

  return NextResponse.json({ ok: true, receipt: result.data });
}