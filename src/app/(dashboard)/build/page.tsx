"use client";

import { Wand2, Sparkles, ArrowUp, Lock } from "lucide-react";

// Build — AI app generator (monday.com Vibe equivalent).
//
// Stub for now. Phase D will deliver:
//   - Prompt → generated app (schema + UI + automations)
//   - Idea chips (Project Portfolio Hub, Team Task Tracker, …)
//   - Starter template gallery
//   - Embeddable in any board as a view or sidebar widget
//   - Cross-org publishing (Phase F marketplace)

const IDEAS = [
  "Project Portfolio Hub",
  "Team Task Tracker",
  "Resource Scheduler",
  "Client Service Portal",
  "Content Editorial Suite",
  "Strategic OKR Manager",
];

const STARTERS = [
  { name: "Campaign health tracker", hue: "amber" },
  { name: "HR knowledge hub", hue: "pink" },
  { name: "Employee resource portal", hue: "violet" },
  { name: "Time tracker", hue: "blue" },
  { name: "Vendor scorecard", hue: "sky" },
  { name: "Incident postmortem", hue: "rose" },
];

export default function BuildPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="text-center mb-10 pt-10">
        <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-gradient-to-r from-violet-200 to-pink-200 dark:from-violet-900/40 dark:to-pink-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium mb-4">
          <Wand2 size={12} />
          Build
        </div>
        <h1 className="text-4xl font-semibold mb-2">Build your ideas with WorkwrK</h1>
        <p className="text-muted max-w-xl mx-auto">
          Hey there — let&apos;s build a new app for you. Describe what you need and
          we&apos;ll turn it into a working board with schema, automations, and views.
        </p>
      </div>

      <div className="relative mb-8 rounded-3xl p-[2px] bg-gradient-to-r from-violet-400 via-pink-400 to-amber-400">
        <div className="relative rounded-3xl bg-surface p-6">
          <textarea
            placeholder="Build your new application…"
            className="w-full min-h-[140px] resize-none border-0 bg-transparent focus:outline-none text-sm"
            disabled
          />
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1"><Sparkles size={12} /> AI model</span>
            </div>
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-40"
            >
              <ArrowUp size={14} />
            </button>
          </div>
          <div className="absolute -bottom-7 right-0 text-[11px] text-muted-2 inline-flex items-center gap-1">
            <Lock size={10} /> Phase D
          </div>
        </div>
      </div>

      <div className="text-center mb-10">
        <p className="text-xs uppercase tracking-wider text-muted-2 mb-3">Ideas for you</p>
        <div className="flex flex-wrap justify-center gap-2">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              disabled
              className="text-xs px-3 py-1.5 rounded-full border border-border text-muted disabled:opacity-60"
            >
              {idea}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Start with an idea</h2>
          <div className="flex gap-2 text-xs text-muted">
            <button type="button" className="px-2 py-1 rounded-md bg-surface-2">All</button>
            <button type="button" disabled className="px-2 py-1 rounded-md text-muted-2">Projects</button>
            <button type="button" disabled className="px-2 py-1 rounded-md text-muted-2">Sales</button>
            <button type="button" disabled className="px-2 py-1 rounded-md text-muted-2">HR</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {STARTERS.map((s) => (
            <article
              key={s.name}
              className={`rounded-2xl bg-${s.hue}-50 dark:bg-${s.hue}-950/30 border border-${s.hue}-200 dark:border-${s.hue}-900 p-5 cursor-pointer hover:scale-[1.02] transition-transform`}
            >
              <div className="h-32 rounded-xl bg-white dark:bg-zinc-900 mb-3" aria-hidden />
              <p className="text-sm font-medium">{s.name}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
