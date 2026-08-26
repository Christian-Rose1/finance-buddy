import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdfTextExtractionError } from "@/lib/parser/pdfTextExtractor";
import {
  OllamaReceiptExtractionProvider,
  ReceiptExtractionError,
} from "./ollamaProvider";

const validModelReceipt = {
  merchant: "Corner Market",
  transaction_date: "2026-08-25",
  currency: "usd",
  items: [
    {
      name: "Milk",
      price: 4.5,
      quantity: 1,
      confidence: 0.95,
    },
  ],
  subtotal: 4.5,
  tax: 0,
  tip: null,
  discount: null,
  total: 4.5,
  confidence: 0.9,
  source: "ollama",
};

function ollamaResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      message: { content },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("OllamaReceiptExtractionProvider", () => {
  it("keeps the existing image request path for supported receipt images", async () => {
    const imageBytes = Buffer.from("mock image bytes");
    let pdfExtractionCalls = 0;
    const requestBodies: Array<Record<string, unknown>> = [];
    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test",
      "receipt-vision-model",
      {
        extractPdfText: async () => {
          pdfExtractionCalls += 1;
          return "must not run";
        },
        fetch: async (_input, init) => {
          requestBodies.push(JSON.parse(String(init?.body)));
          return ollamaResponse(JSON.stringify(validModelReceipt));
        },
      }
    );

    await provider.extractReceipt({
      data: imageBytes,
      mimeType: "image/png",
    });

    const messages = requestBodies[0].messages as Array<Record<string, unknown>>;
    assert.deepEqual(messages[0].images, [imageBytes.toString("base64")]);
    assert.equal(pdfExtractionCalls, 0);
  });

  it("keeps JPEG, PNG, and WebP on the image request path", async () => {
    const imageBytes = Buffer.from("unchanged image payload");
    const requestBodies: Array<Record<string, unknown>> = [];
    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test",
      "receipt-vision-model",
      {
        extractPdfText: async () => {
          throw new Error("image inputs must not use PDF extraction");
        },
        fetch: async (_input, init) => {
          requestBodies.push(JSON.parse(String(init?.body)));
          return ollamaResponse(JSON.stringify(validModelReceipt));
        },
      }
    );

    for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
      await provider.extractReceipt({ data: imageBytes, mimeType });
    }

    assert.equal(requestBodies.length, 3);
    for (const requestBody of requestBodies) {
      const messages = requestBody.messages as Array<Record<string, unknown>>;
      assert.deepEqual(messages[0].images, [imageBytes.toString("base64")]);
      assert.equal(String(messages[0].content).includes("<receipt_text>"), false);
    }
  });

  it("sends extracted PDF text to the configured model without image data", async () => {
    const receiptText = "CORNER MARKET\nMILK 4.50\nTOTAL 4.50";
    const privateFilename = "customer-123-storage-private-receipt-name.pdf";
    let requestedUrl = "";
    const requestBodies: Array<Record<string, unknown>> = [];

    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test/",
      "receipt-text-model",
      {
        extractPdfText: async () => receiptText,
        fetch: async (input, init) => {
          requestedUrl = String(input);
          requestBodies.push(JSON.parse(String(init?.body)));
          return ollamaResponse(JSON.stringify(validModelReceipt));
        },
      }
    );

    const privateInput = {
      data: Buffer.from("%PDF-1.7 mocked"),
      mimeType: "application/pdf",
      filename: privateFilename,
      storagePath: "customer-123/receipts/private.pdf",
      customerId: "customer-123",
      internalId: "draft-private-456",
    };
    const receipt = await provider.extractReceipt(privateInput);

    assert.equal(requestedUrl, "http://ollama.test/api/chat");
    assert.equal(requestBodies.length, 1);
    const requestBody = requestBodies[0];
    assert.equal(requestBody.model, "receipt-text-model");
    const messages = requestBody.messages as Array<Record<string, unknown>>;
    assert.equal(messages.length, 1);
    assert.match(String(messages[0].content), /CORNER MARKET/);
    assert.equal("images" in messages[0], false);
    assert.equal(JSON.stringify(requestBody).includes(privateFilename), false);
    assert.equal(JSON.stringify(requestBody).includes("customer-123"), false);
    assert.equal(JSON.stringify(requestBody).includes("draft-private-456"), false);
    assert.equal(receipt.currency, "USD");
    assert.equal(receipt.items[0].unit_price, 4.5);
    assert.equal(receipt.source, "ollama");
  });

  it("does not call Ollama when a PDF is scanned", async () => {
    let fetchCalls = 0;
    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test",
      "receipt-text-model",
      {
        extractPdfText: async () => {
          throw new PdfTextExtractionError(
            "no_text",
            "The PDF does not contain readable text."
          );
        },
        fetch: async () => {
          fetchCalls += 1;
          return ollamaResponse(JSON.stringify(validModelReceipt));
        },
      }
    );

    await assert.rejects(
      () =>
        provider.extractReceipt({
          data: Buffer.from("%PDF-1.7 mocked"),
          mimeType: "application/pdf",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ReceiptExtractionError);
        assert.equal(error.code, "pdf_no_text");
        return true;
      }
    );
    assert.equal(fetchCalls, 0);
  });

  it("rejects oversized extracted PDF text before calling Ollama", async () => {
    let fetchCalls = 0;
    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test",
      "receipt-text-model",
      {
        extractPdfText: async () => "X".repeat(100_001),
        fetch: async () => {
          fetchCalls += 1;
          return ollamaResponse(JSON.stringify(validModelReceipt));
        },
      }
    );

    await assert.rejects(
      () =>
        provider.extractReceipt({
          data: Buffer.from("%PDF-1.7 mocked"),
          mimeType: "application/pdf",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ReceiptExtractionError);
        assert.equal(error.code, "pdf_too_large");
        return true;
      }
    );
    assert.equal(fetchCalls, 0);
  });

  it("does not expose malformed model output in errors", async () => {
    const privateOutput = "customer line items and account data";
    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test",
      "receipt-text-model",
      {
        extractPdfText: async () => "STORE\nTOTAL 1.00",
        fetch: async () => ollamaResponse(`not-json ${privateOutput}`),
      }
    );

    await assert.rejects(
      () =>
        provider.extractReceipt({
          data: Buffer.from("%PDF-1.7 mocked"),
          mimeType: "application/pdf",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ReceiptExtractionError);
        assert.equal(error.code, "invalid_output");
        assert.equal(error.message.includes(privateOutput), false);
        assert.equal(JSON.stringify(error).includes(privateOutput), false);
        assert.equal("details" in error, false);
        return true;
      }
    );
  });

  it("rejects structurally incomplete provider JSON", async () => {
    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test",
      "receipt-text-model",
      {
        extractPdfText: async () => "STORE\nTOTAL 1.00",
        fetch: async () => ollamaResponse("{}"),
      }
    );

    await assert.rejects(
      () =>
        provider.extractReceipt({
          data: Buffer.from("%PDF-1.7 mocked"),
          mimeType: "application/pdf",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ReceiptExtractionError);
        assert.equal(error.code, "invalid_output");
        return true;
      }
    );
  });

  it("keeps invalid structured output values out of validation errors", async () => {
    const privateOutput = "private merchant output";
    const provider = new OllamaReceiptExtractionProvider(
      "http://ollama.test",
      "receipt-text-model",
      {
        extractPdfText: async () => "STORE\nTOTAL 1.00",
        fetch: async () =>
          ollamaResponse(
            JSON.stringify({
              ...validModelReceipt,
              merchant: privateOutput,
              total: -1,
            })
          ),
      }
    );

    await assert.rejects(
      () =>
        provider.extractReceipt({
          data: Buffer.from("%PDF-1.7 mocked"),
          mimeType: "application/pdf",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ReceiptExtractionError);
        assert.equal(error.code, "invalid_output");
        assert.equal(error.message.includes(privateOutput), false);
        assert.equal(JSON.stringify(error).includes(privateOutput), false);
        return true;
      }
    );
  });
});
