"use client";

// MessageBox (spec-talk.md section 2.2 and section 3), the rename of
// ChatComposer. What you write in is a "message box", which is the word the
// naming canon settles on; "composer" was a fourth name for a thing that
// already had three.
//
// What changed with the rename, each for a stated reason:
//
//   * Link no longer calls window.prompt. It opens LinkPopover, an absolute
//     child with Text and URL fields, because a system prompt is not
//     themeable, not focus-trapped, blocks the tab a live call is running in,
//     and on a phone is a full-screen sheet.
//   * Emoji is the shared EmojiPicker over the embedded list, not a fixed row
//     of twelve. The old row could not produce eight of the ten emoji the
//     reaction endpoint accepts.
//   * The camera and microphone buttons are GONE from the box and live in the
//     conversation header, where there is one Call control rather than two
//     that disagree with it.
//   * `sendVariant` exists so the thread reply box can render its Send as a
//     ghost: one blue thing per page (design principle 0.1), and the main
//     box's Send is it.
//   * The formatting chords are real key handlers now, not tooltips: ⌘B, ⌘I,
//     ⌘⇧X, ⌘⇧L for Link, ⌘⇧7, ⌘⇧8, ⌘⇧9, ⌘E. ⌘K is NOT rebound; it stays the
//     shell's global search inside inputs too.
//   * `onJumpToLast` gives ArrowUp in an empty box somewhere to go. It
//     brings my last message back into view and paints it; it does NOT open
//     the editor, and the prop is named for what it does, because a prop
//     called onEditLast that only highlights is a promise the feed cannot
//     keep from here (the row owns its own edit state).
//
// The send path is unchanged and deliberately so: the text leaves the box
// first, uploads are cached per File so a retry never re-uploads, and a failed
// upload puts the text back without clobbering anything typed since. A message
// that fails to send is never silently dropped.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign, Bold, Code, Italic, Link2, List, ListOrdered,
  Paperclip, Send, Smile, SquareCode, Strikethrough, TextQuote, Type, Underline, X,
} from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";
import { Dots } from "@/components/ui/dots";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { LinkPopover } from "@/components/ui/link-popover";
import { dragHasFiles } from "@/lib/upload-dropped-files";
import type { ChatUserLite } from "@/components/talk/conversation-utils";
import { TALK_FMTBAR_KEY, readTalkKey } from "@/components/talk/talk-keys";
import type { ChatAttachment } from "@/components/talk/message-feed";

const MAX_FILES = 10;
const MAX_FILE_MB = 25;

export type MessagePayload = { body: string; mentions: string[]; attachments: ChatAttachment[] };

