"use client";

// SchedulePicker (spec-ai-automation section 3): when an agent runs. A
// trigger that reads the schedule back in words ("Weekdays at 9:00"),
// opening a Picker with Only when you ask, Every weekday morning, Every
// Monday, Every month start, and Custom cron, which opens one field that
// shows the words it will run on as you type and saves only a schedule the
// scheduler can read (src/lib/agents/schedule-words.ts isValidSchedule).
//
// One control for "does it run by itself, and when": the drawer used to
// carry a second "Runs by itself" switch beside it, two switches whose
// difference nobody could tell. Only when you ask is that switch off; any
// schedule turns it on.
//
// THE ZONE. The words name the zone the saved schedule is read in when it is
// not the viewer's own ("Weekdays at 9:00, Kolkata time"). A schedule picked
// here is saved in the picker's own zone (the page adds CRON_TZ=).
//
// `onChange` returns whether the save worked, so a refused or failed save
// keeps the custom field open with the text still in it.
//
// `isValid` narrows what the custom field saves: an AI teammate's routine
// runs at most once an hour (src/lib/agents/routines.ts
// routineScheduleProblem), so its picker refuses "every 10 minutes" in the
// field rather than after the save. The presets are all hourly or slower.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { SCHEDULE_PRESETS, describeSchedule, isValidSchedule, presetFor, sameZone, wordsInZone } from "@/lib/agents/schedule-words";
import { splitScheduleZone } from "@/lib/agents/cron";

const CUSTOM = "custom";
const MANUAL = "manual";

export function SchedulePicker({
  cron,
  autonomous = true,
  zone = null,
  viewerZone = null,
  onChange,
  onManual,
  disabled = false,
  isValid = isValidSchedule,
}: {
  cron: string | null;
  /** Whether it runs by itself at all; false reads "When you ask". */
  autonomous?: boolean;
  /** The zone the saved schedule is read in. */
  zone?: string | null;
  /** The viewer's own zone, which new picks are saved in. */
  viewerZone?: string | null;
  /** A schedule was picked (the bare five fields, no zone). */
  onChange: (cron: string) => Promise<boolean> | boolean;
  /** Only when you ask was picked. Absent: the option is not offered. */
  onManual?: () => Promise<boolean> | boolean;
  disabled?: boolean;
  /** Which custom schedules may be saved. Default: any the scheduler can read (isValidSchedule). */
  isValid?: (schedule: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const body = splitScheduleZone(cron).body;
  const current = !autonomous ? MANUAL : presetFor(cron);
  // A saved schedule in another zone reads as picking it again would change
  // it (a preset saves in the viewer's zone), so its preset is not ticked.
  const zoneDiffers = Boolean(zone && viewerZone && !sameZone(zone, viewerZone));
  const words = !autonomous ? "When you ask" : body ? wordsInZone(describeSchedule(cron, true), zone, viewerZone) : "Choose when it runs";

  async function save(next: string) {
    setSaving(true);
    const ok = await onChange(next);
    setSaving(false);
    if (ok) setCustom(null);
  }
  async function manual() {
    if (!onManual) return;
    setSaving(true);
    await onManual();
    setSaving(false);
    setCustom(null);
  }

  const draftValid = custom !== null && isValid(custom);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative">
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md px-2 text-base text-ink hover:bg-hover disabled:opacity-60"
        >
          <span className={`truncate ${!autonomous || body ? "" : "text-ink-3"}`}>{words}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        </button>
        <Picker
          open={open}
          onClose={() => setOpen(false)}
          ariaLabel="When it runs"
          width={340}
          selected={current === MANUAL || !zoneDiffers ? current : null}
          onSelect={(v) => {
            setOpen(false);
            if (v === MANUAL) { if (autonomous) void manual(); return; }
            if (v === CUSTOM) { setCustom(body && current === "custom" ? body : "0 9 * * *"); return; }
            const preset = SCHEDULE_PRESETS.find((p) => p.key === v);
            if (preset && (preset.cron !== body || !autonomous || zoneDiffers)) void save(preset.cron);
          }}
          sections={[{
            options: [
              ...(onManual ? [{ value: MANUAL, label: "Only when you ask" }] : []),
              ...SCHEDULE_PRESETS.map((p) => ({ value: p.key, label: p.label, hint: describeSchedule(p.cron, true) })),
              { value: CUSTOM, label: "Custom cron", hint: current === "custom" && body ? describeSchedule(cron, true) : undefined },
            ],
          }]}
        />
      </div>
      {custom !== null ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && draftValid) void save(custom); if (e.key === "Escape") { e.stopPropagation(); setCustom(null); } }}
              aria-label="Custom cron"
              placeholder="minute hour day month weekday"
              spellCheck={false}
              autoFocus
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 font-mono text-sm text-ink outline-none focus:border-brand"
            />
            <button type="button" onClick={() => setCustom(null)} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button
              type="button"
              disabled={!draftValid || saving}
              onClick={() => void save(custom)}
              className="inline-flex h-8 items-center rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
            >
              Save
            </button>
          </div>
          <span className={`text-sm ${draftValid ? "text-ink-2" : "text-danger-text"}`}>
            {draftValid ? `Runs: ${describeSchedule(custom, true)}` : "Not a schedule we can run. Five fields: minute, hour, day, month, weekday."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
