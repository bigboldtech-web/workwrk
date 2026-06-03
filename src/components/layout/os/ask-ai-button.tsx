"use client";

/* AskAiButton — the launcher for the Brain panel.
 *
 * Two variants:
 *   size="sm"  → icon-only (used in the topbar search card)
 *   size="md"  → "Ask AI" text + icon beside it (used in the palette
 *                header)
 *
 * The button container itself stays subtle (bg-zinc-100 / dark-flipped
 * to #1F2329 via the existing dark-mode catchall). The visual
 * heavy-lifting comes from the shared BloomMark — see bloom-mark.tsx.
 */

import { BloomMark } from "./bloom-mark";

interface Props {
  onClick: () => void;
  /** sm = icon-only (topbar), md = text + icon (palette). Default md. */
  size?: "sm" | "md";
  className?: string;
  title?: string;
}

export function AskAiButton({ onClick, size = "md", className, title }: Props) {
  const iconOnly = size === "sm";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? "Ask AI — opens the Brain"}
      aria-label="Ask AI"
      className={
        iconOnly
          ? `inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-zinc-100 transition-colors flex-shrink-0${className ? " " + className : ""}`
          : `inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-[12px] font-semibold transition-colors flex-shrink-0${className ? " " + className : ""}`
      }
    >
      {!iconOnly && <span>Ask AI</span>}
      <BloomMark size={iconOnly ? 18 : 14} />
    </button>
  );
}
