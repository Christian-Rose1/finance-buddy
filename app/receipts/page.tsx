"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { ReceiptExtraction } from "@/lib/receipts/types";

type StorageFile = {
  name: string;
  created_at: string | null;
};

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function formatMoney(value: number | null): string {
  return value !== null ? `$${value.toFixed(2)}` : "—";
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function ReceiptsPage() {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [extractionError, setExtractionError] = useState("");
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    isImage: boolean;
  } | null>(null);
  const [extraction, setExtraction] = useState<ReceiptExtraction | null>(null);

  async function loadFiles() {
    const supabase = createClient();

    const { data, error } = await supabase.storage.from("receipts").list("", {
      sortBy: {
        column: "created_at",
        order: "desc",
      },
    });

    if (error) {
      console.error(error);
      setError("Failed to load receipt history.");
      return;
    }

    setFiles(data ?? []);
  }

  async function extractReceipt(file: File) {
    setAnalyzing(true);
    setExtractionError("");
    setExtraction(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/receipts/extract", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to analyze receipt.");
      }

      setExtraction(data.receipt as ReceiptExtraction);
    } catch (err: any) {
      setExtractionError(err.message ?? "Failed to analyze receipt.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function uploadReceipt(file: File) {
    setUploading(true);
    setMessage("");
    setError("");
    setExtractionError("");
    setExtraction(null);
    setUploadedFile(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    try {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error("Only JPEG, PNG, WebP, and PDF files are allowed.");
      }

      const supabase = createClient();
      const filename = `${Date.now()}-${crypto.randomUUID()}-${file.name}`;
      const isImage = file.type.startsWith("image/");

      const { error } = await supabase.storage
        .from("receipts")
        .upload(filename, file);

      if (error) throw error;

      if (isImage) {
        setPreviewUrl(URL.createObjectURL(file));
      }
      setUploadedFile({ name: file.name, isImage });

      if (isImage) {
        setMessage("Receipt uploaded successfully.");
        await extractReceipt(file);
      } else {
        setMessage(
          "Receipt uploaded successfully. PDF receipt extraction is not yet supported."
        );
      }

      await loadFiles();
    } catch (err: any) {
      setError(err.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    loadFiles();
  }, []);

  return (
    <main>
      <Nav />

      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="fb-card p-8">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
            Receipt Upload
          </p>

          <h1 className="mt-3 text-3xl font-semibold text-white">
            Upload a Receipt
          </h1>

          <p className="mt-3 text-slate-300">
            Upload a receipt image or PDF to start building product-level
            intelligence.
          </p>

          <label className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-14 text-center transition hover:bg-white/5">
            {uploading || analyzing ? (
              <Loader2 className="h-10 w-10 animate-spin text-sky-300" />
            ) : (
              <UploadCloud className="h-10 w-10 text-sky-300" />
            )}

            <span className="mt-4 text-lg font-medium text-white">
              {uploading
                ? "Uploading..."
                : analyzing
                ? "Analyzing receipt..."
                : "Choose Receipt"}
            </span>

            <span className="mt-1 text-sm text-slate-400">
              JPG, PNG, WebP, or PDF
            </span>

            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
              className="hidden"
              disabled={uploading || analyzing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadReceipt(file);
                e.target.value = "";
              }}
            />
          </label>

          {uploadedFile && (
            <div className="mt-6">
              {uploadedFile.isImage && previewUrl ? (
                <img
                  src={previewUrl}
                  alt={uploadedFile.name}
                  className="max-h-64 w-full rounded-xl border border-white/10 bg-black/20 object-contain"
                />
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-slate-300">
                  <FileText className="h-5 w-5 text-sky-300" />
                  {uploadedFile.name}
                </div>
              )}
            </div>
          )}

          {message && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
              {message}
            </div>
          )}

          {analyzing && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sky-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              Analyzing receipt...
            </div>
          )}

          {error && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
              <AlertCircle className="h-5 w-5" />
              {error}
            </div>
          )}

          {extractionError && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
              <AlertCircle className="h-5 w-5" />
              {extractionError}
            </div>
          )}

          {extraction && (
            <div className="mt-10">
              <h2 className="mb-4 text-xl font-semibold text-white">
                Extracted Receipt
              </h2>

              <div className="rounded-xl border border-white/10 bg-black/20 p-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <div className="text-sm text-slate-400">Merchant</div>
                    <div className="font-medium text-white">
                      {extraction.merchant ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400">Transaction Date</div>
                    <div className="font-medium text-white">
                      {extraction.transaction_date ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400">Total</div>
                    <div className="font-medium text-white">
                      {formatMoney(extraction.total)}
                    </div>
                  </div>
                </div>

                {extraction.items.length > 0 && (
                  <div className="mt-6">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Line Items
                    </h3>

                    <div className="space-y-2">
                      {extraction.items.map((item, index) => (
                        <div
                          key={`${item.name}-${index}`}
                          className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3"
                        >
                          <div>
                            <div className="font-medium text-white">
                              {item.name ?? "Unknown item"}
                            </div>
                            <div className="text-sm text-slate-400">
                              Qty: {item.quantity ?? "—"} · Unit:{" "}
                              {formatMoney(item.unit_price)} · Confidence:{" "}
                              {formatConfidence(item.confidence)}
                            </div>
                          </div>
                          <div className="font-medium text-white">
                            {formatMoney(item.total)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-10">
            <h2 className="mb-4 text-xl font-semibold text-white">
              Recent Receipts
            </h2>

            {files.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-slate-400">
                No receipts uploaded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {files.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-sky-300" />
                      <div>
                        <div className="font-medium text-white">{file.name}</div>
                        <div className="text-sm text-slate-400">
                          {file.created_at
                            ? new Date(file.created_at).toLocaleString()
                            : "Uploaded"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}