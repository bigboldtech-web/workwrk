"use client";

/* /sign/[token] (spec-process section 2): read a contract and sign it (or
 * decline) from a link, on any device. The token is the credential.
 *
 *   strip    the org logo + name, "Sent by {sender}" at the right
 *   header   the contract title, "You're signing as {party} · {role}", the
 *            quad-steps Review › Fill › Sign › Done
 *   body     the document (written prose or PDF pages at 720) with this
 *            party's fields drawn over it (dashed brand outlines), other
 *            parties' fields as dashed line outlines with their values
 *   bottom   a sticky bar: "3 of 5 required fields left" (or "All fields
 *            complete"), a ghost "Decline" and the one blue "Finish signing"
 *
 * Unknown, voided or archived: the public 404. Already signed: "You signed
 * this on {date}". Declined: the past tense too.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PenLine } from "lucide-react";
import { PublicPageFrame } from "@/components/process/public-page-frame";
import { SignaturePad } from "@/components/agreements/signature-pad";
import { SignatureImage } from "@/components/agreements/signature-image";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { PdfPages } from "@/components/agreements/pdf-pages";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format/date";
import { partyRoleLabel, remainingRequired, signingBarLabel, signingProgress } from "@/lib/contracts";

type Field = { id: string; type: string; partyId: string; page?: number; x: number; y: number; w: number; h: number; label?: string; required?: boolean; options?: string[]; defaultValue?: string };
type SignData = {
  title: string; content: string; sourceType?: string; pdfUrl?: string | null; status: string;
  org: { name: string; logo: string | null } | null; sender: { name: string } | null;
  party: { id: string; name: string; email: string; role: string; status: string; signedAt: string | null; declinedAt: string | null };
  fields: Field[]; myFields: Field[]; values: Record<string, string>; otherValues: Record<string, string>;
  otherParties?: { id: string; name: string; role: string; status: string }[];
  myTurn: boolean; waitingFor: string | null; completionEmail: boolean;
};

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SignData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone" | "failed">("loading");
  const [values, setValues] = useState<Record<string, string>>({});
  const [padFor, setPadFor] = useState<Field | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [online, setOnline] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/sign/${token}`, { cache: "no-store" });
      if (res.status === 404) { setState("gone"); return; }
      if (!res.ok) { setState("failed"); return; }
      const d = (await res.json()) as SignData;
      setData(d);
      setValues(d.values || {});
      setState("ready");
    } catch { setState("failed"); }
  }, [token]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const myIds = useMemo(() => new Set((data?.myFields ?? []).map((f) => f.id)), [data]);
  const done = data?.party.status === "SIGNED";
  const declined = data?.party.status === "DECLINED";
  const remaining = data ? remainingRequired(data.myFields, values) : { left: 0, total: 0 };
  const canFinish = !!data && remaining.left === 0 && !submitting && online && data.myTurn && !done && !declined;

  async function finish() {
    if (!data || !canFinish) return;
    setSubmitting(true); setErr(null);
    try {
      const res = await fetch(`/api/public/sign/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", values }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr((j as { error?: string }).error || "Couldn't submit. Try again."); return; }
      await load();
    } catch { setErr("Couldn't submit. Check your connection and try again."); }
    finally { setSubmitting(false); }
  }
  async function decline() {
    if (!data || submitting) return;
    setSubmitting(true); setErr(null);
    try {
      const res = await fetch(`/api/public/sign/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decline", reason }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr((j as { error?: string }).error || "Couldn't decline. Try again."); return; }
      setDeclineOpen(false);
      await load();
    } catch { setErr("Couldn't decline. Check your connection and try again."); }
    finally { setSubmitting(false); }
  }

  function renderField(f: Field) {
    const mine = myIds.has(f.id);
    const val = mine ? values[f.id] || "" : data?.otherValues[f.id] || "";
    const base: React.CSSProperties = { position: "absolute", left: f.x, top: f.y, width: f.w, height: f.h };
    const locked = done || declined || !data?.myTurn;
    if (!mine) {
      // A field that belongs to somebody else. Until they fill it there is
      // nothing to draw, and an unexplained empty box on a page somebody is
      // being asked to sign is its own small alarm, so say whose it is.
      const owner = data?.otherParties?.find((p) => p.id === f.partyId);
      const waiting = owner ? `Waiting for ${owner.name}` : "Waiting for the other party";
      return (
        <div key={f.id} className="flex items-center justify-center overflow-hidden rounded border border-dashed border-line-strong bg-subtle text-xs text-ink-2" style={base} aria-label={owner ? `${f.label || f.type}, ${waiting}` : f.label || f.type}>
          {val
            ? (val.startsWith("data:image") ? <SignatureImage src={val} alt={f.type} /> : f.type === "checkbox" ? (val === "true" ? "✓" : "") : <span className="truncate px-1">{val}</span>)
            : <span className="truncate px-1 text-ink-3">{waiting}</span>}
        </div>
      );
    }
    if (f.type === "signature" || f.type === "initials") {
      return (
        <button key={f.id} type="button" disabled={locked} onClick={() => setPadFor(f)} className="flex items-center justify-center overflow-hidden rounded border-2 border-dashed border-brand-deep bg-brand-soft text-xs font-medium text-brand-deep disabled:opacity-80" style={base} aria-label={f.type === "initials" ? "Initials" : "Signature"}>
          {val ? <SignatureImage src={val} alt={f.type} fallback={data?.party.name} /> : <span className="inline-flex items-center gap-1"><PenLine className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> {f.type === "initials" ? "Initials" : "Signature"}</span>}
        </button>
      );
    }
    if (f.type === "checkbox") {
      const checked = val === "true";
      return (
        <button key={f.id} type="button" disabled={locked} role="checkbox" aria-checked={checked} aria-label={f.label || "Checkbox"} onClick={() => setValues((v) => ({ ...v, [f.id]: checked ? "" : "true" }))}
          className="flex items-center justify-center rounded border-2 border-dashed border-brand-deep bg-brand-soft text-base text-brand-deep disabled:opacity-80" style={{ ...base, ...(checked ? { background: "var(--os-brand)", color: "#fff", borderStyle: "solid" } : {}) }}>
          {checked ? "✓" : ""}
        </button>
      );
    }
    if (f.type === "dropdown") {
      return (
        <select key={f.id} disabled={locked} value={val || f.defaultValue || ""} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} aria-label={f.label || "Dropdown"} className="rounded border-2 border-dashed border-brand-deep bg-brand-soft px-1 text-sm text-ink outline-none" style={base}>
          <option value="">{f.label || "Select"}</option>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input key={f.id} disabled={locked} type={f.type === "date" ? "date" : f.type === "email" ? "email" : "text"} value={val} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} placeholder={f.type === "date" ? "" : (f.label || (f.type === "email" ? "Email" : "Text"))} aria-label={f.label || f.type}
        className="rounded border-2 border-dashed border-brand-deep bg-brand-soft px-1.5 text-sm text-ink outline-none placeholder:text-brand-deep" style={base} />
    );
  }

  if (state === "gone") {
    return (
      <PublicPageFrame org={null} label="Contract" footer={<>WorkwrK</>}>
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-row text-ink">This link is no longer available</p>
          <p className="text-sm text-ink-2">It may have been voided, or the contract was withdrawn.</p>
        </div>
      </PublicPageFrame>
    );
  }
  if (state === "failed") {
    return (
      <PublicPageFrame org={null} label="Contract">
        <div className="flex flex-col items-center gap-2 py-16 text-center" role="alert">
          <p className="text-row text-ink">Couldn&apos;t load this contract</p>
          <button type="button" onClick={() => void load()} className="text-base font-medium text-brand-deep hover:underline">Retry</button>
        </div>
      </PublicPageFrame>
    );
  }
  if (!data) {
    return (
      <PublicPageFrame org={null} label="Contract">
        <div className="pt-2"><span className="block h-6 w-2/3 rounded bg-skeleton os-skeleton-pulse" /><div className="mt-6"><SkeletonLines lines={6} /></div></div>
      </PublicPageFrame>
    );
  }

  const step = signingProgress({ viewed: true, fields: data.myFields, values, signed: done });
  const doc = data.sourceType === "pdf" && data.pdfUrl ? (
    <PdfPages url={data.pdfUrl} width={720} renderPage={(i) => <div className="absolute inset-0">{data.fields.filter((f) => (f.page ?? 0) === i).map(renderField)}</div>} />
  ) : (
    /* The fields were placed on a 720-wide page, so the page keeps that
       width and scrolls sideways inside its own box on a narrow screen (the
       page body never scrolls horizontally). */
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="relative w-[720px] rounded-lg border border-line bg-raised px-10 py-7" style={{ minHeight: data.fields.filter((f) => (f.page ?? 0) === 0).reduce((m, f) => Math.max(m, f.y + f.h), 0) + 24 }}>
        <div className="pointer-events-none select-none os-prose">
          <BlockNoteCanvas key={token} initialBnDoc={null} legacyBlocks={null} initialHtml={data.content || ""} readonly onChange={() => {}} entity={{ type: "agreement", id: data.party.id }} />
        </div>
        {data.fields.filter((f) => (f.page ?? 0) === 0).map(renderField)}
      </div>
    </div>
  );

  return (
    <PublicPageFrame org={data.org} label={data.sender ? `Sent by ${data.sender.name}` : "Contract"}>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-ink">{data.title}</h1>
        <p className="text-sm text-ink-2">You&apos;re signing as {data.party.name} · {partyRoleLabel(data.party.role)}</p>
        <div className="inline-flex items-center gap-2 text-sm text-ink-2">
          <Dots variant="quad-steps" done={step} total={4} label={`Step ${step} of 4`} />
          <span>Review › Fill › Sign › Done</span>
        </div>
        {done ? <p className="inline-flex items-center gap-2 text-sm text-ink"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-success-solid" />You signed this{data.party.signedAt ? ` on ${formatDate(data.party.signedAt, null, "datetime")}` : ""}.{data.completionEmail ? " You'll receive a copy by email once everyone has signed." : ""}</p> : null}
        {declined ? <p className="text-sm text-ink">You declined to sign this{data.party.declinedAt ? ` on ${formatDate(data.party.declinedAt, null, "datetime")}` : ""}.</p> : null}
        {!done && !declined && !data.myTurn ? <p className="text-sm text-ink-2">It&apos;s {data.waitingFor ?? "another party"}&apos;s turn to sign first. You&apos;ll get an email when it&apos;s yours.</p> : null}
        {!online ? <p className="text-sm text-ink-2">You&apos;re offline</p> : null}
        {err ? <p className="text-sm text-danger-text" role="alert">{err}</p> : null}
      </div>
      <div className="mt-6">{doc}</div>

      {!done && !declined && data.myTurn ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised">
          <div className="mx-auto box-content flex h-16 max-w-[720px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
            {/* The count is the visible reason the primary is disabled, so it
                keeps its width on a phone: "3 of 5 left" there, the full
                sentence from 640px up. */}
            <span className={`min-w-0 flex-1 truncate ${remaining.left === 0 ? "text-row font-medium text-ink" : "text-sm text-ink-2"}`}>
              <span className="sm:hidden">{remaining.left === 0 ? "All done" : `${remaining.left} of ${remaining.total} left`}</span>
              <span className="hidden sm:inline">{signingBarLabel(data.myFields, values)}</span>
            </span>
            <button type="button" onClick={() => setDeclineOpen(true)} disabled={submitting} className="inline-flex h-9 shrink-0 items-center rounded-md px-2 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink sm:px-3">Decline</button>
            {online ? (
              <button type="button" onClick={() => void finish()} disabled={!canFinish} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
                {submitting ? <Dots variant="pending" /> : null} Finish signing
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <SignaturePad open={!!padFor} kind={padFor?.type === "initials" ? "initials" : "signature"} onCancel={() => setPadFor(null)} onDone={(url) => { if (padFor) setValues((v) => ({ ...v, [padFor.id]: url })); setPadFor(null); }} />

      <Dialog open={declineOpen} onOpenChange={(v) => { if (!v && !submitting) setDeclineOpen(false); }}>
        <DialogContent className="max-w-[400px]">
          <DialogTitle>Decline to sign?</DialogTitle>
          <DialogDescription>The sender is told you declined. You can add why.</DialogDescription>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (optional)" className="mt-2 w-full resize-none rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDeclineOpen(false)} disabled={submitting} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button type="button" onClick={() => void decline()} disabled={submitting} className="inline-flex h-9 items-center gap-2 rounded-md bg-danger-solid px-3 text-base font-medium text-white hover:brightness-95 disabled:opacity-60">{submitting ? <Dots variant="pending" /> : null} Decline</button>
          </div>
        </DialogContent>
      </Dialog>
    </PublicPageFrame>
  );
}

