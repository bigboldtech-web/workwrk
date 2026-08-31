"use client";

// A small client "Ask" button for Space/Board/Folder headers that opens the AI
// Sidekick (optionally with a starter question). Self-contained so a SERVER
// page can drop it in — the onClick lives here, not passed from the server.
// (Distinct from AskAiButton, which is the topbar/palette Brain launcher.)

import { Sparkles } from "lucide-react";
import { askSidekick } from "./empty-view";

export function AskSidekickButton({ prompt, className }: { prompt?: string; className?: string }) {
  return (
    <button
      type="button"
      title="Ask Sidekick"
      onClick={() => askSidekick(prompt)}
      className={
        className ??
        "text-sm text-zinc-600 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100 hover:text-zinc-900"
      }
    >
      <Sparkles className="w-3.5 h-3.5 text-[var(--os-brand)]" />
      Ask
    </button>
  );
}
