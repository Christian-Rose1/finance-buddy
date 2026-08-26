import {
  FormatError,
  InvalidPDFException,
  PasswordException,
  PDFParse,
} from "pdf-parse";

export type PdfTextExtractionErrorCode =
  | "empty"
  | "malformed"
  | "encrypted"
  | "no_text"
  | "failed";

export class PdfTextExtractionError extends Error {
  constructor(
    readonly code: PdfTextExtractionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PdfTextExtractionError";
  }
}

type PdfTextResult = {
  pages: Array<{ text: string }>;
};

type PdfTextParser = {
  getText(): Promise<PdfTextResult>;
  destroy(): Promise<void>;
};

export type PdfTextParserFactory = (buffer: Buffer) => PdfTextParser;

const createPdfParser: PdfTextParserFactory = (buffer) =>
  new PDFParse({ data: buffer });

function hasPdfHeader(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes("%PDF-");
}

function hasReadableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Extracts raw text from a PDF buffer using pdf-parse v2 (class-based API).
 *
 * This module is the ONLY place in the codebase that imports pdf-parse, so
 * the dependency stays isolated and can be swapped without touching the
 * parser logic or API routes.
 */
export async function extractPdfText(
  buffer: Buffer,
  parserFactory: PdfTextParserFactory = createPdfParser
): Promise<string> {
  if (buffer.length === 0) {
    throw new PdfTextExtractionError("empty", "The PDF file is empty.");
  }

  if (!hasPdfHeader(buffer)) {
    throw new PdfTextExtractionError(
      "malformed",
      "The file is not a valid PDF."
    );
  }

  let parser: PdfTextParser | null = null;
  try {
    parser = parserFactory(buffer);
    const result = await parser.getText();
    const text = result.pages.map((page) => page.text).join("\n").trim();

    if (!hasReadableText(text)) {
      throw new PdfTextExtractionError(
        "no_text",
        "The PDF does not contain readable text."
      );
    }

    return text;
  } catch (error) {
    if (error instanceof PdfTextExtractionError) {
      throw error;
    }

    if (error instanceof PasswordException) {
      throw new PdfTextExtractionError(
        "encrypted",
        "Password-protected PDFs are not supported."
      );
    }

    if (error instanceof InvalidPDFException || error instanceof FormatError) {
      throw new PdfTextExtractionError(
        "malformed",
        "The PDF is malformed or corrupted."
      );
    }

    throw new PdfTextExtractionError(
      "failed",
      "The PDF could not be read."
    );
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Cleanup failures must not replace the classified extraction result.
      }
    }
  }
}
