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
import { formatMoney } from "@/lib/purchases/formatMoney";
import { MAX_STATEMENT_FILE_BYTES } from "@/lib/uploads/policy";

type StorageFile = {
  name: string;
  created_at: string | null;
};

type ParsedTransaction = {
  date: string;
  merchant: string;
  amount: number;
  currency: string | null;
  category: string | null;
};

const CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "text/comma-separated-values",
  "application/vnd.ms-excel",
]);

function statementFileType(file: File): "pdf" | "csv" | null {
  const mimeType = file.type.toLowerCase();
  const filename = file.name.toLowerCase();
  const extension = filename.endsWith(".pdf")
    ? ".pdf"
    : filename.endsWith(".csv")
      ? ".csv"
      : "";

  if (mimeType === "application/pdf" && (!extension || extension === ".pdf")) {
    return "pdf";
  }
  if (CSV_MIME_TYPES.has(mimeType) && (!extension || extension === ".csv")) {
    return "csv";
  }
  if (!mimeType && extension === ".pdf") return "pdf";
  if (!mimeType && extension === ".csv") return "csv";
  return null;
}

export function StatementUploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
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

    const { data, error } = await supabase.storage.from("statements").list(userData.user.id, {
      sortBy: {
        column: "created_at",
        order: "desc",
      },
    });

    if (error) {
      console.error(error);
      return;
    }

    setFiles(data ?? []);
  }

  async function parseStatement(file: File, storagePath: string) {
    setParsing(true);
    setError("");
    setConfirmationError("");
    setDraftId(null);
    setConfirmed(false);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("storagePath", storagePath);

      const response = await fetch("/api/parse-statement", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to parse statement.");
      }
      if (typeof data.draftId !== "string") {
        throw new Error("Statement review could not be prepared.");
      }

      setTransactions(data.transactions ?? []);
      setDraftId(data.draftId);
      setMessage("Statement parsed. Review every transaction before saving.");
    } catch (err: any) {
      setError(err.message ?? "Parsing failed.");
    } finally {
      setParsing(false);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setMessage("");
    setError("");
    setConfirmationError("");
    setTransactions([]);
    setDraftId(null);
    setConfirmed(false);

    try {
      const format = statementFileType(file);
      if (!format) {
        throw new Error(
          "Only CSV exports and text-based Chase PDF statements are allowed."
        );
      }

      if (file.size > MAX_STATEMENT_FILE_BYTES) {
        throw new Error("Statement files must be 20 MB or smaller.");
      }

      const supabase = createClient();
      const { data: userData, error: authError } = await supabase.auth.getUser();

      if (authError || !userData.user) {
        throw new Error("Authentication required. Please sign in first.");
      }

      const filename = `${userData.user.id}/${Date.now()}-${crypto.randomUUID()}-${file.name}`;

      const { error } = await supabase.storage
        .from("statements")
        .upload(filename, file, {
          contentType: format === "csv" ? "text/csv" : "application/pdf",
        });

      if (error) throw error;

      setMessage("Statement uploaded. Preparing review...");

      await loadFiles();
      await parseStatement(file, filename);
    } catch (err: any) {
      setError(err.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function confirmStatementImport() {
    if (!draftId) return;
    setConfirming(true);
    setConfirmationError("");

    try {
      const response = await fetch("/api/parse-statement", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to save approved statement.");
      }

      setConfirmed(true);
      setMessage(
        data.alreadyConfirmed
          ? "This statement was already approved and saved."
          : `${data.purchaseCount} approved purchases saved.`
      );
    } catch (err: unknown) {
      setConfirmationError(
        err instanceof Error
          ? err.message
          : "Failed to save approved statement. Please retry."
      );
    } finally {
      setConfirming(false);
    }
  }

  async function discardStatementImport() {
    if (!draftId) return;
    setDiscarding(true);
    setConfirmationError("");

    try {
      const response = await fetch("/api/parse-statement", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to discard statement import.");
      }

      setDraftId(null);
      setTransactions([]);
      setMessage("Statement import discarded. Upload it again to retry.");
    } catch (err: unknown) {
      setConfirmationError(
        err instanceof Error
          ? err.message
          : "Failed to discard statement import."
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
        Statement Upload
      </p>

      <h1 className="mt-3 text-3xl font-semibold text-white">
        Upload a Statement
      </h1>

      <p className="mt-3 text-slate-300">
        Upload a CSV export or a text-based Chase credit-card PDF to begin
        building your financial history.
      </p>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || parsing || confirming || discarding}
        aria-describedby="statement-upload-formats"
        className="mt-8 flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-14 text-center transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading || parsing ? (
          <Loader2 className="h-10 w-10 animate-spin text-sky-300" />
        ) : (
          <UploadCloud className="h-10 w-10 text-sky-300" />
        )}

        <span className="mt-4 text-lg font-medium text-white">
          {uploading
            ? "Uploading..."
            : parsing
              ? "Parsing..."
              : "Choose Statement"}
        </span>

        <span id="statement-upload-formats" className="mt-1 text-sm text-slate-400">
          CSV exports or text-based Chase credit-card PDFs
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,text/csv,application/csv,text/comma-separated-values,application/vnd.ms-excel,.pdf,.csv"
        className="hidden"
        disabled={uploading || parsing || confirming || discarding}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file);
          e.target.value = "";
        }}
      />

      {message && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
          <CheckCircle2 className="h-5 w-5" />
          {message}
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {confirmationError && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <AlertCircle className="h-5 w-5" />
          {confirmationError}
        </div>
      )}

      {transactions.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-4 text-xl font-semibold text-white">
            Review Transactions ({transactions.length})
          </h2>

          <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {transactions.map((tx, index) => (
              <div
                key={`${tx.date}-${tx.merchant}-${index}`}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-sky-300" />
                  <div>
                    <div className="font-medium text-white">{tx.merchant}</div>
                    <div className="text-sm text-slate-400">
                      {tx.date} · {tx.category ?? "Uncategorized"}
                    </div>
                  </div>
                </div>
                <div className="text-right font-medium text-white">
                  {formatMoney(tx.amount, tx.currency)}
                </div>
              </div>
            ))}
          </div>

          {draftId && !confirmed && (
            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="text-sm font-medium text-amber-200">
                Not saved. Approval saves all {transactions.length} transactions
                together.
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={confirmStatementImport}
                  disabled={confirming || discarding}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {confirming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {confirmationError ? "Retry save" : "Approve and save all"}
                </button>
                <button
                  type="button"
                  onClick={discardStatementImport}
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
      )}

      <div className="mt-10">
        <h2 className="mb-4 text-xl font-semibold text-white">
          Uploaded Statements
        </h2>

        {files.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-slate-400">
            No statements uploaded yet.
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
