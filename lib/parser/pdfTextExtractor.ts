import { PDFParse } from "pdf-parse";

/**
 * Extracts raw text from a PDF buffer using pdf-parse v2 (class-based API).
 *
 * This module is the ONLY place in the codebase that imports pdf-parse, so
 * the dependency stays isolated and can be swapped without touching the
 * parser logic or API routes.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}