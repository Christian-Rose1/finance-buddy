import type { StatementTransaction } from "@/lib/purchases/statementTypes";
import {
  CHASE_STATEMENT_FORMAT_DESCRIPTION,
  detectChaseStatementDateContext,
  isSupportedChaseStatement,
  parseTransactions,
} from "./chaseParser";
import { parseCsvStatement } from "./csvStatementParser";
import { extractPdfText } from "./pdfTextExtractor";
import { toStatementTransaction } from "./toStatementTransaction";

export const PDF_STATEMENT_MIME_TYPES = ["application/pdf"] as const;
export const CSV_STATEMENT_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "text/comma-separated-values",
  "application/vnd.ms-excel",
] as const;

export type StatementFileFormat = "chase_pdf" | "csv";

export class StatementFormatError extends Error {
  constructor(
    readonly code: "unsupported_file" | "unsupported_pdf" | "missing_pdf_date",
    message: string
  ) {
    super(message);
    this.name = "StatementFormatError";
  }
}

export interface StatementFileInput {
  data: Buffer;
  mimeType: string;
  filename?: string | null;
}

export interface StatementParserDependencies {
  extractPdfText?: typeof extractPdfText;
}

export interface ParsedStatementFile {
  format: StatementFileFormat;
  transactions: StatementTransaction[];
}

function normalizedMimeType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function filenameExtension(filename?: string | null): string {
  const match = filename?.trim().toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function detectStatementFileFormat(
  mimeType: string,
  filename?: string | null
): StatementFileFormat | null {
  const mime = normalizedMimeType(mimeType);
  const extension = filenameExtension(filename);
  const isPdfMime = PDF_STATEMENT_MIME_TYPES.includes(
    mime as (typeof PDF_STATEMENT_MIME_TYPES)[number]
  );
  const isCsvMime = CSV_STATEMENT_MIME_TYPES.includes(
    mime as (typeof CSV_STATEMENT_MIME_TYPES)[number]
  );

  if (isPdfMime && (!extension || extension === ".pdf")) return "chase_pdf";
  if (isCsvMime && (!extension || extension === ".csv")) return "csv";
  if (!mime && extension === ".pdf") return "chase_pdf";
  if (!mime && extension === ".csv") return "csv";
  return null;
}

export async function parseStatementFile(
  input: StatementFileInput,
  dependencies: StatementParserDependencies = {}
): Promise<ParsedStatementFile> {
  const format = detectStatementFileFormat(input.mimeType, input.filename);
  if (!format) {
    throw new StatementFormatError(
      "unsupported_file",
      "Supported statement files are CSV exports and text-based Chase credit-card PDFs."
    );
  }

  if (format === "csv") {
    return {
      format,
      transactions: parseCsvStatement(input.data),
    };
  }

  const text = await (dependencies.extractPdfText ?? extractPdfText)(input.data);
  if (!isSupportedChaseStatement(text)) {
    throw new StatementFormatError(
      "unsupported_pdf",
      `Unsupported statement format. Upload a ${CHASE_STATEMENT_FORMAT_DESCRIPTION} or a CSV export.`
    );
  }

  const dateContext = detectChaseStatementDateContext(text);
  if (!dateContext) {
    throw new StatementFormatError(
      "missing_pdf_date",
      "Could not determine the statement date from the PDF."
    );
  }

  return {
    format,
    transactions: parseTransactions(text).map((transaction) =>
      toStatementTransaction(
        transaction,
        dateContext.closingYear,
        dateContext.closingMonth
      )
    ),
  };
}
