"use client";

// BoardDocView — DOC renderer. Embeds a workdoc as a board tab (the
// ClickUp "Doc view"). View.config.docId points at the Doc; the doc
// itself is anchored to the board (entityType BOARD) when created from
// here, so it also shows under the board's linked docs.
//
// Reuses BlockDocEditor in "peek" pane mode — full block editing, no
// back-button chrome. No doc yet → setup card (create or connect).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, Loader2, RefreshCcw } from "lucide-react";
import { BlockDocEditor } from "@/components/docs/block-doc-editor";

interface ApiDoc { id: string; title: string; updatedAt?: string }

interface BoardDocViewProps {
  boardId: string;
  viewId: string | null;
  viewConfig: Record<string, unknown>;
  canEdit: boolean;
}

export function BoardDocView({ boardId, viewId, viewConfig, canEdit }: BoardDocViewProps) {
  const [docId, setDocId] = useState<string | null>(
    typeof viewConfig?.docId === "string" ? (viewConfig.docId as string) : null,
  );
  const [docs, setDocs] = useState<ApiDoc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const persistDocId = useCallback((next: string | null) => {
    setDocId(next);
    if (!viewId) return;
    void fetch(`/api/boards/${boardId}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ...(viewConfig ?? {}), docId: next } }),
    }).catch(() => {});
  }, [boardId, viewId, viewConfig]);

  useEffect(() => {
    if (docId && !picking) return;
    if (docs !== null) return;
    let cancelled = false;
    void fetch("/api/docs")
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((d) => {
        if (cancelled) return;
        setDocs(Array.isArray(d?.docs) ? d.docs.filter((x: { isFolder?: boolean }) => !x.isFolder) : []);
      })
      .catch(() => { if (!cancelled) setDocs([]); });
    return () => { cancelled = true; };
  }, [docId, picking, docs]);

  const createDoc = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled doc", entityType: "BOARD", entityId: boardId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? "Couldn't create doc");
        return;
      }
      const id = (data as { doc?: { id?: string } })?.doc?.id;
      if (id) {
        persistDocId(id);
        setPicking(false);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!docId || picking) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-12">
        <div className="max-w-md mx-auto text-center">
          <FileText className="w-8 h-8 mx-auto text-blue-400 mb-3" />
          <h3 className="text-[15px] font-semibold text-zinc-900 mb-1">
            {picking ? "Change the embedded doc" : "Add a Doc to this List"}
          </h3>
          <p className="text-[12.5px] text-zinc-500 mb-5">
            A wiki tab right on the board — specs, briefs, runbooks. Create a fresh doc
            anchored to this List, or embed one you already wrote.
          </p>
          {error ? <p className="text-[12px] text-red-500 mb-3">{error}</p> : null}
          {canEdit ? (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void createDoc()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Create doc
              </button>
              {docs === null ? (
                <span className="text-[12px] text-zinc-400">Loading docs…</span>
              ) : docs.length > 0 ? (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { persistDocId(e.target.value); setPicking(false); } }}
                  className="h-8 max-w-[240px] rounded-lg border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-700 outline-none focus:border-zinc-400"
                >
                  <option value="" disabled>Embed existing…</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
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
            <p className="text-[12px] text-zinc-400">Ask a List editor to add a doc.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-blue-500" />
        <span className="text-[12.5px] font-medium text-zinc-800">Doc</span>
        <div className="flex-1" />
        <Link
          href={`/docs/${docId}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50"
        >
          <ExternalLink className="w-3 h-3" />
          Open full page
        </Link>
        {canEdit ? (
          <button
            type="button"
            onClick={() => { setPicking(true); setDocs(null); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50"
            title="Embed a different doc"
          >
            <RefreshCcw className="w-3 h-3" />
            Change
          </button>
        ) : null}
      </div>
      <div className="min-h-[480px]" style={{ height: "calc(100vh - 320px)" }}>
        <BlockDocEditor docId={docId} pane="peek" />
      </div>
    </div>
  );
}
