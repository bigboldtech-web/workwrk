"use client";

// FullScreenDocEditor — Phase 4. Edge-to-edge editor for any Doc.
//
// Mirrors monday's full-screen Doc surface:
//   - Breadcrumbs at the top
//   - Title field (editable in place)
//   - Creator + created/updated metadata
//   - Versions button → opens version panel
//   - Copy link / Close
//   - RichEditor body (TipTap)
//
// Auto-saves debounced (1.5s). Every save snapshots a new DocVersion
// so the version trail grows naturally — no explicit save button
// needed, no data lost.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, History, Link as LinkIcon, Loader2, Check, RotateCcw,
} from "lucide-react";
import { RichEditor } from "@/components/ui/rich-editor";
import { useToast } from "@/components/ui/toast";

interface DocPayload {
  id: string;
  title: string;
  content: { html?: string } | null;
  excerpt: string | null;
  entityType: string | null;
  entityId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VersionRow {
  id: string;
  version: number;
  title: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

interface Props {
  docId: string;
  onClose: () => void;
  /** Breadcrumb segments shown above the title. e.g. ["CRM", "Acme Corp"]. */
  breadcrumbs?: string[];
}

export function FullScreenDocEditor({ docId, onClose, breadcrumbs }: Props) {
  const toast = useToast();

  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);

  // Track the latest title/html in a ref so the debounced save reads
  // the live values rather than the stale closure.
  const liveRef = useRef({ title: "", html: "" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/docs/${docId}`);
        if (!res.ok) throw new Error("load failed");
        const data = await res.json();
        if (cancelled) return;
        const d = data.doc as DocPayload;
        setDoc(d);
        setTitle(d.title);
        const initialHtml = (d.content && typeof d.content === "object" && "html" in d.content) ? String(d.content.html ?? "") : "";
        setHtml(initialHtml);
        liveRef.current = { title: d.title, html: initialHtml };
      } catch {
        toast.error("Couldn't load doc");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId, toast]);

  const persist = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    try {
      // Plain-text excerpt for list previews — strip HTML tags, cap.
      const plain = liveRef.current.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
      const res = await fetch(`/api/docs/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: liveRef.current.title || "Untitled note",
          content: { html: liveRef.current.html },
          excerpt: plain || null,
        }),
      });
      if (!res.ok) throw new Error();
      setLastSavedAt(new Date());
    } catch {
      toast.error("Save failed — will retry on next change");
    } finally {
      setSaving(false);
    }
  }, [doc, docId, toast]);

  // Schedule a debounced save whenever title or html changes after
  // initial load.
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 1500);
  }, [persist]);

  // Cleanup pending save on unmount — flush immediately so we don't
  // lose the last keystrokes.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        // Best-effort flush; we don't await it.
        persist();
      }
    };
  }, [persist]);

  // Esc closes (after flushing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/${docId}/versions`);
      if (!res.ok) return;
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch {}
  }, [docId]);

  useEffect(() => { if (showVersions) loadVersions(); }, [showVersions, loadVersions]);

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/docs/${docId}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy"),
    );
  }, [docId, toast]);

  const restoreVersion = useCallback(async (versionId: string) => {
    try {
      const res = await fetch(`/api/docs/${docId}/versions/${versionId}`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const newHtml = (data.doc?.content && typeof data.doc.content === "object" && "html" in data.doc.content) ? String(data.doc.content.html ?? "") : "";
      setTitle(data.doc.title);
      setHtml(newHtml);
      liveRef.current = { title: data.doc.title, html: newHtml };
      setShowVersions(false);
      toast.success(`Restored from v${data.restoredFromVersion} (now v${data.newVersion})`);
      loadVersions();
    } catch {
      toast.error("Couldn't restore");
    }
  }, [docId, toast, loadVersions]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface" role="dialog" aria-modal="true">
      <header className="flex-shrink-0 border-b border-border px-6 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <p className="text-xs text-muted-2 mb-1 truncate">
              {breadcrumbs.join(" › ")}
            </p>
          )}
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              liveRef.current.title = e.target.value;
              scheduleSave();
            }}
            placeholder="Untitled note"
            className="w-full bg-transparent border-0 outline-none text-2xl font-semibold text-foreground placeholder-muted-2"
          />
        </div>

        <div className="flex items-center gap-2">
          {saving ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-2"><Loader2 size={12} className="animate-spin" /> Saving…</span>
          ) : lastSavedAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check size={12} /> Saved {timeAgo(lastSavedAt)}</span>
          ) : null}

          <button
            type="button"
            onClick={() => setShowVersions((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
            title="Version history"
          >
            <History size={14} /> Versions
          </button>
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
            title="Copy link"
          >
            <LinkIcon size={14} /> Copy link
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:text-foreground hover:bg-surface-2"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {doc && (
        <p className="flex-shrink-0 px-6 py-2 border-b border-border text-xs text-muted-2 flex items-center gap-4">
          <span>Created {fmtAbs(new Date(doc.createdAt))}</span>
          <span>·</span>
          <span>Last updated {fmtAbs(new Date(doc.updatedAt))}</span>
        </p>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
        <div className="overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
          {loading ? (
            <div className="text-center py-20 text-sm text-muted-2 inline-flex items-center gap-2 mx-auto"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : (
            <RichEditor
              content={html}
              onChange={(next) => {
                setHtml(next);
                liveRef.current.html = next;
                scheduleSave();
              }}
              placeholder="Start writing…"
            />
          )}
        </div>

        {showVersions && (
          <aside className="border-l border-border bg-surface overflow-y-auto">
            <header className="sticky top-0 z-10 bg-surface border-b border-border px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Version history</p>
              <button
                type="button"
                onClick={() => setShowVersions(false)}
                className="p-1 rounded text-muted hover:text-foreground hover:bg-surface-2"
                aria-label="Close versions"
              >
                <X size={14} />
              </button>
            </header>
            <div className="p-3 space-y-1">
              {versions.length === 0 && (
                <p className="text-xs text-muted-2 py-8 text-center">No versions yet.</p>
              )}
              {versions.map((v) => (
                <div key={v.id} className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold">v{v.version}</p>
                    <button
                      type="button"
                      onClick={() => restoreVersion(v.id)}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-600 hover:text-violet-700"
                      title="Restore this version"
                    >
                      <RotateCcw size={10} /> Restore
                    </button>
                  </div>
                  <p className="text-xs text-foreground truncate">{v.title}</p>
                  <p className="text-[10px] text-muted-2 mt-1">
                    {v.authorName ? `${v.authorName} · ` : ""}{fmtAbs(new Date(v.createdAt))}
                  </p>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function fmtAbs(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function timeAgo(d: Date) {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
