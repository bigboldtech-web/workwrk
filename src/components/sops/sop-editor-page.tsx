"use client";

/* SopEditorPage (spec-process section 3): the one page component behind
 * /sops/[id], /sops/[id]?edit=1 and the four create routes.
 *
 *   header      BackButton "SOPs", the title (an input in edit mode), a pale
 *               StatusChip, the kind Chip, "v3", the AutosaveIndicator; right:
 *               Share (or the role chip), the "…" menu, and the ONE blue
 *               button (Acknowledge / Start run / Continue run / Publish /
 *               Submit for review), which depends on who is looking
 *   column 720  the read-only banner (Can view / Can comment), the local
 *               draft restore strip, the Details strip (Folder, Tags, Linked
 *               KRA, Owner, "Show more fields"; collapsible,
 *               remembered in home.ui.sopDetailsCollapsed), the Content /
 *               People / History tabs, and "Used by" at the bottom
 *
 * CREATE-ON-FIRST-CHANGE. With `sopId` null nothing is written until the first
 * non-empty title or content change; that change POSTs /api/sops { kind,
 * title, folderId, tags, content } and history.replaceState moves the URL to
 * /sops/[id]?edit=1, so leaving a blank page leaves nothing behind.
 *
 * ONE SAVE MODEL FOR EVERY KIND. Edit mode is the only place content
 * changes. Drafts autosave (700ms debounce, single-flight with a coalescing
 * queue, keepalive flush on pagehide and unmount, 800ms doubling retries and
 * then "Not saved · Retry"). Published SOPs never autosave: the sticky save
 * bar appears when dirty and Save is explicit (the server snapshots the old
 * version). Recorded-step edits go through the same path (they used to
 * PATCH immediately and swallow failures). Every queued save is mirrored to
 * localStorage by useLocalDraft and cleared on a 200, so a crash or an
 * expired session never loses typed content: the DraftRestoreStrip offers
 * it back on the next open. The pure state rules live in
 * src/lib/sop-save-state.ts with a test per state.
 *
 * IN WORK. /work/sops/[id] renders this same page when an SOP is opened from
 * Work, so the person stays in Work (src/lib/nav/object-href.ts). There
 * (`inWork`, from the route's placement) the WorkPlacementProvider declares
 * the crumb, Back and Delete land on the Work crumb, and ?edit and its strip
 * stay at the address the SOP is mounted at (`workSelf`). The create routes
 * never run in Work: they start without an id.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Archive, Check, ChevronDown, ChevronRight, Copy, Edit3, GitBranch, Link2, ListOrdered, Play, Plus, Send, Sparkles, Trash2, UserPlus,
} from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader, OsPageHeaderSkeleton, type HeaderMenuEntry, type PrimaryAction } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { ReadOnlyBanner } from "@/components/access/read-only-banner";
import { ShareOrRoleChip } from "@/components/access/share-or-role-chip";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { DraftRestoreStrip } from "@/components/ui/draft-restore-strip";
import { Chip, StatusChip } from "@/components/ui/chip";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { BlockNoteCanvas, type BnDocJSON } from "@/components/docs/blocknote-canvas";
import type { Block } from "@/components/docs/block-types";
import { BacklinksPanel } from "@/components/docs/block-doc-editor";
import { collectLegacyCustomEmbeds, rehydrateMirrorWithLegacyEmbeds } from "@/components/docs/legacy-embed-preserve";
import { ChecklistBuilder, normalizeChecklistSections, type ChecklistSection } from "@/components/checklist-builder";
import type { ProcessFlow } from "@/components/process-flow-builder";
import { SopTaxonomyPicker } from "@/components/sops/sop-taxonomy-picker";
import { SopTagInput } from "@/components/sops/sop-tag-input";
import { SopKraPicker } from "@/components/sops/sop-kra-picker";
import { SopReadView, type SopReadContent } from "@/components/sops/sop-read-view";
import { SopStepsEditor, flowFromSteps, stepsFromFlow, type EditStep } from "@/components/sops/sop-steps-editor";
import { SopRecordingEditor, type RecordedStep } from "@/components/sops/sop-recording-editor";
import { SopPeopleTab } from "@/components/sops/sop-people-tab";
import { SopVersionsTab } from "@/components/sops/sop-versions-tab";
import { SopShareDialog } from "@/components/sops/sop-share-dialog";
import { SopWalkthrough } from "@/components/sops/sop-walkthrough";
import { StartRunDialog } from "@/components/sops/start-run-dialog";
import { AssignDialog } from "@/components/process/assign-dialog";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { getSopKind, getSopLayout, SOP_KIND_LABEL, SOP_STATUS_COLOR, SOP_STATUS_LABEL, sopTypeForKind, type SopKind, type SopLayout, type SopStatus } from "@/lib/sop-kind";
import { deriveSopSaveState, isMeaningfulFirstChange, nextRetryDelay } from "@/lib/sop-save-state";
import { useWorkPlacement, useWorkTitle } from "@/components/layout/os/work-placement";
import { copyObjectLink, objectHrefNow } from "@/components/layout/os/use-object-href";

/* ───────────────────────────── types ───────────────────────────── */

type Role = "FULL" | "EDIT" | "COMMENT" | "VIEW";

interface SopPayload {
  id: string;
  title: string;
  description: string | null;
  sopType: "WRITTEN" | "RECORDED" | "CHECKLIST";
  content: SopReadContent & { meta?: Record<string, unknown> };
  kind: SopKind;
  layout: SopLayout;
  version: number;
  status: SopStatus;
  folderId: string | null;
  folder: { id: string; name: string; color: string | null } | null;
  tags: string[];
  kraId: string | null;
  shareToken: string | null;
  createdById: string | null;
  createdBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  myAssignment: { assignmentId: string; status: string; completedAt: string | null; dueDate: string | null } | null;
  myRun: { id: string; shareToken: string | null; progress: number; status: string } | null;
  access: { role: Role };
}

type Snapshot = { title: string; description: string; content: Record<string, unknown> };

const AUTOSAVE_MS = 700;
const KEEPALIVE_LIMIT = 60_000;

function newId() { return Math.random().toString(36).slice(2, 10); }

