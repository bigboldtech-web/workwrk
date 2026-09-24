"use client";

/* /agreements/[id] (spec-process section 2): write or upload a contract,
 * place the fields each party fills, send it for signature, and watch it
 * get signed.
 *
 *   header      BackButton ("Contracts" or "Contract templates"), the title
 *               (an input for FULL on drafts and templates), a StatusChip,
 *               the AutosaveIndicator (EVERY PATCH goes through it: saving /
 *               saved / failed with Retry; nothing is fire-and-forget); right:
 *               "…" (Rename, Move to folder…, Duplicate, Save as template /
 *               Use template, Copy signing link…, Void, Archive, Delete) and
 *               the one blue: "Send for signature" on a draft, "Use template"
 *               on a template, none while out for signature
 *   column 720  the Details strip (Folder, Source, Sent on, Completed on), a
 *               32px segmented control Write · Place fields (FULL, draft or
 *               template), the document; in Place-fields mode the 272 right
 *               PartiesPanel; after Send a Parties TableCard (Copy signing
 *               link, Resend) and the document read-only
 *   party view  a Member who is a party: the read-only banner, the document
 *               and one card "Your signature" with "Open signing page"
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, ChevronDown, Copy, Eye, FileSignature, LayoutTemplate, Link2, Pencil, RefreshCw, Send, Trash2, XCircle, FolderInput } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader, OsPageHeaderSkeleton, type HeaderMenuEntry } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { ReadOnlyBanner } from "@/components/access/read-only-banner";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { StatusChip } from "@/components/ui/chip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Picker, PickerFooterRow } from "@/components/ui/picker";
import { SkeletonLines } from "@/components/ui/skeleton";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { AgreementFieldBuilder, type FieldType, type PlacedField, type BuilderParty } from "@/components/agreements/field-builder";
import { PdfPages } from "@/components/agreements/pdf-pages";
import { PartiesPanel } from "@/components/agreements/parties-panel";
import { SendDialog } from "@/components/agreements/send-dialog";
import { SignPreviewDialog } from "@/components/agreements/sign-preview-dialog";
import { SignatureImage } from "@/components/agreements/signature-image";
import type { PersonRef } from "@/components/board-view/assignee-picker";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useRole } from "@/hooks/use-role";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { CONTRACT_STATUS_COLOR, CONTRACT_STATUS_LABEL, PARTY_STATUS_COLOR, PARTY_STATUS_LABEL, parseContractStatus, parsePartyStatus, partyHue, partyRoleLabel, partySendErrors, type PartyRole } from "@/lib/contracts";
import { nextRetryDelay } from "@/lib/sop-save-state";
import type { AutosaveStatus } from "@/hooks/use-autosave";

type Party = BuilderParty & { email: string; status: string; token?: string; signedAt?: string | null; declinedAt?: string | null; userId?: string | null };
interface Agreement {
  id: string; title: string; content: string; status: string; category: string | null; isTemplate: boolean; sourceType: string; pdfUrl: string | null;
  fields: PlacedField[]; parties: Party[]; sentAt: string | null; voidedAt: string | null; updatedAt: string; signingOrder?: boolean;
  createdBy: PersonRef | null; access: { role: "FULL" | "VIEW" };
  myParty: { id: string; name: string; role: string; status: string; token: string; signedAt: string | null } | null;
}
type Mode = "write" | "fields";

/**
 * spec-process section 1 (Mobile / narrow): Place fields needs 1024. Below
 * it the segmented control offers Write alone and one honest line says so;
 * nothing renders disabled.
 */
function useNarrow(maxWidth = 1023): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [maxWidth]);
  return narrow;
}

