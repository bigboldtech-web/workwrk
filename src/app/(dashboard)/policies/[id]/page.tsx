"use client";

/* /policies/[id] (spec-process section 2): read a policy and acknowledge it;
 * for the People team and admins, write, publish and assign it.
 *
 *   header      BackButton "Policies", THE POLICY TITLE (an input in edit
 *               mode), a pale StatusChip, "v2", the AutosaveIndicator; right:
 *               the Audience button (opens the 360 right info panel, never a
 *               modal), the "Can view" chip for everyone else, the "…" menu
 *               (Edit, Assign…, Acknowledgements, Publish / Unpublish,
 *               Version history, Copy link, Archive, Delete) and the one blue
 *               "Publish" for a FULL viewer on a draft
 *   column 720  the Details strip (Category, Effective date, Requires
 *               acknowledgement, Attestation statement), the acknowledgement
 *               card (the blue "Acknowledge" lives HERE beside the
 *               attestation; the header has no blue then), the Content /
 *               History tabs
 *
 * SAVE MODEL, the same as the SOP page: edit mode is the only place content
 * changes; drafts autosave (700ms debounce, single-flight, retries, the
 * localStorage draft mirror); published policies save on an explicit Save
 * and the server bumps the version. No read-only banner: a policy carries no
 * grants and no owner a Request could reach (the one named exception).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Archive, Check, ChevronDown, Edit3, Link2, ListOrdered, Plus, RotateCcw, Send, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader, OsPageHeaderSkeleton, type HeaderMenuEntry } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { DraftRestoreStrip } from "@/components/ui/draft-restore-strip";
import { StatusChip } from "@/components/ui/chip";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { Picker, PickerFooterRow } from "@/components/ui/picker";
import { DateField } from "@/components/ui/date-field";
import { SkeletonLines, SkeletonRows } from "@/components/ui/skeleton";
import { InfoPanel, InfoRow } from "@/components/ui/info-panel";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { AssignDialog } from "@/components/process/assign-dialog";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useRole } from "@/hooks/use-role";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { POLICY_STATUS_COLOR, POLICY_STATUS_LABEL, type PolicyStatus } from "@/lib/policies-list";
import { deriveSopSaveState, nextRetryDelay } from "@/lib/sop-save-state";
import { defaultAckDueDate } from "@/lib/process-settings";

type AudiencePerson = PersonRef & { assignmentId: string; status: string; dueDate: string | null; mandatory: boolean; department: string | null };
interface Policy {
  id: string; title: string; content: string; category: string | null; version: number; ackVersion: number; ackStatement: string | null;
  status: PolicyStatus; requiresAck: boolean; effectiveDate: string | null; createdAt: string; updatedAt: string;
  acknowledged: boolean; needsReack: boolean; totalAcks: number; totalUsers: number;
  access: { role: "FULL" | "VIEW" };
  myAssignment: { id: string; status: string; dueDate: string | null; mandatory: boolean; completedAt: string | null } | null;
  myAcknowledgement: { version: number | null; acknowledgedAt: string; current: boolean } | null;
  audienceSummary: { everyone: boolean; count: number; acknowledged: number; departments: Array<{ id: string; name: string; count: number }>; people: AudiencePerson[] };
  defaults: { ackStatement: string; ackDueDays: number | null };
}
type VersionRow = { id: string; version: number; title: string; createdAt: string; publishedBy: string | null };
type Snapshot = { title: string; content: string; category: string | null; effectiveDate: string | null; requiresAck: boolean; ackStatement: string };

const AUTOSAVE_MS = 700;

export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const { boot } = useBoot();
  const { bumpRowVersion, layerCount } = useOsShell();
  const { isAdmin } = useRole();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "failed">("loading");
  const full = policy?.access.role === "FULL";
  const status: PolicyStatus = policy?.status ?? "DRAFT";
  const autosaves = status === "DRAFT";

  /* edit buffers */
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
  const [requiresAck, setRequiresAck] = useState(true);
  const [ackStatement, setAckStatement] = useState("");
  const [showFields, setShowFields] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [tab, setTab] = useState<"content" | "history">("content");
  const [categories, setCategories] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState(false);

  const hydrate = useCallback((p: Policy) => {
    setTitle(p.title ?? "");
    setContent(p.content ?? "");
    setCategory(p.category ?? null);
    setEffectiveDate(p.effectiveDate ? p.effectiveDate.slice(0, 10) : null);
    setRequiresAck(p.requiresAck);
    setAckStatement(p.ackStatement ?? "");
    if (p.ackStatement) setShowFields(true);
    setEditorKey((k) => k + 1);
  }, []);

  const load = useCallback(async (): Promise<Policy | null> => {
    const r = await apiFetch<Policy | { data: Policy }>(`/api/policies/${id}`, { cache: "no-store" });
    if (!r.ok) { setLoadState(r.status === 404 ? "notfound" : "failed"); return null; }
    const p = ("data" in r.data && r.data.data ? r.data.data : r.data) as Policy;
    setPolicy(p);
    setLoadState("ready");
    return p;
  }, [id]);
  const baselinePendingRef = useRef(false);
  // The ?edit=1 that arrived with the page opens the editor once; a later
  // router.replace that drops it must not re-run the load and reset buffers.
  const editOnArrivalRef = useRef(search?.get("edit") === "1");
  useEffect(() => {
    const t = setTimeout(() => {
      void load().then((p) => {
        if (!p) return;
        baselinePendingRef.current = true;
        hydrate(p);
        if (editOnArrivalRef.current && p.access.role === "FULL") setEditing(true);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [load, hydrate]);
  useEffect(() => {
    void apiFetch<{ process?: { policyCategories?: string[] } }>("/api/settings/process", { cache: "no-store" }).then((r) => { if (r.ok) setCategories(r.data.process?.policyCategories ?? []); });
  }, []);

  /* the save engine (a sibling of the SOP page's, one contract) */
  const snapshot = useMemo<Snapshot>(() => ({ title, content, category, effectiveDate, requiresAck, ackStatement }), [title, content, category, effectiveDate, requiresAck, ackStatement]);
  const serial = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const savedSerialRef = useRef(serial);
  const [dirtyTick, setDirtyTick] = useState(0);
  const dirty = useMemo(() => { void dirtyTick; return serial !== savedSerialRef.current; }, [serial, dirtyTick]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const serialRef = useRef(serial); serialRef.current = serial;
  const draft = useLocalDraft<Snapshot>("policy", id, policy?.updatedAt ?? null);
  const mountedAtRef = useRef(Date.now());
  const draftFromEarlier = !!draft.pending && Date.parse(draft.pending.at) < mountedAtRef.current;

  const flush = useCallback(async (opts: { keepalive?: boolean; publish?: { reacknowledge: boolean } } = {}): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (inFlightRef.current) { queuedRef.current = true; return true; }
    const snap = snapshotRef.current;
    const sent = serialRef.current;
    inFlightRef.current = true;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { title: snap.title.trim() || "Untitled policy", content: snap.content, category: snap.category, effectiveDate: snap.effectiveDate, requiresAck: snap.requiresAck, ackStatement: snap.ackStatement.trim() || null };
      if (opts.publish) { body.status = "PUBLISHED"; body.requireReack = opts.publish.reacknowledge; }
      const r = await apiFetch<Policy>(`/api/policies/${id}`, { method: "PATCH", json: body, keepalive: opts.keepalive && sent.length < 60_000 ? true : undefined });
      if (!r.ok) throw Object.assign(new Error(r.error || "Save failed"), { status: r.status });
      const data = (r.data as Policy & { data?: Policy }).data ?? r.data;
      savedSerialRef.current = sent;
      attemptRef.current = 0;
      setFailed(false); setRetrying(false);
      setLastSaved(new Date());
      draft.clear();
      setPolicy((prev) => (prev ? { ...prev, ...data, access: prev.access, audienceSummary: prev.audienceSummary, defaults: prev.defaults, myAssignment: prev.myAssignment, myAcknowledgement: prev.myAcknowledgement } : prev));
      setDirtyTick((n) => n + 1);
      return true;
    } catch (e) {
      const st = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 0;
      const fatal = st >= 400 && st < 500 && st !== 401 && st !== 408 && st !== 429;
      setFailed(true);
      const delay = fatal ? null : nextRetryDelay(attemptRef.current);
      attemptRef.current += 1;
      if (delay !== null) { setRetrying(true); retryRef.current = setTimeout(() => { retryRef.current = null; void flush(); }, delay); }
      else {
        setRetrying(false); attemptRef.current = 0;
        toast(fatal && e instanceof Error ? e.message : "Couldn't save. Check your connection and keep this tab open.", { tone: "danger", action: { label: "Retry", onClick: () => void flush() } });
      }
      return false;
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      if (queuedRef.current) { queuedRef.current = false; void flush(); }
    }
  }, [id, draft, toast]);

  const queueSave = useCallback(() => {
    draft.write(snapshotRef.current);
    if (!autosaves) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; void flush(); }, AUTOSAVE_MS);
  }, [autosaves, draft, flush]);
  useEffect(() => {
    if (baselinePendingRef.current) { baselinePendingRef.current = false; savedSerialRef.current = serial; setDirtyTick((n) => n + 1); return; }
    if (!editing) return;
    if (serial === savedSerialRef.current) return;
    queueSave();
  }, [serial, editing, queueSave]);
  useEffect(() => {
    const onHide = () => { if (editing && autosaves && serialRef.current !== savedSerialRef.current) void flush({ keepalive: true }); };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", onHide); document.removeEventListener("visibilitychange", onVis); };
  }, [editing, autosaves, flush]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); if (retryRef.current) clearTimeout(retryRef.current); }, []);
  const saveState = deriveSopSaveState({ saving, failed, retrying, dirty, autosaves, lastSaved });
  useDirtyGuard(editing && saveState.leaveGuard, { onSave: () => flush(), id: `policy:${id}` });
  const restoreDraft = (payload: Snapshot) => {
    setTitle(payload.title); setContent(payload.content); setCategory(payload.category); setEffectiveDate(payload.effectiveDate); setRequiresAck(payload.requiresAck); setAckStatement(payload.ackStatement);
    setEditorKey((k) => k + 1);
    setEditing(true);
    toast("Restored your unsaved changes");
  };

  /* actions */
  const enterEdit = useCallback(() => {
    if (!full || !policy) return;
    baselinePendingRef.current = true;
    hydrate(policy);
    setEditing(true);
    router.replace(`/policies/${policy.id}?edit=1`);
  }, [full, policy, hydrate, router]);
  const leaveEdit = useCallback(async (opts: { discard?: boolean } = {}) => {
    if (!policy) return;
    if (dirty && !opts.discard) {
      if (autosaves) { const ok = await flush(); if (!ok) return; }
      else {
        const ok = await confirm({ title: "Discard changes?", description: "This policy is published, so unsaved changes are not kept.", confirmLabel: "Discard", destructive: true });
        if (!ok) return;
      }
    }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    draft.discard();
    setEditing(false);
    const fresh = await load();
    if (fresh) { baselinePendingRef.current = true; hydrate(fresh); }
    router.replace(`/policies/${policy.id}`);
  }, [policy, dirty, autosaves, flush, confirm, draft, load, hydrate, router]);

  const [publishOpen, setPublishOpen] = useState(false);
  const [reack, setReack] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    if (!policy) return;
    if (!(editing ? content : policy.content).trim()) { toast("Write the policy before publishing it", { tone: "danger" }); return; }
    setPublishing(true);
    if (!editing) { baselinePendingRef.current = true; hydrate(policy); }
    const ok = await flush({ publish: { reacknowledge: reack } });
    setPublishing(false);
    if (!ok) return;
    setPublishOpen(false); setReack(false);
    toast("Published");
    setEditing(false);
    router.replace(`/policies/${policy.id}`);
    void load().then((p) => { if (p) { baselinePendingRef.current = true; hydrate(p); } });
    bumpRowVersion("policies");
  };
  const setStatus = async (next: PolicyStatus, done: string) => {
    if (!policy) return;
    const r = await apiFetch<Policy>(`/api/policies/${policy.id}`, { method: "PATCH", json: { status: next } });
    if (!r.ok) { toast(r.error || "Couldn't update the status", { tone: "danger" }); return; }
    toast(done);
    void load();
    bumpRowVersion("policies");
  };
  const unpublish = async () => {
    const ok = await confirm({ title: "Unpublish this policy?", description: "It goes back to a draft and leaves the list people see. Acknowledgements are kept.", confirmLabel: "Unpublish" });
    if (ok) await setStatus("DRAFT", "Unpublished");
  };
  const archive = async () => {
    const ok = await confirm({ title: "Archive this policy?", description: "It leaves the list people see. Acknowledgements are kept, and you can find it under Archived.", confirmLabel: "Archive" });
    if (ok) await setStatus("ARCHIVED", "Archived");
  };
  const remove = async () => {
    if (!policy) return;
    const ok = await confirm({ title: `Delete "${policy.title}"?`, description: `It moves to Trash and can be restored within ${boot.org.trashDays} days.`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/policies/${policy.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete", { tone: "danger" }); return; }
    toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=policy") } });
    bumpRowVersion("policies");
    router.push("/policies");
  };
  const copyLink = useCallback(() => {
    void navigator.clipboard.writeText(`${window.location.origin}/policies/${id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  }, [id, toast]);

  /* acknowledgement */
  const [attested, setAttested] = useState(false);
  const [acking, setAcking] = useState(false);
  const acknowledge = async () => {
    if (!policy || acking || !attested) return;
    setAcking(true);
    const attestation = policy.ackStatement?.trim() || policy.defaults.ackStatement;
    const r = await apiFetch(`/api/policies/${policy.id}/acknowledge`, { method: "POST", json: { attestation, version: policy.version } });
    setAcking(false);
    if (!r.ok) { toast(r.error || "Couldn't acknowledge", { tone: "danger" }); return; }
    setAttested(false);
    toast("Acknowledged");
    void load();
    bumpRowVersion("policies");
  };
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#acknowledge" || !policy) return;
    const t = setTimeout(() => document.getElementById("acknowledge")?.scrollIntoView({ block: "center" }), 50);
    return () => clearTimeout(t);
  }, [policy]);

  /* history */
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "history" || versions !== null) return;
    void apiFetch<{ versions?: VersionRow[]; data?: { versions?: VersionRow[] } }>(`/api/policies/${id}/versions`, { cache: "no-store" }).then((r) => setVersions(r.ok ? r.data.versions ?? r.data.data?.versions ?? [] : []));
  }, [tab, versions, id]);
  const restore = async (v: VersionRow) => {
    const ok = await confirm({ title: `Restore v${v.version}?`, description: "The current version is kept in the history and the policy becomes a new version.", confirmLabel: "Restore" });
    if (!ok) return;
    setRestoring(v.id);
    const r = await apiFetch(`/api/policies/${id}/versions`, { method: "POST", json: { versionId: v.id } });
    setRestoring(null);
    if (!r.ok) { toast(r.error || "Couldn't restore", { tone: "danger" }); return; }
    toast(`Restored v${v.version}`);
    setVersions(null);
    void load().then((p) => { if (p) { baselinePendingRef.current = true; hydrate(p); } });
  };

  /* audience panel, assign */
  const [audienceOpen, setAudienceOpen] = useState(false);
  const audienceBtn = useRef<HTMLButtonElement>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  /* keyboard */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && editing) { e.preventDefault(); void flush(); return; }
      if (e.key === "e" && !typing && !editing && full && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); enterEdit(); return; }
      const overlayOpen = layerCount > 0 || e.defaultPrevented || !!document.querySelector('[role="listbox"], [role="dialog"]');
      if (e.key === "Escape" && editing && !typing && !overlayOpen && !publishOpen && !assignOpen) void leaveEdit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, full, enterEdit, leaveEdit, flush, layerCount, publishOpen, assignOpen]);

  if (loadState === "notfound") return <NotFoundView />;
  if (loadState === "failed") {
    return (
      <>
        <OsPageHeader title="Policy" back={{ fallbackHref: "/policies", label: "Policies" }} />
        <OsEmptyView variant="error" title="Couldn't load this policy" action={{ label: "Retry", onClick: () => { setLoadState("loading"); void load().then((p) => { if (p) { baselinePendingRef.current = true; hydrate(p); } }); } }} />
      </>
    );
  }
  if (loadState === "loading" || !policy) {
    return (<><OsPageHeaderSkeleton /><div className="mx-auto w-full max-w-[720px] px-6 pt-4"><SkeletonLines lines={6} /></div></>);
  }

  const headerTitle = (editing ? title : policy.title) || "Untitled policy";
  const openAck = policy.requiresAck && policy.status === "PUBLISHED" && (policy.myAssignment !== null || policy.audienceSummary.everyone);
  const acked = policy.acknowledged;
  const openPublish = () => { if (!policy?.content?.trim()) { toast("Write the policy before publishing it", { tone: "danger", action: full ? { label: "Start writing", onClick: enterEdit } : undefined }); return; } setPublishOpen(true); };
  const primary = full && !editing && status === "DRAFT" ? { label: "Publish", onClick: openPublish } : null;
  const more: HeaderMenuEntry[] = [];
  if (full && !editing) more.push({ label: "Edit", icon: Edit3, onClick: enterEdit });
  if (full) more.push({ label: "Assign…", icon: UserPlus, onClick: () => setAssignOpen(true) });
  if (full) more.push({ label: "Acknowledgements", icon: ShieldCheck, href: `/policies/${policy.id}/compliance` });
  if (full && status === "PUBLISHED") more.push({ label: "Unpublish", icon: RotateCcw, onClick: () => void unpublish() });
  if (full && status !== "DRAFT" && status !== "PUBLISHED") more.push({ label: "Publish", icon: Send, onClick: openPublish });
  if (full) more.push({ label: "Version history", icon: ListOrdered, onClick: () => setTab("history") });
  more.push({ label: "Copy link", icon: Link2, onClick: copyLink });
  if (full && status !== "ARCHIVED") { more.push({ separator: true }); more.push({ label: "Archive", icon: Archive, onClick: () => void archive() }); }
  if (full && isAdmin) { if (status === "ARCHIVED") more.push({ separator: true }); more.push({ label: "Delete", icon: Trash2, destructive: true, onClick: () => void remove() }); }
  const audience = policy.audienceSummary;
  const dueDefault = defaultAckDueDate(policy.defaults.ackDueDays);

  return (
    <>
      <Breadcrumb items={[{ label: "Policies", href: "/policies" }, { label: headerTitle }]} />
      <OsPageHeader
        title={headerTitle}
        back={{ fallbackHref: "/policies", label: "Policies" }}
        titleSlot={
          <>
            {editing ? (
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled policy" aria-label="Policy title" className="h-9 min-w-0 flex-1 rounded-md bg-transparent px-1 text-xl font-semibold text-ink placeholder:text-ink-3 focus:bg-subtle focus:outline-none" />
            ) : (
              <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-ink">{headerTitle}</h1>
            )}
            <StatusChip color={POLICY_STATUS_COLOR[status]} label={POLICY_STATUS_LABEL[status]} disabled />
            <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">v{policy.version}</span>
          </>
        }
        autosave={editing ? <AutosaveIndicator status={saveState.status} lastSavedAt={lastSaved} onRetry={saveState.showRetry ? () => void flush() : undefined} labels={{ idle: autosaves ? "Auto-saves as you type" : undefined }} /> : undefined}
        actions={
          <>
            {/* ONE control, one door. A policy carries no object grants, so
                Audience is the share door for everyone (spec-process section 2
                /policies/[id]: "read-only for everyone"). A role chip beside it
                would be a second affordance opening the same 360 panel. */}
            <button ref={audienceBtn} type="button" onClick={() => setAudienceOpen((o) => !o)} aria-pressed={audienceOpen} aria-haspopup="dialog" title="Audience" className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
              <Users className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Audience
            </button>
            {primary ? (
              <button type="button" onClick={primary.onClick} className="ms-1 inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover">
                <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {primary.label}
              </button>
            ) : null}
          </>
        }
        more={more}
      />

      <div className="os-chrome mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-32 pt-2 sm:px-6">
        {draftFromEarlier && full ? <DraftRestoreStrip draft={draft} onRestore={restoreDraft} className="-mx-4 sm:-mx-6" /> : null}

        {/* Details strip */}
        <section className="rounded-lg border border-line bg-raised">
          <dl>
            <DetailRow label="Category">
              {editing ? (
                <span className="relative block max-w-[320px]">
                  <button type="button" onClick={() => setCatOpen((o) => !o)} className="inline-flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-base text-ink">
                    <span className={`min-w-0 flex-1 truncate text-start ${category ? "" : "text-ink-3"}`}>{category ?? "None"}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                  </button>
                  <Picker open={catOpen} onClose={() => setCatOpen(false)} ariaLabel="Category" selected={category} onSelect={(v) => { setCategory(v === "__none__" ? null : v); setCatOpen(false); }}
                    sections={[{ options: [{ value: "__none__", label: "None" }, ...categories.map((c) => ({ value: c, label: c }))] }]}
                    footer={<PickerFooterRow onClick={() => router.push("/sops/manage?tab=policy-categories")}>Manage categories…</PickerFooterRow>} />
                </span>
              ) : <span className="text-base text-ink">{policy.category ?? <span className="text-ink-3">None</span>}</span>}
            </DetailRow>
            <DetailRow label="Effective date">
              {editing ? <DateField value={effectiveDate} onChange={setEffectiveDate} ariaLabel="Effective date" placeholder="Not set" size="sm" className="max-w-[320px]" />
                : policy.effectiveDate ? <span className="text-base text-ink" title={fmt.title(policy.effectiveDate)}>{fmt.date(policy.effectiveDate, "date")}</span> : <span className="text-ink-3">Not set</span>}
            </DetailRow>
            <DetailRow label="Requires acknowledgement">
              {editing ? <span className="inline-flex h-8 items-center gap-2 text-base text-ink"><Switch checked={requiresAck} onChange={setRequiresAck} aria-label="Requires acknowledgement" /> {requiresAck ? "Yes" : "No"}</span>
                : <span className="text-base text-ink">{policy.requiresAck ? "Yes" : "No"}</span>}
            </DetailRow>
            {(showFields || editing && ackStatement) || (!editing && policy.ackStatement) ? (
              <DetailRow label="Attestation statement">
                {editing ? <textarea value={ackStatement} onChange={(e) => setAckStatement(e.target.value)} placeholder={policy.defaults.ackStatement} aria-label="Attestation statement" rows={2} className="w-full resize-none rounded-md border border-line-strong bg-raised px-2 py-1 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
                  : <span className="text-base text-ink">{policy.ackStatement ?? policy.defaults.ackStatement}</span>}
              </DetailRow>
            ) : null}
            {editing && !showFields && !ackStatement ? (
              <div className="border-t border-line-soft px-3 py-1">
                <button type="button" onClick={() => setShowFields(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add field</button>
              </div>
            ) : null}
          </dl>
        </section>

        {/* Acknowledgement card */}
        {openAck && !editing ? (
          <section id="acknowledge" className="rounded-lg border border-line bg-raised p-6">
            {policy.needsReack ? <p className="mb-3 text-sm font-medium text-ink">This policy changed. Please acknowledge version {policy.version}.</p> : null}
            {acked ? (
              <p className="inline-flex items-center gap-2 text-sm text-ink-2"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-success-solid" />Acknowledged{policy.myAcknowledgement?.acknowledgedAt ? ` on ${fmt.date(policy.myAcknowledgement.acknowledgedAt, "date")}` : ""} · version {policy.myAcknowledgement?.version ?? policy.version}</p>
            ) : (
              <>
                <p className="text-row text-ink">{policy.ackStatement?.trim() || policy.defaults.ackStatement}</p>
                {policy.myAssignment?.dueDate ? <p className={`mt-2 text-sm ${new Date(policy.myAssignment.dueDate).getTime() < Date.now() ? "text-danger-text" : "text-ink-2"}`}>{new Date(policy.myAssignment.dueDate).getTime() < Date.now() ? "Overdue · " : ""}Due {fmt.date(policy.myAssignment.dueDate, "date")}</p> : null}
                <label className="mt-4 flex cursor-pointer items-start gap-2 text-base text-ink">
                  <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] rounded border-line-strong accent-[var(--os-brand)]" />
                  <span>I confirm the statement above</span>
                </label>
                <div className="mt-4">
                  <button type="button" onClick={() => void acknowledge()} disabled={!attested || acking} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
                    {acking ? <Dots variant="pending" /> : <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Acknowledge
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}

        <ViewTabStrip aria-label="Policy">
          <ViewTab dense label="Content" active={tab === "content"} onClick={() => setTab("content")} />
          <ViewTab dense label="History" active={tab === "history"} onClick={() => setTab("history")} />
        </ViewTabStrip>

        {tab === "history" ? (
          <section className="rounded-lg border border-line bg-raised">
            <div className="flex h-11 items-center gap-2 border-b border-line-soft px-3 text-row text-ink"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-success-solid" />v{policy.version} · current{policy.status === "PUBLISHED" ? " · Published" : ""}</div>
            {versions === null ? <div className="p-3"><SkeletonRows rows={3} rowHeight="44px" /></div>
              : versions.length === 0 ? <p className="flex h-11 items-center px-3 text-base text-ink-2">No earlier versions yet. Edits to a published policy are versioned automatically.</p>
              : versions.map((v) => (
                <div key={v.id} className="flex h-11 items-center gap-3 border-b border-line-soft px-3 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-row text-ink">v{v.version} · {v.title} · <span className="text-ink-2" title={fmt.title(v.createdAt)}>{fmt.date(v.createdAt, "date")}</span></span>
                  {full ? <button type="button" onClick={() => void restore(v)} disabled={!!restoring} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60">{restoring === v.id ? <Dots variant="pending" /> : <RotateCcw className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Restore</button> : null}
                </div>
              ))}
          </section>
        ) : editing ? (
          <div className="os-prose rounded-lg border border-line bg-raised px-6 py-5">
            <BlockNoteCanvas key={`edit-${policy.id}-${editorKey}`} initialBnDoc={null} legacyBlocks={null} initialHtml={content || ""} readonly={false} onChange={() => {}} onHtmlChange={setContent} entity={{ type: "policy", id: policy.id }} />
          </div>
        ) : policy.content?.trim() ? (
          <div className="os-prose">
            <BlockNoteCanvas key={`read-${policy.id}-${policy.version}`} initialBnDoc={null} legacyBlocks={null} initialHtml={policy.content} readonly onChange={() => {}} entity={{ type: "policy", id: policy.id }} />
          </div>
        ) : (
          <p className="text-base text-ink-2">Nothing written yet{full ? <> · <button type="button" onClick={enterEdit} className="font-medium text-brand-deep hover:underline">Start writing</button></> : "."}</p>
        )}
      </div>

      {/* The sticky save bar */}
      {editing && saveState.showSaveBar ? (
        <div className="fixed bottom-0 end-0 start-[calc(var(--os-rail-w)+var(--os-side-w,0px))] z-30 flex h-14 items-center gap-2 border-t border-line bg-raised px-6">
          <span className="min-w-0 flex-1 truncate text-base text-ink">{failed ? "Not saved" : "Unsaved changes"}</span>
          <button type="button" onClick={() => void leaveEdit()} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void flush()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">{saving ? <Dots variant="pending" /> : null} Save</button>
        </div>
      ) : editing ? (
        <div className="fixed bottom-0 end-0 start-[calc(var(--os-rail-w)+var(--os-side-w,0px))] z-30 flex h-14 items-center gap-2 border-t border-line bg-raised px-6">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{autosaves ? "Editing · drafts save as you type" : "Editing · changes are saved when you press Save"}</span>
          <button type="button" onClick={() => void leaveEdit()} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover"><Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Done</button>
        </div>
      ) : null}

      {/* Audience panel (the 360 right info panel) */}
      <InfoPanel open={audienceOpen} onClose={() => setAudienceOpen(false)} title="Audience" returnFocusTo={audienceBtn}
        footer={full ? <button type="button" onClick={() => { setAudienceOpen(false); setAssignOpen(true); }} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover"><UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Assign…</button> : undefined}>
        <InfoRow label="Who">{audience.everyone ? `Everyone at ${boot.org.name} · ${audience.count} ${audience.count === 1 ? "person" : "people"}` : `${audience.count} ${audience.count === 1 ? "person" : "people"}`}</InfoRow>
        {policy.requiresAck && status === "PUBLISHED" ? <InfoRow label="Acknowledged">{audience.acknowledged} of {audience.count}</InfoRow> : null}
        {audience.departments.length ? (
          <div className="border-b border-line-soft px-4 py-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Departments</p>
            {audience.departments.map((d) => <p key={d.id} className="flex h-8 items-center text-base text-ink">{d.name}<span className="ms-auto text-sm tabular-nums text-ink-2">{d.count}</span></p>)}
          </div>
        ) : null}
        {full && audience.people.length ? (
          <div className="px-4 py-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">People</p>
            {audience.people.map((p) => (
              <p key={p.assignmentId} className="flex h-9 items-center gap-2 text-base text-ink">
                <PersonAvatar person={p} size={24} />
                <span className="min-w-0 flex-1 truncate">{`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email}</span>
                <span className="shrink-0 text-xs text-ink-2">{p.status === "COMPLETED" ? "Acknowledged" : p.dueDate && new Date(p.dueDate).getTime() < Date.now() ? "Overdue" : "Pending"}</span>
              </p>
            ))}
          </div>
        ) : !full && !audience.everyone ? <p className="px-4 py-3 text-sm text-ink-2">Named people, managed by the People team and admins.</p> : null}
      </InfoPanel>

      <Dialog open={publishOpen} onOpenChange={(v) => { if (!v) setPublishOpen(false); }}>
        <DialogContent className="max-w-[400px]">
          <DialogTitle>Publish version {policy.version}?</DialogTitle>
          <DialogDescription>{audience.everyone ? `Everyone at ${boot.org.name} will see it${policy.requiresAck ? " and be asked to acknowledge it" : ""}.` : `The ${audience.count} ${audience.count === 1 ? "person" : "people"} assigned will see it${policy.requiresAck ? " and be asked to acknowledge it" : ""}.`}</DialogDescription>
          {status === "PUBLISHED" || policy.acknowledged || policy.totalAcks > 0 ? <label className="mt-2 inline-flex items-center gap-2 text-base text-ink"><Switch checked={reack} onChange={setReack} /> Require everyone to acknowledge again</label> : null}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setPublishOpen(false)} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button type="button" onClick={() => void publish()} disabled={publishing} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">{publishing ? <Dots variant="pending" /> : <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Publish</button>
          </div>
        </DialogContent>
      </Dialog>

      <AssignDialog open={assignOpen} onClose={() => setAssignOpen(false)} object={{ type: "policy", id: policy.id, title: policy.title }} defaults={{ dueDate: dueDefault, mandatory: true }} alreadyAssigned={audience.people.map((p) => p.id)} onAssigned={() => { void load(); bumpRowVersion("policies"); }} />
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-start gap-3 border-b border-line-soft px-3 py-1.5 last:border-b-0">
      <dt className="w-[184px] shrink-0 pt-1.5 text-sm font-medium text-ink-2">{label}</dt>
      <dd className="min-w-0 flex-1 pt-0.5">{children}</dd>
    </div>
  );
}
