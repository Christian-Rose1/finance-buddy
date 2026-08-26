"use client";

import { useState } from "react";
import { Nav } from "@/components/nav";
import { ReceiptUploadPanel } from "@/components/receipt-upload-panel";
import { StatementUploadPanel } from "@/components/statement-upload-panel";
import { AuthGuard } from "@/components/auth-guard";

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<"receipt" | "statement">("receipt");

  return (
    <AuthGuard>
      <main>
        <Nav />

      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-white">Add Your Data</h1>

        <p className="mt-3 text-slate-300">
          Upload receipts and statements so Finance Buddy can understand your
          spending and build better points strategies.
        </p>

        <div className="mt-8 flex gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("receipt")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === "receipt"
                ? "bg-sky-500/20 text-sky-300"
                : "text-slate-400 hover:bg-white/5"
            }`}
            aria-pressed={activeTab === "receipt"}
          >
            Receipt
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("statement")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === "statement"
                ? "bg-sky-500/20 text-sky-300"
                : "text-slate-400 hover:bg-white/5"
            }`}
            aria-pressed={activeTab === "statement"}
          >
            Statement
          </button>
        </div>

        <div className="mt-8">
          <div
            className={activeTab === "receipt" ? "block" : "hidden"}
            aria-hidden={activeTab !== "receipt"}
          >
            <ReceiptUploadPanel />
          </div>

          <div
            className={activeTab === "statement" ? "block" : "hidden"}
            aria-hidden={activeTab !== "statement"}
          >
            <StatementUploadPanel />
          </div>
        </div>
      </div>
      </main>
    </AuthGuard>
  );
}
