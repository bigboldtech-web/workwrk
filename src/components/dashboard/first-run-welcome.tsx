"use client";

/**
 * First-run welcome modal — Phase G5.
 *
 * Fires the first time a user lands on the dashboard. Three-step
 * intro: (1) what the seven hubs are, (2) Cmd-K is the universal
 * entry-point, (3) pin your favorites for one-click access.
 *
 * Acknowledgement persists in localStorage so it never appears
 * again on the same browser. We deliberately don't store this on
 * the user row server-side — first-run is a per-device experience;
 * a user signing in on a new laptop should get the same intro.
 *
 * Hydrates post-mount to avoid an SSR mismatch (the dialog's open
 * state depends on localStorage, which is client-only).
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, CalendarDays, DollarSign, Star, Megaphone, Wrench,
  Sparkles, Pin, ArrowRight, Command,
} from "lucide-react";

const STORAGE_KEY = "workwrk.firstRunWelcome.v1";

const HUBS = [
  { icon: LayoutDashboard, name: "Home",     blurb: "What needs you, right now." },
  { icon: Users,           name: "People",   blurb: "Org chart, profiles, lookups." },
  { icon: CalendarDays,    name: "Work",     blurb: "Tasks, OKRs, SOPs, time." },
  { icon: DollarSign,      name: "Money",    blurb: "Expenses, POs, financials." },
  { icon: Star,            name: "Talent",   blurb: "Reviews, comp, hiring." },
  { icon: Megaphone,       name: "Culture",  blurb: "Announcements, kudos, ideas." },
  { icon: Wrench,          name: "Platform", blurb: "Studio, integrations, audit." },
] as const;

export function FirstRunWelcome() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Hydrate — only open if the user has never dismissed before.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {
      // Storage blocked — skip the welcome rather than fail loudly.
    }
  }, []);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // Best-effort persistence; if it fails, the welcome may show
      // again next session — a minor annoyance, not a bug.
    }
  }

  function advance() {
    if (step >= 2) {
      dismiss();
      return;
    }
    setStep((s) => s + 1);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl tracking-tight">
            {step === 0 && "Welcome to WorkwrK."}
            {step === 1 && "Everything's one keystroke away."}
            {step === 2 && "Make it yours."}
          </DialogTitle>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-5 pt-2">
            <p className="text-sm text-muted leading-relaxed">
              Seven hubs in the sidebar, organized around how teams actually work.
              Most people use three of them daily — the rest stay quietly out of the way.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {HUBS.map((hub) => {
                const Icon = hub.icon;
                return (
                  <div key={hub.name} className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3">
                    <span
                      className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent-strong)",
                      }}
                    >
                      <Icon size={13} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold leading-tight">{hub.name}</p>
                      <p className="text-[11px] text-muted leading-snug mt-0.5">{hub.blurb}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5 pt-2">
            <p className="text-sm text-muted leading-relaxed">
              Press{" "}
              <kbd className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-surface font-mono text-[11px]">
                <Command size={10} /> K
              </kbd>{" "}
              from anywhere to open the command palette. Search people, tasks,
              SOPs, documents, anything. AI ranks the top match and lets you
              ask follow-up questions in plain English.
            </p>
            <div className="rounded-lg border border-[color:var(--accent)]/30 bg-[color:var(--accent-soft)] p-4">
              <div className="flex items-start gap-3">
                <Sparkles size={16} className="text-[color:var(--accent-strong)] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-semibold mb-1">Try it now</p>
                  <p className="text-[12px] text-muted leading-relaxed">
                    Type a teammate's name, an SOP keyword, or just <em>"who's overdue?"</em> —
                    the AI synthesizes the answer from your live data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 pt-2">
            <p className="text-sm text-muted leading-relaxed">
              Click the{" "}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-surface text-[11px]">
                <Pin size={10} />
              </span>{" "}
              next to any sidebar item to pin it to the top. Your pinned set
              persists across sessions, and frequently-visited items show up
              in the Recent rail automatically.
            </p>
            <div className="rounded-lg border border-border bg-surface p-4 text-sm">
              <p className="font-semibold mb-2 text-[13px]">A typical day</p>
              <ol className="space-y-2 text-[12.5px] text-muted">
                <li className="flex gap-2"><span className="text-[color:var(--accent-strong)] font-bold tabular-nums">1.</span>Open Home → check Inbox + Tasks.</li>
                <li className="flex gap-2"><span className="text-[color:var(--accent-strong)] font-bold tabular-nums">2.</span>Decide / dismiss / snooze pending approvals.</li>
                <li className="flex gap-2"><span className="text-[color:var(--accent-strong)] font-bold tabular-nums">3.</span>Drag tasks into today, complete as you go.</li>
                <li className="flex gap-2"><span className="text-[color:var(--accent-strong)] font-bold tabular-nums">4.</span>Give a kudos. Seriously — try it.</li>
              </ol>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <div className="mr-auto flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-fast ${
                  i === step ? "bg-[color:var(--accent)] w-4" : "bg-border"
                }`}
              />
            ))}
          </div>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={dismiss}>
            Skip
          </Button>
          <Button onClick={advance} className="gap-1.5">
            {step < 2 ? "Next" : "Get started"}
            <ArrowRight size={13} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
