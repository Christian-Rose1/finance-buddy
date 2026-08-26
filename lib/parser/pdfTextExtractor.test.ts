import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FormatError, PasswordException } from "pdf-parse";
import {
  extractPdfText,
  PdfTextExtractionError,
  type PdfTextParserFactory,
} from "./pdfTextExtractor";

const pdfBytes = Buffer.from("%PDF-1.7\nmock test document");

function generatedTextPdf(text: string): Buffer {
  const escapedText = text.replace(/([\\()])/g, "\\$1");
  const content = `BT\n/F1 12 Tf\n72 720 Td\n(${escapedText}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "ascii");
}

function parserFactory(input: {
  pages?: Array<{ text: string }>;
  error?: Error;
  onDestroy?: () => void;
}): PdfTextParserFactory {
  return () => ({
    async getText() {
      if (input.error) throw input.error;
      return { pages: input.pages ?? [] };
    },
    async destroy() {
      input.onDestroy?.();
    },
  });
}

function assertPdfError(
  expectedCode: PdfTextExtractionError["code"]
): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof PdfTextExtractionError);
    assert.equal(error.code, expectedCode);
    return true;
  };
}

describe("extractPdfText", () => {
  it("extracts receipt text from a generated PDF through real pdf-parse", async () => {
    const result = await extractPdfText(
      generatedTextPdf("CORNER MARKET TOTAL 4.50")
    );

    assert.match(result, /CORNER MARKET TOTAL 4\.50/);
  });

  it("rejects an empty PDF before constructing a parser", async () => {
    let parserCreated = false;

    await assert.rejects(
      () =>
        extractPdfText(Buffer.alloc(0), () => {
          parserCreated = true;
          throw new Error("must not run");
        }),
      assertPdfError("empty")
    );

    assert.equal(parserCreated, false);
  });

  it("rejects malformed bytes before constructing a parser", async () => {
    let parserCreated = false;

    await assert.rejects(
      () =>
        extractPdfText(Buffer.from("not a PDF"), () => {
          parserCreated = true;
          throw new Error("must not run");
        }),
      assertPdfError("malformed")
    );

    assert.equal(parserCreated, false);
  });

  it("rejects scanned PDFs with no readable text and destroys the parser", async () => {
    let destroyed = false;

    await assert.rejects(
      () =>
        extractPdfText(
          pdfBytes,
          parserFactory({
            pages: [{ text: " \n\t" }],
            onDestroy: () => {
              destroyed = true;
            },
          })
        ),
      assertPdfError("no_text")
    );

    assert.equal(destroyed, true);
  });

  it("classifies encrypted PDFs without exposing parser details", async () => {
    const privateDetail = "password hint: customer secret";

    await assert.rejects(
      () =>
        extractPdfText(
          pdfBytes,
          parserFactory({ error: new PasswordException(privateDetail) })
        ),
      (error: unknown) => {
        assertPdfError("encrypted")(error);
        assert.ok(error instanceof PdfTextExtractionError);
        assert.equal(error.message.includes(privateDetail), false);
        return true;
      }
    );
  });

  it("classifies malformed parser output without exposing parser details", async () => {
    const privateDetail = "raw malformed object contents";

    await assert.rejects(
      () =>
        extractPdfText(
          pdfBytes,
          parserFactory({ error: new FormatError(privateDetail) })
        ),
      (error: unknown) => {
        assertPdfError("malformed")(error);
        assert.ok(error instanceof PdfTextExtractionError);
        assert.equal(error.message.includes(privateDetail), false);
        return true;
      }
    );
  });

  it("returns page text without pdf-parse page decorations", async () => {
    const result = await extractPdfText(
      pdfBytes,
      parserFactory({
        pages: [
          { text: "Store Name\nItem 4.00" },
          { text: "Total 4.00" },
        ],
      })
    );

    assert.equal(result, "Store Name\nItem 4.00\nTotal 4.00");
  });
});
