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
import { X, Plus, ChevronLeft, FileText } from "lucide-react";
import type { BnDocJSON } from "@/components/docs/blocknote-canvas";
import type { Block as LegacyBlock } from "@/components/docs/block-types";
import { useLayer } from "./shell-context";
import { SkeletonLines } from "@/components/ui/skeleton";
import { fetchWithRetry } from "@/lib/fetch-retry";

// BlockNoteCanvas statically imports heavy editor CSS — load its chunk only
// when a note is actually opened (this panel is mounted on every page).
const BlockNoteCanvas = dynamic(
  () => import("@/components/docs/blocknote-canvas").then((m) => m.BlockNoteCanvas),
  {
    ssr: false,
    loading: () => (
      <SkeletonLines lines={4} className="flex-1 px-4 py-6" />
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
  // A save that failed every retry: said on screen, kept for the next retry
  // (pen test 2026-11-28, V-19: a note over 64 KB was refused by the browser
  // as a keepalive request, the error was swallowed, and the note was lost).
  // "retrying": a network failure or a server error, tried again every 10 s.
  // "refused": the server said no (too large, no access), so a retry cannot
  // help and the person is told to keep their text.
  const [saveFailed, setSaveFailed] = useState<null | "retrying" | "refused">(null);
  // One save at a time, in order (the step 2 review): each retried on its own
  // backoff, an older save could land after a newer one and the note ended up
  // older on the server, with nothing left to send the newer one again.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  // One PATCH of a note. fetchWithRetry: keepalive only while the body fits
  // the browser's 64 KB keepalive limit (a bigger note goes out as a plain
  // request), and a network failure or a 5xx is retried.
  const sendNow = useCallback(async (id: string, body: string) => {
    try {
      const r = await fetchWithRetry(`/api/docs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body,
      });
      if (r.ok) {
        // Only clear our own payload: a newer edit may have replaced it.
        if (pendingRef.current?.id === id && pendingRef.current.body === body) { pendingRef.current = null; setSaveFailed(null); }
      } else {
        setSaveFailed(r.status >= 400 && r.status < 500 ? "refused" : "retrying");
      }
    } catch {
      setSaveFailed("retrying"); // kept in pendingRef: the 10 s retry sends it
    }
  }, []);

  // The same, in the save queue: after every save before it, and skipped when
  // a newer body for the same note is waiting (that one carries everything).
  const sendNote = useCallback((id: string, body: string): Promise<void> => {
    const run = saveQueueRef.current.then(async () => {
      const latest = pendingRef.current;
      if (latest && latest.id === id && latest.body !== body) return;
      await sendNow(id, body);
    });
    saveQueueRef.current = run.catch(() => undefined);
    return run;
  }, [sendNow]);

  // Re-fire the last unconfirmed save (if any). Called before switching
  // notes / closing the panel, and on pagehide/hidden (`now`: the page may
  // be going, so it goes out at once rather than waiting its turn).
  const flushPending = useCallback((opts?: { now?: boolean }) => {
    const p = pendingRef.current;
    if (!p) return;
    void (opts?.now ? sendNow(p.id, p.body) : sendNote(p.id, p.body));
  }, [sendNow, sendNote]);

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
    void sendNote(id, body).finally(() => { setSaving(false); loadList(); });
  }, [loadList, sendNote]);

  // A save that failed every retry is tried again every 10 s until it lands,
  // so "Retrying…" is true and the note is never left unsaved in silence.
  useEffect(() => {
    if (saveFailed !== "retrying") return;
    const t = window.setInterval(() => flushPending(), 10_000);
    return () => window.clearInterval(t);
  }, [saveFailed, flushPending]);

  // Retry an unconfirmed save when the tab is hidden/closing. The canvas
  // flushes its own not-yet-emitted edit through onChange on pagehide, which
  // lands in persistNote above with keepalive.
  useEffect(() => {
    const onPageHide = () => flushPending({ now: true });
    const onHide = () => { if (document.visibilityState === "hidden") flushPending({ now: true }); };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushPending]);

  // Closing the panel must also persist the in-flight edit. (The canvas
  // additionally flushes its pending edit on unmount.)
  const closePanel = useCallback(() => { flushPending(); setOpen(false); }, [flushPending]);

  // Esc goes through the LayerStack (spec-shell section 1.5), not a listener
  // here; closePanel still flushes the pending edit first.
  useLayer(open, { id: "notepad-panel", kind: "panel", close: closePanel });

  if (!open) return null;

  return (
    <>
      {/* Scrim and panel both start after the rail and below the bar: the rail
          at 64 and the bar at 48 stay visible and live at every width
          (spec-shell 1.16), so the bar's Create, bell, Help and avatar are
          not covered while the Notepad is open. */}
      <div className="fixed bottom-0 end-0 start-[var(--os-rail-w)] top-[var(--os-top-h)] z-[90] bg-[var(--os-scrim)]" onClick={closePanel} aria-hidden />
      <aside className="fixed bottom-0 end-0 top-[var(--os-top-h)] z-[91] w-[440px] max-w-[92vw] bg-white dark:bg-[#14171D] border-s border-zinc-200 dark:border-[#2A2F38] shadow-2xl flex flex-col">
        <div className="flex items-center gap-2 px-3 h-12 border-b border-zinc-200 dark:border-[#2A2F38] shrink-0 bg-warning-bg text-ink">
          {activeId ? (
            <button type="button" onClick={() => { flushPending(); loadTokenRef.current++; setActiveId(null); loadList(); }} className="w-7 h-7 rounded-full hover:bg-hover flex items-center justify-center text-ink-2" aria-label="Back">
              <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
            </button>
          ) : null}
          <div className="text-base font-semibold text-ink flex-1">Notepad</div>
          {saving ? <span className="text-xs text-ink-2">Saving…</span> : saveFailed === "retrying" ? (
            <span role="alert" className="text-xs text-danger-text">Not saved. Retrying…</span>
          ) : saveFailed === "refused" ? (
            <span role="alert" className="text-xs text-danger-text">Couldn&apos;t save this note. Copy your text before closing.</span>
          ) : null}
          <button type="button" onClick={closePanel} className="w-7 h-7 rounded-full hover:bg-hover flex items-center justify-center text-ink-2" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeId ? (
          seed === "loading" ? (
            <SkeletonLines lines={4} className="flex-1 px-4 py-6" />
          ) : seed === "error" ? (
            // No editor on a failed load — typing into an empty canvas here
            // would save over the note's real content.
            <div className="flex-1 px-4 py-10 text-center text-base text-zinc-400 dark:text-zinc-500">
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
              <SkeletonLines lines={4} className="px-4 py-6" />
            ) : notes.length === 0 ? (
              <div className="px-4 py-10 text-center text-base text-zinc-400 dark:text-zinc-500">No notes yet. Create your first sticky note.</div>
            ) : (
              <ul className="py-1">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => openNote(n.id)} className="w-full flex items-start gap-2.5 px-4 py-2.5 text-start hover:bg-zinc-50 dark:hover:bg-white/5 border-b border-zinc-100 dark:border-[#23272F]">
                      <FileText className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium text-zinc-800 dark:text-zinc-100">{n.title}</span>
                        {n.excerpt ? <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">{n.excerpt}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!activeId ? (
          <button type="button" onClick={newNote} disabled={!meId} className="shrink-0 flex items-center gap-2 px-4 h-11 border-t border-zinc-200 dark:border-[#2A2F38] text-base font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-40">
            <Plus className="w-4 h-4" /> New note
          </button>
        ) : null}
      </aside>
    </>
  );
}
