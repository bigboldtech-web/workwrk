"use client";

// DocEditorDialog — monday-style full-screen doc popup.
// Used to open notes, SOPs, and note-sections in a focused overlay
// rather than navigating away to a route. Renders the document
// chrome (breadcrumb + sidekick / copy-link / close), a contenteditable
// title, an "Add block" + "Start with AI" affordance, and a rich-ish
// text body that autosaves on blur + ⌘S. The body is plain HTML; the
// component is intentionally light so we can plug in a richer editor
// later without changing the public API.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Sparkles, Link as LinkIcon, MessageCircle, Plus,
  ChevronLeft, Bold, Italic, List, ListOrdered, Heading1, Heading2, Quote, Loader2,
} from "lucide-react";

export interface DocEditorDialogProps {
  open: boolean;
  onClose: () => void;
  // Breadcrumb segments rendered at the top-left (e.g. ["SOPs", "Onboarding"]).
  breadcrumb?: string[];
  // Initial document title and body. Body is treated as HTML.
  title: string;
  body: string;
  // Optional copy-link target. When provided we render the link button.
  shareUrl?: string;
  // Called on autosave (blur / ⌘S). Return a promise; the dialog shows a
  // spinner until it resolves so users see the save is in-flight.
  onSave?: (next: { title: string; body: string }) => Promise<void> | void;
  // Optional "Ask AI" — when provided we render the Sparkles button at the
  // top-right and the empty-state CTA at the bottom of the body.
  onAskAi?: (prompt: string) => void;
  // Optional Sidekick open hook (chat overlay button top-right).
  onOpenSidekick?: () => void;
  // Read-only mode disables editing (used to render published / archived docs).
  readOnly?: boolean;
}

