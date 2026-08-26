"use client";

import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Save,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { ReceiptExtraction } from "@/lib/receipts/types";
import type { ReceiptSavingsResult } from "@/lib/receipts/savings";
import { MAX_RECEIPT_FILE_BYTES } from "@/lib/uploads/policy";

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

function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  const code = currency?.trim().toUpperCase();
  return code ? `${code} ${value.toFixed(2)}` : `${value.toFixed(2)} (currency unknown)`;
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ReceiptUploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [extractionError, setExtractionError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    isImage: boolean;
  } | null>(null);
  const [extraction, setExtraction] = useState<ReceiptExtraction | null>(null);
  const [savings, setSavings] = useState<ReceiptSavingsResult | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function loadFiles() {
    const supabase = createClient();
    const { data: userData, error: authError } = await supabase.auth.getUser();

    if (authError || !userData.user) {
      setError("Authentication required. Please sign in first.");
      return;
    }

    const { data, error } = await supabase.storage.from("receipts").list(userData.user.id, {
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

  async function extractReceipt(file: File, storagePath: string) {
    setAnalyzing(true);
    setExtractionError("");
    setConfirmationError("");
    setExtraction(null);
    setSavings(null);
    setDraftId(null);
    setConfirmed(false);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("storagePath", storagePath);

      const response = await fetch("/api/receipts/extract", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to analyze receipt.");
      }
      if (typeof data.draftId !== "string") {
        throw new Error("Receipt review could not be prepared.");
      }

      setExtraction(data.receipt as ReceiptExtraction);
      setSavings(data.savings as ReceiptSavingsResult);
      setDraftId(data.draftId);
      setMessage("Receipt extracted. Review it before saving.");
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
    setConfirmationError("");
    setExtraction(null);
    setSavings(null);
    setDraftId(null);
    setConfirmed(false);
    setUploadedFile(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    try {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error("Only JPEG, PNG, WebP, and PDF files are allowed.");
      }

      if (file.size > MAX_RECEIPT_FILE_BYTES) {
        throw new Error("Receipt files must be 10 MB or smaller.");
      }

      const supabase = createClient();
      const { data: userData, error: authError } = await supabase.auth.getUser();

      if (authError || !userData.user) {
        throw new Error("Authentication required. Please sign in first.");
      }

      const filename = `${userData.user.id}/${Date.now()}-${crypto.randomUUID()}-${file.name}`;
      const isImage = file.type.startsWith("image/");

      const { error } = await supabase.storage
        .from("receipts")
        .upload(filename, file);

      if (error) throw error;

      if (isImage) {
        setPreviewUrl(URL.createObjectURL(file));
      }
      setUploadedFile({ name: file.name, isImage });

      setMessage("Receipt uploaded. Preparing review...");
      await extractReceipt(file, filename);

      await loadFiles();
    } catch (err: any) {
      setError(err.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function confirmReceiptImport() {
    if (!draftId) return;
    setConfirming(true);
    setConfirmationError("");

    try {
      const response = await fetch("/api/receipts/extract", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to save approved receipt.");
      }

      setConfirmed(true);
      setMessage(
        data.alreadyConfirmed
          ? "This receipt was already approved and saved."
          : "Receipt approved and saved."
      );
    } catch (err: unknown) {
      setConfirmationError(
        err instanceof Error
          ? err.message
          : "Failed to save approved receipt. Please retry."
      );
    } finally {
      setConfirming(false);
    }
  }

  async function discardReceiptImport() {
    if (!draftId) return;
    setDiscarding(true);
    setConfirmationError("");

    try {
      const response = await fetch("/api/receipts/extract", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to discard receipt import.");
      }

      setDraftId(null);
      setExtraction(null);
      setSavings(null);
      setMessage("Receipt import discarded. Upload it again to retry.");
    } catch (err: unknown) {
      setConfirmationError(
        err instanceof Error ? err.message : "Failed to discard receipt import."
      );
    } finally {
      setDiscarding(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadFiles();
    })();
  }, []);

  return (
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

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || analyzing || confirming || discarding}
        aria-describedby="receipt-upload-formats"
        className="mt-8 flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-14 text-center transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
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

        <span id="receipt-upload-formats" className="mt-1 text-sm text-slate-400">
          JPG, PNG, WebP, or text-based PDF
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
        className="hidden"
        disabled={uploading || analyzing || confirming || discarding}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadReceipt(file);
          e.target.value = "";
        }}
      />

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

      {confirmationError && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <AlertCircle className="h-5 w-5" />
          {confirmationError}
        </div>
      )}

      {extraction && (
        <div className="mt-10">
          <h2 className="mb-4 text-xl font-semibold text-white">
            Review Receipt
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
                <div className="text-sm text-slate-400">Subtotal</div>
                <div className="font-medium text-white">
                  {formatMoney(extraction.subtotal, extraction.currency)}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Already Saved</div>
                <div className="font-medium text-emerald-300">
                  {formatMoney(extraction.discount, extraction.currency)}
                </div>
                <div className="text-xs text-slate-500">
                  Discounts & coupons applied
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Tax</div>
                <div className="font-medium text-white">
                  {formatMoney(extraction.tax, extraction.currency)}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Total</div>
                <div className="font-medium text-white">
                  {formatMoney(extraction.total, extraction.currency)}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="text-sm text-slate-400">Already Saved</div>
                <div className="mt-1 text-xl font-semibold text-emerald-300">
                  {formatMoney(savings?.alreadySaved ?? null, extraction.currency)}
                </div>
                <div className="text-xs text-slate-500">
                  Discounts and coupons shown on this receipt
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
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-white">
                            {item.name ?? "Unknown item"}
                          </div>
                          <div className="mt-0.5 text-sm text-slate-400">
                            <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-xs text-sky-300">
                              {item.category ?? "Other"}
                            </span>
                          </div>
                          <div className="mt-1.5 text-sm text-slate-400">
                            Qty: {item.quantity ?? "—"} · Unit:{" "}
                            {formatMoney(item.unit_price, extraction.currency)} · Confidence:{" "}
                            {formatConfidence(item.confidence)}
                          </div>
                          {item.discount != null && item.discount > 0 && (
                            <div className="mt-0.5 text-sm text-emerald-300">
                              Item discount: -{formatMoney(item.discount, extraction.currency)}
                            </div>
                          )}
                        </div>
                        <div className="font-medium text-white">
                          {formatMoney(item.total, extraction.currency)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {draftId && !confirmed && (
              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="text-sm font-medium text-amber-200">
                  Not saved. Approve only after reviewing the extracted details.
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={confirmReceiptImport}
                    disabled={confirming || discarding}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {confirming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {confirmationError ? "Retry save" : "Approve and save"}
                  </button>
                  <button
                    type="button"
                    onClick={discardReceiptImport}
                    disabled={confirming || discarding}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 font-medium text-slate-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {discarding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Discard
                  </button>
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
  );
}
