"use client";

// One schedule's settings, inside the Schedule report dialog: when it runs
// (daily, weekly on a weekday, monthly on a day), at what time in which zone,
// to whom, and whether it is on. The pure rules (defaults, bodies, the
// printed cadence and next run) are src/lib/reports/schedule-form.ts.
//
// What it promises is exactly what the cron does: each email is built for its
// recipient alone, from what they can see (reportContentLine says what it
// holds), so the dialog never suggests a recipient sees what the sender sees.

import { useEffect, useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useBoot } from "@/components/layout/os/boot-context";
import { nextReportRunAt } from "@/lib/reports/schedule";
import {
  cadenceLabel,
  formatRunTime,
  reportContentLine,
  specFromForm,
  WEEKDAY_OPTIONS,
  type ScheduleFormState,
} from "@/lib/reports/schedule-form";
import type { DateFormatPrefs } from "@/lib/format/date";
import { RecipientPicker } from "./recipient-picker";
import { TimezonePicker } from "./timezone-picker";

type FieldErrors = Partial<Record<"weekday" | "monthDay" | "timeOfDay" | "timezone" | "recipients" | "form", string>>;

function Row({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-9 items-center gap-3">
        <span className="w-24 shrink-0 text-sm text-ink-2">{label}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      </div>
      {error ? <p className="m-0 ps-[108px] text-xs text-danger-text">{error}</p> : null}
    </div>
  );
}

export function ScheduleForm({
  form,
  onChange,
  kind,
  privateView,
  errors,
  prefs,
  disabled,
  onPickerOpenChange,
}: {
  form: ScheduleFormState;
  onChange: (next: ScheduleFormState) => void;
  kind: "dashboard" | "view";
  /** The view is private, so its owner is the only possible recipient. */
  privateView: boolean;
  errors: FieldErrors;
  prefs: DateFormatPrefs;
  disabled?: boolean;
  /**
   * Whether the time zone or recipient list is open. The dialog scrolls its
   * body, which would clip a list that opens near the bottom of the form, so
   * it stops clipping while one is open.
   */
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const [zoneOpen, setZoneOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const anyOpen = zoneOpen || peopleOpen;
  useEffect(() => {
    onPickerOpenChange?.(anyOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyOpen]);
  // Leaving the form (saved, cancelled) never leaves the dialog unclipped.
  useEffect(
    () => () => onPickerOpenChange?.(false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const spec = specFromForm(form);
  const next = nextReportRunAt(spec, new Date());
  const set = (patch: Partial<ScheduleFormState>) => onChange({ ...form, ...patch });
  // A private view is shown to its owner alone (viewVisibleTo), so whoever
  // has this form open on one is that owner.
  const { boot } = useBoot();
  const ownerId = privateView ? boot.viewer.id : null;
  // Scheduled to colleagues while shared, then made private: offer the one
  // click that makes the list what the view allows, so a save can succeed.
  const onlyOwner = !!ownerId && form.recipientIds.length === 1 && form.recipientIds[0] === ownerId;

  return (
    <div className="flex flex-col gap-2.5">
      <Row label="Repeats">
        <SegmentedControl
          size="sm"
          label="Repeats"
          value={form.cadence}
          onChange={(cadence) =>
            set({
              cadence,
              weekday: cadence === "weekly" ? form.weekday ?? 1 : form.weekday,
              monthDay: cadence === "monthly" ? form.monthDay ?? 1 : form.monthDay,
            })
          }
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
      </Row>

      {form.cadence === "weekly" ? (
        <Row label="On" error={errors.weekday}>
          <select
            value={form.weekday ?? 1}
            disabled={disabled}
            onChange={(e) => set({ weekday: Number(e.target.value) })}
            aria-label="Day of the week"
            className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"
          >
            {WEEKDAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
      ) : null}

      {form.cadence === "monthly" ? (
        <Row label="On day" error={errors.monthDay}>
          <select
            value={form.monthDay ?? 1}
            disabled={disabled}
            onChange={(e) => set({ monthDay: Number(e.target.value) })}
            aria-label="Day of the month"
            className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-2">Shorter months send on their last day</span>
        </Row>
      ) : null}

      <Row label="At" error={errors.timeOfDay}>
        <input
          type="time"
          value={form.timeOfDay}
          disabled={disabled}
          onChange={(e) => set({ timeOfDay: e.target.value.slice(0, 5) })}
          aria-label="Time of day"
          className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"
        />
      </Row>

      <Row label="Time zone" error={errors.timezone}>
        <TimezonePicker value={form.timezone} onChange={(timezone) => set({ timezone })} disabled={disabled} onOpenChange={setZoneOpen} />
      </Row>

      <Row label="Send to" error={errors.recipients}>
        <RecipientPicker
          value={form.recipientIds}
          onChange={(recipientIds) => set({ recipientIds })}
          locked={privateView}
          keepId={ownerId}
          disabled={disabled}
          onOpenChange={setPeopleOpen}
        />
      </Row>
      {privateView ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 ps-[108px] text-xs text-ink-2">
          <span>This view is private, so only its owner can receive it.</span>
          {ownerId && !onlyOwner ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => set({ recipientIds: [ownerId] })}
              className="font-medium text-brand-deep hover:underline disabled:text-ink-4 disabled:no-underline"
            >
              Send only to me
            </button>
          ) : null}
        </p>
      ) : null}

      <Row label="Active">
        <Switch checked={form.active} onChange={(active) => set({ active })} disabled={disabled} aria-label="Active" />
        <span className="text-sm text-ink-2">{form.active ? "Sends on schedule" : "Paused"}</span>
      </Row>

      <div className="mt-1 flex flex-col gap-1 rounded-md bg-subtle px-3 py-2.5 text-sm">
        <p className="m-0 text-ink">
          {cadenceLabel(spec, prefs)}
          {form.active && next ? <span className="text-ink-2">. Next: {formatRunTime(next.toISOString(), form.timezone, prefs)}</span> : null}
        </p>
        <p className="m-0 text-xs text-ink-2">{reportContentLine(kind)}</p>
        <p className="m-0 text-xs text-ink-2">Each person gets their own copy, built only from what they can see.</p>
      </div>
    </div>
  );
}
