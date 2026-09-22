"use client";

// NewEventModal (spec-planner.md section 2 `/planner`, Side panel / drawer /
// modal): 560 wide, "New event", opened by the blue button, by a sweep on
// the grid, by an empty Month cell and by the Planner sidebar "+" > Event.
//
// WHAT IT REPLACES, AND WHY THAT MATTERED. The popover before it had four
// tabs (Event / Task / Focus time / OOO) that changed one placeholder string
// and nothing else, four rows reading "Add video call", "Add participants",
// "Add tasks and docs" and "Add location" that had no handlers at all, and a
// Create button that POSTed a personal TASK to /api/me/work. So choosing
// "Focus time" and choosing "Event" produced the same row, none of the four
// affordances did anything, and a block of focus time became a to-do that
// showed up in every "still open" list forever (audit P-3).
//
// Now: Kind is stored on the event, the four dead rows are gone, and the
// write goes to POST /api/calendar/events, which is a calendar row.
//
// A FAILED CREATE KEEPS THE MODAL OPEN with everything that was typed and a
// Retry (audit P-6, TC-6). It used to close and lose the text.

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/date-time-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";
import { useLayer } from "@/components/layout/os/shell-context";
import { durationHint, hhmm, minutesOfHhmm } from "@/lib/calendar-blocks";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_LABEL,
  type CalendarEventKindWord,
} from "@/lib/calendar-event";

export interface NewEventInitial {
  dayKey: string;
  /** Minutes past midnight, in the viewer's zone. */
  startMin: number;
  endMin: number;
  allDay?: boolean;
  kind?: CalendarEventKindWord;
}

export { hhmm, minutesOfHhmm, durationHint };

export function NewEventModal({
  initial, timezone, onClose, onCreated, toInstant,
}: {
  initial: NewEventInitial;
  timezone: string | null;
  onClose: () => void;
  onCreated: () => void;
  toInstant: (dayKey: string, minutes: number) => Date;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarEventKindWord>(initial.kind ?? "EVENT");
  const [dayKey, setDayKey] = useState(initial.dayKey);
  const [startT, setStartT] = useState(() => hhmm(initial.startMin));
  const [endT, setEndT] = useState(() => hhmm(initial.endMin));
  const [allDay, setAllDay] = useState(Boolean(initial.allDay));
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useLayer(true, { id: "planner-new-event", kind: "modal", close: onClose });
  useEffect(() => { titleRef.current?.focus(); }, []);

  const startMin = minutesOfHhmm(startT);
  const endMin = minutesOfHhmm(endT);

  async function create() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const startAt = allDay ? toInstant(dayKey, 0) : toInstant(dayKey, startMin);
    const endAt = allDay ? toInstant(dayKey, 0) : toInstant(dayKey, Math.max(startMin + 15, endMin));
    const r = await apiFetch("/api/calendar/events", {
      method: "POST",
      json: {
        title: title.trim(),
        kind,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        allDay,
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      keepalive: true,
    });
    setSaving(false);
    if (!r.ok) { setFailure(r.error); return; }
    onCreated();
  }

  return (
    <div className="pln-modal os-chrome" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label="New event"
        aria-modal="true"
        className="pln-modal__card"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="pln-modal__head">
          <h2>New event</h2>
        </header>

        <div className="pln-modal__body">
          <label className="pln-field">
            <span>Title</span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
              placeholder={CALENDAR_EVENT_KIND_LABEL[kind]}
            />
          </label>

          <div className="pln-field">
            <span>Kind</span>
            <SegmentedControl
              label="Kind"
              value={kind}
              options={CALENDAR_EVENT_KINDS.map((k) => ({ value: k, label: CALENDAR_EVENT_KIND_LABEL[k] }))}
              onChange={setKind}
            />
          </div>

          {/* The product's own pickers. A native date input reads in the
              MACHINE's locale and a native time input ignores
              home.locale.timeFormat, so this modal and the meeting detail's
              When row disagreed with each other inside one phase
              (design-system 5.6: "selects, dates and people are pickers,
              never native"). */}
          <div className="pln-field pln-field--row">
            <span className="pln-field__sub">
              <span>Date</span>
              <DateField
                value={dayKey}
                onChange={(v) => { if (v) setDayKey(v); }}
                allowClear={false}
                ariaLabel="Date"
              />
            </span>
            {!allDay ? (
              <>
                <span className="pln-field__sub">
                  <span>Start</span>
                  <TimeField value={startT} onChange={setStartT} label="Start time" width={104} />
                </span>
                <span className="pln-field__sub">
                  <span>End</span>
                  <TimeField value={endT} onChange={setEndT} label="End time" width={104} />
                </span>
                <em className="pln-field__hint">{durationHint(startMin, endMin)}</em>
              </>
            ) : null}
          </div>

          <div className="pln-field pln-field--switch">
            <span id="pln-allday-label">All day</span>
            <Switch checked={allDay} onChange={setAllDay} aria-labelledby="pln-allday-label" />
          </div>

          {timezone && !allDay ? (
            <p className="pln-modal__note">Times are {timezone.replace(/_/g, " ")}, from your locale setting.</p>
          ) : null}

          <label className="pln-field">
            <span>Description</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          {failure ? (
            <p className="pln-modal__bad">
              Couldn&rsquo;t create it. {failure}
            </p>
          ) : null}
        </div>

        <footer className="pln-modal__foot">
          <button type="button" className="pln-modal__ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="pln-modal__primary" onClick={() => { void create(); }} disabled={saving}>
            {saving ? <Dots variant="pending" /> : <Plus aria-hidden />}
            {failure ? "Retry" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
