import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { PdfTextExtractionError } from "@/lib/parser/pdfTextExtractor";
import {
  detectStatementFileFormat,
  parseStatementFile,
  StatementFormatError,
} from "@/lib/parser/statementParser";
import { CsvStatementParseError } from "@/lib/parser/csvStatementParser";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";
import { createStatementImportDraftPayload } from "@/lib/imports/payload";
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
  MAX_STATEMENT_FILE_BYTES,
  normalizeOwnedStoragePath,
  requestBodyIsTooLarge,
  storageObjectMatchesBytes,
} from "@/lib/uploads/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STATEMENT_TRANSACTIONS = 500;

function csvHasTooManyPhysicalRows(data: Buffer): boolean {
  let rows = 1;
  for (const byte of data) {
    if (byte === 0x0a) rows += 1;
    if (rows > MAX_STATEMENT_TRANSACTIONS + 1) return true;
  }
  return false;
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
    { ok: false, error: "Statement import could not be updated. Please try again." },
    { status: 500 }
  );
}

function statementPdfErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof PdfTextExtractionError)) {
    return NextResponse.json(
      { ok: false, error: "Statement PDF text extraction failed." },
      { status: 500 }
    );
  }

  switch (error.code) {
    case "empty":
      return NextResponse.json(
        { ok: false, error: "The statement PDF is empty." },
        { status: 400 }
      );
    case "malformed":
      return NextResponse.json(
        { ok: false, error: "The statement PDF is malformed or corrupted." },
        { status: 400 }
      );
    case "encrypted":
      return NextResponse.json(
        {
          ok: false,
          error:
            "Password-protected statement PDFs are not supported. Upload an unlocked text-based Chase statement PDF.",
        },
        { status: 422 }
      );
    case "no_text":
      return NextResponse.json(
        {
          ok: false,
          error:
            "No readable text was found in the statement PDF. Scanned statement PDFs are not supported.",
        },
        { status: 422 }
      );
    default:
      return NextResponse.json(
        { ok: false, error: "Statement PDF text extraction failed." },
        { status: 500 }
      );
  }
}

function statementParseErrorResponse(error: unknown): NextResponse {
  if (error instanceof PdfTextExtractionError) {
    return statementPdfErrorResponse(error);
  }

  if (error instanceof CsvStatementParseError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 }
    );
  }

  if (error instanceof StatementFormatError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.code === "missing_pdf_date" ? 400 : 415 }
    );
  }

  return NextResponse.json(
    { ok: false, error: "Statement parsing failed." },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  if (
    requestBodyIsTooLarge(
      request.headers.get("content-length"),
      MAX_STATEMENT_FILE_BYTES
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "Statement files must be 20 MB or smaller." },
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
      { ok: false, error: "Statement storage path is invalid." },
      { status: 400 }
    );
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "No file uploaded. Expected a form field named 'file'." },
      { status: 400 }
    );
  }

  if (!detectStatementFileFormat(file.type, file.name)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unsupported statement file. Upload a CSV export or a text-based Chase credit-card PDF.",
      },
      { status: 415 }
    );
  }

  if (file.size > MAX_STATEMENT_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Statement files must be 20 MB or smaller." },
      { status: 413 }
    );
  }

  let statementDigest: string;
  let statementTransactions: StatementTransaction[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (
      !(await storageObjectMatchesBytes(
        supabase,
        "statements",
        storagePathResult.path,
        buffer
      ))
    ) {
      return NextResponse.json(
        { ok: false, error: "The uploaded statement could not be verified." },
        { status: 409 }
      );
    }
    if (detectStatementFileFormat(file.type, file.name) === "csv" && csvHasTooManyPhysicalRows(buffer)) {
      return NextResponse.json(
        {
          ok: false,
          error: `A statement may contain at most ${MAX_STATEMENT_TRANSACTIONS} transactions.`,
        },
        { status: 413 }
      );
    }
    statementDigest = createHash("sha256").update(buffer).digest("hex");
    statementTransactions = (
      await parseStatementFile({
        data: buffer,
        mimeType: file.type,
        filename: file.name,
      })
    ).transactions;
  } catch (error) {
    return statementParseErrorResponse(error);
  }
  if (statementTransactions.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No purchase transactions were found in this statement.",
      },
      { status: 400 }
    );
  }
  if (statementTransactions.length > MAX_STATEMENT_TRANSACTIONS) {
    return NextResponse.json(
      {
        ok: false,
        error: `A statement may contain at most ${MAX_STATEMENT_TRANSACTIONS} transactions.`,
      },
      { status: 400 }
    );
  }

  const uploadedStoragePath = storagePathResult.path;
  const draftPayload = createStatementImportDraftPayload({
    transactions: statementTransactions,
    statementDigest,
    storagePath: uploadedStoragePath,
  });

  let draft;
  try {
    draft = await createImportDraft(draftPayload, user.id, supabase);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to prepare statement review. Please try again.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    draftId: draft.id,
    expiresAt: draft.expiresAt,
    transactions: statementTransactions,
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
      { ok: false, error: "A statement import draft is required." },
      { status: 400 }
    );
  }

  try {
    const result = await confirmImportDraft(
      draftId,
      "statement",
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
      { ok: false, error: "A statement import draft is required." },
      { status: 400 }
    );
  }

  try {
    const result = await discardImportDraft(
      draftId,
      "statement",
      user.id,
      supabase
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return importDraftErrorResponse(error);
  }
}
