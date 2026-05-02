'use client';

import { useEffect, useRef, useState } from 'react';

type JobStatus = 'queued' | 'processing' | 'retry_wait' | 'succeeded' | 'failed';

type Job = {
  id: string;
  status: JobStatus;
  public_url: string | null;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  ocr_provider: string | null;
  ocr_model: string | null;
  created_at: string;
};

const safeJson = async (res: Response) => {
  const text = await res.text();
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
};

const getObj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

export default function UploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/ocr-jobs?limit=10');
      const { json, text } = await safeJson(res);
      const obj = getObj(json);
      if (!res.ok) throw new Error(String(obj?.error ?? text ?? 'Failed to load jobs'));
      setJobs(Array.isArray(obj?.jobs) ? (obj.jobs as Job[]) : []);
    } catch {
      setJobs([]);
    }
  };

  useEffect(() => {
    fetchJobs();
    const t = window.setInterval(fetchJobs, 4000);
    return () => window.clearInterval(t);
  }, []);

  const onPick = (f: File | null) => {
    setError(null);
    setFile(f);
    if (!f) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  };

  const onUpload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/process', { method: 'POST', body: form });
      const { json, text } = await safeJson(res);
      const obj = getObj(json);
      if (!res.ok) throw new Error(String(obj?.error ?? text ?? 'Upload failed'));
      await fetchJobs();
      setFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-white text-2xl font-black">Upload invoice</h1>
            <p className="text-slate-400 text-sm mt-1">Staff can only upload and track OCR jobs.</p>
          </div>
          <button
            onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}
            className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-sm font-semibold hover:border-slate-500"
          >
            Logout
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-white font-bold">New scan</div>
            <div className="text-sm text-slate-400 mt-1">Choose an image and upload.</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              className="mt-4 block w-full text-sm text-slate-300"
            />
            {previewUrl && (
              <div className="mt-4 rounded-xl overflow-hidden border border-slate-800 bg-black/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Preview" className="w-full object-contain max-h-[420px]" />
              </div>
            )}
            {error && (
              <div className="mt-4 text-sm text-rose-200 bg-rose-950/30 border border-rose-900/40 rounded-xl px-4 py-3">
                {error}
              </div>
            )}
            <button
              disabled={!file || busy}
              onClick={onUpload}
              className="mt-4 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60"
            >
              {busy ? 'Uploading…' : 'Upload & OCR'}
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="text-white font-bold">My OCR jobs</div>
              <button onClick={fetchJobs} className="text-xs text-slate-400 hover:text-slate-200">Refresh</button>
            </div>
            <div className="mt-4 space-y-2">
              {jobs.length === 0 ? (
                <div className="text-sm text-slate-500 py-8 text-center">No jobs yet.</div>
              ) : (
                jobs.map((j) => (
                  <div key={j.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-slate-200 font-semibold">Job {j.id.slice(0, 8)}</div>
                      <div className="text-xs text-slate-400">{j.status}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {j.ocr_model ? `${j.ocr_provider || 'gemini'}/${j.ocr_model}` : ''} · attempt {j.attempts}/{j.max_attempts}
                    </div>
                    {j.error_message && (
                      <div className="mt-2 text-xs text-rose-200">{j.error_message}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
