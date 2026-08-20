"use client";

// NotepadPanel — sticky-notes slide-over. Personal notes are Docs anchored
// entityType="NOTEPAD" / entityId=<owner userId>, so they are owner-only
// (doc-access gate) and never appear in /docs, Library, or pickers (the
// bare /api/docs list excludes NOTEPAD rows). Opened from the topbar
// "Notepad" quick-tool via the `workwrk:tool` window event (detail:
// "notepad"). List + BlockNote editor with debounced autosave.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { X, Plus, ChevronLeft, Loader2, FileText } from "lucide-react";
import type { BnDocJSON } from "@/components/docs/blocknote-canvas";
import type { Block as LegacyBlock } from "@/components/docs/block-editor";

// BlockNoteCanvas statically imports heavy editor CSS — load its chunk only
// when a note is actually opened (this panel is mounted on every page).
const BlockNoteCanvas = dynamic(
  () => import("@/components/docs/blocknote-canvas").then((m) => m.BlockNoteCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-300" /></div>
    ),
  },
);

interface NoteRow { id: string; title: string; excerpt: string | null; updatedAt: string }

// What seeds the editor for one note. Old notes are a minimal TipTap doc
// (paragraphs only, written by the pre-BlockNote textarea) → converted to
// legacy paragraph blocks; new notes persist {bnDoc, blocks, version:2}.
interface NoteSeed { bnDoc: BnDocJSON | null; legacyBlocks: LegacyBlock[] | null }

function contentToSeed(content: unknown): NoteSeed {
  const c = content as {
    bnDoc?: unknown; blocks?: unknown; type?: string;
    content?: Array<{ content?: Array<{ text?: string }> }>;
  } | null;
  if (c && Array.isArray(c.bnDoc)) {
    return {
      bnDoc: c.bnDoc as BnDocJSON,
      legacyBlocks: Array.isArray(c.blocks) ? (c.blocks as LegacyBlock[]) : null,
    };
  }
  if (c && Array.isArray(c.blocks)) return { bnDoc: null, legacyBlocks: c.blocks as LegacyBlock[] };
  if (c && c.type === "doc" && Array.isArray(c.content)) {
    // Pre-BlockNote note (minimal TipTap paragraphs) — mounting the canvas
    // without this conversion would show an EMPTY editor over real content.
    const legacyBlocks: LegacyBlock[] = c.content.map((p, i) => ({
      id: `np-${i}`,
      kind: "paragraph",
      text: (p.content ?? []).map((n) => n.text ?? "").join(""),
    }));
    return { bnDoc: null, legacyBlocks };
  }
  return { bnDoc: null, legacyBlocks: null };
}

// Title = first non-empty block (plainText flattens newlines to spaces, so
// derive from the mirror, not the flat string).
function titleFrom(mirror: LegacyBlock[]): string {
  for (const b of mirror) {
    if ("text" in b) {
      const t = (b as { text: string }).text.trim();
      if (t) return t.slice(0, 80);
    }
  }
  return "Untitled note";
}

