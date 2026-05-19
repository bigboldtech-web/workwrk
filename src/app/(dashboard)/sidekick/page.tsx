"use client";

import Link from "next/link";
import { Sparkles, Wand2, FileText, Search, Lightbulb, Image, ChevronRight, BookOpen, BarChart3 } from "lucide-react";

// Sidekick — general-purpose AI chat surface.
//
// Stub for now. Phase D will rebuild this with:
//   - 8 starter pills (Create board / Write doc / Research / Analyze /
//     Brainstorm / Generate image / Build a Vibe app / Learn about)
//   - 8 suggested starter cards categorized by output type
//   - Multi-modal output (text + table + chart + image)
//   - History of prior chats in the left rail
//   - Add context: @board, @doc, @person
//
// Until then this is a friendly placeholder that points users to the
// existing /ai surface so we don't break anything.

const STARTERS = [
  { label: "Create a board", icon: Wand2, hue: "violet" },
  { label: "Write a doc", icon: FileText, hue: "teal" },
  { label: "Research online", icon: Search, hue: "amber" },
  { label: "Analyze data", icon: BarChart3, hue: "rose" },
  { label: "Brainstorm ideas", icon: Lightbulb, hue: "amber" },
  { label: "Generate an image", icon: Image, hue: "green" },
  { label: "Build a Vibe app", icon: Sparkles, hue: "pink" },
  { label: "Learn about", icon: BookOpen, hue: "sky" },
] as const;

export default function SidekickPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 max-w-3xl mx-auto text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium mb-6">
        <Sparkles size={12} />
        WorkwrK Sidekick
      </div>

      <h1 className="text-3xl font-semibold mb-2">Hi, what would you like to work on today?</h1>
      <p className="text-muted mb-8 max-w-xl">
        Sidekick is your general-purpose AI assistant. Ask anything — Sidekick
        can create boards, write docs, run research, analyze data, and more.
      </p>

      <div className="w-full max-w-2xl mb-8">
        <div className="relative">
          <textarea
            placeholder="Transform a challenge into a practical, ready-to-use solution…"
            className="w-full min-h-[120px] rounded-2xl border-2 border-violet-200 dark:border-violet-800 px-5 py-4 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
            disabled
          />
          <div className="absolute bottom-3 right-3 text-xs text-muted">Coming in Phase D</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl mb-8">
        {STARTERS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              type="button"
              disabled
              className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border hover:border-violet-300 transition-colors disabled:opacity-50"
            >
              <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full bg-${s.hue}-100 text-${s.hue}-600`}>
                <Icon size={16} />
              </span>
              <span className="text-xs">{s.label}</span>
            </button>
          );
        })}
      </div>

      <Link
        href="/ai"
        className="inline-flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700"
      >
        Use the existing AI Assistant
        <ChevronRight size={14} />
      </Link>
    </div>
  );
}