export function DocEditorDialog({
  open,
  onClose,
  breadcrumb = [],
  title,
  body,
  shareUrl,
  onSave,
  onAskAi,
  onOpenSidekick,
  readOnly = false,
}: DocEditorDialogProps) {
  const [localTitle, setLocalTitle] = useState(title);
  const [localBody, setLocalBody] = useState(body);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset when a different doc is opened.
  useEffect(() => {
    setLocalTitle(title);
    setLocalBody(body);
    if (bodyRef.current) bodyRef.current.innerHTML = body;
  }, [title, body, open]);

  const save = useCallback(async () => {
    if (!onSave || readOnly) return;
    setSaving(true);
    try {
      await onSave({ title: localTitle, body: localBody });
    } finally {
      setSaving(false);
    }
  }, [onSave, readOnly, localTitle, localBody]);

  // ⌘S / Ctrl+S → save. Esc → close (unless typing in the title row).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape" && !showAiPrompt) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, save, showAiPrompt]);

  if (!open) return null;

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail in non-secure contexts — fall back to a prompt
      // so the user can still grab the URL.
      window.prompt("Copy link", shareUrl);
    }
  };

  // Inline-format the active selection with execCommand. This is
  // deprecated but still the simplest way to do basic bold/italic on a
  // contenteditable without a full editor framework. Good enough for the
  // popup until we wire a real editor in.
  const format = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    if (bodyRef.current) setLocalBody(bodyRef.current.innerHTML);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/55 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-4 md:m-8 w-full max-w-5xl bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top chrome — breadcrumb + actions. Mirrors monday doc layout. */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2/40">
          <div className="flex items-center gap-1.5 text-xs text-muted min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-surface-2 text-muted-2 hover:text-foreground"
              aria-label="Back"
            >
              <ChevronLeft size={14} />
            </button>
            {breadcrumb.map((seg, i) => (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{seg}</span>
                {i < breadcrumb.length - 1 && <span className="text-muted-2">/</span>}
              </span>
            ))}
            {breadcrumb.length > 0 && <span className="text-muted-2">/</span>}
            <span className="text-foreground font-medium truncate">{localTitle || "Untitled"}</span>
          </div>
          <div className="flex items-center gap-1">
            {saving && (
              <span className="text-[11px] text-muted-2 inline-flex items-center gap-1 mr-2">
                <Loader2 size={11} className="animate-spin" /> Saving…
              </span>
            )}
            {onAskAi && !readOnly && (
              <button
                type="button"
                onClick={() => setShowAiPrompt((v) => !v)}
                className="p-1.5 rounded-md hover:bg-surface-2 text-violet-600"
                aria-label="Ask AI"
                title="Ask AI"
              >
                <Sparkles size={14} />
              </button>
            )}
            {onOpenSidekick && (
              <button
                type="button"
                onClick={onOpenSidekick}
                className="p-1.5 rounded-md hover:bg-surface-2 text-muted-2 hover:text-foreground"
                aria-label="Open Sidekick"
                title="Open Sidekick"
              >
                <MessageCircle size={14} />
              </button>
            )}
            {shareUrl && (
              <button
                type="button"
                onClick={copyLink}
                className="p-1.5 rounded-md hover:bg-surface-2 text-muted-2 hover:text-foreground"
                aria-label="Copy link"
                title={copied ? "Copied!" : "Copy link"}
              >
                <LinkIcon size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-surface-2 text-muted-2 hover:text-foreground"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body — title + rich text. Scrolls independently of the chrome. */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 md:px-12 py-10">
            <input
              type="text"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={save}
              readOnly={readOnly}
              placeholder="Untitled"
              className="w-full text-4xl font-bold bg-transparent outline-none placeholder:text-muted-2 mb-6"
            />

            {/* Inline-format toolbar — appears above the body, monday-ish.
                For simplicity we render it always; future iteration: surface
                it as a floating bubble next to the caret. */}
            {!readOnly && (
              <div className="flex items-center gap-0.5 mb-4 text-muted-2">
                <ToolbarBtn onClick={() => format("formatBlock", "h1")} title="Heading 1"><Heading1 size={14} /></ToolbarBtn>
                <ToolbarBtn onClick={() => format("formatBlock", "h2")} title="Heading 2"><Heading2 size={14} /></ToolbarBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolbarBtn onClick={() => format("bold")} title="Bold"><Bold size={14} /></ToolbarBtn>
                <ToolbarBtn onClick={() => format("italic")} title="Italic"><Italic size={14} /></ToolbarBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolbarBtn onClick={() => format("insertUnorderedList")} title="Bulleted list"><List size={14} /></ToolbarBtn>
                <ToolbarBtn onClick={() => format("insertOrderedList")} title="Numbered list"><ListOrdered size={14} /></ToolbarBtn>
                <ToolbarBtn onClick={() => format("formatBlock", "blockquote")} title="Quote"><Quote size={14} /></ToolbarBtn>
              </div>
            )}

            <div
              ref={bodyRef}
              contentEditable={!readOnly}
              suppressContentEditableWarning
              onBlur={() => {
                if (bodyRef.current) setLocalBody(bodyRef.current.innerHTML);
                save();
              }}
              onInput={() => {
                if (bodyRef.current) setLocalBody(bodyRef.current.innerHTML);
              }}
              className="prose prose-sm md:prose-base max-w-none text-foreground min-h-[40vh] focus:outline-none [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_blockquote]:border-l-4 [&_blockquote]:border-violet-300 [&_blockquote]:pl-4 [&_blockquote]:text-muted [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
            />

            {/* Block-add + AI strip — surfaces when body is empty. */}
            {!readOnly && localBody.replace(/<[^>]+>/g, "").trim().length === 0 && (
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    bodyRef.current?.focus();
                    format("formatBlock", "p");
                  }}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-sm text-muted-2 hover:text-foreground hover:bg-surface-2"
                >
                  <Plus size={13} /> Add a block — text, heading, list…
                </button>
                {onAskAi && (
                  <button
                    type="button"
                    onClick={() => setShowAiPrompt(true)}
                    className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-700/40 bg-violet-50 dark:bg-violet-900/10 text-sm text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/20"
                  >
                    <Sparkles size={13} /> Start with AI — describe what you want…
                  </button>
                )}
              </div>
            )}

            {/* Inline AI prompt box (shown when user clicks Sparkles or empty-state CTA). */}
            {showAiPrompt && onAskAi && !readOnly && (
              <div className="mt-6 rounded-xl border border-violet-200 dark:border-violet-700/40 bg-violet-50/60 dark:bg-violet-900/10 p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-violet-700 dark:text-violet-300 font-medium">
                  <Sparkles size={13} /> Ask AI
                </div>
                <textarea
                  autoFocus
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Outline an onboarding SOP for a new account manager…"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => { setShowAiPrompt(false); setAiPrompt(""); }}
                    className="px-3 py-1 rounded-md text-xs text-muted hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!aiPrompt.trim()) return;
                      onAskAi(aiPrompt.trim());
                      setShowAiPrompt(false);
                      setAiPrompt("");
                    }}
                    disabled={!aiPrompt.trim()}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                  >
                    Generate
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="p-1.5 rounded hover:bg-surface-2 hover:text-foreground"
    >
      {children}
    </button>
  );
}
