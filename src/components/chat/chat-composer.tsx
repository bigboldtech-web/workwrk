"use client";

// Shared composer for the main pane and thread panels: Enter-sends,
// @mention autocomplete against the conversation roster, and file
// attachments (picker + drag-drop) uploaded through the same pipeline
// as every other file in WorkwrK.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign, Bold, Code, Italic, Link2, List, ListOrdered, Loader2, Mic,
  Paperclip, Send, Smile, SquareCode, Strikethrough, TextQuote, Type,
  Underline, Video, X,
} from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";
import { dragHasFiles } from "@/lib/upload-dropped-files";
import type { ChatUserLite } from "@/components/chat/conversation-utils";
import type { ChatAttachment } from "@/components/chat/message-feed";

const MAX_FILES = 10;
const MAX_FILE_MB = 25;

export type ComposerPayload = { body: string; mentions: string[]; attachments: ChatAttachment[] };

export function ChatComposer({ members, meId, placeholder, autoFocus, onSend, onError, onStartCall }: {
  members: { userId: string; user: ChatUserLite }[];
  meId: string | null;
  placeholder: string;
  autoFocus?: boolean;
  /** Called with the finished payload — the caller owns optimistic state. */
  onSend: (payload: ComposerPayload) => void;
  onError: (message: string) => void;
  /** Slack puts camera + mic in the composer's toolbar — main pane only
   *  (thread panels omit it; threads don't start huddles). */
  onStartCall?: (audioOnly: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Slack's Aa toggle: the formatting row shows above the text, persisted.
  const [fmtOpen, setFmtOpen] = useState(false);
  useEffect(() => {
    try { setFmtOpen(localStorage.getItem("workwrk:room:fmtbar") === "1"); } catch { /* defaults */ }
  }, []);
  const toggleFmt = () => setFmtOpen((v) => {
    const n = !v;
    try { localStorage.setItem("workwrk:room:fmtbar", n ? "1" : "0"); } catch { /* private mode */ }
    return n;
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Successful uploads survive a failed batch — retrying re-uses them
  // instead of re-uploading (and re-registering) the same file.
  const uploadedRef = useRef<Map<File, ChatAttachment>>(new Map());

  const roster = useMemo(
    () => members
      .filter((m) => m.userId !== meId)
      .map((m) => ({ id: m.userId, name: `${m.user.firstName} ${m.user.lastName}`.trim(), avatar: m.user.avatar })),
    [members, meId],
  );

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return roster.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, roster]);

  /* ── mention detection: the word containing the caret ─────────── */
  const refreshMentionState = (value: string, caret: number) => {
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at === -1 || (at > 0 && !/[\s\n]/.test(upToCaret[at - 1]))) {
      setMentionQuery(null);
      return;
    }
    const fragment = upToCaret.slice(at + 1);
    // A finished mention contains the full name; stop suggesting after ~30 chars.
    if (fragment.length > 30 || fragment.includes("\n")) { setMentionQuery(null); return; }
    setMentionQuery(fragment);
    setMentionIndex(0);
  };

  const pickMention = (person: { id: string; name: string }) => {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? input.length;
    const upToCaret = input.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at === -1) { setMentionQuery(null); return; }
    const next = input.slice(0, at) + `@${person.name} ` + input.slice(caret);
    setInput(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = at + person.name.length + 2;
      el.setSelectionRange(pos, pos);
    });
  };

  /* ── attachments ──────────────────────────────────────────────── */
  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const oversize = incoming.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (oversize) { onError(`"${oversize.name}" is over ${MAX_FILE_MB} MB`); return; }
    setFiles((prev) => {
      const merged = [...prev, ...incoming];
      if (merged.length > MAX_FILES) onError(`Only ${MAX_FILES} files per message — ${merged.length - MAX_FILES} dropped`);
      return merged.slice(0, MAX_FILES);
    });
  };

  const send = async () => {
    const body = input.trim();
    const batch = files;
    if ((!body && batch.length === 0) || uploading) return;

    // Mentions = roster names actually present in the text. Boundary
    // check so "@Sam Lee" doesn't also match inside "@Sam Leeson".
    // (?![A-Za-z0-9]) not (?!\w): _ is a word char, and an italic- or
    // underline-wrapped "_@Name_" must still count as a mention.
    const mentions = roster
      .filter((r) => r.name && new RegExp(`@${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(body))
      .map((r) => r.id);

    // The message leaves the composer NOW — anything typed during a slow
    // upload belongs to the next message, never wiped by this one.
    setInput("");
    setFiles([]);
    setMentionQuery(null);
    inputRef.current?.focus();

    const attachments: ChatAttachment[] = [];
    if (batch.length > 0) {
      setUploading(true);
      try {
        for (const f of batch) {
          const cached = uploadedRef.current.get(f);
          if (cached) { attachments.push(cached); continue; }
          const fd = new FormData();
          fd.append("file", f);
          const up = await fetch("/api/upload", { method: "POST", body: fd });
          if (!up.ok) throw new Error(f.name);
          const u = await up.json();
          const url = u.url ?? u.data?.url;
          if (!url) throw new Error(f.name);
          const s3Key = typeof (u.s3Key ?? u.data?.s3Key) === "string" ? (u.s3Key ?? u.data?.s3Key) : undefined;
          const att: ChatAttachment = { url, name: f.name, type: f.type || "application/octet-stream", size: f.size, ...(s3Key ? { s3Key } : {}) };
          uploadedRef.current.set(f, att);
          attachments.push(att);
          // Land it in the Library too (files system) — best-effort.
          void fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: f.name, mimeType: f.type || "application/octet-stream", size: f.size, url, ...(s3Key ? { s3Key } : {}) }),
          }).catch(() => {});
        }
      } catch (e) {
        // Restore the batch (already-uploaded files are cached and won't
        // re-upload) and put the text back without clobbering anything
        // typed since.
        setUploading(false);
        setFiles((prev) => (prev.length ? prev : batch));
        setInput((cur) => (cur ? `${body}
${cur}` : body));
        onError(`Couldn't upload ${e instanceof Error && e.message ? `"${e.message}"` : "a file"} — press send to try again`);
        return;
      }
      setUploading(false);
      for (const f of batch) uploadedRef.current.delete(f);
    }

    onSend({ body, mentions, attachments });
  };

  /** Wrap the selection in paired markers (bold/italic/…): no selection
   *  inserts the pair and parks the caret inside; a wrapped selection
   *  unwraps (toggle). Line ops (quote/lists) prefix every selected line. */
  const applyFormat = (kind: "bold" | "italic" | "underline" | "strike" | "code" | "codeblock" | "link" | "quote" | "ul" | "ol") => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const sel = input.slice(start, end);
    const set = (next: string, selStart: number, selEnd: number) => {
      setInput(next);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(selStart, selEnd); });
    };
    const wrap = (marker: string) => {
      const already = sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2;
      if (already) {
        const inner = sel.slice(marker.length, sel.length - marker.length);
        set(input.slice(0, start) + inner + input.slice(end), start, start + inner.length);
      } else {
        set(input.slice(0, start) + marker + sel + marker + input.slice(end),
          start + marker.length, start + marker.length + sel.length);
      }
    };
    const prefixLines = (prefix: (i: number) => string) => {
      const lineStart = input.lastIndexOf("\n", start - 1) + 1;
      const block = input.slice(lineStart, end);
      const lines = block.split("\n").map((l, i) => prefix(i) + l);
      const next = input.slice(0, lineStart) + lines.join("\n") + input.slice(end);
      set(next, lineStart, lineStart + lines.join("\n").length);
    };
    switch (kind) {
      case "bold": return wrap("**");
      case "italic": return wrap("_");
      case "underline": return wrap("__");
      case "strike": return wrap("~");
      case "code": return wrap("`");
      case "codeblock": {
        const block = "```\n" + (sel || "") + "\n```";
        set(input.slice(0, start) + block + input.slice(end), start + 4, start + 4 + sel.length);
        return;
      }
      case "link": {
        const url = window.prompt("Link URL (https://…)", "https://");
        if (!url || !/^https?:\/\//.test(url)) return;
        const label = sel || "link";
        const md = `[${label}](${url})`;
        set(input.slice(0, start) + md + input.slice(end), start + 1, start + 1 + label.length);
        return;
      }
      case "quote": return prefixLines(() => "> ");
      case "ul": return prefixLines(() => "- ");
      case "ol": return prefixLines((i) => `${i + 1}. `);
    }
  };

  const FMT_BUTTONS: { kind: Parameters<typeof applyFormat>[0]; icon: React.ReactNode; label: string; divider?: boolean }[] = [
    { kind: "bold", icon: <Bold className="h-4 w-4" />, label: "Bold (**)" },
    { kind: "italic", icon: <Italic className="h-4 w-4" />, label: "Italic (_)" },
    { kind: "underline", icon: <Underline className="h-4 w-4" />, label: "Underline (__)" },
    { kind: "strike", icon: <Strikethrough className="h-4 w-4" />, label: "Strikethrough (~)" },
    { kind: "link", icon: <Link2 className="h-4 w-4" />, label: "Link", divider: true },
    { kind: "ol", icon: <ListOrdered className="h-4 w-4" />, label: "Ordered list", divider: true },
    { kind: "ul", icon: <List className="h-4 w-4" />, label: "Bullet list" },
    { kind: "quote", icon: <TextQuote className="h-4 w-4" />, label: "Blockquote", divider: true },
    { kind: "code", icon: <Code className="h-4 w-4" />, label: "Inline code", divider: true },
    { kind: "codeblock", icon: <SquareCode className="h-4 w-4" />, label: "Code block" },
  ];

  /** Insert text at the caret and refocus — the emoji picker and the @
   *  button both ride this; @ also re-runs mention detection so the
   *  people popover opens exactly as if it was typed. */
  const insertAtCaret = (text: string, refreshMentions = false) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const next = input.slice(0, caret) + text + input.slice(el?.selectionEnd ?? caret);
    setInput(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = caret + text.length;
      el?.setSelectionRange(pos, pos);
      if (refreshMentions) refreshMentionState(next, pos);
    });
  };

  const COMPOSER_EMOJI = ["😀", "😂", "😍", "👍", "🙏", "🎉", "🔥", "❤️", "😮", "😢", "👀", "✅"];

  return (
    <div
      className={`relative rounded-xl border bg-white px-3 py-2 focus-within:border-zinc-300 ${dragOver ? "border-[var(--os-brand)] bg-[var(--os-brand)]/5" : "border-zinc-200"}`}
      onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {/* Mention autocomplete */}
      {mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-2 mb-1 z-20 w-64 rounded-lg border border-zinc-200 bg-white shadow-lg py-1">
          {mentionMatches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pickMention(p); }}
              className={`w-full flex items-center gap-2 px-2.5 h-8 text-left text-[13px] ${i === mentionIndex ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"}`}
            >
              <TeamAvatar name={p.name} avatar={p.avatar} size={20} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Pending attachments */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-lg bg-zinc-100 text-[12px] text-zinc-700">
              <Paperclip className="w-3 h-3 text-zinc-400" />
              <span className="max-w-[180px] truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, x) => x !== i))} aria-label={`Remove ${f.name}`} className="text-zinc-400 hover:text-zinc-700">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col">
        {fmtOpen && (
          <div className="mb-1 flex items-center gap-0.5 border-b border-zinc-100 pb-1">
            {FMT_BUTTONS.map((b) => (
              <span key={b.kind} className="flex items-center">
                {b.divider && <span className="mx-1 h-4 w-px bg-zinc-200" />}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault() /* keep textarea selection */}
                  onClick={() => applyFormat(b.kind)}
                  title={b.label}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                >
                  {b.icon}
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
        />
        <textarea
          ref={inputRef}
          value={input}
          autoFocus={autoFocus}
          onChange={(e) => {
            setInput(e.target.value);
            refreshMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (mentionMatches.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionMatches[mentionIndex]); return; }
              if (e.key === "Escape") { setMentionQuery(null); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          onClick={(e) => refreshMentionState(input, (e.target as HTMLTextAreaElement).selectionStart ?? input.length)}
          onKeyUp={(e) => {
            // Arrow-left/right (and Home/End) move the caret without an
            // onChange — refresh so a stale popover can't hijack Enter.
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
              refreshMentionState(input, (e.target as HTMLTextAreaElement).selectionStart ?? input.length);
            }
          }}
          onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
          placeholder={placeholder}
          rows={Math.min(6, Math.max(1, input.split("\n").length))}
          className="w-full resize-none bg-transparent outline-none text-[14px] text-zinc-800 placeholder:text-zinc-400 leading-6 max-h-40"
        />
        {/* Slack's toolbar row: attach · emoji · mention | camera · mic … send */}
        <div className="mt-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleFmt}
            title={fmtOpen ? "Hide formatting" : "Show formatting"}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${fmtOpen ? "bg-zinc-100 text-zinc-700 underline underline-offset-2" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"}`}
          >
            <Type className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              title="Emoji"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${emojiOpen ? "bg-zinc-100 text-zinc-700" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"}`}
            >
              <Smile className="h-4 w-4" />
            </button>
            {emojiOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
                <div className="absolute bottom-8 left-0 z-20 grid grid-cols-6 gap-0.5 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg">
                  {COMPOSER_EMOJI.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => { setEmojiOpen(false); insertAtCaret(e); }}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-[17px] hover:bg-zinc-100"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => insertAtCaret("@", true)}
            title="Mention someone"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <AtSign className="h-4 w-4" />
          </button>
          {onStartCall && (
            <>
              <span className="mx-1 h-4 w-px bg-zinc-200" />
              <button
                type="button"
                onClick={() => onStartCall(false)}
                title="Start a video call"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <Video className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onStartCall(true)}
                title="Start an audio call"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <Mic className="h-4 w-4" />
              </button>
            </>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void send()}
            disabled={(!input.trim() && files.length === 0) || uploading}
            aria-label="Send"
            className={`inline-flex h-7 w-8 items-center justify-center rounded-md text-white  ${
              input.trim() || files.length > 0 ? "bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]" : "bg-zinc-200"
            }`}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
