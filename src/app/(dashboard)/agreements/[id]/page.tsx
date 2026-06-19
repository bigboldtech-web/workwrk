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
import { FileSignature, ArrowLeft, Loader2, Send, Link2, Pencil, Check } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { AgreementFieldBuilder, ordinal, type PlacedField, type BuilderParty } from "@/components/agreements/field-builder";

type Party = BuilderParty;
type Agreement = { id: string; title: string; content: string; status: string; sourceType?: string; pdfUrl?: string | null; fields?: PlacedField[]; parties: Party[] };

export default function AgreementEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast } = useOsToast();

  const [ag, setAg] = useState<Agreement | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [editText, setEditText] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);

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
  function setPartyEmail(partyId: string, email: string) {
    setAg((a) => (a ? { ...a, parties: a.parties.map((p) => (p.id === partyId ? { ...p, email } : p)) } : a));
    patchPartyDebounced(partyId, { email }, "email");
  }
  async function removeParty(partyId: string) {
    const res = await fetch(`/api/agreements/${id}/parties?partyId=${encodeURIComponent(partyId)}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  function copyLink(p: Party) {
    if (!p.token) return;
    navigator.clipboard.writeText(`${window.location.origin}/sign/${p.token}`);
    toast("Signing link copied");
  }
  function copyViewLink() {
    navigator.clipboard.writeText(`${window.location.origin}/agreements/${id}`);
    toast("Link copied");
  }
  async function send() {
    if (!ag || sendBusy) return;
    if (ag.parties.length === 0) { toast("Add at least one party first"); return; }
    setSendBusy(true);
    try {
      const res = await fetch(`/api/agreements/${id}/send`, { method: "POST" });
      if (!res.ok) { toast((await res.json().catch(() => ({})))?.error || "Couldn't send"); return; }
      toast("Sent to signers");
      await load();
    } catch { toast("Couldn't send"); } finally { setSendBusy(false); }
  }

  return (
    <>
      <OsTitleBar
        title="Agreement"
        Icon={FileSignature}
        iconGradient={GRAD.indigoBlue}
        showStandardActions={false}
        description={ag ? ag.status.replace(/_/g, " ").toLowerCase() : ""}
        actions={
          <div className="flex items-center gap-2">
            {ag && ag.sourceType !== "pdf" ? (
              <button type="button" onClick={() => setEditText((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
                {editText ? <><Check className="h-3.5 w-3.5" /> Done editing</> : <><Pencil className="h-3.5 w-3.5" /> Edit text</>}
              </button>
            ) : null}
            <button type="button" onClick={copyViewLink} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><Link2 className="h-3.5 w-3.5" /> Copy view link</button>
            <button type="button" onClick={send} disabled={sendBusy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
              {sendBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send to signers
            </button>
            <Link href="/agreements" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><ArrowLeft className="h-3.5 w-3.5" /> All</Link>
          </div>
        }
      />

      {loadErr ? (
        <div className="px-6 py-8 text-sm text-zinc-500">Couldn&apos;t load this agreement. <Link href="/agreements" className="text-violet-600 underline">Back</Link></div>
      ) : !ag ? (
        <div className="flex items-center gap-2 px-6 py-8 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="px-6 py-6">
          <input
            type="text"
            value={title}
            onChange={(e) => saveTitle(e.target.value)}
            placeholder="Agreement title…"
            className="mb-4 w-full max-w-3xl border-0 border-b border-zinc-200 px-0 py-1 text-2xl font-semibold tracking-[-0.01em] text-zinc-900 outline-none focus:border-zinc-300"
          />

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
              onSetPartyEmail={setPartyEmail}
              onCopyLink={copyLink}
            />
          )}
        </div>
      )}
    </>
  );
}
