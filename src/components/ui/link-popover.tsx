"use client";

// LinkPopover (spec-talk.md section 3): the 280px "Text" + "URL" popover that
// replaces `window.prompt("Link URL (https://…)")` in the message box.
//
// window.prompt is not themeable, not focus-trapped, not testable, cannot be
// cancelled with a keyboard in the way the rest of the product cancels things,
// and on a phone it is a full-screen system sheet. It also blocked the whole
// tab, which on a page holding a live call is a real cost.
//
// Like Picker and EmojiPicker this is an ABSOLUTE CHILD, never a portal, so it
// survives inside a dialog's focus trap. The URL rule is shared with the
// caller through `normaliseLinkUrl` in src/lib/link-url.ts, which is where the
// "a bare domain becomes https" decision is tested.

import { useEffect, useRef, useState } from "react";
import { useLayer } from "@/components/layout/os/shell-context";
import { normaliseLinkUrl } from "@/lib/link-url";

export function LinkPopover({
  open,
  onClose,
  onInsert,
  initialText = "",
  side = "top",
  align = "start",
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the finished pair; the caller writes the markup. */
  onInsert: (link: { text: string; url: string }) => void;
  /** Pre-fills "Text" from whatever was selected in the box. */
  initialText?: string;
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayer(open, { kind: "popover", close: onClose });

  // Re-seed on OPEN, during render rather than in an effect, so a previous
  // link never flashes into a fresh popover.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setText(initialText); setUrl(""); setError(null); }
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = e.target as Node | null;
      if (target && (panel.contains(target) || panel.parentElement?.contains(target))) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const insert = () => {
    const href = normaliseLinkUrl(url);
    if (!href) { setError("Enter a web address, like example.com"); return; }
    onInsert({ text: text.trim() || href, url: href });
    onClose();
  };

  const field = "h-8 w-full rounded-md border border-line bg-app px-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-line-strong";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Insert a link"
      className={`absolute z-30 w-[280px] rounded-lg border border-line bg-raised p-3 shadow-[var(--os-shadow-pop)] ${
        side === "top" ? "bottom-full mb-1" : "top-full mt-1"
      } ${align === "start" ? "start-0" : "end-0"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        if (e.key === "Enter") { e.preventDefault(); insert(); }
      }}
    >
      <label className="mb-1 block text-micro font-semibold uppercase tracking-wide text-ink-3" htmlFor="link-text">Text</label>
      <input id="link-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Link text" className={field} />
      <label className="mb-1 mt-2.5 block text-micro font-semibold uppercase tracking-wide text-ink-3" htmlFor="link-url">URL</label>
      <input id="link-url" autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="example.com" className={field} />
      {error ? <p className="mt-1.5 text-xs text-danger-text">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-8 rounded-md px-2.5 text-sm text-ink-2 hover:bg-hover">Cancel</button>
        <button
          type="button"
          onClick={insert}
          className="h-8 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover"
        >
          Insert
        </button>
      </div>
    </div>
  );
}