export default function AgreementEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const { bumpRowVersion } = useOsShell();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const fmt = useFormat();
  const { isAdmin } = useRole();

  const [ag, setAg] = useState<Agreement | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "failed">("loading");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [mode, setMode] = useState<Mode>("write");
  const [activeParty, setActiveParty] = useState<string | null>(null);
  const [pendingTool, setPendingTool] = useState<FieldType | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderOpen, setFolderOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const narrow = useNarrow();
  useEffect(() => { if (narrow && mode === "fields") { setMode("write"); setPendingTool(null); } }, [narrow, mode]);
  const partiesCardRef = useRef<HTMLElement | null>(null);

  /* The read-only banner's Request link (access 5.4): a Member party asks the sender for edit access. */
  const [requestState, setRequestState] = useState<"idle" | "busy" | "sent">("idle");
  const requestAccess = async () => {
    if (requestState !== "idle") return;
    setRequestState("busy");
    const r = await apiFetch("/api/access-requests", { method: "POST", json: { objectType: "contract", objectId: id, role: "EDIT" } });
    if (!r.ok) { setRequestState("idle"); toast(r.error || "Couldn't send the request", { tone: "danger" }); return; }
    setRequestState("sent");
    toast("Request sent");
  };

  const load = useCallback(async (): Promise<Agreement | null> => {
    const r = await apiFetch<Agreement | { data: Agreement }>(`/api/agreements/${id}`, { cache: "no-store" });
    if (!r.ok) { setLoadState(r.status === 404 || r.status === 403 ? "notfound" : "failed"); return null; }
    const a = ("data" in r.data && r.data.data ? r.data.data : r.data) as Agreement;
    a.fields = Array.isArray(a.fields) ? a.fields : [];
    setAg(a);
    setLoadState("ready");
    return a;
  }, [id]);
  useEffect(() => {
    const t = setTimeout(() => {
      void load().then((a) => {
        if (!a) return;
        setTitle(a.title);
        setFields(a.fields);
        setActiveParty((cur) => cur ?? a.parties[0]?.id ?? null);
        setEditorKey((k) => k + 1);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    void apiFetch<{ process?: { contractFolders?: string[] } }>("/api/settings/process", { cache: "no-store" }).then((r) => { if (r.ok) setFolders(r.data.process?.contractFolders ?? []); });
  }, []);
  // The Parties card polls while the contract is out for signature.
  useEffect(() => {
    if (!ag || (ag.status !== "SENT" && ag.status !== "PARTIALLY_SIGNED")) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [ag, load]);

  /* ── the save path: every PATCH through one indicator, never silent ── */
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showRetry, setShowRetry] = useState(false);
  const pendingRef = useRef<Record<string, unknown>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const attemptRef = useRef(0);
  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (inFlightRef.current) { queuedRef.current = true; return true; }
    const body = pendingRef.current;
    if (Object.keys(body).length === 0) return true;
    inFlightRef.current = true;
    setStatus("saving");
    setShowRetry(false);
    try {
      const r = await apiFetch<Agreement>(`/api/agreements/${id}`, { method: "PATCH", json: body });
      if (!r.ok) throw Object.assign(new Error(r.error || "Save failed"), { status: r.status });
      pendingRef.current = {};
      attemptRef.current = 0;
      setStatus("saved");
      setLastSaved(new Date());
      setAg((prev) => (prev ? { ...prev, ...body, updatedAt: new Date().toISOString() } as Agreement : prev));
      return true;
    } catch (e) {
      const st = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 0;
      const fatal = st >= 400 && st < 500 && st !== 401 && st !== 408 && st !== 429;
      setStatus("error");
      const delay = fatal ? null : nextRetryDelay(attemptRef.current);
      attemptRef.current += 1;
      if (delay !== null) { timerRef.current = setTimeout(() => { timerRef.current = null; void flush(); }, delay); }
      else { setShowRetry(true); attemptRef.current = 0; toast(fatal && e instanceof Error ? e.message : "Couldn't save. Check your connection and keep this tab open.", { tone: "danger", action: { label: "Retry", onClick: () => void flush() } }); }
      return false;
    } finally {
      inFlightRef.current = false;
      if (queuedRef.current) { queuedRef.current = false; void flush(); }
    }
  }, [id, toast]);
  const queue = useCallback((patch: Record<string, unknown>, delay = 600) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; void flush(); }, delay);
  }, [flush]);
  useEffect(() => {
    const onHide = () => { if (Object.keys(pendingRef.current).length) void flush(); };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", onHide); document.removeEventListener("visibilitychange", onVis); if (timerRef.current) clearTimeout(timerRef.current); };
  }, [flush]);
  useDirtyGuard(status === "dirty" || status === "saving" || status === "error", { onSave: () => flush(), id: `contract:${id}` });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void flush(); }
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape" && mode === "fields" && !typing) { if (pendingTool) setPendingTool(null); else setMode("write"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, mode, pendingTool]);

  const full = ag?.access.role === "FULL";
  const editable = !!ag && full && (ag.status === "DRAFT" || ag.isTemplate);
  const saveTitle = (next: string) => { setTitle(next); queue({ title: next.trim() || "Untitled contract" }); };
  const saveFields = (next: PlacedField[]) => { setFields(next); queue({ fields: next }, 400); };
  const saveContent = (html: string) => queue({ content: html }, 800);
  const setFolder = (folder: string | null) => { setAg((a) => (a ? { ...a, category: folder } : a)); queue({ category: folder }, 0); };

  /* ── parties ── */
  const patchParty = async (partyId: string, body: Record<string, unknown>) => {
    setStatus("saving");
    const r = await apiFetch(`/api/agreements/${id}/parties`, { method: "PATCH", json: { partyId, ...body } });
    if (!r.ok) { setStatus("error"); setShowRetry(true); toast(r.error || "Couldn't save the party", { tone: "danger" }); return; }
    setStatus("saved"); setLastSaved(new Date());
    setAg((a) => (a ? { ...a, parties: a.parties.map((p) => (p.id === partyId ? { ...p, ...body } as Party : p)) } : a));
  };
  const addParty = async (person?: PersonRef) => {
    const n = (ag?.parties.length ?? 0) + 1;
    const r = await apiFetch(`/api/agreements/${id}/parties`, { method: "POST", json: person ? { userId: person.id, role: "INTERNAL" } : { name: `${ordinal(n)} Party`, role: "SIGNER" } });
    if (!r.ok) { toast(r.error || "Couldn't add the party", { tone: "danger" }); return; }
    const a = await load();
    if (a) setActiveParty(a.parties[a.parties.length - 1]?.id ?? null);
  };
  const removeParty = async (partyId: string) => {
    const r = await apiFetch(`/api/agreements/${id}/parties?partyId=${encodeURIComponent(partyId)}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't remove the party", { tone: "danger" }); return; }
    if (activeParty === partyId) setActiveParty(null);
    void load();
  };
  const reorder = async (ids: string[]) => {
    setAg((a) => (a ? { ...a, parties: a.parties.map((p) => ({ ...p, order: ids.indexOf(p.id) })) } : a));
    const r = await apiFetch(`/api/agreements/${id}/parties`, { method: "PATCH", json: { order: ids } });
    if (!r.ok) { toast(r.error || "Couldn't reorder", { tone: "danger" }); void load(); }
  };

  /* ── actions ── */
  const [sendOpen, setSendOpen] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  // A fresh contract starts with two parties and no emails, so deriving the
  // Send errors on mount would paint "Enter a valid email" in red under a
  // field nobody has touched. The Parties card stays quiet until the person
  // actually tries to send; the Send modal itself always shows them.
  const [sendTried, setSendTried] = useState(false);
  const send = async (opts: { signingOrder: boolean; message: string }): Promise<boolean> => {
    setSendBusy(true);
    await flush();
    const r = await apiFetch<{ notified?: number; links?: unknown[]; data?: { notified?: number } }>(`/api/agreements/${id}/send`, { method: "POST", json: opts });
    setSendBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't send", { tone: "danger" }); return false; }
    const n = r.data?.notified ?? r.data?.data?.notified ?? 0;
    toast(n ? `Sent to ${n} ${n === 1 ? "party" : "parties"}` : "Sent. Copy each signing link from the Parties card.");
    setSendOpen(false);
    setMode("write");
    bumpRowVersion("agreements");
    void load();
    return true;
  };
  const copyText = (text: string, done = "Link copied") => { void navigator.clipboard.writeText(text).then(() => toast(done), () => toast("Couldn't copy", { tone: "danger" })); };
  const signLink = (p: Party) => `${window.location.origin}/sign/${p.token}`;
  const resend = async (p: Party) => {
    const r = await apiFetch(`/api/agreements/${id}/parties/${p.id}/resend`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't resend", { tone: "danger" }); return; }
    toast(`Sent again to ${p.name}`);
  };
  const rename = async () => {
    if (!ag) return;
    const next = await prompt({ title: "Rename", defaultValue: ag.title, submitLabel: "Save" });
    if (!next || next.trim() === ag.title) return;
    setTitle(next.trim()); queue({ title: next.trim() }, 0);
  };
  const duplicate = async () => {
    if (!ag) return;
    const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/agreements", { method: "POST", json: { title: `${ag.title} (copy)`, category: ag.category, isTemplate: ag.isTemplate, ...(ag.isTemplate ? { sourceType: ag.sourceType, pdfUrl: ag.pdfUrl, content: ag.content } : { fromTemplateId: ag.id }) } });
    if (!r.ok) { toast(r.error || "Couldn't duplicate", { tone: "danger" }); return; }
    const nid = r.data?.id ?? r.data?.data?.id;
    toast("Duplicated"); bumpRowVersion("agreements");
    if (nid) router.push(`/agreements/${nid}`);
  };
  const saveAsTemplate = async () => {
    const r = await apiFetch(`/api/agreements/${id}/save-as-template`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't save the template", { tone: "danger" }); return; }
    toast("Saved as template", { action: { label: "Open templates", onClick: () => router.push("/agreements?view=templates") } });
    bumpRowVersion("agreements");
  };
  const createFromTemplate = async () => {
    const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/agreements", { method: "POST", json: { fromTemplateId: id } });
    if (!r.ok) { toast(r.error || "Couldn't create the contract", { tone: "danger" }); return; }
    const nid = r.data?.id ?? r.data?.data?.id;
    bumpRowVersion("agreements");
    if (nid) router.push(`/agreements/${nid}`);
  };
  const voidIt = async () => {
    if (!ag) return;
    const ok = await confirm({ title: "Void this contract?", description: "Signing links stop working. Signatures already given are kept for the record.", confirmLabel: "Void", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/agreements/${id}`, { method: "PATCH", json: { action: "void" } });
    if (!r.ok) { toast(r.error || "Couldn't void", { tone: "danger" }); return; }
    toast("Voided"); bumpRowVersion("agreements"); void load();
  };
  const archive = async () => {
    if (!ag) return;
    const ok = await confirm({ title: "Move to Trash?", description: `You can restore it within ${boot.org.trashDays} days.`, confirmLabel: "Move to Trash", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/agreements/${id}`, { method: "PATCH", json: { archived: true } });
    if (!r.ok) { toast(r.error || "Couldn't archive", { tone: "danger" }); return; }
    toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=contract") } });
    bumpRowVersion("agreements");
    router.push(ag.isTemplate ? "/agreements?view=templates" : "/agreements");
  };
  const remove = async () => {
    if (!ag) return;
    const ok = await confirm({ title: `Delete "${ag.title}"?`, description: "This removes it for good.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/agreements/${id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete", { tone: "danger" }); return; }
    toast("Deleted"); bumpRowVersion("agreements");
    router.push(ag.isTemplate ? "/agreements?view=templates" : "/agreements");
  };

  const partyColumns = useMemo<TableColumn<Party>[]>(() => [
    { key: "party", label: "Party", title: true, width: "minmax(140px,1fr)", render: (p) => <span className="inline-flex min-w-0 items-center gap-2" title={p.email}><span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: partyHue((ag?.parties.findIndex((x) => x.id === p.id) ?? 0)) }} /><span className="truncate">{p.name}</span></span> },
    { key: "role", label: "Role", width: "80px", render: (p) => <span className="text-ink-2">{partyRoleLabel(p.role)}</span> },
    { key: "status", label: "Status", width: "100px", render: (p) => <StatusChip color={PARTY_STATUS_COLOR[parsePartyStatus(p.status)]} label={PARTY_STATUS_LABEL[parsePartyStatus(p.status)]} disabled /> },
    { key: "signedAt", label: "Signed at", width: "120px", render: (p) => p.signedAt ? <span className="tabular-nums text-ink-2" title={fmt.title(p.signedAt)}>{fmt.date(p.signedAt, "datetime")}</span> : p.declinedAt ? <span className="tabular-nums text-ink-2" title={fmt.title(p.declinedAt)}>Declined {fmt.date(p.declinedAt, "date")}</span> : "" },
    { key: "actions", label: "", width: "262px", render: (p) => (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {p.token ? <button type="button" onClick={(e) => { e.stopPropagation(); copyText(signLink(p), "Signing link copied"); }} title="Copy signing link" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm font-medium text-ink hover:bg-hover"><Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy signing link</button> : null}
        {p.status !== "SIGNED" && p.status !== "DECLINED" && ag && (ag.status === "SENT" || ag.status === "PARTIALLY_SIGNED") ? <button type="button" onClick={(e) => { e.stopPropagation(); void resend(p); }} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm font-medium text-ink hover:bg-hover" title="Resend"><RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Resend</button> : null}
      </span>
    ) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ag, fmt]);

  if (loadState === "notfound") return <NotFoundView />;
  if (loadState === "failed") {
    return (<><OsPageHeader title="Contract" back={{ fallbackHref: "/agreements", label: "Contracts" }} /><OsEmptyView variant="error" title="Couldn't load this contract" action={{ label: "Retry", onClick: () => { setLoadState("loading"); void load(); } }} /></>);
  }
  if (!ag) return (<><OsPageHeaderSkeleton /><div className="mx-auto w-full max-w-[720px] px-6 pt-4"><SkeletonLines lines={6} /></div></>);

  const cStatus = parseContractStatus(ag.status);
  const back = ag.isTemplate ? { fallbackHref: "/agreements?view=templates", label: "Contract templates" } : { fallbackHref: "/agreements", label: "Contracts" };
  const out = cStatus === "SENT" || cStatus === "PARTIALLY_SIGNED";
  const sendErrors = sendTried ? partySendErrors(ag.parties) : undefined;
  const more: HeaderMenuEntry[] = [];
  if (full) {
    if (editable) more.push({ label: "Rename", icon: Pencil, onClick: () => void rename() });
    more.push({ label: "Move to folder…", icon: FolderInput, onClick: () => setFolderOpen(true) });
    more.push({ label: "Duplicate", icon: Copy, onClick: () => void duplicate() });
    if (ag.isTemplate) more.push({ label: "Use template", icon: FileSignature, onClick: () => void createFromTemplate() });
    else more.push({ label: "Save as template", icon: LayoutTemplate, onClick: () => void saveAsTemplate() });
    if (out) {
      more.push({ separator: true });
      more.push({ label: "Copy signing link…", icon: Link2, onClick: () => partiesCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }) });
      more.push({ label: "Void", icon: XCircle, onClick: () => void voidIt() });
    }
    more.push({ separator: true });
    more.push({ label: "Archive", icon: Archive, onClick: () => void archive() });
    if (isAdmin && (ag.isTemplate || cStatus === "DRAFT")) more.push({ label: "Delete", icon: Trash2, destructive: true, onClick: () => void remove() });
  }
  const primary = !full ? null : ag.isTemplate ? { label: "Use template", icon: FileSignature, onClick: () => void createFromTemplate() } : cStatus === "DRAFT" ? { label: "Send for signature", icon: Send, onClick: () => { setSendTried(true); setSendOpen(true); } } : null;
  const PrimaryIcon = primary?.icon ?? null;

  return (
    <>
      <Breadcrumb items={[ag.isTemplate ? { label: "Contract templates", href: "/agreements?view=templates" } : { label: "Contracts", href: "/agreements" }, ...(ag.category ? [{ label: ag.category, href: `/agreements?${ag.isTemplate ? "view=templates&" : ""}category=${encodeURIComponent(ag.category)}` }] : []), { label: title || ag.title }]} />
      <OsPageHeader
        title={title || ag.title}
        back={back}
        titleSlot={
          <>
            {editable ? (
              <input value={title} onChange={(e) => saveTitle(e.target.value)} placeholder="Untitled contract" aria-label="Contract title" className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-title font-semibold text-ink placeholder:text-ink-3 focus:bg-subtle focus:outline-none" />
            ) : <h1 className="min-w-0 flex-1 truncate text-title font-semibold text-ink">{ag.title}</h1>}
            {ag.isTemplate ? <span className="inline-flex h-6 items-center rounded-md bg-active px-2 text-xs font-medium text-ink">Template</span> : <StatusChip color={CONTRACT_STATUS_COLOR[cStatus]} label={CONTRACT_STATUS_LABEL[cStatus]} disabled />}
          </>
        }
        autosave={full ? <AutosaveIndicator status={status} lastSavedAt={lastSaved} onRetry={showRetry ? () => void flush() : undefined} /> : undefined}
        actions={full ? (
          <>
            <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">
              <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Preview as signer
            </button>
            {primary ? (
              <button type="button" onClick={primary.onClick} className="ms-1 inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover">
                {PrimaryIcon ? <PrimaryIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : null} {primary.label}
              </button>
            ) : null}
          </>
        ) : undefined}
        more={more.length ? more : undefined}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-4 pb-16 pt-2 sm:px-6">
        <div className="mx-auto flex w-full min-w-0 max-w-[720px] flex-col gap-6">
          {!full ? (
            <ReadOnlyBanner
              variant="inline"
              ownerName={ag.createdBy ? `${ag.createdBy.firstName ?? ""} ${ag.createdBy.lastName ?? ""}`.trim() : null}
              message={requestState === "sent" ? "View only. Request sent." : undefined}
              onRequest={requestState === "idle" ? () => void requestAccess() : undefined}
            />
          ) : null}

          {/* Details strip */}
          <section className="rounded-lg border border-line bg-raised">
            <dl>
              <DetailRow label="Folder">
                {full ? (
                  <span className="relative block max-w-[320px]">
                    <button type="button" onClick={() => setFolderOpen((o) => !o)} className="inline-flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-base text-ink">
                      <span className={`min-w-0 flex-1 truncate text-start ${ag.category ? "" : "text-ink-3"}`}>{ag.category ?? "Unfiled"}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                    </button>
                    <Picker open={folderOpen} onClose={() => setFolderOpen(false)} ariaLabel="Folder" selected={ag.category ?? "__none__"} onSelect={(v) => { setFolder(v === "__none__" ? null : v); setFolderOpen(false); }}
                      sections={[{ options: [{ value: "__none__", label: "Unfiled" }, ...folders.map((f) => ({ value: f, label: f }))] }]}
                      footer={<PickerFooterRow onClick={() => router.push("/sops/manage?tab=contract-folders")}>Manage folders…</PickerFooterRow>} />
                  </span>
                ) : <span className="text-base text-ink">{ag.category ?? <span className="text-ink-3">Unfiled</span>}</span>}
              </DetailRow>
              <DetailRow label="Source"><span className="text-base text-ink">{ag.sourceType === "pdf" ? "PDF" : "Written"}</span></DetailRow>
              {ag.sentAt ? <DetailRow label="Sent on"><span className="text-base text-ink" title={fmt.title(ag.sentAt)}>{fmt.date(ag.sentAt, "datetime")}{ag.signingOrder ? " · parties sign in order" : ""}</span></DetailRow> : null}
              {cStatus === "COMPLETED" ? <DetailRow label="Completed on"><span className="text-base text-ink">{fmt.date(ag.parties.map((p) => p.signedAt).filter(Boolean).sort().slice(-1)[0] ?? ag.updatedAt, "datetime")}</span></DetailRow> : null}
              {ag.voidedAt ? <DetailRow label="Voided on"><span className="text-base text-ink" title={fmt.title(ag.voidedAt)}>{fmt.date(ag.voidedAt, "datetime")}</span></DetailRow> : null}
            </dl>
          </section>

          {/* A party who is a Member: their signature card */}
          {!full && ag.myParty ? (
            <section className="rounded-lg border border-line bg-raised p-6">
              <h2 className="text-row font-medium text-ink">Your signature</h2>
              <p className="mt-1 text-sm text-ink-2">You are {ag.myParty.name} · {partyRoleLabel(ag.myParty.role)} · {PARTY_STATUS_LABEL[parsePartyStatus(ag.myParty.status)]}{ag.myParty.signedAt ? ` on ${fmt.date(ag.myParty.signedAt, "date")}` : ""}</p>
              {out && ag.myParty.status !== "SIGNED" && ag.myParty.status !== "DECLINED" ? (
                <a href={`/sign/${ag.myParty.token}`} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover"><FileSignature className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Open signing page</a>
              ) : cStatus === "DRAFT" ? <p className="mt-2 text-sm text-ink-2">It has not been sent for signature yet.</p> : null}
            </section>
          ) : null}

          {/* After Send: the Parties card */}
          {full && !ag.isTemplate && cStatus !== "DRAFT" ? (
            <section ref={partiesCardRef} className="flex flex-col gap-2 scroll-mt-4">
              <h2 className="text-row font-medium text-ink">Parties</h2>
              <TableCard<Party> ariaLabel="Parties" columns={partyColumns} rows={[...ag.parties].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))} rowKey={(p) => p.id} empty="No parties" />
            </section>
          ) : null}

          {/* Write · Place fields */}
          {editable ? (
            <div className="flex flex-wrap items-center gap-3">
              {narrow ? (
                <>
                  <span className="inline-flex h-8 items-center rounded-md bg-active px-3 text-sm font-medium text-ink">Write</span>
                  <span className="text-sm text-ink-2">Place fields on a wider screen</span>
                </>
              ) : (
                <>
                  <SegmentedControl<Mode> label="Mode" value={mode} onChange={(m) => { setMode(m); setPendingTool(null); }} options={[{ value: "write", label: "Write" }, { value: "fields", label: "Place fields" }]} />
                  {mode === "fields" ? <span className="text-sm text-ink-2">{fields.length} {fields.length === 1 ? "field" : "fields"} placed{pendingTool ? " · click the document to place" : ""}</span> : null}
                </>
              )}
            </div>
          ) : null}

          {editable && mode === "fields" ? (
            <AgreementFieldBuilder agreementId={ag.id} content={ag.content || ""} sourceType={ag.sourceType} pdfUrl={ag.pdfUrl} parties={ag.parties} fields={fields} onFieldsChange={saveFields}
              activePartyId={activeParty} onActivePartyChange={setActiveParty} pendingTool={pendingTool} onToolPlaced={() => setPendingTool(null)} width={720} />
          ) : editable && ag.sourceType !== "pdf" ? (
            <div className="os-prose rounded-lg border border-line bg-raised px-6 py-5">
              <BlockNoteCanvas key={`edit-${ag.id}-${editorKey}`} initialBnDoc={null} legacyBlocks={null} initialHtml={ag.content || ""} readonly={false} onChange={() => {}} onHtmlChange={saveContent} entity={{ type: "agreement", id: ag.id }} />
            </div>
          ) : ag.sourceType === "pdf" && ag.pdfUrl ? (
            <PdfPages url={ag.pdfUrl} width={720} renderPage={(i) => <FilledFields fields={fields.filter((f) => (f.page ?? 0) === i)} parties={ag.parties} />} />
          ) : (
            <div className="relative rounded-lg border border-line bg-raised px-6 py-5" style={{ minHeight: fieldsBottom(fields.filter((f) => (f.page ?? 0) === 0)) + 24 }}>
              <div className="os-prose"><BlockNoteCanvas key={`read-${ag.id}-${editorKey}`} initialBnDoc={null} legacyBlocks={null} initialHtml={ag.content || ""} readonly onChange={() => {}} entity={{ type: "agreement", id: ag.id }} /></div>
              {!editable ? <FilledFields fields={fields.filter((f) => (f.page ?? 0) === 0)} parties={ag.parties} /> : null}
            </div>
          )}
        </div>

        {editable && mode === "fields" ? (
          <PartiesPanel parties={ag.parties} activePartyId={activeParty} onActiveParty={setActiveParty} pendingTool={pendingTool} onPendingTool={setPendingTool}
            onAddParty={() => void addParty()} onAddTeammate={(p) => void addParty(p)} onRenameParty={(pid, name) => void patchParty(pid, { name })} onEmailParty={(pid, email) => void patchParty(pid, { email })}
            onRoleParty={(pid, role: PartyRole) => void patchParty(pid, { role })} onReorder={(ids) => void reorder(ids)} onRemoveParty={(pid) => void removeParty(pid)} sendErrors={sendErrors} />
        ) : null}
      </div>

      <SendDialog open={sendOpen} onClose={() => setSendOpen(false)} parties={ag.parties} onSend={send} busy={sendBusy} />
      {previewOpen ? <SignPreviewDialog open onClose={() => setPreviewOpen(false)} title={title || ag.title} content={ag.content || ""} sourceType={ag.sourceType} pdfUrl={ag.pdfUrl} fields={fields} parties={[...ag.parties].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => ({ id: p.id, name: p.name, role: p.role }))} orgName={boot.org.name} /> : null}
      {status === "saved" ? <span className="sr-only" role="status">Saved</span> : null}
    </>
  );
}

/** The values parties have signed, drawn in place over the read-only document. */
/** The document box must reach the lowest placed field, so a value never floats below it. */
function fieldsBottom(fields: PlacedField[]): number {
  return fields.reduce((m, f) => Math.max(m, f.y + f.h), 0);
}

function FilledFields({ fields, parties }: { fields: PlacedField[]; parties: Party[] }) {
  const valueFor = (f: PlacedField): string | null => {
    const p = parties.find((x) => x.id === f.partyId) as (Party & { values?: Record<string, string> }) | undefined;
    const v = p?.values?.[f.id];
    return typeof v === "string" && v ? v : null;
  };
  return (
    <div className="pointer-events-none absolute inset-0">
      {fields.map((f) => {
        const v = valueFor(f);
        const idx = Math.max(0, parties.findIndex((p) => p.id === f.partyId));
        return (
          <div key={f.id} className="absolute flex items-center justify-center overflow-hidden rounded text-xs text-ink" style={{ left: f.x, top: f.y, width: f.w, height: f.h, border: `1px dashed ${partyHue(idx)}`, background: v ? "transparent" : `${partyHue(idx)}14` }}>
            {v ? (v.startsWith("data:image") ? <SignatureImage src={v} alt={f.type} fallback={parties.find((p) => p.id === f.partyId)?.name} /> : f.type === "checkbox" ? (v === "true" ? "✓" : "") : <span className="truncate px-1">{v}</span>) : <span className="px-1 text-ink-3">{f.label || f.type}</span>}
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-start gap-3 border-b border-line-soft px-3 py-1.5 last:border-b-0">
      <dt className="w-[120px] shrink-0 pt-1.5 text-sm font-medium text-ink-2">{label}</dt>
      <dd className="min-w-0 flex-1 pt-0.5">{children}</dd>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
