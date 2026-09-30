"use client";

// "Set up {Org}" on Workspace settings > Overview (settings-architecture
// 11.2, spec-account-auth `/onboard` "The wizard and the Overview card, one
// rule"). Built on SettingsCard, inside the Overview's own column, so its
// edges are the section grid's edges.
//
//   wizard not finished and not dismissed   one line and "Continue setup"
//                                           (the resume point is server side)
//   "Finish later" was chosen               the four steps, each one click
//                                           into the page that does it,
//                                           ticked from DATA, never from
//                                           "this step was visited"
//   finished (in this release)              "Setup complete", one line, with
//                                           Dismiss; a workspace that finished
//                                           an older wizard ("legacy") shows
//                                           nothing, it was never offered
//   finished and dismissed                  nothing
//
// One deviation from the spec's table, on purpose: with both flags null the
// spec renders nothing here because the admin "is in the wizard". The
// dashboard's setup gate is gone, so an admin who closed the tab mid-wizard
// would otherwise have no way back but typing /onboard. The worst case of
// showing it is one extra line; the worst case of hiding it is a workspace
// left half set up with no prompt.
//
// The departments step ticks only once the list is no longer exactly the
// six seedOrgDefaults made: a step ticked before anyone acted tells the
// admin nothing.
//
// Admin-only by where it is mounted (the Overview is an Owner and Admin
// page); its writes go through PATCH /api/settings { section: "console" }.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { SettingsCard } from "@/components/settings/settings-card";
import { readConsole } from "@/lib/setup/console-state";
import { isSeededDepartmentSet } from "@/lib/org/default-departments";

interface Props {
  orgName: string;
  consoleRaw: unknown;
  /** settings.setupCompleted: the workspace finished one of the old wizards. */
  legacyCompleted?: boolean;
  hasLogoOrMission: boolean;
  activeUsers: number;
  activeModules: number;
  onChanged: () => void;
}

const GHOST = "inline-flex h-8 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50";
const SECONDARY = "inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-base font-medium text-ink hover:bg-hover";

export function SetupCard({ orgName, consoleRaw, legacyCompleted = false, hasLogoOrMission, activeUsers, activeModules, onChanged }: Props) {
  const state = readConsole({ console: consoleRaw, setupCompleted: legacyCompleted });
  const [departments, setDepartments] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showSteps = !state.setupCompletedAt && !!state.setupDismissedAt;
  useEffect(() => {
    if (!showSteps) return;
    let alive = true;
    fetch("/api/departments?fresh=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        const rows = Array.isArray(d) ? d : d && typeof d === "object" && Array.isArray((d as { data?: unknown }).data) ? (d as { data: unknown[] }).data : null;
        if (alive && rows) setDepartments(rows.map((r) => (r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string" ? (r as { name: string }).name : "")));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showSteps]);

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

  const errorLine = error ? (
    <p className="text-sm text-danger-text" role="alert">
      {error}
    </p>
  ) : null;

  if (state.setupCompletedAt) {
    if (state.setupCompletedAt === "legacy" || state.setupDismissedAt) return null;
    return (
      <SettingsCard
        title="Setup complete"
        description={`${orgName} is set up. Everything the wizard did can be changed on the pages below.`}
        actions={
          <button type="button" className={GHOST} onClick={() => void write({ dismiss: true })} disabled={busy}>
            {busy ? <Dots variant="pending" label="Saving" /> : null}
            Dismiss
          </button>
        }
      >
        {errorLine}
      </SettingsCard>
    );
  }

  if (!showSteps) {
    return (
      <SettingsCard
        title={`Set up ${orgName}`}
        description={`Four short steps. You are on step ${state.setupStep} of 4.`}
        actions={
          <>
            <button type="button" className={GHOST} onClick={() => void write({ dismiss: true })} disabled={busy}>
              {busy ? <Dots variant="pending" label="Saving" /> : null}
              Dismiss
            </button>
            <Link href="/onboard" className={SECONDARY}>
              Continue setup
            </Link>
          </>
        }
      >
        {errorLine}
      </SettingsCard>
    );
  }

  const steps = [
    { label: "Add your logo and mission", href: "/settings/identity", done: hasLogoOrMission },
    { label: "Invite your team", href: "/settings/members?invite=1", done: activeUsers >= 2 },
    { label: "Review your departments", href: "/settings/structure?tab=departments", done: departments !== null && departments.length > 0 && !isSeededDepartmentSet(departments) },
    { label: "Turn on Talk or Tables (both optional)", href: "/settings/apps#modules", done: activeModules > 0 },
  ];
  return (
    <SettingsCard
      title={`Set up ${orgName}`}
      actions={
        <button type="button" className={GHOST} onClick={() => void write({ complete: true })} disabled={busy}>
          {busy ? <Dots variant="pending" label="Saving" /> : null}
          Mark as done
        </button>
      }
    >
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((s) => (
          <li key={s.href} className="flex items-center gap-2 text-base">
            {s.done ? <Check className="h-4 w-4 text-success-text" aria-label="Done" /> : <Circle className="h-4 w-4 text-ink-3" aria-label="Not done yet" />}
            <Link href={s.href} className="text-brand-deep hover:underline">
              {s.label}
            </Link>
          </li>
        ))}
      </ol>
      {errorLine}
    </SettingsCard>
  );
}