/** Legacy `{ type: "WRITTEN", body }` and `{ type: "richtext", html }` become blocks the first time they are edited. */
function bodyToBlocks(body: string): Block[] {
  const out: Block[] = [];
  for (const raw of (body ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) { out.push({ id: newId(), kind: "paragraph", text: "" }); continue; }
    if (line.startsWith("# ")) { out.push({ id: newId(), kind: "h1", text: line.slice(2) }); continue; }
    if (line.startsWith("## ")) { out.push({ id: newId(), kind: "h2", text: line.slice(3) }); continue; }
    if (line.startsWith("### ")) { out.push({ id: newId(), kind: "h3", text: line.slice(4) }); continue; }
    if (line.startsWith("- ")) { out.push({ id: newId(), kind: "bullet", text: line.slice(2) }); continue; }
    if (/^\d+\. /.test(line)) { out.push({ id: newId(), kind: "numbered", text: line.replace(/^\d+\. /, "") }); continue; }
    out.push({ id: newId(), kind: "paragraph", text: line });
  }
  if (out.length === 0) out.push({ id: newId(), kind: "paragraph", text: "" });
  return out;
}
function htmlToBlocks(html: string): Block[] {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return bodyToBlocks(text);
}

function personName(p: PersonRef | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "";
}

/* ───────────────────────────── the page ───────────────────────────── */

