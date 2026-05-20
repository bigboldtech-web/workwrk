"use client";

// Single-whiteboard canvas. Excalidraw is dynamically imported with
// ssr:false because it touches `window` on load. Scene is autosaved
// every 3 seconds when dirty.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
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

const AUTOSAVE_DEBOUNCE_MS = 3000;

export default function WhiteboardCanvasPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [board, setBoard] = useState<Whiteboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Latest scene captured from Excalidraw onChange — flushed by the
  // autosave loop. Ref instead of state so onChange doesn't cause
  // re-renders.
  const pendingSceneRef = useRef<SceneShape | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      });
      if (res.ok) {
        dirtyRef.current = false;
        setLastSavedAt(new Date());
      }
    } finally {
      setSaving(false);
    }
  }, [params?.id]);

  const onCanvasChange = useCallback((elements: readonly unknown[], appState: unknown, files: unknown) => {
    // Excalidraw fires onChange on every frame; we don't want to save
    // on every keystroke. Stash latest scene; debounce-flush.
    pendingSceneRef.current = {
      elements: elements as unknown[],
      appState: appState as Record<string, unknown>,
      files: files as Record<string, unknown>,
    };
    dirtyRef.current = true;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushSave(); }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Save on tab close / route away
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
    <div className="flex flex-col h-[calc(100vh-var(--app-topbar-height,56px))]">
      {/* Mini toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface">
        <Link
          href="/whiteboards"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          <ArrowLeft size={12} /> All whiteboards
        </Link>
        <input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={renameBoard}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="font-medium text-sm bg-transparent border-0 focus:outline-none focus:bg-surface-2 px-2 py-1 rounded-md min-w-[200px]"
        />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-2">
          {saving ? (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Loader2 size={11} className="animate-spin" /> Saving…
            </span>
          ) : lastSavedAt ? (
            <span className="inline-flex items-center gap-1">
              <Save size={11} /> Saved {lastSavedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : (
            <span className="text-muted-2">Autosave on · Cmd+S to flush</span>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <Excalidraw
          initialData={initialData}
          onChange={onCanvasChange}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: { saveFileToDisk: true },
              loadScene: false,        // we own load/save through our API
              saveToActiveFile: false, // ditto
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
    <div className="flex items-center justify-center h-[calc(100vh-var(--app-topbar-height,56px))]">
      <div className="text-center">
        <Loader2 size={24} className="mx-auto mb-2 animate-spin text-pink-600" />
        <p className="text-sm text-muted">Loading whiteboard…</p>
      </div>
    </div>
  );
}
