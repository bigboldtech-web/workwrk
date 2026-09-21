"use client";

/* /canvas/[id] (spec-docs-knowledge section 2): draw, diagram and pin work
 * on a canvas that saves itself.
 *
 *   title row   48px: BackButton (the anchor Space, else Canvases) · the
 *               inline editable title (22/600) · AutosaveIndicator · Ask AI
 *               (opens the CanvasAiPanel; AI on only) · Share or the role
 *               chip · star · the bordered "..." (CanvasRowMenu, the one
 *               canvas menu, plus Export as PNG and Version history)
 *   body        the canvas fills the content area (the engine's own chrome
 *               is untouched); a read-only banner for Can view
 *
 * WHO CAN EDIT. GET /api/whiteboards/[id] answers `myRole`: a canvas has no
 * grant rows of its own yet, so the role is its anchor's. On a Space, Can
 * edit for anyone who can contribute and Can view for a Space guest (the
 * PATCH refuses them too); a standalone canvas is org-wide and everyone
 * edits; Full access = owner or org admin. Read-only = pan and zoom only, no
 * tool strip, the ReadOnlyBanner and the role chip. Under 768 the canvas is
 * read-only for everyone with the banner "Open on a larger screen to edit"
 * (drawing needs a pointer; view-only is the honest state, never dead tools).
 *
 * THE SHARE DOOR. An anchored canvas's access IS its Space's, so Share (Space
 * managers) and the chip (everyone else) open the one ShareDialog on that
 * Space, write or read-only. A standalone canvas has no store to write, so
 * its chip opens the read-only "Who has access" sentence and never a Share
 * button whose dialog could not read grants.
 *
 * AUTOSAVE IS UNCHANGED: the 3 s debounce, the 15 s retry, the keepalive
 * rules on unload and the unmount flush are exactly what they were. What is
 * new around them: the AutosaveIndicator observes the states, the save
 * carries `expectedUpdatedAt` so two editors get a 409 and the ConflictStrip
 * instead of last-write-wins, and a scene draft mirrors to localStorage
 * ("workwrk:draft:canvas:<id>") until a 200.
 *
 * ENGINE RULE: boards already in the first-party format and empty boards
 * open in WorkwrK Canvas; legacy Excalidraw scenes still open in Excalidraw
 * so nothing is rewritten silently. There is no engine env flag any more:
 * the board's own stored format decides, and nothing else.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Download, Globe, History, MoreHorizontal, Sparkles, Star } from "lucide-react";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { MenuItem } from "@/components/ui/menu";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { WhiteboardCanvas, type TaskSummary, type WhiteboardCanvasHandle } from "@/components/canvas/whiteboard-canvas";
import { CanvasAiPanel } from "@/components/canvas/canvas-ai-panel";
import { CanvasRowMenu, dispatchCanvasesChanged } from "@/components/canvas/canvas-row-menu";
import { isCanvasScene, emptyScene, type CanvasScene } from "@/lib/canvas/scene";
import { isExcalidrawScene, importExcalidraw } from "@/lib/canvas/import-excalidraw";
import { STATUS_LOOKUP } from "@/lib/board-items-shared";
import "@excalidraw/excalidraw/index.css";
import { BackButton } from "@/components/ui/back-button";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import type { AutosaveStatus } from "@/hooks/use-autosave";
import { ConflictStrip } from "@/components/ui/conflict-strip";
import { DraftRestoreStrip } from "@/components/ui/draft-restore-strip";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { ReadOnlyBanner } from "@/components/access/read-only-banner";
import { ShareOrRoleChip } from "@/components/access/share-or-role-chip";
import { ShareDialog } from "@/components/access/share-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CanvasVersionsPanel } from "@/components/canvas/canvas-versions-panel";
import { useViewer } from "@/lib/access/use-access";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { cn } from "@/lib/utils";

// Load droppable work-graph items for the canvas card picker: tasks, docs,
// canvases and SOPs, each access-scoped by its own endpoint.
type MeItem = { id: string; title: string; status: string | null; dueAt: string | null; board: { name: string } | null };
type DocItem = { id: string; title: string | null; updatedAt: string | null };
type CanvasItem = { id: string; name: string | null; updatedAt?: string | null };
type SopItem = { id: string; title: string | null; category: string | null };
async function loadCanvasEntities(excludeId?: string): Promise<TaskSummary[]> {
  const [taskRes, docRes, canvasRes, sopRes] = await Promise.all([
    fetch("/api/me/items?status=all", { cache: "no-store" }).catch(() => null),
    fetch("/api/docs", { cache: "no-store" }).catch(() => null),
    fetch("/api/whiteboards", { cache: "no-store" }).catch(() => null),
    fetch("/api/sops?limit=200", { cache: "no-store" }).catch(() => null),
  ]);
  const tasks: TaskSummary[] = [];
  if (taskRes?.ok) {
    const data = await taskRes.json().catch(() => ({ items: [] }));
    const items: MeItem[] = Array.isArray(data.items) ? data.items : [];
    for (const it of items) {
      const s = it.status ? STATUS_LOOKUP[it.status] : undefined;
      tasks.push({
        id: it.id, kind: "task", title: it.title, status: it.status ?? "",
        statusLabel: s?.label ?? (it.status ?? "No status"), statusColor: s?.color ?? "#94A3B8",
        meta: it.dueAt ? formatDate(it.dueAt) : it.board?.name ?? "",
        href: `/item/${it.id}`,
      });
    }
  }
  const docs: TaskSummary[] = [];
  if (docRes?.ok) {
    const data = await docRes.json().catch(() => ({}));
    const list: DocItem[] = data.docs ?? data.data ?? (Array.isArray(data) ? data : []);
    for (const d of list.slice(0, 60)) {
      docs.push({ id: d.id, kind: "doc", title: d.title || "Untitled doc", status: "", statusLabel: "Doc", statusColor: "#3B82F6", meta: formatDate(d.updatedAt), href: `/docs/${d.id}` });
    }
  }
  const canvases: TaskSummary[] = [];
  if (canvasRes?.ok) {
    const data = await canvasRes.json().catch(() => ({}));
    const list: CanvasItem[] = data.whiteboards ?? (Array.isArray(data) ? data : []);
    for (const w of list.slice(0, 60)) {
      if (excludeId && w.id === excludeId) continue; // never drop a Canvas onto itself
      canvases.push({ id: w.id, kind: "canvas", title: w.name || "Untitled canvas", status: "", statusLabel: "Canvas", statusColor: "#7C3AED", meta: formatDate(w.updatedAt ?? null), href: `/canvas/${w.id}` });
    }
  }
  const sops: TaskSummary[] = [];
  if (sopRes?.ok) {
    const data = await sopRes.json().catch(() => ({}));
    const list: SopItem[] = data.data ?? data.sops ?? (Array.isArray(data) ? data : []);
    for (const s of list.slice(0, 60)) {
      sops.push({ id: s.id, kind: "sop", title: s.title || "Untitled SOP", status: "", statusLabel: "SOP", statusColor: "#F59E0B", meta: s.category ?? "", href: `/sops/${s.id}` });
    }
  }
  return [...tasks, ...docs, ...canvases, ...sops];
}

function sceneIsEmpty(scene: unknown): boolean {
  if (!scene || typeof scene !== "object") return true;
  const els = (scene as { elements?: unknown[] }).elements;
  return !Array.isArray(els) || els.length === 0;
}

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <CanvasSkeleton /> },
);

type SceneShape = {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

type Whiteboard = {
  id: string;
  name: string;
  description: string | null;
  scene: SceneShape | null;
  updatedAt: string;
  spaceId?: string | null;
  ownerId?: string | null;
};

type CanvasRole = "full" | "edit" | "view";
type SpaceInfo = { id: string; slug: string | null; name: string; visibility: "PRIVATE" | "WORKSPACE" | "ORG" };

/**
 * matchMedia("(max-width: 768px)") as state, false during SSR. Inclusive of
 * 768 on purpose: a 768-wide tablet has no pointer to draw with either.
 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return narrow;
}

type ExcalidrawAPI = {
  getSceneElements: () => readonly unknown[];
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
};

const AUTOSAVE_DEBOUNCE_MS = 3000;
const SAVE_RETRY_MS = 15000;

export default function WhiteboardCanvasPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { railApps } = useOsShell();
  const { boot } = useBoot();
  const viewer = useViewer();
  const aiOn = railApps.some((a) => a.key === "ai");
  const [board, setBoard] = useState<Whiteboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [spaceBack, setSpaceBack] = useState<{ fallbackHref: string; label: string } | null>(null);
  const [spaceInfo, setSpaceInfo] = useState<SpaceInfo | null>(null);
  const [myRole, setMyRole] = useState<CanvasRole>("edit");
  const [spaceManage, setSpaceManage] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const narrow = useNarrow();
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [conflict, setConflict] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<WhiteboardCanvasHandle>(null);
  const { toast } = useOsToast();

  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);

  // Latest scene captured from the canvas onChange; flushed by autosave.
  const pendingSceneRef = useRef<unknown>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw fires onChange once right after mount echoing the loaded scene.
  const firstChangeRef = useRef(true);
  // The updatedAt this tab last observed, for the 409 precondition.
  const knownUpdatedAtRef = useRef<string | null>(null);

  const canManage = myRole === "full";
  // Can view (a Space guest) or a narrow screen: pan and zoom only. There is
  // no Can comment on a canvas (change request A3), so a viewer is either
  // read-only or editing.
  const readOnly = myRole === "view" || narrow;
  // Only one right panel is open at a time (spec-docs-knowledge section 2);
  // either of them insets the canvas so the tool strip is never under it.
  const rightPanelOpen = versionsOpen || (aiOn && aiOpen && !readOnly);

  const draft = useLocalDraft<{ scene: unknown }>("canvas", params?.id ?? null, board?.updatedAt ?? null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const copyLink = useCallback(() => {
    void navigator.clipboard.writeText(window.location.href).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
  }, [toast]);

  // Initial load
  useEffect(() => {
    if (!params?.id) return;
    let cancelled = false;
    (async () => {
      let res: Response;
      try {
        res = await fetch(`/api/whiteboards/${params.id}`, { cache: "no-store" });
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
        return;
      }
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json();
        const wb = data.whiteboard as Whiteboard;
        setBoard(wb);
        setRenameValue(wb.name);
        knownUpdatedAtRef.current = wb.updatedAt ?? null;
        setMyRole(data.myRole === "view" ? "view" : data.myRole === "full" ? "full" : "edit");
        setSpaceManage(!!data.spaceManage);
        setMissing(false);
        setLoadError(false);
        if (wb.spaceId) {
          try {
            const sr = await fetch(`/api/spaces/${wb.spaceId}`);
            const sd = sr.ok ? await sr.json() : null;
            const s = sd?.space as { id?: string; slug?: string; name?: string; visibility?: string } | undefined;
            if (!cancelled) {
              setSpaceBack(s?.slug ? { fallbackHref: `/spaces/${s.slug}`, label: s.name || "Space" } : null);
              setSpaceInfo(s?.id ? { id: s.id, slug: s.slug ?? null, name: s.name || "Space", visibility: s.visibility === "PRIVATE" || s.visibility === "ORG" ? s.visibility : "WORKSPACE" } : null);
            }
          } catch {
            if (!cancelled) { setSpaceBack(null); setSpaceInfo(null); }
          }
        } else {
          setSpaceBack(null);
          setSpaceInfo(null);
        }
      } else if (res.status === 404) {
        setMissing(true);
      } else {
        setLoadError(true);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [params?.id, reloadKey]);

  // Favorite state (the star in the title row).
  useEffect(() => {
    if (!params?.id) return;
    let alive = true;
    void (async () => {
      const r = await apiFetch<{ effective?: { home?: { favoriteWhiteboardIds?: string[] } } }>("/api/preferences", { cache: "no-store" });
      if (alive && r.ok) setFavorite((r.data.effective?.home?.favoriteWhiteboardIds ?? []).includes(params.id));
    })();
    return () => { alive = false; };
  }, [params?.id]);
  const toggleFavorite = useCallback(async () => {
    if (!params?.id) return;
    const next = !(favorite ?? false);
    setFavorite(next);
    const r = await apiFetch("/api/me/favorites/whiteboards", { method: "POST", json: { whiteboardId: params.id, on: next } });
    if (!r.ok) { setFavorite(!next); toast("Couldn't update favorite", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
  }, [params?.id, favorite, toast]);

  // cmd L copies the link (spec-docs-knowledge section 2, /canvas/[id] Keyboard).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); copyLink(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copyLink]);

  // ?new=1: focus the title so the natural next action is naming it.
  const focusedNewRef = useRef(false);
  useEffect(() => {
    if (focusedNewRef.current || !board || search.get("new") !== "1") return;
    focusedNewRef.current = true;
    titleRef.current?.focus();
    titleRef.current?.select();
    router.replace(`/canvas/${board.id}`);
  }, [board, search, router]);

  // opts.keepalive: only the real page-unload path asks for it. The browser
  // rejects a keepalive body over ~64KB, so routine autosaves send a normal
  // request; keepalive is used only on unload and only when the payload
  // actually fits under the cap. (Unchanged.)
  const flushSave = useCallback(async (opts?: { keepalive?: boolean }) => {
    if (!params?.id || !dirtyRef.current || !pendingSceneRef.current) return;
    const payload = JSON.stringify({ scene: pendingSceneRef.current, expectedUpdatedAt: knownUpdatedAtRef.current ?? undefined });
    const useKeepalive = !!opts?.keepalive && payload.length < 60000;
    setSaving(true);
    try {
      const res = await fetch(`/api/whiteboards/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: useKeepalive,
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.whiteboard?.updatedAt) knownUpdatedAtRef.current = data.whiteboard.updatedAt;
        dirtyRef.current = false;
        setDirty(false);
        setSaveError(false);
        setConflict(false);
        setLastSavedAt(new Date());
        draftRef.current.clear();
        dispatchCanvasesChanged();
      } else if (res.status === 409) {
        // Someone else saved. Keep the local scene (it is in the draft) and
        // say so; the person reloads to see their version. Never overwrite.
        setConflict(true);
        setSaveError(true);
      } else {
        // Keep it dirty so the periodic retry / next edit tries again, and
        // surface it instead of failing silently.
        setSaveError(true);
      }
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [params?.id]);

  const queueSave = useCallback((scene: unknown) => {
    pendingSceneRef.current = scene;
    dirtyRef.current = true;
    setDirty(true);
    draftRef.current.write({ scene });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushSave(); }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const onCanvasChange = useCallback((elements: readonly unknown[], appState: unknown, files: unknown) => {
    if (firstChangeRef.current) { firstChangeRef.current = false; return; }
    queueSave({ elements: elements as unknown[], appState: appState as Record<string, unknown>, files: files as Record<string, unknown> });
  }, [queueSave]);

  const onCanvasSceneChange = useCallback((next: CanvasScene) => { queueSave(next); }, [queueSave]);

  // Once Excalidraw is ready, fit the view to the loaded content. (Unchanged.)
  useEffect(() => {
    if (!api) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      try {
        const els = api.getSceneElements();
        if (els.length > 0) { api.scrollToContent(els, { fitToContent: true, animate: false }); clearInterval(iv); }
        else if (tries > 20) clearInterval(iv);
      } catch { clearInterval(iv); }
    }, 100);
    return () => clearInterval(iv);
  }, [api]);

  // Safety net: retry any still-unsaved changes on an interval, but never a
  // conflict (that needs a person's decision, not a retry). (Unchanged otherwise.)
  useEffect(() => {
    const iv = setInterval(() => { if (dirtyRef.current && !conflict) void flushSave(); }, SAVE_RETRY_MS);
    return () => clearInterval(iv);
  }, [flushSave, conflict]);

  // Save on tab close / hide / unmount. (Unchanged.)
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) { void flushSave({ keepalive: true }); e.preventDefault(); e.returnValue = ""; }
    }
    function onPageHide() { if (dirtyRef.current) void flushSave({ keepalive: true }); }
    function onVisibility() { if (document.visibilityState === "hidden" && dirtyRef.current) void flushSave({ keepalive: true }); }
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushSave();
    };
  }, [flushSave]);

  // The gallery's real preview: after a successful save, post a rendered PNG
  // (first-party engine only; a separate endpoint so it never rides the save).
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!lastSavedAt || !board || !canvasRef.current) return;
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(() => {
      try {
        const el = document.querySelector<HTMLCanvasElement>(".wbcanvas canvas");
        if (!el) return;
        const off = document.createElement("canvas");
        const scale = Math.min(1, 480 / el.width);
        off.width = Math.max(1, Math.round(el.width * scale));
        off.height = Math.max(1, Math.round(el.height * scale));
        const ctx = off.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--os-surface").trim() || "white";
        ctx.fillRect(0, 0, off.width, off.height);
        ctx.drawImage(el, 0, 0, off.width, off.height);
        const dataUrl = off.toDataURL("image/jpeg", 0.7);
        void apiFetch(`/api/whiteboards/${board.id}/thumbnail`, { method: "POST", json: { dataUrl } });
      } catch { /* a thumbnail is presentation; the save already landed */ }
    }, 1500);
    return () => { if (thumbTimer.current) clearTimeout(thumbTimer.current); };
  }, [lastSavedAt, board]);

  async function renameBoard() {
    if (!board) return;
    const next = renameValue.trim();
    if (!next) { setRenameValue(board.name); return; }
    if (next === board.name) return;
    const r = await apiFetch<{ whiteboard: { updatedAt: string } }>(`/api/whiteboards/${board.id}`, { method: "PATCH", json: { name: next } });
    if (r.ok) {
      setBoard({ ...board, name: next });
      if (r.data.whiteboard?.updatedAt) knownUpdatedAtRef.current = r.data.whiteboard.updatedAt;
      refreshSidebar();
      dispatchCanvasesChanged();
    } else {
      setRenameValue(board.name);
      toast(r.error || "Couldn't rename", { tone: "danger" });
    }
  }

  // Export is a read, so it works for a Can view viewer and on a narrow
  // screen, where the tool strip is not rendered at all. It used to be done
  // by finding and clicking that strip's hidden button, so both of those
  // people got "Export is available once the canvas has loaded" on a canvas
  // that had loaded: a menu row with no working handler.
  function exportPng() {
    const done = canvasRef.current?.exportPng();
    if (done === undefined) { toast("Export is available once the canvas has loaded"); return; }
    if (!done) toast("Nothing to export yet");
  }

  const status: AutosaveStatus = saving ? "saving" : saveError ? "error" : dirty ? "dirty" : lastSavedAt ? "saved" : "idle";

  if (missing) return <NotFoundView />;
  if (loadError) {
    return (
      <OsEmptyView variant="error" context="board" title="Couldn't open this canvas" action={{ label: "Retry", onClick: () => { setLoadError(false); setLoading(true); setReloadKey((k) => k + 1); } }}>
        <BackButton fallbackHref="/canvas" label="Canvases" />
      </OsEmptyView>
    );
  }
  if (loading || !board) return <CanvasSkeleton />;

  // Engine choice: the board's own stored format decides.
  const useFirstParty = isCanvasScene(board.scene) || sceneIsEmpty(board.scene);
  const canvasInitial: CanvasScene = isCanvasScene(board.scene)
    ? board.scene
    : isExcalidrawScene(board.scene)
      ? importExcalidraw(board.scene)
      : emptyScene();

  const initialData = board.scene && Object.keys(board.scene).length > 0
    ? {
        elements: (board.scene.elements as never[]) ?? [],
        appState: { ...(board.scene.appState ?? {}), collaborators: new Map() } as never,
        files: (board.scene.files as Record<string, never>) ?? undefined,
      }
    : undefined;

  const ghost = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";
  // The chip's role: Full access on an anchored canvas means the Space's
  // managers (that is where Share writes); a standalone canvas never shows
  // Share, because there is no store for it to write.
  const chipRole = spaceInfo ? (spaceManage ? "FULL" : myRole === "view" ? "VIEW" : "EDIT") : myRole === "view" ? "VIEW" : "EDIT";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <Breadcrumb items={[...(spaceBack ? [{ label: spaceBack.label, href: spaceBack.fallbackHref }] : [{ label: "Canvases", href: "/canvas" }]), { label: board.name || "Untitled canvas" }]} />
      <header className="os-chrome flex h-12 shrink-0 items-center gap-2 border-b border-line bg-app px-6">
        <BackButton fallbackHref={spaceBack?.fallbackHref ?? "/canvas"} label={spaceBack?.label ?? "Canvases"} />
        <input
          ref={titleRef}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-ink placeholder:font-medium placeholder:text-ink-3 hover:bg-hover focus:border-brand focus:bg-raised focus:outline-none read-only:hover:bg-transparent"
          style={{ maxWidth: 480 }}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => void renameBoard()}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setRenameValue(board.name); (e.target as HTMLInputElement).blur(); } }}
          placeholder="Untitled canvas"
          aria-label="Canvas name"
          readOnly={readOnly}
        />
        <AutosaveIndicator status={status} lastSavedAt={lastSavedAt} labels={{ idle: "" }} onRetry={saveError && !saving && !conflict ? () => void flushSave() : undefined} />
        <span className="flex-1" />
        {aiOn && useFirstParty && !readOnly ? (
          <button type="button" onClick={() => { setVersionsOpen(false); setAiOpen((o) => !o); }} aria-pressed={aiOpen} title="Ask AI" className={cn(ghost, aiOpen ? "bg-active text-ink" : "")}>
            <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Ask AI
          </button>
        ) : null}
        <ShareOrRoleChip role={chipRole} onOpen={() => setShareOpen(true)} />
        <button type="button" onClick={() => void toggleFavorite()} aria-pressed={!!favorite} aria-label={favorite ? "Remove from favorites" : "Add to favorites"} title={favorite ? "Remove from favorites" : "Star"} className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-hover", favorite ? "text-ink" : "text-ink-2")}>
          <Star className="h-4 w-4" strokeWidth={1.5} style={favorite ? { fill: "currentColor" } : undefined} aria-hidden />
        </button>
        <button
          ref={moreRef}
          type="button"
          aria-label="Canvas actions"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong text-ink-2 hover:bg-hover hover:text-ink", moreOpen ? "bg-active text-ink" : "")}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
        <MorePortal anchorRef={moreRef} panelRef={morePanelRef} width={240} open={moreOpen} placement="below">
          <CanvasRowMenu
            canvas={{ id: board.id, name: board.name, spaceId: board.spaceId ?? null, favorite: !!favorite, canManage, canEdit: !readOnly }}
            context="editor"
            onClose={() => setMoreOpen(false)}
            onChanged={(kind) => { if (kind === "favorited") setFavorite((f) => !(f ?? false)); if (kind === "moved") setReloadKey((k) => k + 1); }}
            onRenameInline={() => { titleRef.current?.focus(); titleRef.current?.select(); }}
            extraRows={
              <>
                {!viewer.isAgent && viewer.orgRole !== "GUEST" && useFirstParty ? <MenuItem icon={Download} label="Export as PNG" onClick={() => { setMoreOpen(false); exportPng(); }} /> : null}
                <MenuItem icon={History} label="Version history" onClick={() => { setMoreOpen(false); setAiOpen(false); setVersionsOpen(true); }} />
              </>
            }
          />
        </MorePortal>
      </header>

      {spaceInfo ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          target={{ kind: "space", id: spaceInfo.id, name: spaceInfo.name, visibility: spaceInfo.visibility }}
          readOnly={!spaceManage}
        />
      ) : (
        <StandaloneCanvasAccess open={shareOpen} onOpenChange={setShareOpen} orgName={boot.org.name} ownerIsViewer={board.ownerId === boot.viewer.id} />
      )}

      {readOnly ? (
        narrow
          ? <ReadOnlyBanner message="Open on a larger screen to edit." />
          : <ReadOnlyBanner ownerName={null} />
      ) : null}
      {conflict ? <ConflictStrip noun="canvas" onReload={() => window.location.reload()} onDismiss={() => setConflict(false)} /> : null}
      <DraftRestoreStrip
        draft={draft}
        onRestore={(p) => {
          if (isCanvasScene(p.scene) && canvasRef.current) {
            canvasRef.current.insertScene(p.scene);
          }
          queueSave(p.scene);
        }}
      />

      <div className="relative min-h-0 flex-1">
        {useFirstParty ? (
          <>
            {/* The right panels are 360 overlays inside this box, and the
                tool strip is centred in it, so without this inset the strip's
                last buttons sit underneath an open panel. The canvas is
                absolutely positioned to this wrapper, so narrowing it moves
                both together. */}
            <div className="absolute inset-y-0 start-0 end-0" style={rightPanelOpen ? { insetInlineEnd: 360 } : undefined}>
            <WhiteboardCanvas
              ref={canvasRef}
              initialScene={canvasInitial}
              onChange={onCanvasSceneChange}
              loadEntities={() => loadCanvasEntities(board.id)}
              onOpenEntity={(href) => router.push(href)}
              readOnly={readOnly}
            />
            </div>
            {versionsOpen ? <CanvasVersionsPanel canvasId={board.id} canRestore={!readOnly} onClose={() => setVersionsOpen(false)} /> : null}
            {aiOn && aiOpen && !readOnly ? (
              <CanvasAiPanel
                onApply={(scene) => canvasRef.current?.insertScene(scene) ?? []}
                onReplace={(oldIds, scene) => canvasRef.current?.replaceGenerated(oldIds, scene) ?? []}
                getScene={() => canvasRef.current?.getScene() ?? emptyScene()}
                onClose={() => setAiOpen(false)}
              />
            ) : null}
          </>
        ) : (
          <>
          {versionsOpen ? <CanvasVersionsPanel canvasId={board.id} canRestore={!readOnly} onClose={() => setVersionsOpen(false)} /> : null}
          <Excalidraw
            excalidrawAPI={(a) => setApi(a as unknown as ExcalidrawAPI)}
            initialData={initialData}
            onChange={onCanvasChange}
            viewModeEnabled={readOnly}
            UIOptions={{
              canvasActions: {
                // The drawing surface only: our "..." and cluster carry export
                // and clear; theme and background stay the workspace's.
                changeViewBackgroundColor: false,
                clearCanvas: true,
                export: { saveFileToDisk: true },
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
              },
            }}
          />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Who has access" for a standalone canvas: it has no grant rows, so the
 * honest body is the one sentence. Read-only, like WhoHasAccess for a Space.
 */
function StandaloneCanvasAccess({ open, onOpenChange, orgName, ownerIsViewer }: { open: boolean; onOpenChange: (v: boolean) => void; orgName: string; ownerIsViewer: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-lg font-semibold">Who has access</DialogTitle>
          <DialogDescription className="mt-1">A canvas with no location follows the workspace.</DialogDescription>
        </div>
        <div className="px-6 pb-6">
          <div className="flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2.5">
            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
            <div className="min-w-0 text-base text-ink">
              <div>Everyone at {orgName} can edit this canvas.</div>
              <div className="text-sm text-ink-2">{ownerIsViewer ? "You" : "The owner"} and Admins have Full access. Move it into a Space to limit who can open it.</div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The loading state: a full-area skeleton rectangle, no spinner text. */
function CanvasSkeleton() {
  return (
    <div className="os-chrome flex h-full min-h-[60vh] flex-col gap-3 p-6" aria-busy="true" aria-label="Loading">
      <span className="h-6 w-[30%] rounded bg-skeleton os-skeleton-pulse" />
      <span className="min-h-0 flex-1 rounded-lg bg-skeleton os-skeleton-pulse" />
    </div>
  );
}
