"use client";

/* Agreements — BreezeDoc-style e-signature documents. List + create.
 *   GET  /api/agreements        list
 *   POST /api/agreements        create (blocknote | pdf) → open editor
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileSignature, Plus, Loader2, Users, CheckCircle2, PenLine, Upload, LayoutTemplate, X } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Row = { id: string; title: string; status: string; updatedAt: string; partyCount: number; signedCount: number };

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  SENT: "bg-blue-50 text-blue-700",
  PARTIALLY_SIGNED: "bg-amber-50 text-amber-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  VOIDED: "bg-red-50 text-red-700",
};

export default function AgreementsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useOsToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const newHandled = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agreements");
      if (!res.ok) { setRows([]); return; }
      const j = await res.json();
      setRows(Array.isArray(j) ? j : (j.data ?? []));
    } catch { setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const createWith = useCallback(async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/agreements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't create"); return; }
      const j = await res.json();
      const a = j.data ?? j;
      if (a?.id) router.push(`/agreements/${a.id}`);
      else toast("Couldn't create");
    } catch { toast("Couldn't create"); } finally { setBusy(false); }
  }, [busy, router, toast]);

  async function onPickPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) { toast("Upload failed"); return; }
      const uj = await up.json();
      const url = uj.url ?? uj.data?.url;
      if (!url) { toast("Upload failed"); return; }
      setBusy(false); // createWith manages its own busy flag
      await createWith({ sourceType: "pdf", pdfUrl: url, title: file.name.replace(/\.pdf$/i, "") });
    } catch { toast("Upload failed"); setBusy(false); }
  }

  // Sidebar "+" routes here with ?new=1 — open the create chooser.
  useEffect(() => {
    if (search?.get("new") === "1" && !newHandled.current) { newHandled.current = true; setShowNew(true); }
  }, [search]);

  return (
    <>
      <OsTitleBar
        title="Agreements"
        Icon={FileSignature}
        iconGradient={GRAD.indigoBlue}
        showStandardActions={false}
        description={rows === null ? "Loading…" : `${rows.length} agreement${rows.length === 1 ? "" : "s"}`}
        actions={
          <button type="button" onClick={() => setShowNew(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500">
            <Plus className="h-3.5 w-3.5" /> New agreement
          </button>
        }
      />
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPickPdf} />

      <div className="mx-auto max-w-5xl px-6 py-8">
        {rows === null ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center">
            <FileSignature className="mx-auto h-8 w-8 text-zinc-300" />
            <div className="mt-3 text-sm font-medium text-zinc-700">No agreements yet</div>
            <div className="mt-1 text-[13px] text-zinc-500">Write or upload a document, add signers, place signature fields, and send it for signature.</div>
            <button type="button" onClick={() => setShowNew(true)} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500">
              <Plus className="h-4 w-4" /> New agreement
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <Link key={r.id} href={`/agreements/${r.id}`} className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{r.title}</div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[r.status] ?? "bg-zinc-100 text-zinc-600"}`}>{r.status.replace(/_/g, " ").toLowerCase()}</span>
                </div>
                <div className="mt-3 flex items-center gap-3 text-[12px] text-zinc-400">
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {r.partyCount} part{r.partyCount === 1 ? "y" : "ies"}</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {r.signedCount} signed</span>
                  <span className="ml-auto">{new Date(r.updatedAt).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showNew ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && setShowNew(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900">New agreement</h2>
              <button type="button" onClick={() => !busy && setShowNew(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-4 text-[13px] text-zinc-500">Choose how you want to start.</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <ChooserCard Icon={PenLine} title="Write" sub="Author a document in the editor" disabled={busy} onClick={() => createWith({ sourceType: "blocknote" })} />
              <ChooserCard Icon={Upload} title="Upload PDF" sub="Start from an existing PDF" disabled={busy} onClick={() => fileRef.current?.click()} />
              <ChooserCard Icon={LayoutTemplate} title="Template" sub="No templates yet" disabled onClick={() => toast("Save an agreement as a template first")} />
            </div>
            {busy ? <div className="mt-4 flex items-center gap-2 text-[13px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Working…</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChooserCard({ Icon, title, sub, onClick, disabled }: { Icon: typeof PenLine; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex flex-col items-start gap-2 rounded-xl border border-zinc-200 p-3.5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-200 disabled:hover:bg-transparent">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Icon className="h-5 w-5" /></span>
      <span className="text-[13px] font-semibold text-zinc-900">{title}</span>
      <span className="text-[11px] leading-snug text-zinc-500">{sub}</span>
    </button>
  );
}
