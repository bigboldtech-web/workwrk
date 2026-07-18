"use client";

// NotepadPanel — sticky-notes slide-over. Personal notes are standalone Docs
// (entityType=null). Opened from the topbar "Notepad" quick-tool via the
// `workwrk:tool` window event (detail: "notepad"). List + inline editor with
// debounced autosave. Plain text only (stored as a minimal TipTap doc).

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Plus, ChevronLeft, Loader2, FileText } from "lucide-react";

interface NoteRow { id: string; title: string; excerpt: string | null; updatedAt: string }

// Plain text <-> minimal TipTap doc.
function textToContent(text: string) {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}
function contentToText(content: unknown): string {
  const doc = content as { content?: Array<{ content?: Array<{ text?: string }> }> } | null;
  if (!doc?.content) return "";
  return doc.content
    .map((p) => (p.content ?? []).map((n) => n.text ?? "").join(""))
    .join("\n");
}
function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0);
  return (line ?? "").trim().slice(0, 80) || "Untitled note";
}

export function NotepadPanel() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the not-yet-saved PATCH so a tab-close / navigate within the debounce
  // window can still flush it (with keepalive) instead of dropping the edit.
  const pendingRef = useRef<{ id: string; body: string } | null>(null);

  const loadList = useCallback(() => {
    fetch("/api/docs?standaloneOnly=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { docs: NoteRow[] } | null) => { if (d) setNotes(d.docs); });
  }, []);

  useEffect(() => {
    function onTool(e: Event) {
      if ((e as CustomEvent).detail === "notepad") { setOpen(true); setActiveId(null); loadList(); }
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("workwrk:tool", onTool as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("workwrk:tool", onTool as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, [loadList]);

  async function openNote(id: string) {
    setActiveId(id);
    setText("");
    const res = await fetch(`/api/docs/${id}`);
    if (res.ok) { const d = await res.json(); setText(contentToText((d.doc ?? d).content)); }
  }

  async function newNote() {
    const res = await fetch("/api/docs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled note", content: textToContent("") }),
    });
    if (res.ok) { const d = await res.json(); setActiveId(d.doc.id); setText(""); loadList(); }
  }

  function onChange(next: string) {
    setText(next);
    if (!activeId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    const body = JSON.stringify({ title: firstLine(next), content: textToContent(next), excerpt: next.slice(0, 200) });
    pendingRef.current = { id: activeId, body };
    saveTimer.current = setTimeout(async () => {
      pendingRef.current = null;
      await fetch(`/api/docs/${activeId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, keepalive: true, body,
      }).catch(() => {});
      setSaving(false);
      loadList();
    }, 700);
  }

  // Flush any pending note save when the tab is hidden/closing, so a quick note
  // typed and then navigated away from within the debounce window isn't lost.
  useEffect(() => {
    const flush = () => {
      const p = pendingRef.current;
      if (!p) return;
      pendingRef.current = null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      fetch(`/api/docs/${p.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, keepalive: true, body: p.body,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("visibilitychange", flush);
    };
  }, []);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/20" onClick={() => setOpen(false)} aria-hidden />
      <aside className="fixed top-0 right-0 z-[91] h-screen w-[380px] max-w-[92vw] bg-white dark:bg-[#14171D] border-l border-zinc-200 dark:border-[#2A2F38] shadow-2xl flex flex-col">
        <div className="flex items-center gap-2 px-3 h-12 border-b border-zinc-200 dark:border-[#2A2F38] shrink-0" style={{ background: "#FBE9AE" }}>
          {activeId ? (
            <button type="button" onClick={() => { setActiveId(null); loadList(); }} className="w-7 h-7 rounded-full hover:bg-black/5 flex items-center justify-center text-zinc-700" aria-label="Back">
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : null}
          <div className="text-[14px] font-semibold text-zinc-900 flex-1">Notepad</div>
          {saving ? <span className="text-[11px] text-zinc-600">Saving…</span> : null}
          <button type="button" onClick={() => setOpen(false)} className="w-7 h-7 rounded-full hover:bg-black/5 flex items-center justify-center text-zinc-700" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeId ? (
          <textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
            placeholder="Write your note…"
            className="flex-1 w-full resize-none px-4 py-3 text-[13.5px] leading-relaxed text-zinc-800 dark:text-zinc-100 bg-white dark:bg-[#14171D] outline-none placeholder:text-zinc-400"
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {notes === null ? (
              <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-300" /></div>
            ) : notes.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-zinc-400 dark:text-zinc-500">No notes yet. Create your first sticky note.</div>
            ) : (
              <ul className="py-1">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => openNote(n.id)} className="w-full flex items-start gap-2.5 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-white/5 border-b border-zinc-100 dark:border-[#23272F]">
                      <FileText className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{n.title}</span>
                        {n.excerpt ? <span className="block truncate text-[11.5px] text-zinc-400 dark:text-zinc-500">{n.excerpt}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!activeId ? (
          <button type="button" onClick={newNote} className="shrink-0 flex items-center gap-2 px-4 h-11 border-t border-zinc-200 dark:border-[#2A2F38] text-[13px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5">
            <Plus className="w-4 h-4" /> New note
          </button>
        ) : null}
      </aside>
    </>
  );
}
