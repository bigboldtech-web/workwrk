"use client";

// The page-header Ask AI slot for the Space / Board / Folder server pages
// (design-system 4.4): a 28px ghost with Sparkles and the label "Ask AI",
// rendered only when the AI hub is visible to the viewer; otherwise nothing,
// never a disabled button. Self-contained so a SERVER page can drop it in.

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { askSidekick } from "./empty-view";
import { useOsShell } from "./shell-context";

export function AskSidekickButton({ prompt, className }: { prompt?: string; className?: string }) {
  const { railApps } = useOsShell();
  if (!railApps.some((a) => a.key === "ai")) return null;
  return (
    <button
      type="button"
      title={`${SHELL_LABELS.askAi} (⌘J)`}
      onClick={() => askSidekick(prompt)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink",
        className,
      )}
    >
      <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      {SHELL_LABELS.askAi}
    </button>
  );
}
