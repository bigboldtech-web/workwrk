"use client";

// SchedulePicker (spec-ai-automation section 3): when an agent runs by
// itself. A trigger that reads the schedule back in words ("Weekdays at
// 9:00"), opening a Picker with four choices: Every weekday morning, Every
// Monday, Every month start, and Custom cron, which opens one field that
// shows the words it will run on as you type and saves only a schedule the
// scheduler can read (src/lib/agents/schedule-words.ts isValidSchedule).
//
// `onChange` returns whether the save worked, so a refused or failed save
// keeps the custom field open with the text still in it.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { SCHEDULE_PRESETS, describeSchedule, isValidSchedule, presetFor } from "@/lib/agents/schedule-words";

const CUSTOM = "custom";

export function SchedulePicker({
  cron,
  onChange,
  disabled = false,
}: {
  cron: string | null;
  onChange: (cron: string) => Promise<boolean> | boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = presetFor(cron);
  const words = cron && cron.trim() ? describeSchedule(cron, true) : "Choose when it runs";

  async function save(next: string) {
    setSaving(true);
    const ok = await onChange(next);
    setSaving(false);
    if (ok) setCustom(null);
  }

  const draftValid = custom !== null && isValidSchedule(custom);

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
          <span className={`truncate ${cron ? "" : "text-ink-3"}`}>{words}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        </button>
        <Picker
          open={open}
          onClose={() => setOpen(false)}
          ariaLabel="When it runs"
          width={260}
          selected={current}
          onSelect={(v) => {
            setOpen(false);
            if (v === CUSTOM) { setCustom(cron && current === "custom" ? cron : "0 9 * * *"); return; }
            const preset = SCHEDULE_PRESETS.find((p) => p.key === v);
            if (preset && preset.cron !== cron) void save(preset.cron);
          }}
          sections={[{
            options: [
              ...SCHEDULE_PRESETS.map((p) => ({ value: p.key, label: p.label, hint: describeSchedule(p.cron, true) })),
              { value: CUSTOM, label: "Custom cron", hint: current === "custom" && cron ? describeSchedule(cron, true) : undefined },
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
