"use client";

// "Set up {Org}" on Workspace settings > Overview (settings-architecture
// 11.2, spec-account-auth `/onboard` "The wizard and the Overview card, one
// rule"). With the dashboard's setup gate gone, this card is how an Owner or
// Admin gets back to setup:
//   wizard not finished and not dismissed   one line and "Continue setup"
//                                           (the resume point is server side)
//   "Finish later" was chosen               the four steps, each one click
//                                           into the page that does it,
//                                           ticked from DATA, never from
//                                           "this step was visited"
//   finished                                nothing
// Admin-only by where it is mounted (the Overview is an Owner and Admin
// page); its writes go through PATCH /api/settings { section: "console" }.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { readConsole } from "@/lib/setup/console-state";

interface Props {
  orgName: string;
  consoleRaw: unknown;
  hasLogoOrMission: boolean;
  activeUsers: number;
  activeModules: number;
  onChanged: () => void;
}

export function SetupCard({ orgName, consoleRaw, hasLogoOrMission, activeUsers, activeModules, onChanged }: Props) {
  const state = readConsole({ console: consoleRaw });
  const [departments, setDepartments] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showSteps = !state.setupCompletedAt && !!state.setupDismissedAt;
  useEffect(() => {
    if (!showSteps) return;
    let alive = true;
    fetch("/api/departments?fresh=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d)) setDepartments(d.length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showSteps]);

  if (state.setupCompletedAt) return null;

  async function write(data: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "console", data }) });
      if (!r.ok) setError("That did not save. Try again.");
      else onChanged();
    } catch {
      setError("Can't reach WorkwrK. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = {
    margin: "0 24px 8px",
    padding: 16,
    border: "1px solid var(--os-line)",
    borderRadius: 8,
    background: "var(--os-surface)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  if (!showSteps) {
    return (
      <section style={card} aria-label={`Set up ${orgName}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--os-ink)" }}>Set up {orgName}</h2>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--os-ink-2)" }}>Four short steps. You are on step {state.setupStep} of 4.</p>
          </div>
          <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50" onClick={() => void write({ dismiss: true })} disabled={busy}>
            {busy ? <Dots variant="pending" label="Saving" /> : null}
            Dismiss
          </button>
          <Link href="/onboard" className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 text-base font-medium text-ink hover:bg-hover">
            Continue setup
          </Link>
        </div>
        {error ? <p style={{ margin: 0, fontSize: 13, color: "var(--os-danger-text)" }}>{error}</p> : null}
      </section>
    );
  }

  const steps = [
    { label: "Add your logo and mission", href: "/settings/identity", done: hasLogoOrMission },
    { label: "Invite your team", href: "/settings/members?invite=1", done: activeUsers >= 2 },
    { label: "Create departments", href: "/settings/structure?tab=departments", done: (departments ?? 0) >= 1 },
    { label: "Turn on Talk or Tables (both optional)", href: "/settings/apps#modules", done: activeModules > 0 },
  ];
  return (
    <section style={card} aria-label={`Set up ${orgName}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0, flex: 1, fontSize: 15, fontWeight: 600, color: "var(--os-ink)" }}>Set up {orgName}</h2>
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50" onClick={() => void write({ complete: true })} disabled={busy}>
          {busy ? <Dots variant="pending" label="Saving" /> : null}
          Mark as done
        </button>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s) => (
          <li key={s.href} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            {s.done ? <Check size={16} aria-label="Done" style={{ color: "var(--os-success-text)" }} /> : <Circle size={16} aria-label="Not done yet" style={{ color: "var(--os-ink-3)" }} />}
            <Link href={s.href} style={{ color: "var(--os-brand-deep)", textDecoration: "none" }}>
              {s.label}
            </Link>
          </li>
        ))}
      </ol>
      {error ? <p style={{ margin: 0, fontSize: 13, color: "var(--os-danger-text)" }}>{error}</p> : null}
    </section>
  );
}
