"use client";

/* Contracts — BreezeDoc-style e-signature documents.
 * Folders (by category) + Templates + a 60-day Trash. Right-click or the "…"
 * button on any card to rename / move folder / archive (or restore / delete in
 * Trash). Create via Write / Upload PDF / Use template.
 *   GET  /api/agreements[?view=templates|trash]
 *   POST /api/agreements   (blocknote | pdf | fromTemplateId | isTemplate)
 *   PATCH/DELETE /api/agreements/[id]
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  FileSignature, Plus, Loader2, Users, CheckCircle2, PenLine, Upload, LayoutTemplate,
  X, Folder, Trash2, FolderInput, MoreHorizontal, Pencil,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Row = { id: string; title: string; status: string; category: string | null; isTemplate: boolean; archivedAt: string | null; updatedAt: string; partyCount: number; signedCount: number };
type View = "live" | "templates";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  SENT: "bg-blue-50 text-blue-700",
  PARTIALLY_SIGNED: "bg-amber-50 text-amber-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  VOIDED: "bg-red-50 text-red-700",
};
const CATEGORY_OPTIONS = ["SLA", "NDA", "Vendor", "Employment", "Partner", "Sales", "Service", "Other"];

export default function AgreementsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useOsToast();
  const view: View = search?.get("view") === "templates" ? "templates" : "live";

  const [rows, setRows] = useState<Row[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [step, setStep] = useState<"choose" | "template">("choose");
  const [templates, setTemplates] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number } | null>(null);
  const [edit, setEdit] = useState<{ row: Row; mode: "rename" | "folder"; value: string } | null>(null);
  const [folderEdit, setFolderEdit] = useState<{ items: Row[]; value: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const newHandled = useRef(false);

  const qs = view === "templates" ? "?view=templates" : "";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agreements${qs}`);
      if (!res.ok) { setRows([]); return; }
      const j = await res.json();
      setRows(Array.isArray(j) ? j : (j.data ?? []));
    } catch { setRows([]); }
  }, [qs]);
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
      try { const r = await fetch("/api/agreements?view=templates"); const j = await r.json(); setTemplates(Array.isArray(j) ? j : (j.data ?? [])); }
      catch { setTemplates([]); }
    }
  }
  function openNew() { setStep("choose"); setShowNew(true); }
  function newTemplate() { void createWith({ isTemplate: true }); }

  useEffect(() => {
    if (search?.get("new") === "1" && !newHandled.current) { newHandled.current = true; openNew(); }
  }, [search]);

  // ── Row actions ──
  async function patchRow(id: string, body: Record<string, unknown>, ok: string) {
    const res = await fetch(`/api/agreements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { toast(ok); await load(); } else toast("Couldn't update");
  }
  async function renameFolder(items: Row[], category: string | null) {
    await Promise.allSettled(items.map((r) => fetch(`/api/agreements/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category }) })));
    toast("Folder updated"); await load();
  }
  function openMenu(e: React.MouseEvent, row: Row) { e.preventDefault(); e.stopPropagation(); setMenu({ row, x: e.clientX, y: e.clientY }); }

  const noun = view === "templates" ? "template" : "contract";

  // Group rows into folders by category.
  const groups = (() => {
    const list = rows ?? [];
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
        description={rows === null ? "Loading…" : `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/agreements" className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] hover:bg-zinc-50 ${view === "live" ? "border-zinc-300 bg-zinc-50 text-zinc-900" : "border-zinc-200 text-zinc-700"}`}><FileSignature className="h-3.5 w-3.5" /> Contracts</Link>
            <Link href="/agreements?view=templates" className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] hover:bg-zinc-50 ${view === "templates" ? "border-zinc-300 bg-zinc-50 text-zinc-900" : "border-zinc-200 text-zinc-700"}`}><Folder className="h-3.5 w-3.5" /> Templates</Link>
            {view === "templates" ? (
              <button type="button" onClick={newTemplate} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} New template
              </button>
            ) : (
              <button type="button" onClick={openNew} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500"><Plus className="h-3.5 w-3.5" /> New contract</button>
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
            <div className="mt-1 text-[13px] text-zinc-500">{view === "templates" ? "Create a template, or open a contract and choose “Save as template”." : "Write or upload a document, add signers, place fields, and send it."}</div>
            <button type="button" onClick={view === "templates" ? newTemplate : openNew} disabled={busy} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"><Plus className="h-4 w-4" /> {view === "templates" ? "New template" : "New contract"}</button>
          </div>
        ) : (
          <div className="space-y-7">
            {groups.map((g) => (
              <section key={g.name}>
                {(
                  <header className="group/h mb-2.5 flex items-center gap-2"
                    onContextMenu={(e) => { e.preventDefault(); setFolderEdit({ items: g.items, value: g.name === "Uncategorized" ? "" : g.name }); }}>
                    <Folder className="h-3.5 w-3.5 text-zinc-400" />
                    <h2 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{g.name}</h2>
                    <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] tabular-nums text-zinc-500">{g.items.length}</span>
                    <button type="button" title="Rename folder" onClick={() => setFolderEdit({ items: g.items, value: g.name === "Uncategorized" ? "" : g.name })}
                      className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-600 group-hover/h:opacity-100"><Pencil className="h-3 w-3" /></button>
                    <span className="h-px flex-1 bg-zinc-100" />
                  </header>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {g.items.map((r) => (
                    <div key={r.id}
                      onClick={() => router.push(`/agreements/${r.id}`)}
                      onContextMenu={(e) => openMenu(e, r)}
                      className="group relative cursor-pointer rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{r.title}</div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {r.isTemplate
                            ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">template</span>
                            : <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[r.status] ?? "bg-zinc-100 text-zinc-600"}`}>{r.status.replace(/_/g, " ").toLowerCase()}</span>}
                          <button type="button" onClick={(e) => openMenu(e, r)} className="rounded p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100" title="More"><MoreHorizontal className="h-4 w-4" /></button>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-[12px] text-zinc-400">
                        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {r.partyCount} part{r.partyCount === 1 ? "y" : "ies"}</span>
                        {!r.isTemplate && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {r.signedCount} signed</span>}
                        <span className="ml-auto">{new Date(r.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* ── Context menu ── */}
      {menu ? (
        <>
          <div className="fixed inset-0 z-[140]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="fixed z-[141] w-44 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl"
            style={{ left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 184), top: menu.y }}>
            <MenuItem Icon={FileSignature} label="Open" onClick={() => { const r = menu.row; setMenu(null); router.push(`/agreements/${r.id}`); }} />
            <MenuItem Icon={Pencil} label="Rename" onClick={() => { const r = menu.row; setMenu(null); setEdit({ row: r, mode: "rename", value: r.title }); }} />
            <MenuItem Icon={FolderInput} label="Move to folder" onClick={() => { const r = menu.row; setMenu(null); setEdit({ row: r, mode: "folder", value: r.category ?? "" }); }} />
            <MenuItem Icon={Trash2} label="Delete" danger onClick={() => { const r = menu.row; setMenu(null); void patchRow(r.id, { archived: true }, "Moved to Trash"); }} />
          </div>
        </>
      ) : null}

      {/* ── Rename / move modal ── */}
      {edit ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30 p-4" onClick={() => setEdit(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-base font-semibold text-zinc-900">{edit.mode === "rename" ? "Rename" : "Move to folder"}</h2>
            <input autoFocus list={edit.mode === "folder" ? "agreement-folders" : undefined} value={edit.value}
              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("agreement-edit-save")?.click(); }}
              placeholder={edit.mode === "rename" ? "Title" : "Folder (e.g. SLA, NDA)"}
              className="h-9 w-full rounded-md border border-zinc-200 px-3 text-[14px] outline-none focus:border-zinc-300" />
            {edit.mode === "folder" && <datalist id="agreement-folders">{CATEGORY_OPTIONS.map((c) => <option key={c} value={c} />)}</datalist>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEdit(null)} className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50">Cancel</button>
              <button id="agreement-edit-save" type="button"
                onClick={() => { const e = edit; setEdit(null); if (e.mode === "rename") void patchRow(e.row.id, { title: e.value.trim() || e.row.title }, "Renamed"); else void patchRow(e.row.id, { category: e.value.trim() || null }, "Moved"); }}
                className="inline-flex h-8 items-center rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500">Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Rename folder modal ── */}
      {folderEdit ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30 p-4" onClick={() => setFolderEdit(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-base font-semibold text-zinc-900">Rename folder</h2>
            <p className="mb-3 text-[12px] text-zinc-500">Applies to {folderEdit.items.length} item{folderEdit.items.length === 1 ? "" : "s"}.</p>
            <input autoFocus list="agreement-folders-2" value={folderEdit.value}
              onChange={(e) => setFolderEdit({ ...folderEdit, value: e.target.value })}
              placeholder="Folder name (blank = Uncategorized)"
              className="h-9 w-full rounded-md border border-zinc-200 px-3 text-[14px] outline-none focus:border-zinc-300" />
            <datalist id="agreement-folders-2">{CATEGORY_OPTIONS.map((c) => <option key={c} value={c} />)}</datalist>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFolderEdit(null)} className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50">Cancel</button>
              <button type="button" onClick={() => { const f = folderEdit; setFolderEdit(null); void renameFolder(f.items, f.value.trim() || null); }}
                className="inline-flex h-8 items-center rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500">Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── New-contract chooser ── */}
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
                  <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-[13px] text-zinc-500">No templates yet. Open a contract and choose “Save as template”.</div>
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

function MenuItem({ Icon, label, onClick, danger }: { Icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-zinc-50 ${danger ? "text-red-600" : "text-zinc-700"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
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
