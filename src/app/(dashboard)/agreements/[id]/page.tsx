"use client";

/* Agreement editor — BreezeDoc-style builder.
 *
 *   GET    /api/agreements/[id]
 *   PATCH  /api/agreements/[id]              { title, content, fields, status }
 *   POST   /api/agreements/[id]/parties      { name?, email?, role? }
 *   PATCH  /api/agreements/[id]/parties      { partyId, name?, email? }
 *   DELETE /api/agreements/[id]/parties?partyId=
 *   POST   /api/agreements/[id]/send
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FileSignature, Send, Link2, Pencil, Check, LayoutTemplate, Copy, X, Archive } from "lucide-react";
import { OsPageHeader, OsPageHeaderSkeleton, HeaderAction } from "@/components/layout/os/page-header";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";

import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { AgreementFieldBuilder, ordinal, type PlacedField, type BuilderParty } from "@/components/agreements/field-builder";

type Party = BuilderParty;
type Agreement = { id: string; title: string; content: string; status: string; category?: string | null; isTemplate?: boolean; sourceType?: string; pdfUrl?: string | null; fields?: PlacedField[]; parties: Party[] };
type SendLink = { partyId: string; name: string; email: string; link: string };

const CATEGORY_OPTIONS = ["SLA", "NDA", "Vendor", "Employment", "Partner", "Sales", "Service", "Other"];

export default function AgreementEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast } = useOsToast();
  const confirm = useConfirm();

  const [ag, setAg] = useState<Agreement | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [editText, setEditText] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendLinks, setSendLinks] = useState<SendLink[] | null>(null);

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partyTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/agreements/${id}`);
      if (!res.ok) { setLoadErr(true); return; }
      const j = await res.json();
      const a = (j.data ?? j) as Agreement;
      setAg(a);
      setTitle(a.title);
      setFields(Array.isArray(a.fields) ? a.fields : []);
      // Brand-new blank written doc → drop straight into text editing.
      setEditText((prev) => prev || (!a.content && a.sourceType !== "pdf"));
    } catch { setLoadErr(true); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  function patchAgreement(body: Record<string, unknown>) {
    void fetch(`/api/agreements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function saveTitle(next: string) {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => patchAgreement({ title: next.trim() || "Untitled agreement" }), 600);
  }
  function saveFields(next: PlacedField[]) {
    setFields(next);
    if (fieldsTimer.current) clearTimeout(fieldsTimer.current);
    fieldsTimer.current = setTimeout(() => patchAgreement({ fields: next }), 400);
  }
  function saveContent(html: string) { patchAgreement({ content: html }); }

  // ── Parties ──
  async function addParty() {
    const n = (ag?.parties.length ?? 0) + 1;
    const res = await fetch(`/api/agreements/${id}/parties`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${ordinal(n)} Party`, role: "SIGNER" }),
    });
    if (res.ok) await load(); else toast("Couldn't add party");
  }
  function patchPartyDebounced(partyId: string, body: Record<string, unknown>, key: string) {
    const k = `${partyId}:${key}`;
    const t = partyTimers.current.get(k);
    if (t) clearTimeout(t);
    partyTimers.current.set(k, setTimeout(() => {
      void fetch(`/api/agreements/${id}/parties`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partyId, ...body }) });
    }, 500));
  }
  function renameParty(partyId: string, name: string) {
    setAg((a) => (a ? { ...a, parties: a.parties.map((p) => (p.id === partyId ? { ...p, name } : p)) } : a));
    patchPartyDebounced(partyId, { name }, "name");
  }
  async function removeParty(partyId: string) {
    const res = await fetch(`/api/agreements/${id}/parties?partyId=${encodeURIComponent(partyId)}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  function copyText(text: string) { navigator.clipboard.writeText(text); toast("Link copied"); }
  function copyViewLink() { copyText(`${window.location.origin}/agreements/${id}`); }

  async function send() {
    if (!ag || sendBusy) return;
    if (ag.parties.length === 0) { toast("Add at least one party first"); return; }
    setSendBusy(true);
    try {
      const res = await fetch(`/api/agreements/${id}/send`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast((j as { error?: string })?.error || "Couldn't send"); return; }
      const data = (j.data ?? j) as { links?: SendLink[] };
      setSendLinks(data.links ?? []);
      await load();
    } catch { toast("Couldn't send"); } finally { setSendBusy(false); }
  }

  async function saveAsTemplate() {
    const res = await fetch(`/api/agreements/${id}/save-as-template`, { method: "POST" });
    if (res.ok) toast("Saved as template"); else toast("Couldn't save template");
  }
  async function useTemplate() {
    const res = await fetch(`/api/agreements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromTemplateId: id }) });
    if (!res.ok) { toast("Couldn't create contract"); return; }
    const j = await res.json(); const a = j.data ?? j;
    if (a?.id) window.location.href = `/agreements/${a.id}`;
  }
  function setCategory(category: string) {
    setAg((a) => (a ? { ...a, category } : a));
    patchAgreement({ category });
  }
  async function archive() {
    if (!ag) return;
    if (!(await confirm({ title: "Move to Trash", description: "Move this to Trash? It will be auto-deleted after 60 days.", destructive: true, confirmLabel: "Move to Trash" }))) return;
    const res = await fetch(`/api/agreements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }) });
    if (res.ok) { toast("Moved to Trash"); window.location.href = ag.isTemplate ? "/agreements?view=templates" : "/agreements"; }
    else toast("Couldn't archive");
  }

  const parentCrumb = ag?.isTemplate
    ? { label: "Contract templates", href: "/agreements?view=templates" }
    : { label: "Contracts", href: "/agreements" };

  return (
    <>
      <Breadcrumb items={[parentCrumb, ...(ag ? [{ label: ag.title }] : [])]} />
      {!ag && !loadErr ? (
        <OsPageHeaderSkeleton />
      ) : (
      <OsPageHeader
        title={ag?.title || (ag?.isTemplate ? "Contract template" : "Contract")}
        back={ag?.isTemplate
          ? { fallbackHref: "/agreements?view=templates", label: "Contract templates" }
          : { fallbackHref: "/agreements", label: "Contracts" }}
        actions={
          <>
            {ag && ag.sourceType !== "pdf" ? (
              <HeaderAction icon={editText ? Check : Pencil} label={editText ? "Done editing" : "Edit text"} active={editText} onClick={() => setEditText((v) => !v)} />
            ) : null}
            {ag && !ag.isTemplate ? (
              <>
                <HeaderAction icon={LayoutTemplate} label="Save as template" onClick={saveAsTemplate} />
                <HeaderAction icon={Link2} label="Copy view link" onClick={copyViewLink} />
              </>
            ) : null}
            {ag ? <HeaderAction icon={Archive} aria-label="Move to Trash" title="Move to Trash" onClick={archive} /> : null}
          </>
        }
        primary={!ag ? undefined : ag.isTemplate
          ? { label: "Use template", icon: FileSignature, onClick: useTemplate }
          : { label: "Send to signers", icon: Send, onClick: send, busy: sendBusy }}
      />
      )}

      {loadErr ? (
        <ErrorState what="this contract" onRetry={() => { setLoadErr(false); void load(); }} />
      ) : !ag ? (
        <SkeletonRows />
      ) : (
        <div className="px-6 py-6">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <input
              type="text"
              value={title}
              onChange={(e) => saveTitle(e.target.value)}
              placeholder="Contract title…"
              className="min-w-0 flex-1 border-0 border-b border-zinc-200 px-0 py-1 text-2xl font-semibold tracking-[-0.01em] text-zinc-900 outline-none focus:border-zinc-300"
            />
            <label className="flex items-center gap-1.5 text-sm text-zinc-500">
              Folder
              <input list="agreement-categories" value={ag.category ?? ""} onChange={(e) => setCategory(e.target.value)} placeholder="Uncategorized"
                className="h-8 w-44 rounded-md border border-zinc-200 bg-white px-2 text-base text-zinc-700 outline-none focus:border-zinc-300" />
            </label>
            <datalist id="agreement-categories">{CATEGORY_OPTIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>

          {editText && ag.sourceType !== "pdf" ? (
            <div className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-white px-10 py-7">
              <BlockNoteCanvas
                key={ag.id}
                initialBnDoc={null}
                legacyBlocks={null}
                initialHtml={ag.content || ""}
                readonly={false}
                onChange={() => { /* HTML-mode */ }}
                onHtmlChange={saveContent}
                entity={{ type: "agreement", id: ag.id }}
              />
            </div>
          ) : (
            <AgreementFieldBuilder
              agreementId={ag.id}
              content={ag.content || ""}
              sourceType={ag.sourceType}
              pdfUrl={ag.pdfUrl}
              parties={ag.parties}
              fields={fields}
              onFieldsChange={saveFields}
              onAddParty={addParty}
              onRemoveParty={removeParty}
              onRenameParty={renameParty}
            />
          )}
        </div>
      )}

      {sendLinks ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={() => setSendLinks(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900">Signing links</h2>
              <button type="button" onClick={() => setSendLinks(null)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-base text-zinc-500">Share each party&apos;s private link to collect their signature. (Parties with an email were also notified.)</p>
            <ul className="space-y-2">
              {sendLinks.map((l) => (
                <li key={l.partyId} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-medium text-zinc-800">{l.name}</div>
                    <div className="truncate text-xs text-zinc-400">{l.link}</div>
                  </div>
                  <button type="button" onClick={() => copyText(l.link)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#0073EA] px-2.5 text-sm font-medium text-white hover:bg-[#0060B9]"><Copy className="h-3 w-3" /> Copy</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