export function MessageBox({
  members,
  meId,
  placeholder,
  autoFocus,
  onSend,
  onError,
  onJumpToLast,
  sendVariant = "primary",
  compact = false,
  initialValue = "",
  onCancel,
  disabled = false,
}: {
  members: { userId: string; user: ChatUserLite }[];
  meId: string | null;
  placeholder: string;
  autoFocus?: boolean;
  /** Called with the finished payload; the caller owns optimistic state. */
  onSend: (payload: MessagePayload) => void;
  onError: (message: string) => void;
  /** ArrowUp in an empty box: scroll my last message into view and paint
   *  it. Editing it is the "…" menu's Edit on the row itself. */
  onJumpToLast?: () => void;
  /** "ghost" for the thread reply box and inline edit: one blue per page. */
  sendVariant?: "primary" | "ghost";
  /** Inline edit: no attach, no formatting bar, Save and Cancel links. */
  compact?: boolean;
  initialValue?: string;
  onCancel?: () => void;
  /** Archived or read-only: the box renders but refuses, never disappears
   *  mid-typing. Callers that must hide it entirely simply do not mount it. */
  disabled?: boolean;
}) {
  const [input, setInput] = useState(initialValue);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSeed, setLinkSeed] = useState("");
  const [fmtOpen, setFmtOpen] = useState(false);

  useEffect(() => {
    try { setFmtOpen(readTalkKey(TALK_FMTBAR_KEY) === "1"); } catch { /* defaults */ }
  }, []);
  const toggleFmt = () => setFmtOpen((v) => {
    const n = !v;
    try { localStorage.setItem(TALK_FMTBAR_KEY, n ? "1" : "0"); } catch { /* private mode */ }
    return n;
  });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The tray as it is RIGHT NOW, for code that runs after an await: the
  // `files` the send closed over is the tray as it was before the upload,
  // and the paperclip and drag-drop stay live while one is running.
  const filesRef = useRef<File[]>(files);
  filesRef.current = files;
  // Successful uploads survive a failed batch: retrying re-uses them instead
  // of re-uploading (and re-registering) the same file.
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
      if (merged.length > MAX_FILES) onError(`Only ${MAX_FILES} files per message, ${merged.length - MAX_FILES} dropped`);
      return merged.slice(0, MAX_FILES);
    });
  };

  const send = async () => {
    if (disabled) return;
    const body = input.trim();
    const batch = files;
    if ((!body && batch.length === 0) || uploading) return;

    // Mentions = roster names actually present in the text. The boundary is
    // (?![A-Za-z0-9]) not (?!\w), because _ is a word character and an
    // italic-wrapped "_@Name_" must still count as a mention.
    const mentions = roster
      .filter((r) => r.name && new RegExp(`@${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(body))
      .map((r) => r.id);

    // The message leaves the box NOW. Anything typed during a slow upload
    // belongs to the next message and is never wiped by this one.
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
          void fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: f.name, mimeType: f.type || "application/octet-stream", size: f.size, url, ...(s3Key ? { s3Key } : {}) }),
          }).catch(() => {});
        }
      } catch (e) {
        setUploading(false);
        // THE WHOLE BATCH GOES BACK IN THE TRAY, beside anything attached
        // while the upload was running. It used to be `prev.length ? prev :
        // batch`, which kept the file added during the upload and dropped
        // every file of the batch, the ones that had already uploaded
        // included, while the error said "press send to try again": the
        // retry it invited sent a message without them. Merging also keeps
        // the uploadedRef cache reachable, since it is keyed on these very
        // File objects.
        const merged = [...batch, ...filesRef.current.filter((f) => !batch.includes(f))];
        setFiles(merged.slice(0, MAX_FILES));
        setInput((cur) => (cur ? `${body}\n${cur}` : body));
        const over = merged.length - MAX_FILES;
        const which = e instanceof Error && e.message ? `"${e.message}"` : "a file";
        onError(over > 0
          ? `Couldn't upload ${which}. The files are back in the box, except ${over} over the ${MAX_FILES}-file limit, press send to try again`
          : `Couldn't upload ${which}, press send to try again`);
        return;
      }
      setUploading(false);
      for (const f of batch) uploadedRef.current.delete(f);
    }

    onSend({ body, mentions, attachments });
  };

  const setSelection = (next: string, selStart: number, selEnd: number) => {
    const el = inputRef.current;
    setInput(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(selStart, selEnd); });
  };

  type FormatKind = "bold" | "italic" | "underline" | "strike" | "code" | "codeblock" | "link" | "quote" | "ul" | "ol";

  /** Wrap the selection in paired markers; a wrapped selection unwraps.
   *  Line operations (quote, lists) prefix every selected line. */
  const applyFormat = (kind: FormatKind) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const sel = input.slice(start, end);
    const wrap = (marker: string) => {
      const already = sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2;
      if (already) {
        const inner = sel.slice(marker.length, sel.length - marker.length);
        setSelection(input.slice(0, start) + inner + input.slice(end), start, start + inner.length);
      } else {
        setSelection(input.slice(0, start) + marker + sel + marker + input.slice(end),
          start + marker.length, start + marker.length + sel.length);
      }
    };
    const prefixLines = (prefix: (i: number) => string) => {
      const lineStart = input.lastIndexOf("\n", start - 1) + 1;
      const block = input.slice(lineStart, end);
      const lines = block.split("\n").map((l, i) => prefix(i) + l);
      const next = input.slice(0, lineStart) + lines.join("\n") + input.slice(end);
      setSelection(next, lineStart, lineStart + lines.join("\n").length);
    };
    switch (kind) {
      case "bold": return wrap("**");
      case "italic": return wrap("_");
      case "underline": return wrap("__");
      case "strike": return wrap("~");
      case "code": return wrap("`");
      case "codeblock": {
        const block = "```\n" + (sel || "") + "\n```";
        setSelection(input.slice(0, start) + block + input.slice(end), start + 4, start + 4 + sel.length);
        return;
      }
      case "link": {
        // No window.prompt: seed the popover with the selection and let it ask.
        // The popover is anchored to the Link button in the formatting row,
        // so the row has to be open for it to exist. Pressing ⌘⇧L with the
        // row closed used to set the state and render nothing, and the
        // popover then appeared unbidden the next time somebody toggled
        // Format. Opening the row is what makes the advertised chord work.
        setFmtOpen(true);
        setLinkSeed(sel);
        setLinkOpen(true);
        return;
      }
      case "quote": return prefixLines(() => "> ");
      case "ul": return prefixLines(() => "- ");
      case "ol": return prefixLines((i) => `${i + 1}. `);
    }
  };

  const insertLink = ({ text, url }: { text: string; url: string }) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? start;
    const md = `[${text}](${url})`;
    setSelection(input.slice(0, start) + md + input.slice(end), start + md.length, start + md.length);
  };

  const FMT_BUTTONS: { kind: FormatKind; icon: React.ReactNode; label: string; divider?: boolean }[] = [
    { kind: "bold", icon: <Bold className="h-4 w-4" />, label: "Bold (⌘B)" },
    { kind: "italic", icon: <Italic className="h-4 w-4" />, label: "Italic (⌘I)" },
    { kind: "underline", icon: <Underline className="h-4 w-4" />, label: "Underline" },
    { kind: "strike", icon: <Strikethrough className="h-4 w-4" />, label: "Strikethrough (⌘⇧X)" },
    { kind: "link", icon: <Link2 className="h-4 w-4" />, label: "Link (⌘⇧L)", divider: true },
    { kind: "ul", icon: <List className="h-4 w-4" />, label: "Bulleted list (⌘⇧7)", divider: true },
    { kind: "ol", icon: <ListOrdered className="h-4 w-4" />, label: "Numbered list (⌘⇧8)" },
    { kind: "quote", icon: <TextQuote className="h-4 w-4" />, label: "Quote (⌘⇧9)", divider: true },
    { kind: "code", icon: <Code className="h-4 w-4" />, label: "Code (⌘E)", divider: true },
    { kind: "codeblock", icon: <SquareCode className="h-4 w-4" />, label: "Code block" },
  ];

  /** Insert text at the caret and refocus. The emoji picker and the @ button
   *  both ride this; @ also re-runs mention detection so the people popover
   *  opens exactly as if it had been typed. */
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

  /** The formatting chords. ⌘K is deliberately absent: it is the shell's
   *  global search and works inside inputs, so Link is ⌘⇧L. */
  const formatChord = (e: React.KeyboardEvent): FormatKind | null => {
    if (!(e.metaKey || e.ctrlKey)) return null;
    const k = e.key.toLowerCase();
    if (e.shiftKey) {
      if (k === "x") return "strike";
      // The inline-edit box has no formatting row and therefore no anchor for
      // the Link popover, so the chord is not offered there rather than
      // being offered and doing nothing.
      if (k === "l") return compact ? null : "link";
      // The spec's table pairs "⌘⇧7, ⌘⇧8, ⌘⇧9" with "bulleted list,
      // numbered list, quote" in that order, so 7 is the bulleted one. The
      // two were bound the other way round, which the tooltips hid and the
      // ? overlay would have contradicted.
      if (k === "7" || e.key === "&") return "ul";
      if (k === "8" || e.key === "*") return "ol";
      if (k === "9" || e.key === "(") return "quote";
      return null;
    }
    if (k === "b") return "bold";
    if (k === "i") return "italic";
    if (k === "e") return "code";
    return null;
  };

  const canSend = (Boolean(input.trim()) || files.length > 0) && !uploading && !disabled;
  const sendClass = sendVariant === "primary"
    ? canSend ? "bg-[var(--os-brand)] text-white hover:bg-[var(--os-brand-hover)]" : "bg-active text-white"
    : "text-ink-2 hover:bg-hover hover:text-ink";

  return (
    <div
      className={`relative rounded-lg border bg-raised px-3 py-2 focus-within:border-line-strong ${dragOver ? "border-[var(--os-brand)] bg-[var(--os-brand)]/5" : "border-line"}`}
      onDragOver={(e) => { if (!compact && dragHasFiles(e)) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (compact || !dragHasFiles(e)) return;
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-line-strong bg-raised/80 text-sm font-medium text-ink">
          Drop files to attach
        </div>
      ) : null}

      {/* Mention autocomplete */}
      {mentionMatches.length > 0 && (
        <div className="absolute bottom-full start-2 z-20 mb-1 w-64 rounded-lg border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]">
          {mentionMatches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pickMention(p); }}
              className={`flex h-8 w-full items-center gap-2 px-2.5 text-start text-sm ${i === mentionIndex ? "bg-hover text-ink-strong" : "text-ink hover:bg-subtle"}`}
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
            <span key={`${f.name}-${i}`} className="inline-flex h-6 items-center gap-1.5 rounded-lg bg-hover ps-2 pe-1.5 text-xs text-ink">
              <Paperclip className="h-3 w-3 text-ink-3" />
              <span className="max-w-[180px] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => {
                  // Taking it out of the tray also drops the upload cached
                  // for it: the cache is keyed on the File itself, so an
                  // entry nobody can re-send is just a File held for ever.
                  uploadedRef.current.delete(f);
                  setFiles((prev) => prev.filter((_, x) => x !== i));
                }}
                aria-label={`Remove ${f.name}`}
                className="text-ink-3 hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col">
        {fmtOpen && !compact && (
          <div className="mb-1 flex items-center gap-0.5 border-b border-line-soft pb-1">
            {FMT_BUTTONS.map((b) => (
              <span key={b.kind} className="relative flex items-center">
                {b.divider && <span className="mx-1 h-4 w-px bg-active" />}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault() /* keep the textarea selection */}
                  onClick={() => applyFormat(b.kind)}
                  title={b.label}
                  aria-label={b.label}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
                >
                  {b.icon}
                </button>
                {b.kind === "link" ? (
                  <LinkPopover
                    open={linkOpen}
                    onClose={() => setLinkOpen(false)}
                    onInsert={insertLink}
                    initialText={linkSeed}
                  />
                ) : null}
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
          disabled={disabled}
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
            const chord = formatChord(e);
            if (chord) { e.preventDefault(); applyFormat(chord); return; }
            if (e.key === "Escape" && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
            if (e.key === "ArrowUp" && !input && onJumpToLast) { e.preventDefault(); onJumpToLast(); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          onClick={(e) => refreshMentionState(input, (e.target as HTMLTextAreaElement).selectionStart ?? input.length)}
          onKeyUp={(e) => {
            // Arrow-left/right and Home/End move the caret with no onChange;
            // refresh so a stale popover cannot hijack Enter.
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
              refreshMentionState(input, (e.target as HTMLTextAreaElement).selectionStart ?? input.length);
            }
          }}
          onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
          placeholder={placeholder}
          rows={Math.min(8, Math.max(1, input.split("\n").length))}
          className="max-h-48 w-full resize-none bg-transparent text-base leading-6 text-ink outline-none placeholder:text-ink-3"
        />

        <div className="mt-1 flex items-center gap-0.5">
          {!compact ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
                aria-label="Attach files"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleFmt}
                title={fmtOpen ? "Hide formatting" : "Show formatting"}
                aria-label={fmtOpen ? "Hide formatting" : "Show formatting"}
                aria-pressed={fmtOpen}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${fmtOpen ? "bg-hover text-ink" : "text-ink-3 hover:bg-hover hover:text-ink"}`}
              >
                <Type className="h-4 w-4" />
              </button>
            </>
          ) : null}
          <div className="relative">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              title="Emoji"
              aria-label="Emoji"
              aria-expanded={emojiOpen}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${emojiOpen ? "bg-hover text-ink" : "text-ink-3 hover:bg-hover hover:text-ink"}`}
            >
              <Smile className="h-4 w-4" />
            </button>
            <EmojiPicker
              open={emojiOpen}
              onClose={() => setEmojiOpen(false)}
              onPick={(e) => { setEmojiOpen(false); insertAtCaret(e); }}
            />
          </div>
          <button
            type="button"
            onClick={() => insertAtCaret("@", true)}
            title="Mention someone"
            aria-label="Mention someone"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
          >
            <AtSign className="h-4 w-4" />
          </button>

          <div className="flex-1" />

          {compact && onCancel ? (
            <button type="button" onClick={onCancel} className="me-1 h-7 rounded-md px-2 text-sm text-ink-2 hover:bg-hover">Cancel</button>
          ) : null}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label={compact ? "Save" : "Send"}
            title={compact ? "Save · Enter" : "Send · Enter"}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${sendClass}`}
          >
            {uploading ? <Dots variant="pending" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
