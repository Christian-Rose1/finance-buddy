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

type StorageFile = {
  name: string;
  created_at?: string;
};

export default function UploadPage() {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<StorageFile[]>([]);

  async function loadFiles() {
    const supabase = createClient();

    const { data, error } = await supabase.storage
      .from("statements")
      .list("", {
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

  useEffect(() => {
    loadFiles();
  }, []);

  async function uploadFile(file: File) {
    setUploading(true);
    setMessage("");
    setError("");

    try {
      const supabase = createClient();

      const filename = `${Date.now()}-${file.name}`;

      const { error } = await supabase.storage
        .from("statements")
        .upload(filename, file);

      if (error) throw error;

      setMessage("Statement uploaded successfully.");

      await loadFiles();
    } catch (err: any) {
      setError(err.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main>
      <Nav />

      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="fb-card p-8">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
            Statement Upload
          </p>

          <h1 className="mt-3 text-3xl font-semibold text-white">
            Upload your Chase Statement
          </h1>

          <p className="mt-3 text-slate-300">
            Upload a Chase PDF to begin building your financial history.
          </p>

          <label className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-14 text-center transition hover:bg-white/5">

            {uploading ? (
              <Loader2 className="h-10 w-10 animate-spin text-sky-300" />
            ) : (
              <UploadCloud className="h-10 w-10 text-sky-300" />
            )}

            <span className="mt-4 text-lg font-medium text-white">
              {uploading ? "Uploading..." : "Choose PDF"}
            </span>

            <span className="mt-1 text-sm text-slate-400">
              Chase statement PDFs only
            </span>

            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];

                if (file) {
                  uploadFile(file);
                }
              }}
            />
          </label>

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
                        <div className="font-medium text-white">
                          {file.name}
                        </div>

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