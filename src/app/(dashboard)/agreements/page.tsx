"use client";

/* Agreements — BreezeDoc-style e-signature documents.
 * Folders (by category) + a Templates view; create via Write / Upload PDF /
 * Use template.
 *   GET  /api/agreements[?templates=1]
 *   POST /api/agreements   (blocknote | pdf | fromTemplateId)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileSignature, Plus, Loader2, Users, CheckCircle2, PenLine, Upload, LayoutTemplate, X, Folder } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Row = { id: string; title: string; status: string; category: string | null; isTemplate: boolean; updatedAt: string; partyCount: number; signedCount: number };

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
  const view = search?.get("view") === "templates" ? "templates" : "agreements";

  const [rows, setRows] = useState<Row[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [step, setStep] = useState<"choose" | "template">("choose");
  const [templates, setTemplates] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const newHandled = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agreements${view === "templates" ? "?templates=1" : ""}`);
      if (!res.ok) { setRows([]); return; }
      const j = await res.json();
      setRows(Array.isArray(j) ? j : (j.data ?? []));
    } catch { setRows([]); }
  }, [view]);
  useEffect(() => { setRows(null); void load(); }, [load]);

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
    if (!file || busy) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) { toast("Upload failed"); return; }
      const uj = await up.json();
      const url = uj.url ?? uj.data?.url;
      if (!url) { toast("Upload failed"); return; }
      setBusy(false);
      await createWith({ sourceType: "pdf", pdfUrl: url, title: file.name.replace(/\.pdf$/i, "") });
    } catch { toast("Upload failed"); setBusy(false); }
  }

  async function openTemplatePicker() {
    setStep("template");
    if (templates === null) {
      try { const r = await fetch("/api/agreements?templates=1"); const j = await r.json(); setTemplates(Array.isArray(j) ? j : (j.data ?? [])); }
      catch { setTemplates([]); }
    }
  }
  function openNew() { setStep("choose"); setShowNew(true); }
  function newTemplate() { void createWith({ isTemplate: true }); }

  useEffect(() => {
    if (search?.get("new") === "1" && !newHandled.current) { newHandled.current = true; openNew(); }
  }, [search]);

  // Group live agreements into folders by category. Templates view is flat.
  const groups = (() => {
    const list = rows ?? [];
    if (view === "templates") return [{ name: "Templates", items: list }];
    const m = new Map<string, Row[]>();
    for (const r of list) { const c = r.category || "Uncategorized"; (m.get(c) ?? m.set(c, []).get(c)!).push(r); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({ name, items }));
  })();

  return (
    <>
      <OsTitleBar
        title={view === "templates" ? "Contract templates" : "Contracts"}
        Icon={view === "templates" ? Folder : FileSignature}
        iconGradient={GRAD.indigoBlue}
        showStandardActions={false}
        description={rows === null ? "Loading…" : `${rows.length} ${view === "templates" ? "template" : "contract"}${rows.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={view === "templates" ? "/agreements" : "/agreements?view=templates"} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              {view === "templates" ? <><FileSignature className="h-3.5 w-3.5" /> All contracts</> : <><Folder className="h-3.5 w-3.5" /> Templates</>}
            </Link>
            {view === "templates" ? (
              <button type="button" onClick={newTemplate} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} New template
              </button>
            ) : (
              <button type="button" onClick={openNew} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500">
                <Plus className="h-3.5 w-3.5" /> New contract
              </button>
            )}
          </div>
        }
      />
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPickPdf} />

      <div className="mx-auto max-w-5xl px-6 py-8">
        {rows === null ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center">
            <FileSignature className="mx-auto h-8 w-8 text-zinc-300" />
            <div className="mt-3 text-sm font-medium text-zinc-700">{view === "templates" ? "No templates yet" : "No contracts yet"}</div>
            <div className="mt-1 text-[13px] text-zinc-500">{view === "templates" ? "Create a template, or open a contract and choose “Save as template” to reuse it later." : "Write or upload a document, add signers, place fields, and send it."}</div>
            <button type="button" onClick={view === "templates" ? newTemplate : openNew} disabled={busy} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"><Plus className="h-4 w-4" /> {view === "templates" ? "New template" : "New contract"}</button>
          </div>
        ) : (
          <div className="space-y-7">
            {groups.map((g) => (
              <section key={g.name}>
                {view === "agreements" && (
                  <header className="mb-2.5 flex items-center gap-2">
                    <Folder className="h-3.5 w-3.5 text-zinc-400" />
                    <h2 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{g.name}</h2>
                    <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] tabular-nums text-zinc-500">{g.items.length}</span>
                    <span className="h-px flex-1 bg-zinc-100" />
                  </header>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {g.items.map((r) => (
                    <Link key={r.id} href={`/agreements/${r.id}`} className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{r.title}</div>
                        {view === "templates"
                          ? <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">template</span>
                          : <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[r.status] ?? "bg-zinc-100 text-zinc-600"}`}>{r.status.replace(/_/g, " ").toLowerCase()}</span>}
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-[12px] text-zinc-400">
                        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {r.partyCount} part{r.partyCount === 1 ? "y" : "ies"}</span>
                        {view === "agreements" && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {r.signedCount} signed</span>}
                        <span className="ml-auto">{new Date(r.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {showNew ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && setShowNew(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900">{step === "template" ? "Use a template" : "New contract"}</h2>
              <button type="button" onClick={() => !busy && setShowNew(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
            </div>

            {step === "choose" ? (
              <>
                <p className="mb-4 text-[13px] text-zinc-500">Choose how you want to start.</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <ChooserCard Icon={PenLine} title="Write" sub="Author a contract in the editor" disabled={busy} onClick={() => createWith({ sourceType: "blocknote" })} />
                  <ChooserCard Icon={Upload} title="Upload PDF" sub="Start from an existing PDF" disabled={busy} onClick={() => fileRef.current?.click()} />
                  <ChooserCard Icon={LayoutTemplate} title="Template" sub="Reuse a saved template" disabled={busy} onClick={openTemplatePicker} />
                </div>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setStep("choose")} className="mb-3 text-[12px] text-zinc-500 hover:text-zinc-800">← Back</button>
                {templates === null ? (
                  <div className="flex items-center gap-2 py-6 text-[13px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</div>
                ) : templates.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-[13px] text-zinc-500">No templates yet. Open an agreement and choose “Save as template”.</div>
                ) : (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                    {templates.map((t) => (
                      <li key={t.id}>
                        <button type="button" disabled={busy} onClick={() => createWith({ fromTemplateId: t.id })}
                          className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 p-2.5 text-left hover:border-violet-300 hover:bg-violet-50/40 disabled:opacity-50">
                          <LayoutTemplate className="h-4 w-4 shrink-0 text-violet-500" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800">{t.title}</span>
                          {t.category ? <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">{t.category}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
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
      className="flex flex-col items-start gap-2 rounded-xl border border-zinc-200 p-3.5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/40 disabled:cursor-not-allowed disabled:opacity-50">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Icon className="h-5 w-5" /></span>
      <span className="text-[13px] font-semibold text-zinc-900">{title}</span>
      <span className="text-[11px] leading-snug text-zinc-500">{sub}</span>
    </button>
  );
}
