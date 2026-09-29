"use client";

// JsonBlock (spec-ai-automation section 3): a collapsible block of JSON in
// the mono face on --os-surface-1, with a Copy icon button. The Logs run
// drawer shows what went into a step, what came back and the triggering
// event with it; the builder shows an API-authored condition with it.

import { useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function pretty(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

export function JsonBlock({ value, label, defaultOpen = false, className }: { value: unknown; label: string; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const text = pretty(value);
  const empty = text === "" || text === "{}" || text === "null";
  return (
    <div className={cn("rounded-md border border-line", className)}>
      <div className="flex h-9 items-center gap-1 pe-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink hover:bg-hover"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-ink-2 transition-transform", open && "rotate-90")} aria-hidden />
          <span className="truncate">{label}</span>
          {empty ? <span className="text-ink-3">· Nothing</span> : null}
        </button>
        {!empty ? (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            title="Copy"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }).catch(() => {});
            }}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </button>
        ) : null}
      </div>
      {open && !empty ? (
        <pre className="m-0 max-h-[320px] overflow-auto border-t border-line bg-[var(--os-surface-1)] p-3 font-mono text-sm leading-[18px] text-ink">{text}</pre>
      ) : null}
    </div>
  );
}
