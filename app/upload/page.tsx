import { Nav } from '@/components/nav';
import { UploadCloud } from 'lucide-react';

export default function UploadPage() {
  return (
    <main>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="fb-card p-8">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Statement upload</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Upload your Chase PDF</h1>
          <p className="mt-3 text-slate-300">
            This page will become the statement intake flow. For now it gives you a clean starting point.
          </p>

          <label className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-14 text-center transition hover:bg-white/5">
            <UploadCloud className="h-10 w-10 text-sky-300" />
            <span className="mt-4 text-lg font-medium text-white">Drop PDF here</span>
            <span className="mt-1 text-sm text-slate-400">Chase statement PDFs only for the MVP</span>
            <input type="file" accept="application/pdf" className="hidden" />
          </label>
        </div>
      </div>
    </main>
  );
}
