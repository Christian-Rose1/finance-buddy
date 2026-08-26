import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  OllamaReceiptExtractionProvider,
  ReceiptExtractionError,
} from "@/lib/receipts/ollamaProvider";
import { validateReceiptExtraction } from "@/lib/receipts/schema";
import { categorizeReceiptItems } from "@/lib/receipts/categorizer";
import { calculateSavingsOpportunities } from "@/lib/receipts/savings";
import { createReceiptImportDraftPayload } from "@/lib/imports/payload";
import {
  createImportDraft,
  ImportDraftError,
} from "@/lib/imports/repository";
import {
  confirmImportDraft,
  discardImportDraft,
} from "@/lib/imports/workflow";
import { createServerClient } from "@/lib/supabase-server";
import {
  MAX_RECEIPT_FILE_BYTES,
  normalizeOwnedStoragePath,
  requestBodyIsTooLarge,
  storageObjectMatchesBytes,
} from "@/lib/uploads/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_RECEIPT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function receiptExtractionErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof ReceiptExtractionError)) {
    return NextResponse.json(
      { ok: false, error: "Receipt extraction failed. Please try again." },
      { status: 500 }
    );
  }

  switch (error.code) {
    case "unsupported_input":
      return NextResponse.json(
        { ok: false, error: "This receipt file type is not supported." },
        { status: 415 }
      );
    case "pdf_empty":
      return NextResponse.json(
        { ok: false, error: "The receipt PDF is empty." },
        { status: 400 }
      );
    case "pdf_malformed":
      return NextResponse.json(
        { ok: false, error: "The receipt PDF is malformed or corrupted." },
        { status: 400 }
      );
    case "pdf_encrypted":
      return NextResponse.json(
        {
          ok: false,
          error:
            "Password-protected receipt PDFs are not supported. Upload an unlocked text-based PDF or a receipt image.",
        },
        { status: 422 }
      );
    case "pdf_no_text":
      return NextResponse.json(
        {
          ok: false,
          error:
            "No readable text was found in the receipt PDF. For a scanned receipt, upload the page as a JPEG, PNG, or WebP image.",
        },
        { status: 422 }
      );
    case "pdf_too_large":
      return NextResponse.json(
        {
          ok: false,
          error: "The receipt PDF contains too much text to analyze safely.",
        },
        { status: 422 }
      );
    case "pdf_failed":
      return NextResponse.json(
        { ok: false, error: "Receipt PDF text extraction failed." },
        { status: 500 }
      );
    default:
      return NextResponse.json(
        { ok: false, error: "Receipt extraction failed. Please try again." },
        { status: 500 }
      );
  }
}

async function readDraftId(request: NextRequest): Promise<string | null> {
  try {
    const value: unknown = await request.json();
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as Record<string, unknown>).draftId === "string"
    ) {
      return (value as Record<string, string>).draftId;
    }
  } catch {
    // The caller receives one generic request-shape error below.
  }
  return null;
}

function importDraftErrorResponse(error: unknown): NextResponse {
  if (error instanceof ImportDraftError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "expired"
          ? 410
          : error.code === "discarded" ||
              error.code === "already_confirmed" ||
              error.code === "in_progress"
            ? 409
            : 500;
    return NextResponse.json({ ok: false, error: error.message }, { status });
  }
  return NextResponse.json(
    { ok: false, error: "Receipt import could not be updated. Please try again." },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  if (
    requestBodyIsTooLarge(
      request.headers.get("content-length"),
      MAX_RECEIPT_FILE_BYTES
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "Receipt files must be 10 MB or smaller." },
      { status: 413 }
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "Authentication required. Please sign in first." },
      { status: 401 }
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
  const storagePathResult = normalizeOwnedStoragePath(
    formData.get("storagePath"),
    user.id
  );

  if (!storagePathResult.valid || !storagePathResult.path) {
    return NextResponse.json(
      { ok: false, error: "Receipt storage path is invalid." },
      { status: 400 }
    );
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "No file uploaded. Expected a form field named 'file'." },
      { status: 400 }
    );
  }

  if (!SUPPORTED_RECEIPT_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unsupported file type "${file.type}". Supported types: JPEG, PNG, WebP, and text-based PDF.`,
      },
      { status: 415 }
    );
  }

  if (file.size > MAX_RECEIPT_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Receipt files must be 10 MB or smaller." },
      { status: 413 }
    );
  }

  let provider: OllamaReceiptExtractionProvider;

  try {
    provider = new OllamaReceiptExtractionProvider();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Receipt extraction is not configured." },
      { status: 500 }
    );
  }

  let extraction;
  let sourceId: string;
  try {
    const data = await file.arrayBuffer();
    if (
      !(await storageObjectMatchesBytes(
        supabase,
        "receipts",
        storagePathResult.path,
        data
      ))
    ) {
      return NextResponse.json(
        { ok: false, error: "The uploaded receipt could not be verified." },
        { status: 409 }
      );
    }
    sourceId = `sha256:${createHash("sha256")
      .update(new Uint8Array(data))
      .digest("hex")}`;

    extraction = await provider.extractReceipt({
      data,
      mimeType: file.type,
      filename: file.name,
    });
  } catch (error) {
    return receiptExtractionErrorResponse(error);
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
  const uploadedStoragePath = storagePathResult.path;

  const draftPayload = createReceiptImportDraftPayload({
    receipt: finalResult.data,
    sourceId,
    storagePath: uploadedStoragePath,
  });

  let draft;
  try {
    draft = await createImportDraft(draftPayload, user.id, supabase);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to prepare receipt review. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    draftId: draft.id,
    expiresAt: draft.expiresAt,
    receipt: finalResult.data,
    savings,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "Authentication required. Please sign in first." },
      { status: 401 }
    );
  }

  const draftId = await readDraftId(request);
  if (!draftId) {
    return NextResponse.json(
      { ok: false, error: "A receipt import draft is required." },
      { status: 400 }
    );
  }

  try {
    const result = await confirmImportDraft(
      draftId,
      "receipt",
      user.id,
      supabase
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return importDraftErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "Authentication required. Please sign in first." },
      { status: 401 }
    );
  }

  const draftId = await readDraftId(request);
  if (!draftId) {
    return NextResponse.json(
      { ok: false, error: "A receipt import draft is required." },
      { status: 400 }
    );
  }

  try {
    const result = await discardImportDraft(
      draftId,
      "receipt",
      user.id,
      supabase
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return importDraftErrorResponse(error);
  }
}
