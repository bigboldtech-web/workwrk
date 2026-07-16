"use client";

/* Whiteboard canvas — Excalidraw wrapper.
 *
 * Custom toolbar above the canvas (back button, inline-editable title,
 * autosave status pill). The canvas itself is Excalidraw — we own
 * load/save, Excalidraw owns the drawing UI.
 *
 * SSR is disabled for Excalidraw (touches window) and the toolbar is
 * full-height so the canvas can fill the viewport below.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, Cloud } from "lucide-react";
import { WhiteboardFavoriteButton } from "@/components/board-view/whiteboard-favorite-button";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <CanvasLoader /> },
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
};

// Minimal slice of the Excalidraw imperative API we use (kept local so we don't
// depend on the package's type-export path, which moves between versions).
type ExcalidrawAPI = {
  getSceneElements: () => readonly unknown[];
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
};

const AUTOSAVE_DEBOUNCE_MS = 3000;
const SAVE_RETRY_MS = 15000;

export default function WhiteboardCanvasPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [board, setBoard] = useState<Whiteboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);

  // Latest scene captured from Excalidraw onChange — flushed by autosave.
  const pendingSceneRef = useRef<SceneShape | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw fires onChange once right after mount echoing the loaded scene;
  // that first call isn't a user edit, so we skip it (no dirty, no save).
  const firstChangeRef = useRef(true);

  // Initial load
  useEffect(() => {
    if (!params?.id) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/whiteboards/${params.id}`);
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json();
        setBoard(data.whiteboard);
        setRenameValue(data.whiteboard.name);
      } else {
        router.push("/whiteboards");
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [params?.id, router]);

  const flushSave = useCallback(async () => {
    if (!params?.id || !dirtyRef.current || !pendingSceneRef.current) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/whiteboards/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: pendingSceneRef.current }),
        // Let the request finish even if the tab is closing/navigating away —
        // otherwise the browser aborts an in-flight save-on-close.
        keepalive: true,
      });
      if (res.ok) {
        dirtyRef.current = false;
        setDirty(false);
        setSaveError(false);
        setLastSavedAt(new Date());
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

  const onCanvasChange = useCallback((elements: readonly unknown[], appState: unknown, files: unknown) => {
    // Ignore Excalidraw's initial post-mount echo of the loaded scene.
    if (firstChangeRef.current) { firstChangeRef.current = false; return; }
    pendingSceneRef.current = {
      elements: elements as unknown[],
      appState: appState as Record<string, unknown>,
      files: files as Record<string, unknown>,
    };
    dirtyRef.current = true;
    setDirty(true);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushSave(); }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Once Excalidraw is ready, fit the view to the loaded content so a board
  // saved with an off-screen scroll position doesn't open looking blank. The
  // API can become ready a beat before initialData is applied, so poll briefly
  // for elements and fit as soon as they appear. Fully guarded — this runs in
  // an effect, never in render, so it can't take the page down.
  useEffect(() => {
    if (!api) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      try {
        const els = api.getSceneElements();
        if (els.length > 0) {
          api.scrollToContent(els, { fitToContent: true, animate: false });
          clearInterval(iv);
        } else if (tries > 20) {
          clearInterval(iv);
        }
      } catch {
        clearInterval(iv);
      }
    }, 100);
    return () => clearInterval(iv);
  }, [api]);

  // Safety net: retry any still-unsaved changes on an interval (covers a save
  // that failed from a network blip without needing another edit to re-trigger).
  useEffect(() => {
    const iv = setInterval(() => { if (dirtyRef.current) void flushSave(); }, SAVE_RETRY_MS);
    return () => clearInterval(iv);
  }, [flushSave]);

  // Save on tab close / unmount
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) {
        flushSave();
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      flushSave();
    };
  }, [flushSave]);

  async function renameBoard() {
    if (!board || !renameValue.trim() || renameValue === board.name) return;
    const res = await fetch(`/api/whiteboards/${board.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    if (res.ok) {
      setBoard({ ...board, name: renameValue.trim() });
      refreshSidebar(); // tell the Spaces sidebar to re-fetch so the tree shows the new name without a reload
    }
  }

  if (loading || !board) return <CanvasLoader />;

  const initialData = board.scene && Object.keys(board.scene).length > 0
    ? {
        elements: (board.scene.elements as never[]) ?? [],
        appState: { ...(board.scene.appState ?? {}), collaborators: new Map() } as never,
        files: (board.scene.files as Record<string, never>) ?? undefined,
      }
    : undefined;

  return (
    <div className="wbc">
      {/* Toolbar */}
      <header className="wbc__bar">
        <button type="button" className="wbc__back" onClick={() => router.push("/whiteboards")} aria-label="Back to whiteboards">
          <ArrowLeft />
        </button>

        <input
          className="wbc__title"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={renameBoard}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="Untitled whiteboard"
        />

        <WhiteboardFavoriteButton whiteboardId={board.id} />

        <div className="wbc__status">
          {saving ? (
            <span className="wbc__status-saving">
              <Loader2 className="wbc__spin" /> Saving…
            </span>
          ) : saveError ? (
            <span className="wbc__status-dirty" title="We'll keep retrying. Don't close until it saves.">
              <Cloud /> Save failed — retrying
            </span>
          ) : dirty ? (
            <span className="wbc__status-dirty">
              <Cloud /> Unsaved changes
            </span>
          ) : lastSavedAt ? (
            <span className="wbc__status-saved">
              <CheckCircle2 /> Saved {lastSavedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : (
            <span className="wbc__status-idle">
              <Cloud /> Autosave on
            </span>
          )}
        </div>
      </header>

      {/* Canvas */}
      <div className="wbc__canvas">
        <Excalidraw
          excalidrawAPI={(a) => setApi(a as unknown as ExcalidrawAPI)}
          initialData={initialData}
          onChange={onCanvasChange}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: { saveFileToDisk: true },
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: true,
            },
          }}
        />
      </div>
    </div>
  );
}

function CanvasLoader() {
  return (
    <div className="wbc__loading">
      <Loader2 className="wbc__spin" />
      <p>Loading whiteboard…</p>
    </div>
  );
}