export function SopEditorPage({ sopId: initialSopId, kind: initialKind = "written", initialFolderId = null }: {
  sopId: string | null;
  kind?: SopKind;
  initialFolderId?: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Work mode is a value, read before any early return. `workSelf` is the
  // address the SOP is mounted at in Work; null on /sops/[id] and the
  // create routes, where every navigation below keeps its /sops URL.
  const place = useWorkPlacement();
  const inWork = !!initialSopId && place?.kind === "sop" && place.id === initialSopId;
  const workSelf = inWork && place ? place.self : null;
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const { boot } = useBoot();
  const { prefs, patchPrefs, railApps, bumpRowVersion, layerCount } = useOsShell();
  const aiEntitled = railApps.some((a) => a.key === "ai");

  /* ── identity ── */
  const [sopId, setSopId] = useState<string | null>(initialSopId);
  const [sop, setSop] = useState<SopPayload | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "failed">(initialSopId ? "loading" : "ready");
  const creating = sopId === null;
  const kind: SopKind = sop?.kind ?? initialKind;
  const role: Role = creating ? "FULL" : sop?.access.role ?? "VIEW";
  const canEdit = role === "FULL" || role === "EDIT";
  const status: SopStatus = sop?.status ?? "DRAFT";
  const autosaves = creating || status === "DRAFT";

  /* ── edit buffers ── */
  const [editing, setEditing] = useState(creating);
  const [title, setTitle] = useState("");
  // The Work crumb's live title.
  useWorkTitle(inWork ? (title || sop?.title || null) : null);
  const [description, setDescription] = useState("");
  const [bnDoc, setBnDoc] = useState<BnDocJSON | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const preservedRef = useRef<Map<string, Block>>(new Map());
  const [steps, setSteps] = useState<EditStep[]>([]);
  const [flow, setFlow] = useState<ProcessFlow>({ type: "process_flow", steps: [] });
  const [layout, setLayout] = useState<SopLayout>("list");
  const [sections, setSections] = useState<ChecklistSection[]>([]);
  const [recSteps, setRecSteps] = useState<RecordedStep[]>([]);
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);
  const [tags, setTags] = useState<string[]>([]);
  const [kraId, setKraId] = useState<string | null>(null);
  const [tab, setTab] = useState<"content" | "people" | "history">("content");
  const [peopleKey, setPeopleKey] = useState(0);
  const [showFields, setShowFields] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const hydrate = useCallback((data: SopPayload) => {
    setTitle(data.title ?? "");
    setDescription(data.description ?? "");
    setFolderId(data.folderId ?? null);
    setTags(Array.isArray(data.tags) ? data.tags : []);
    setKraId(data.kraId ?? null);
    const c = (data.content ?? {}) as SopReadContent & { meta?: Record<string, unknown> };
    const k = getSopKind(data.sopType, data.content);
    if (k === "written") {
      if (c?.type === "blocks") {
        setBnDoc(Array.isArray(c.bnDoc) ? c.bnDoc : null);
        setBlocks(Array.isArray(c.blocks) ? c.blocks : []);
        preservedRef.current = collectLegacyCustomEmbeds(Array.isArray(c.blocks) ? c.blocks : []);
      } else if (typeof c?.html === "string") { setBnDoc(null); setBlocks(htmlToBlocks(c.html)); }
      else if (typeof c?.body === "string") { setBnDoc(null); setBlocks(bodyToBlocks(c.body)); }
      else { setBnDoc(null); setBlocks([]); }
    } else if (k === "checklist") {
      setSections(normalizeChecklistSections(c?.sections));
    } else if (k === "recording") {
      setRecSteps(((c?.steps ?? []) as RecordedStep[]).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    } else {
      const lay = getSopLayout(c);
      setLayout(lay);
      const list = (c?.steps ?? []) as EditStep[];
      const fl = (c?.flow ?? null) as ProcessFlow | null;
      setSteps(list.length > 0 ? list : lay === "flow" ? stepsFromFlow(fl) : []);
      setFlow(fl && Array.isArray(fl.steps) ? fl : flowFromSteps(list));
    }
    setEditorKey((k2) => k2 + 1);
  }, []);

  const load = useCallback(async () => {
    if (!sopId) return;
    const r = await apiFetch<SopPayload>(`/api/sops/${sopId}`, { cache: "no-store" });
    if (!r.ok) { setLoadState(r.status === 404 ? "notfound" : "failed"); return; }
    setSop(r.data);
    setLoadState("ready");
    return r.data;
  }, [sopId]);

  // First load hydrates the buffers; later reloads (after publish, restore)
  // update `sop` and re-hydrate only when not editing, so typing is never
  // clobbered by a background refresh.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!sopId) return;
    let live = true;
    const t = setTimeout(() => {
      void load().then((data) => {
        if (!live || !data || hydratedRef.current) return;
        hydratedRef.current = true;
        baselinePendingRef.current = true;
        hydrate(data);
      });
    }, 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sopId]);

  /* ── ?edit=1 ── */
  const editHandled = useRef(false);
  useEffect(() => {
    if (!sop || editHandled.current) return;
    editHandled.current = true;
    if (params?.get("edit") !== "1") return;
    if (canEdit) setEditing(true);
    else router.replace(workSelf ?? `/sops/${sop.id}`);
  }, [sop, canEdit, params, router, workSelf]);

  /* ── the content payload for the kind ── */
  const buildContent = useCallback((): Record<string, unknown> => {
    const original = ((sop?.content ?? {}) as Record<string, unknown>);
    switch (kind) {
      case "written":
        return { ...original, type: "blocks", ...(bnDoc ? { bnDoc } : {}), blocks, meta: (original.meta as object | undefined) ?? {} };
      case "checklist":
        return { ...original, type: "CHECKLIST", sections };
      case "recording":
        return { ...original, type: original.type === "RECORDED" ? "RECORDED" : "recorded", steps: recSteps };
      default:
        return { ...original, type: layout === "flow" ? "process_flow" : "steps", layout, steps: layout === "flow" ? stepsFromFlow(flow) : steps, flow: layout === "flow" ? flow : flowFromSteps(steps) };
    }
  }, [sop?.content, kind, bnDoc, blocks, sections, recSteps, layout, steps, flow]);

  const snapshot = useMemo<Snapshot>(() => ({ title, description, content: buildContent() }), [title, description, buildContent]);
  const serial = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  // The serial of the last saved snapshot. `buildContent()` normalises the
  // stored shape (it adds `layout`, keeps `flow` beside `steps`, and so on),
  // so the baseline is taken from the FIRST snapshot after a hydrate rather
  // than from the raw server JSON: comparing the two would read "Unsaved
  // changes" on a page nobody has touched, and autosave would then write a
  // no-op version. `baselinePendingRef` asks the serial effect below to take
  // it; `dirtyTick` re-renders when a save moves it.
  const savedSerialRef = useRef<string>(creating ? serial : "");
  const baselinePendingRef = useRef(false);
  const [dirtyTick, setDirtyTick] = useState(0);
  void dirtyTick;
  const dirty = editing && !baselinePendingRef.current && serial !== savedSerialRef.current;

  const contentHasSomething = useMemo(() => {
    switch (kind) {
      case "written": return blocks.some((b) => (b as { text?: string }).text?.trim());
      case "checklist": return sections.some((s) => s.steps.length > 0 || s.title.trim());
      case "recording": return recSteps.length > 0;
      default: return layout === "flow" ? flow.steps.length > 0 : steps.some((s) => s.title.trim() || s.description);
    }
  }, [kind, blocks, sections, recSteps, layout, flow, steps]);

  /* ── the save engine ── */
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const serialRef = useRef(serial);
  serialRef.current = serial;
  const folderRef = useRef(folderId); folderRef.current = folderId;
  const tagsRef = useRef(tags); tagsRef.current = tags;
  const kraRef = useRef(kraId); kraRef.current = kraId;
  const sopIdRef = useRef(sopId); sopIdRef.current = sopId;
  // Before the row exists the draft is keyed by the kind ("new:written"), and
  // the epoch stands in for the server's updatedAt so any draft counts as
  // newer: a failed create leaves the typed content in localStorage and the
  // restore strip offers it back on the next open of that create route.
  const draft = useLocalDraft<Snapshot>("sop", sopId ?? `new:${kind}`, sop?.updatedAt ?? (creating ? "1970-01-01T00:00:00.000Z" : null));
  // The restore strip is for a draft from an EARLIER session. A draft this
  // session wrote a moment ago (queued, not yet flushed) is not an offer to
  // restore anything, so anything newer than the mount is never shown.
  const mountedAtRef = useRef(Date.now());
  const draftFromEarlier = !!draft.pending && Date.parse(draft.pending.at) < mountedAtRef.current;

  const flush = useCallback(async (opts: { keepalive?: boolean; publish?: { reacknowledge: boolean } } = {}): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (inFlightRef.current) { queuedRef.current = true; return true; }
    const snap = snapshotRef.current;
    const sent = serialRef.current;
    const id = sopIdRef.current;
    inFlightRef.current = true;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { title: snap.title.trim() || "Untitled SOP", description: snap.description.trim() || null, content: snap.content };
      if (opts.publish) { body.status = "PUBLISHED"; body.reacknowledge = opts.publish.reacknowledge; }
      let r;
      if (!id) {
        body.kind = kind;
        body.folderId = folderRef.current;
        body.tags = tagsRef.current;
        if (kraRef.current) body.kraId = kraRef.current;
        r = await apiFetch<SopPayload>("/api/sops", { method: "POST", json: body });
      } else {
        const keep = opts.keepalive && sent.length < KEEPALIVE_LIMIT;
        r = await apiFetch<SopPayload>(`/api/sops/${id}`, { method: "PATCH", json: body, keepalive: keep || undefined });
      }
      if (!r.ok) throw Object.assign(new Error(r.error || "Save failed"), { status: r.status });
      const data = (r.data as SopPayload & { data?: SopPayload }).data ?? r.data;
      savedSerialRef.current = sent;
      attemptRef.current = 0;
      setFailed(false);
      setRetrying(false);
      setLastSaved(new Date());
      draft.clear();
      if (!id && data?.id) {
        // Create-on-first-change: the row exists now; the URL becomes the SOP's.
        sopIdRef.current = data.id;
        setSopId(data.id);
        window.history.replaceState(window.history.state, "", `/sops/${data.id}?edit=1`);
        bumpRowVersion("sops");
      }
      // Keep the content we BUILT as the page's `sop.content`, not the
      // server's echo: buildContent() spreads `sop.content` as its base, so
      // an echo with extra or reordered keys would read as a new change,
      // queue a no-op save and mirror a draft nobody typed.
      setSop((prev) => ({ ...(prev ?? ({} as SopPayload)), ...data, content: (prev?.content ?? snap.content) as SopPayload["content"], access: data.access ?? prev?.access ?? { role: "FULL" }, kind: data.kind ?? getSopKind(data.sopType, data.content), layout: data.layout ?? prev?.layout ?? "list" }));
      setDirtyTick((n) => n + 1);
      return true;
    } catch (e) {
      // The server said no (a 4xx other than a timeout or a rate limit: the
      // plan limit, a permission, a validation error): retrying will not
      // change the answer, so the reason is shown at once and the content
      // stays in memory and in the localStorage draft. Anything else is a
      // connection problem and gets the backoff.
      const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 0;
      const fatal = status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
      setFailed(true);
      const delay = fatal ? null : nextRetryDelay(attemptRef.current);
      attemptRef.current += 1;
      if (delay !== null) {
        setRetrying(true);
        retryRef.current = setTimeout(() => { retryRef.current = null; void flush(); }, delay);
      } else {
        setRetrying(false);
        attemptRef.current = 0;
        const reason = fatal && e instanceof Error ? e.message : "Couldn't save. Check your connection and keep this tab open.";
        toast(id ? reason : `Couldn't create the SOP. ${reason}`, { tone: "danger", action: { label: "Retry", onClick: () => void flush() } });
      }
      return false;
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      if (queuedRef.current) { queuedRef.current = false; void flush(); }
    }
  }, [kind, draft, toast, bumpRowVersion]);

  /** Every change in edit mode: mirror to the local draft and, on a draft, queue the autosave. */
  const queueSave = useCallback(() => {
    const snap = snapshotRef.current;
    if (!sopIdRef.current && !isMeaningfulFirstChange(snap.title, contentHasSomething)) return;
    draft.write(snap);
    if (!autosaves) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; void flush(); }, AUTOSAVE_MS);
  }, [autosaves, contentHasSomething, draft, flush]);

  // Buffers change through setState; the effect below turns "the snapshot
  // changed while editing" into one queued save, whichever kind changed it.
  // A pending baseline (right after a hydrate) is taken here and never saved.
  useEffect(() => {
    if (baselinePendingRef.current) {
      baselinePendingRef.current = false;
      savedSerialRef.current = serial;
      setDirtyTick((n) => n + 1);
      return;
    }
    if (!editing) return;
    if (serial === savedSerialRef.current) return;
    queueSave();
  }, [serial, editing, queueSave]);

  // Keepalive flush on pagehide and when the tab is hidden; a final flush on unmount.
  useEffect(() => {
    const onHide = () => { if (editing && autosaves && serialRef.current !== savedSerialRef.current) void flush({ keepalive: true }); };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [editing, autosaves, flush]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); if (retryRef.current) clearTimeout(retryRef.current); }, []);

  const saveState = deriveSopSaveState({ saving, failed, retrying, dirty, autosaves, lastSaved });
  useDirtyGuard(editing && saveState.leaveGuard, { onSave: () => flush(), id: `sop:${sopId ?? "new"}` });

  const restoreDraft = (payload: Snapshot) => {
    // The restored draft IS unsaved: no baseline, so the autosave (or the
    // save bar on a published SOP) picks it up straight away. On the create
    // route there is no `sop` yet; the kind is read from the content.
    hydrate({ ...((sop ?? { sopType: sopTypeForKind(kind), folderId: folderId }) as SopPayload), title: payload.title, description: payload.description, content: payload.content as SopPayload["content"] });
    setEditing(true);
    toast("Restored your unsaved changes");
  };

  /* ── metadata rows save on their own (never through the content payload) ── */
  const patchMeta = useCallback(async (patch: { folderId?: string | null; tags?: string[] }) => {
    if (!sopIdRef.current) return;
    const r = await apiFetch<SopPayload>(`/api/sops/${sopIdRef.current}`, { method: "PATCH", json: patch });
    if (!r.ok) { toast(r.error || "Couldn't save", { tone: "danger" }); void load(); return; }
    setSop((prev) => (prev ? { ...prev, folderId: r.data.folderId ?? null, folder: r.data.folder ?? null, tags: r.data.tags ?? prev.tags } : prev));
  }, [load, toast]);

  /* ── actions ── */
  const enterEdit = useCallback(() => {
    if (!canEdit || !sop) return;
    baselinePendingRef.current = true;
    hydrate(sop);
    setEditing(true);
    router.replace(`${workSelf ?? `/sops/${sop.id}`}?edit=1`);
  }, [canEdit, sop, hydrate, router, workSelf]);

  const leaveEdit = useCallback(async (opts: { discard?: boolean } = {}) => {
    if (!sop) {
      // The create route with nothing saved yet: anything typed is asked
      // about before it goes (the draft is discarded with it).
      const typed = title.trim().length > 0 || description.trim().length > 0 || contentHasSomething;
      if (typed && !opts.discard) {
        const ok = await confirm({ title: "Discard this SOP?", description: "Nothing has been saved yet, so what you typed will be lost.", confirmLabel: "Discard", destructive: true });
        if (!ok) return;
      }
      draft.discard();
      router.push("/sops");
      return;
    }
    if (dirty && !opts.discard) {
      if (autosaves) { const ok = await flush(); if (!ok) return; }
      else {
        const ok = await confirm({ title: "Discard changes?", description: "This SOP is published, so unsaved changes are not kept.", confirmLabel: "Discard", destructive: true });
        if (!ok) return;
      }
    }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    draft.discard();
    setEditing(false);
    const fresh = await load();
    if (fresh) { baselinePendingRef.current = true; hydrate(fresh); }
    router.replace(workSelf ?? `/sops/${sop.id}`);
  }, [sop, dirty, autosaves, flush, confirm, draft, load, hydrate, router, title, description, contentHasSomething, workSelf]);

  const [publishOpen, setPublishOpen] = useState(false);
  const [reack, setReack] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    if (!sopIdRef.current) { const ok = await flush(); if (!ok) return; }
    setPublishing(true);
    const ok = await flush({ publish: { reacknowledge: reack } });
    setPublishing(false);
    if (!ok) return;
    setPublishOpen(false);
    setReack(false);
    toast("Published");
    setEditing(false);
    router.replace(workSelf ?? `/sops/${sopIdRef.current}`);
    void load().then((d) => { if (d) { baselinePendingRef.current = true; hydrate(d); } });
    bumpRowVersion("sops");
  };

  const transition = async (next: SopStatus, done: string) => {
    if (!sop) return;
    const r = await apiFetch<SopPayload>(`/api/sops/${sop.id}`, { method: "PATCH", json: { status: next } });
    if (!r.ok) { toast(r.error || "Couldn't update the status", { tone: "danger" }); return; }
    toast(done);
    setSop((prev) => (prev ? { ...prev, status: next, version: r.data.version ?? prev.version } : prev));
    bumpRowVersion("sops");
  };

  const archive = async () => {
    if (!sop) return;
    const ok = await confirm({ title: "Archive this SOP?", description: "People assigned to it keep their history. Archived SOPs stay in the Archived view.", confirmLabel: "Archive" });
    if (!ok) return;
    await transition("ARCHIVED", "Archived");
  };
  const remove = async () => {
    if (!sop) return;
    const ok = await confirm({ title: `Move "${sop.title || "Untitled SOP"}" to Trash?`, description: `You can restore it for ${boot.org.trashDays} days.`, confirmLabel: "Move to Trash", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/sops/${sop.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't move it to Trash", { tone: "danger" }); return; }
    toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=sop") } });
    bumpRowVersion("sops");
    router.push(inWork && place ? place.closeHref : "/sops");
  };
  const duplicate = async () => {
    if (!sop) return;
    const r = await apiFetch<{ id: string }>("/api/sops", { method: "POST", json: { duplicateOf: sop.id } });
    if (!r.ok) { toast(r.error || "Couldn't duplicate", { tone: "danger" }); return; }
    toast("Duplicated");
    bumpRowVersion("sops");
    router.push(`${objectHrefNow("sop", r.data.id)}?edit=1`);
  };
  const copyLink = useCallback(() => {
    if (!sopIdRef.current) return;
    // The share form: the Work door from Work, /sops/<id> elsewhere.
    void navigator.clipboard.writeText(copyObjectLink("sop", sopIdRef.current)).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  }, [toast]);

  const [acking, setAcking] = useState(false);
  const acknowledge = async () => {
    const a = sop?.myAssignment;
    if (!a || acking) return;
    setAcking(true);
    const r = await apiFetch<{ assignment?: { completedAt?: string } }>(`/api/me/sops/${a.assignmentId}/ack`, { method: "POST", json: {} });
    setAcking(false);
    if (!r.ok) { toast(r.error || "Couldn't acknowledge", { tone: "danger" }); return; }
    const completedAt = r.data?.assignment?.completedAt ?? new Date().toISOString();
    setSop((prev) => (prev && prev.myAssignment ? { ...prev, myAssignment: { ...prev.myAssignment, status: "COMPLETED", completedAt } } : prev));
    setPeopleKey((k) => k + 1);
    toast("Acknowledged", {
      onUndo: () => {
        void apiFetch(`/api/me/sops/${a.assignmentId}/ack`, { method: "DELETE" }).then((u) => {
          if (!u.ok) { toast("Couldn't undo", { tone: "danger" }); return; }
          setSop((prev) => (prev && prev.myAssignment ? { ...prev, myAssignment: { ...prev.myAssignment, status: "ASSIGNED", completedAt: null } } : prev));
          setPeopleKey((k) => k + 1);
        });
      },
    });
  };

  const [runOpen, setRunOpen] = useState(false);
  const [requestState, setRequestState] = useState<"idle" | "busy" | "sent">("idle");
  const requestAccess = async () => {
    if (!sop || requestState !== "idle") return;
    setRequestState("busy");
    const r = await apiFetch("/api/access-requests", { method: "POST", json: sop.folderId ? { objectType: "sop_folder", objectId: sop.folderId, role: "EDIT" } : { objectType: "sop", objectId: sop.id, role: "EDIT" } });
    if (!r.ok) { setRequestState("idle"); toast(r.error || "Couldn't send the request", { tone: "danger" }); return; }
    setRequestState("sent");
    const owner = personName(sop.createdBy);
    toast(owner ? `Request sent to ${owner}` : "Request sent");
  };
  const [assignOpen, setAssignOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState<"share" | "who" | null>(null);
  const [presentOpen, setPresentOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const aiGenerate = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    const r = await apiFetch<{ sections?: unknown[]; data?: { sections?: unknown[] } }>("/api/sops/ai-generate", { method: "POST", json: { title: title || sop?.title || "Checklist", context: description } });
    setAiBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't generate the checklist", { tone: "danger" }); return; }
    const generated = r.data?.sections ?? r.data?.data?.sections;
    if (!Array.isArray(generated)) { toast("Nothing came back. Try again.", { tone: "danger" }); return; }
    setSections(normalizeChecklistSections(generated));
    toast("Checklist generated. Review and adjust the steps.");
  };

  /* ── keyboard ── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && editing) { e.preventDefault(); void flush(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l" && !typing) { e.preventDefault(); copyLink(); return; }
      if (e.key === "e" && !typing && !editing && canEdit && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); enterEdit(); return; }
      // Esc closes only the topmost overlay: a Picker, panel or dialog on
      // the shell's layer stack takes it, and only a bare edit mode leaves.
      const overlayOpen = layerCount > 0 || e.defaultPrevented || !!document.querySelector('[role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper]');
      if (e.key === "Escape" && editing && !typing && !overlayOpen && !presentOpen && !runOpen && !assignOpen && !shareOpen && !publishOpen) { void leaveEdit(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, canEdit, enterEdit, leaveEdit, flush, copyLink, presentOpen, runOpen, assignOpen, shareOpen, publishOpen, layerCount]);

  /* ── details strip collapsed state ── */
  const detailsCollapsed = prefs.home.ui?.sopDetailsCollapsed === true;
  const toggleDetails = () => void patchPrefs({ home: { ui: { sopDetailsCollapsed: !detailsCollapsed } } });

  /* ── "Used by" tasks (backlinks with BOARD_ITEM sources) ── */
  const [taskLinks, setTaskLinks] = useState<Array<{ sourceId: string; title: string; href: string | null }>>([]);
  useEffect(() => {
    if (!sopId) return;
    let live = true;
    void apiFetch<Record<string, unknown>>(`/api/backlinks?kind=sop&id=${sopId}&entityType=SOP&entityId=${sopId}`, { cache: "no-store" }).then((r) => {
      if (!live || !r.ok || !r.data || typeof r.data !== "object") return;
      const d = r.data as { boardItems?: unknown[]; items?: unknown[]; tasks?: unknown[] };
      const pools = [d.boardItems, d.items, d.tasks].filter(Array.isArray) as Array<Array<Record<string, unknown>>>;
      setTaskLinks(pools.flat().filter((x) => x && (x.sourceType === "BOARD_ITEM" || x.type === "BOARD_ITEM")).map((x) => ({ sourceId: String(x.sourceId ?? x.id ?? ""), title: typeof x.title === "string" && x.title ? x.title : "Untitled task", href: typeof x.href === "string" ? x.href : null })).filter((x) => x.sourceId));
    });
    return () => { live = false; };
  }, [sopId]);

  /* ───────────────────────────── render ───────────────────────────── */

  if (loadState === "notfound") return <NotFoundView />;
  if (loadState === "failed") {
    return (
      <>
        <OsPageHeader title="SOP" back={inWork && place ? { fallbackHref: place.back.href, label: place.back.label } : { fallbackHref: "/sops", label: "SOPs" }} />
        <OsEmptyView variant="error" title="Couldn't load this SOP" action={{ label: "Retry", onClick: () => { setLoadState("loading"); void load(); } }} />
      </>
    );
  }
  if (loadState === "loading") {
    return (
      <>
        <OsPageHeaderSkeleton />
        <div className="mx-auto w-full max-w-[720px] px-6 pt-4"><SkeletonLines lines={6} /></div>
      </>
    );
  }

  const isChecklist = kind === "checklist";
  const isWrittenKind = kind === "written";
  const readOnly = !canEdit;
  const ownerName = personName(sop?.createdBy) || null;
  const myAssignment = sop?.myAssignment ?? null;
  const openAssignment = myAssignment && myAssignment.status !== "COMPLETED";
  const displayTitle = (editing ? title : sop?.title ?? title) || (creating ? "" : "Untitled SOP");
  const headerTitle = displayTitle || `New ${SOP_KIND_LABEL[kind].toLowerCase()} SOP`;

  /* the one blue button */
  let primary: PrimaryAction | undefined;
  if (!editing && openAssignment && !isChecklist) {
    primary = { label: "Acknowledge", icon: Check, onClick: () => void acknowledge(), busy: acking };
  } else if (!editing && openAssignment && isChecklist && status === "PUBLISHED") {
    primary = sop?.myRun?.shareToken
      ? { label: "Continue run", icon: Play, onClick: () => window.open(`/run/${sop.myRun!.shareToken}`, "_blank", "noopener") }
      : { label: "Start run", icon: Play, onClick: () => setRunOpen(true) };
  } else if (!creating && canEdit && (status === "DRAFT" || status === "APPROVED") && !openAssignment) {
    primary = { label: "Publish", icon: Send, onClick: () => setPublishOpen(true) };
  }
  const PrimaryIcon = primary?.icon ?? null;

  /* "…" menu */
  const more: HeaderMenuEntry[] = [];
  if (!creating && canEdit && !editing) more.push({ label: "Edit", icon: Edit3, onClick: enterEdit });
  if (!creating && (kind === "steps" || kind === "recording")) more.push({ label: "Present", icon: Play, onClick: () => setPresentOpen(true) });
  if (!creating && canEdit) more.push({ label: "Assign…", icon: UserPlus, onClick: () => setAssignOpen(true) });
  if (!creating && isChecklist && status === "PUBLISHED" && canEdit && primary?.label !== "Start run") more.push({ label: "Start run", icon: Play, onClick: () => setRunOpen(true) });
  if (!creating && canEdit && status === "DRAFT") more.push({ label: "Submit for review", icon: Send, onClick: () => void transition("IN_REVIEW", "Submitted for review") });
  if (!creating && canEdit && status === "IN_REVIEW") {
    more.push({ label: "Approve", icon: Check, onClick: () => void transition("APPROVED", "Approved") });
    more.push({ label: "Request changes", icon: Edit3, onClick: () => void transition("DRAFT", "Sent back to draft") });
  }
  if (!creating && canEdit && (status === "DRAFT" || status === "APPROVED") && primary?.label !== "Publish") more.push({ label: "Publish", icon: Send, onClick: () => setPublishOpen(true) });
  if (!creating) more.push({ label: "Version history", icon: ListOrdered, onClick: () => setTab("history") });
  if (!creating && canEdit) more.push({ label: "Duplicate", icon: Copy, onClick: () => void duplicate() });
  if (!creating && canEdit) more.push({ label: "Move to folder…", icon: GitBranch, onClick: () => { if (detailsCollapsed) toggleDetails(); if (!editing) enterEdit(); } });
  if (!creating) more.push({ label: "Copy link", icon: Link2, onClick: copyLink });
  if (!creating && canEdit && status === "PUBLISHED") { more.push({ separator: true }); more.push({ label: "Archive", icon: Archive, onClick: () => void archive() }); }
  if (!creating && role === "FULL") { if (status !== "PUBLISHED") more.push({ separator: true }); more.push({ label: "Delete", icon: Trash2, destructive: true, onClick: () => void remove() }); }

  const crumbs = [{ label: "SOPs", href: "/sops" }, ...(sop?.folder ? [{ label: sop.folder.name, href: `/sops?folderId=${sop.folder.id}` }] : []), { label: headerTitle }];

  return (
    <>
      {/* In Work the WorkPlacementProvider declares the crumb (Work > SOP). */}
      {!inWork ? <Breadcrumb items={crumbs} /> : null}
      <OsPageHeader
        title={headerTitle}
        back={inWork && place ? { fallbackHref: place.back.href, label: place.back.label } : { fallbackHref: "/sops", label: "SOPs" }}
        titleSlot={
          /* The title row per spec-process section 2: the title (an input with
             the same metrics in edit mode), then the pale StatusChip, the kind
             chip and "v3"; the right cluster holds Share and the one blue. */
          <>
            {editing ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled SOP"
                aria-label="SOP title"
                autoFocus={creating}
                className="h-9 min-w-0 flex-1 rounded-md bg-transparent px-1 text-xl font-semibold text-ink placeholder:text-ink-3 focus:bg-subtle focus:outline-none"
              />
            ) : (
              <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-ink">{headerTitle}</h1>
            )}
            <StatusChip color={SOP_STATUS_COLOR[status]} label={SOP_STATUS_LABEL[status]} disabled />
            <Chip size="default" className="h-6 px-2 text-xs" disabled>{SOP_KIND_LABEL[kind]}</Chip>
            {!creating ? <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">v{sop?.version ?? 1}</span> : null}
          </>
        }
        autosave={editing ? (
          <AutosaveIndicator status={saveState.status} lastSavedAt={lastSaved} onRetry={saveState.showRetry ? () => void flush() : undefined} labels={{ idle: autosaves ? (creating ? "Nothing saved yet" : "Auto-saves as you type") : undefined }} />
        ) : undefined}
        actions={
          <>
            {!creating ? <ShareOrRoleChip role={role} onOpen={(mode) => setShareOpen(mode)} /> : null}
            {primary && primary.onClick ? (
              <button type="button" onClick={primary.onClick} disabled={primary.busy} className="ms-1 inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
                {primary.busy ? <Dots variant="pending" /> : PrimaryIcon ? <PrimaryIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : null}
                {primary.label}
              </button>
            ) : null}
          </>
        }
        more={more.length ? more : undefined}
      />

      <div className="os-chrome mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-32 pt-2 sm:px-6">
        {readOnly && !creating ? (
          <ReadOnlyBanner
            variant="inline"
            ownerName={ownerName}
            message={requestState === "sent" ? `View only. Request sent${ownerName ? ` to ${ownerName}` : ""}.` : undefined}
            onRequest={requestState === "idle" ? () => void requestAccess() : undefined}
          />
        ) : null}
        {draftFromEarlier ? <DraftRestoreStrip draft={draft} onRestore={restoreDraft} className="-mx-4 sm:-mx-6" /> : null}

        {/* Details strip */}
        <section className="rounded-lg border border-line bg-raised">
          <button type="button" onClick={toggleDetails} aria-expanded={!detailsCollapsed} className="flex h-9 w-full items-center gap-2 px-3 text-start text-sm font-medium text-ink-2 hover:text-ink">
            {detailsCollapsed ? <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden /> : <ChevronDown className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            Details
            {detailsCollapsed ? (
              <span className="ms-2 truncate text-xs font-normal text-ink-3">{sop?.folder?.name ?? "Unfiled"}{tags.length ? ` · ${tags.length} tag${tags.length === 1 ? "" : "s"}` : ""}</span>
            ) : null}
          </button>
          {!detailsCollapsed ? (
            <dl className="border-t border-line-soft">
              <DetailRow label="Folder">
                {editing ? (
                  <SopTaxonomyPicker folderId={folderId} disabled={false} onChange={(next) => { setFolderId(next); if (sopIdRef.current) void patchMeta({ folderId: next }); }} />
                ) : (
                  <span className="text-base text-ink">{sop?.folder?.name ?? <span className="text-ink-3">Unfiled</span>}</span>
                )}
                {editing && !folderId ? <span className="mt-1 block text-xs text-ink-3">Unfiled SOPs are read by everyone at {boot.org.name} once published.</span> : null}
                {editing && folderId && sop?.folder?.name ? <span className="mt-1 block text-xs text-ink-3">This SOP follows {sop.folder.name}&apos;s sharing.</span> : null}
              </DetailRow>
              {editing || description.trim() || sop?.description ? (
                <DetailRow label="Description">
                  {editing ? (
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What is this SOP for, and when should someone reach for it?"
                      aria-label="Description"
                      rows={2}
                      className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-base text-ink placeholder:text-ink-3 focus:border-line-strong focus:bg-raised focus:outline-none"
                    />
                  ) : (
                    <span className="text-base text-ink">{sop?.description}</span>
                  )}
                </DetailRow>
              ) : null}
              <DetailRow label="Tags">
                {editing ? (
                  <div className="max-w-[420px]"><SopTagInput value={tags} onChange={(next) => { setTags(next); if (sopIdRef.current) void patchMeta({ tags: next }); }} /></div>
                ) : tags.length ? (
                  <span className="flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="inline-flex h-6 items-center rounded-md bg-active px-2 text-xs font-medium text-ink">{t}</span>)}</span>
                ) : <span className="text-ink-3">None</span>}
              </DetailRow>
              <DetailRow label="Linked KRA">
                <SopKraPicker sopId={sopId} kraId={kraId} canEdit={editing} onSaved={(next) => { setKraId(next); setSop((p) => (p ? { ...p, kraId: next } : p)); }} />
              </DetailRow>
              <DetailRow label="Owner">
                {creating ? (
                  <span className="inline-flex items-center gap-2 text-base text-ink">{boot.viewer.name || "You"}</span>
                ) : sop?.createdBy ? (
                  <span className="inline-flex items-center gap-2 text-base text-ink"><PersonAvatar person={sop.createdBy} size={20} />{personName(sop.createdBy)}</span>
                ) : <span className="text-ink-3">Nobody</span>}
              </DetailRow>
              {!creating && (showFields || sop?.publishedAt) ? (
                <DetailRow label="Published">{sop?.publishedAt ? <span className="text-base text-ink" title={fmt.title(sop.publishedAt)}>{fmt.date(sop.publishedAt, "date")}</span> : <span className="text-ink-3">Not yet</span>}</DetailRow>
              ) : null}
              {!creating && showFields ? (
                <DetailRow label="Updated"><span className="text-base text-ink" title={fmt.title(sop?.updatedAt)}>{fmt.date(sop?.updatedAt, "datetime")}</span></DetailRow>
              ) : null}
              {/* The spec's "+ Add field" reveal (spec-process section 2,
                  Details strip). Custom fields are NOT part of it yet: there
                  is no CustomField model, no /api/custom-fields route and no
                  Studio page to define one in, so the panel could only ever
                  render an empty state pointing at a URL that does not exist.
                  Until those ship, the reveal shows the rows that are real
                  and the control says exactly what it does. */}
              {!creating && !showFields ? (
                <div className="border-t border-line-soft px-3 py-1">
                  <button type="button" onClick={() => setShowFields(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                    <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Show more fields
                  </button>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>

        {/* Tabs */}
        {!creating ? (
          /* Text-tab pills (design-system 5.12): no underline anywhere. */
          <ViewTabStrip aria-label="SOP">
            {([["content", "Content"], ["people", "People"], ["history", "History"]] as const).map(([key, label]) => (
              <ViewTab key={key} dense label={label} active={tab === key} onClick={() => setTab(key)} />
            ))}
          </ViewTabStrip>
        ) : null}

        {tab === "people" && sopId ? (
          <SopPeopleTab sopId={sopId} isChecklist={isChecklist} canAssign={canEdit} canManageRows={canEdit} onAssign={() => setAssignOpen(true)} refreshKey={peopleKey} />
        ) : tab === "history" && sopId ? (
          <SopVersionsTab sopId={sopId} currentVersion={sop?.version ?? 1} status={status} canRestore={canEdit} onRestored={() => { void load().then((d) => { if (d) { baselinePendingRef.current = true; hydrate(d); } }); }} />
        ) : (
          <div className="flex flex-col gap-3">
            {editing && kind === "steps" ? (
              <div className="flex items-center justify-end">
                <button type="button" onClick={() => { if (layout === "list") { setFlow(flowFromSteps(steps)); setLayout("flow"); } else { setSteps(stepsFromFlow(flow)); setLayout("list"); } }} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                  <GitBranch className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {layout === "list" ? "Show as flow" : "Show as list"}
                </button>
              </div>
            ) : null}
            {editing && isChecklist && aiEntitled ? (
              <div className="flex items-center justify-end">
                <button type="button" onClick={() => void aiGenerate()} disabled={aiBusy} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60">
                  {aiBusy ? <Dots variant="pending" /> : <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Generate with AI
                </button>
              </div>
            ) : null}

            {editing ? (
              isWrittenKind ? (
                <div className="os-prose">
                  <BlockNoteCanvas
                    key={`edit-${sopId ?? "new"}-${editorKey}`}
                    initialBnDoc={bnDoc}
                    legacyBlocks={blocks}
                    readonly={false}
                    onChange={(nextBnDoc, mirror) => { setBnDoc(nextBnDoc); setBlocks(rehydrateMirrorWithLegacyEmbeds(mirror, preservedRef.current)); }}
                    entity={sopId ? { type: "sop", id: sopId } : undefined}
                  />
                </div>
              ) : isChecklist ? (
                <ChecklistBuilder sections={sections} onChange={setSections} editing />
              ) : kind === "recording" ? (
                <SopRecordingEditor steps={recSteps} onChange={setRecSteps} />
              ) : (
                <SopStepsEditor layout={layout} steps={steps} flow={flow} onStepsChange={setSteps} onFlowChange={setFlow} />
              )
            ) : sop ? (
              <SopReadView sop={{ id: sop.id, sopType: sop.sopType, content: sop.content }} mode="app" emptyAction={canEdit ? <button type="button" onClick={enterEdit} className="font-medium text-brand-deep hover:underline">Start writing</button> : undefined} />
            ) : null}

            {!creating && sopId ? (
              <>
                <BacklinksPanel kind="sop" id={sopId} />
                {taskLinks.length > 0 ? (
                  <section className="rounded-lg border border-line bg-raised">
                    <header className="flex h-9 items-center px-3 text-sm font-medium text-ink-2">Used by {taskLinks.length} task{taskLinks.length === 1 ? "" : "s"}</header>
                    <ul className="border-t border-line-soft">
                      {taskLinks.map((t) => (
                        <li key={t.sourceId} className="border-b border-line-soft last:border-b-0">
                          {t.href ? <Link href={t.href} className="flex h-9 items-center gap-2 px-3 text-base text-ink hover:bg-hover"><Link2 className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden /><span className="truncate">{t.title}</span></Link>
                            : <span className="flex h-9 items-center gap-2 px-3 text-base text-ink-2"><Link2 className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden /><span className="truncate">{t.title}</span></span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* The sticky save bar: unsaved changes on a published SOP, or a failed save. */}
      {editing && saveState.showSaveBar ? (
        <div className="fixed bottom-0 end-0 start-[calc(var(--os-rail-w)+var(--os-side-w,0px))] z-30 flex h-14 items-center gap-2 border-t border-line bg-raised px-6">
          <span className="min-w-0 flex-1 truncate text-base text-ink">{failed ? "Not saved" : "Unsaved changes"}</span>
          <button type="button" onClick={() => void leaveEdit()} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void flush()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
            {saving ? <Dots variant="pending" /> : null} Save
          </button>
        </div>
      ) : editing && !creating ? (
        /* Nothing dirty: one way out for a mouse user on drafts AND on
           published SOPs (Esc is the keyboard's). */
        <div className="fixed bottom-0 end-0 start-[calc(var(--os-rail-w)+var(--os-side-w,0px))] z-30 flex h-14 items-center gap-2 border-t border-line bg-raised px-6">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{autosaves ? "Editing · drafts save as you type" : "Editing · changes are saved when you press Save"}</span>
          <button type="button" onClick={() => void leaveEdit()} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover">
            <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Done
          </button>
        </div>
      ) : null}

      {/* Modals */}
      <Dialog open={publishOpen} onOpenChange={(v) => { if (!v) setPublishOpen(false); }}>
        <DialogContent className="max-w-[400px]">
          <DialogTitle>Publish v{(sop?.version ?? 0) + 1}?</DialogTitle>
          <DialogDescription>
            {folderId
              ? "People assigned to it will see the new version."
              : `Everyone at ${boot.org.name} will be able to read this SOP, because it isn't in a folder. Change who can see it in Share.`}
          </DialogDescription>
          <label className="mt-2 inline-flex items-center gap-2 text-base text-ink"><Switch checked={reack} onChange={setReack} /> Require everyone to acknowledge again</label>
          <div className="mt-4 flex items-center justify-end gap-2">
            {!folderId && sopId ? <button type="button" onClick={() => { setPublishOpen(false); setShareOpen("share"); }} className="me-auto text-sm font-medium text-brand-deep hover:underline">Share instead</button> : null}
            <button type="button" onClick={() => setPublishOpen(false)} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button type="button" onClick={() => void publish()} disabled={publishing} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
              {publishing ? <Dots variant="pending" /> : <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Publish
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {sop ? (
        <>
          <StartRunDialog open={runOpen} onClose={() => setRunOpen(false)} sop={{ id: sop.id, title: sop.title }} defaultAssigneeId={openAssignment ? boot.viewer.id : null} onStarted={(run) => { setPeopleKey((k) => k + 1); if (run.shareToken) window.open(`/run/${run.shareToken}`, "_blank", "noopener"); void load(); }} />
          <AssignDialog open={assignOpen} onClose={() => setAssignOpen(false)} object={{ type: "sop", id: sop.id, title: sop.title }} onAssigned={() => { setPeopleKey((k) => k + 1); setTab("people"); }} />
          <SopShareDialog
            open={shareOpen !== null}
            mode={shareOpen ?? "who"}
            onClose={() => setShareOpen(null)}
            sop={{ id: sop.id, title: sop.title, status: sop.status, folderId: sop.folderId, folderName: sop.folder?.name ?? null, shareToken: sop.shareToken, ownerName, canManageFolder: role === "FULL" }}
            onShareTokenChange={(token) => setSop((p) => (p ? { ...p, shareToken: token } : p))}
          />
          {presentOpen ? <SopWalkthrough sop={{ id: sop.id, title: sop.title, sopType: sop.sopType, content: sop.content as never }} onClose={() => setPresentOpen(false)} /> : null}
        </>
      ) : null}
    </>
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

