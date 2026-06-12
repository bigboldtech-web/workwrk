"use client";

// BoardWhiteboardView — WHITEBOARD renderer. Embeds an Excalidraw
// canvas as a board tab (View.config.whiteboardId). Same load /
// debounced-autosave contract as the standalone /whiteboards/[id]
// page, minus its page chrome. Read-only viewers get Excalidraw's
// view mode. No canvas yet → setup card (create or embed existing).

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Brush, Cloud, ExternalLink, Loader2, RefreshCcw } from "lucide-react";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <CanvasLoading /> },
);

const AUTOSAVE_DEBOUNCE_MS = 3000;

type SceneShape = {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

interface ApiWhiteboard { id: string; name: string; scene: SceneShape | null }

interface BoardWhiteboardViewProps {
  boardId: string;
  viewId: string | null;
  viewConfig: Record<string, unknown>;
  canEdit: boolean;
}

export function BoardWhiteboardView({ boardId, viewId, viewConfig, canEdit }: BoardWhiteboardViewProps) {
  const [whiteboardId, setWhiteboardId] = useState<string | null>(
    typeof viewConfig?.whiteboardId === "string" ? (viewConfig.whiteboardId as string) : null,
  );
  const [board, setBoard] = useState<ApiWhiteboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const pendingSceneRef = useRef<SceneShape | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistWhiteboardId = useCallback((next: string | null) => {
    setWhiteboardId(next);
    setBoard(null);
    if (!viewId) return;
    void fetch(`/api/boards/${boardId}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ...(viewConfig ?? {}), whiteboardId: next } }),
    }).catch(() => {});
  }, [boardId, viewId, viewConfig]);

  // Load the connected whiteboard's scene.
  useEffect(() => {
    if (!whiteboardId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const res = await fetch(`/api/whiteboards/${whiteboardId}`);
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json();
        setBoard(data.whiteboard);
      } else {
        // Stale config (whiteboard archived) — back to setup.
        setWhiteboardId(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [whiteboardId]);

  // Picker list (setup + change).
  useEffect(() => {
    if (whiteboardId && !picking) return;
    if (list !== null) return;
    let cancelled = false;
    void fetch("/api/whiteboards")
      .then((r) => (r.ok ? r.json() : { whiteboards: [] }))
      .then((d) => { if (!cancelled) setList(Array.isArray(d?.whiteboards) ? d.whiteboards : []); })
      .catch(() => { if (!cancelled) setList([]); });
    return () => { cancelled = true; };
  }, [whiteboardId, picking, list]);

  const flushSave = useCallback(async () => {
    if (!whiteboardId || !dirtyRef.current || !pendingSceneRef.current) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/whiteboards/${whiteboardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scene: pendingSceneRef.current }),
      });
      if (res.ok) dirtyRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [whiteboardId]);

  const onCanvasChange = useCallback((elements: readonly unknown[], appState: unknown, files: unknown) => {
    if (!canEdit) return;
    pendingSceneRef.current = {
      elements: elements as unknown[],
      appState: appState as Record<string, unknown>,
      files: files as Record<string, unknown>,
    };
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void flushSave(); }, AUTOSAVE_DEBOUNCE_MS);
  }, [canEdit, flushSave]);

  // Flush on unmount / tab close so edits aren't lost when switching tabs.
  useEffect(() => {
    const onBeforeUnload = () => { void flushSave(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushSave();
    };
  }, [flushSave]);

  const createWhiteboard = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Board whiteboard" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? "Couldn't create whiteboard");
        return;
      }
      const id = (data as { whiteboard?: { id?: string } })?.whiteboard?.id;
      if (id) {
        persistWhiteboardId(id);
        setPicking(false);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!whiteboardId || picking) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-12">
        <div className="max-w-md mx-auto text-center">
          <Brush className="w-8 h-8 mx-auto text-amber-400 mb-3" />
          <h3 className="text-[15px] font-semibold text-zinc-900 mb-1">
            {picking ? "Change the embedded whiteboard" : "Add a Whiteboard to this List"}
          </h3>
          <p className="text-[12.5px] text-zinc-500 mb-5">
            A freeform canvas tab — diagrams, brainstorms, mind maps. Create a fresh
            canvas, or embed one you already drew.
          </p>
          {error ? <p className="text-[12px] text-red-500 mb-3">{error}</p> : null}
          {canEdit ? (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void createWhiteboard()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Create whiteboard
              </button>
              {list === null ? (
                <span className="text-[12px] text-zinc-400">Loading whiteboards…</span>
              ) : list.length > 0 ? (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { persistWhiteboardId(e.target.value); setPicking(false); } }}
                  className="h-8 max-w-[240px] rounded-lg border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-700 outline-none focus:border-zinc-400"
                >
                  <option value="" disabled>Embed existing…</option>
                  {list.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              ) : null}
              {picking ? (
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="h-8 px-3 rounded-lg text-[12.5px] text-zinc-500 hover:bg-zinc-50"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-zinc-400">Ask a List editor to add a whiteboard.</p>
          )}
        </div>
      </div>
    );
  }

  const initialData = board?.scene && Object.keys(board.scene).length > 0
    ? {
        elements: (board.scene.elements as never[]) ?? [],
        appState: { ...(board.scene.appState ?? {}), collaborators: new Map() } as never,
        files: (board.scene.files as Record<string, never>) ?? undefined,
      }
    : undefined;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
        <Brush className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-[12.5px] font-medium text-zinc-800 truncate">{board?.name ?? "Whiteboard"}</span>
        {saving ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
            <Cloud className="w-3 h-3" /> Saving…
          </span>
        ) : null}
        <div className="flex-1" />
        <Link
          href={`/whiteboards/${whiteboardId}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50"
        >
          <ExternalLink className="w-3 h-3" />
          Open full page
        </Link>
        {canEdit ? (
          <button
            type="button"
            onClick={() => { setPicking(true); setList(null); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50"
            title="Embed a different whiteboard"
          >
            <RefreshCcw className="w-3 h-3" />
            Change
          </button>
        ) : null}
      </div>
      <div style={{ height: "calc(100vh - 320px)", minHeight: 480 }}>
        {loading || !board ? (
          <CanvasLoading />
        ) : (
          <Excalidraw
            initialData={initialData}
            onChange={onCanvasChange}
            viewModeEnabled={!canEdit}
          />
        )}
      </div>
    </div>
  );
}

function CanvasLoading() {
  return (
    <div className="h-full min-h-[480px] flex items-center justify-center gap-2 text-sm text-zinc-500">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading canvas…
    </div>
  );
}