export function NotepadPanel() {
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [seed, setSeed] = useState<NoteSeed | "loading" | "error">("loading");
  const [saving, setSaving] = useState(false);
  // Guards a slow note fetch racing a note switch: a stale response must
  // never seed (and then silently save into) the newer note's editor.
  const loadTokenRef = useRef(0);
  // Holds the last save until the server confirms it, so a tab-close /
  // navigate / panel-close can re-fire it (with keepalive) if the original
  // request failed. The canvas debounces edits internally (~700ms) and
  // flushes its own pending edit through onChange on unmount/pagehide, so
  // persistNote itself dispatches immediately.
  const pendingRef = useRef<{ id: string; body: string } | null>(null);

  // Re-fire the last unconfirmed save (if any). Called before switching
  // notes / closing the panel and on pagehide/hidden — a failed PATCH would
  // otherwise silently lose the edit.
  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    void fetch(`/api/docs/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, keepalive: true, body: p.body,
    }).then((r) => {
      if (r.ok && pendingRef.current?.body === p.body) pendingRef.current = null;
    }).catch(() => {});
  }, []);

  const loadList = useCallback(() => {
    if (!meId) return; // session still resolving — the catch-up effect below re-runs
    fetch(`/api/docs?entityType=NOTEPAD&entityId=${encodeURIComponent(meId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { docs: NoteRow[] } | null) => { if (d) setNotes(d.docs); });
  }, [meId]);

  useEffect(() => {
    function onTool(e: Event) {
      if ((e as CustomEvent).detail === "notepad") { setOpen(true); setActiveId(null); loadList(); }
    }
    window.addEventListener("workwrk:tool", onTool as EventListener);
    return () => window.removeEventListener("workwrk:tool", onTool as EventListener);
  }, [loadList]);

  // Catch-up: the panel can open before the session resolves; fetch the
  // list as soon as we know who "me" is.
  useEffect(() => { if (open && meId && notes === null) loadList(); }, [open, meId, notes, loadList]);

  async function openNote(id: string) {
    flushPending(); // retry any unconfirmed save before leaving the note
    const token = ++loadTokenRef.current;
    setActiveId(id);
    setSeed("loading");
    try {
      const res = await fetch(`/api/docs/${id}`);
      if (loadTokenRef.current !== token) return; // switched away meanwhile
      if (!res.ok) { setSeed("error"); return; }
      const d = await res.json();
      setSeed(contentToSeed((d.doc ?? d).content));
    } catch {
      if (loadTokenRef.current === token) setSeed("error");
    }
  }

  async function newNote() {
    if (!meId) return;
    flushPending();
    const res = await fetch("/api/docs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Untitled note",
        content: { bnDoc: [], blocks: [], version: 2 },
        entityType: "NOTEPAD",
        entityId: meId,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      loadTokenRef.current++; // cancel any in-flight note load
      setActiveId(d.doc.id);
      setSeed({ bnDoc: null, legacyBlocks: null });
      loadList();
    }
  }

  // Persist one edit immediately (the canvas already idle-debounced it).
  // keepalive lets a save fired during pagehide/unmount complete across
  // navigation; pendingRef keeps the payload for a retry until confirmed.
  const persistNote = useCallback((id: string, bnDoc: BnDocJSON, mirror: LegacyBlock[], plainText: string) => {
    const body = JSON.stringify({
      title: titleFrom(mirror),
      content: { bnDoc, blocks: mirror, version: 2 },
      excerpt: plainText.slice(0, 200),
    });
    pendingRef.current = { id, body };
    setSaving(true);
    void fetch(`/api/docs/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, keepalive: true, body,
    }).then((r) => {
      // Only clear our own payload — a newer edit may have replaced it.
      if (r.ok && pendingRef.current?.body === body) pendingRef.current = null;
    }).catch(() => {}) // kept in pendingRef → flushPending retries
      .finally(() => { setSaving(false); loadList(); });
  }, [loadList]);

  // Retry an unconfirmed save when the tab is hidden/closing. The canvas
  // flushes its own not-yet-emitted edit through onChange on pagehide, which
  // lands in persistNote above with keepalive.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushPending(); };
    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushPending]);

  // Closing the panel must also persist the in-flight edit. (The canvas
  // additionally flushes its pending edit on unmount.)
  const closePanel = useCallback(() => { flushPending(); setOpen(false); }, [flushPending]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closePanel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePanel]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/20" onClick={closePanel} aria-hidden />
      <aside className="fixed top-0 right-0 z-[91] h-screen w-[440px] max-w-[92vw] bg-white dark:bg-[#14171D] border-l border-zinc-200 dark:border-[#2A2F38] shadow-2xl flex flex-col">
        <div className="flex items-center gap-2 px-3 h-12 border-b border-zinc-200 dark:border-[#2A2F38] shrink-0" style={{ background: "#FBE9AE" }}>
          {activeId ? (
            <button type="button" onClick={() => { flushPending(); loadTokenRef.current++; setActiveId(null); loadList(); }} className="w-7 h-7 rounded-full hover:bg-black/5 flex items-center justify-center text-zinc-700" aria-label="Back">
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : null}
          <div className="text-[14px] font-semibold text-zinc-900 flex-1">Notepad</div>
          {saving ? <span className="text-[12px] text-zinc-600">Saving…</span> : null}
          <button type="button" onClick={closePanel} className="w-7 h-7 rounded-full hover:bg-black/5 flex items-center justify-center text-zinc-700" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeId ? (
          seed === "loading" ? (
            <div className="flex-1 flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-300" /></div>
          ) : seed === "error" ? (
            // No editor on a failed load — typing into an empty canvas here
            // would save over the note's real content.
            <div className="flex-1 px-4 py-10 text-center text-[13.5px] text-zinc-400 dark:text-zinc-500">
              Couldn&apos;t load this note. Go back and try again.
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto py-3">
              <BlockNoteCanvas
                key={activeId}
                docId={activeId}
                initialBnDoc={seed.bnDoc}
                legacyBlocks={seed.legacyBlocks}
                readonly={false}
                onChange={(bnDoc, mirror, plainText) => persistNote(activeId, bnDoc, mirror, plainText)}
              />
            </div>
          )
        ) : (
          <div className="flex-1 overflow-y-auto">
            {notes === null ? (
              <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-300" /></div>
            ) : notes.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13.5px] text-zinc-400 dark:text-zinc-500">No notes yet. Create your first sticky note.</div>
            ) : (
              <ul className="py-1">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => openNote(n.id)} className="w-full flex items-start gap-2.5 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-white/5 border-b border-zinc-100 dark:border-[#23272F]">
                      <FileText className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-zinc-800 dark:text-zinc-100">{n.title}</span>
                        {n.excerpt ? <span className="block truncate text-[12.5px] text-zinc-400 dark:text-zinc-500">{n.excerpt}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!activeId ? (
          <button type="button" onClick={newNote} disabled={!meId} className="shrink-0 flex items-center gap-2 px-4 h-11 border-t border-zinc-200 dark:border-[#2A2F38] text-[14px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-40">
            <Plus className="w-4 h-4" /> New note
          </button>
        ) : null}
      </aside>
    </>
  );
}
