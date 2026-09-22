"use client";

// The Calendar's four popovers (spec-planner.md section 2 `/planner`):
//
//   EventPopover           a personal event, every field autosaving
//   ExternalEventPopover   a Google row, read only, with a link out
//   ReminderPopover        an alarm: snooze, done, move
//   DayListPopover         Month view's "+N more", the day's blocks as rows
//
// WHY THEY ARE ALL HERE. They are one drawing with four bodies: the same
// 320px card, anchored to the block that opened it, dismissed the same way,
// and registered on the same LayerStack so Escape closes the top one and not
// the page behind it. Splitting them into four files duplicated the
// anchoring three times in the draft and the copies drifted immediately.
//
// EVERY ACTION SURFACES ITS FAILURE. An autosave that does not land shows
// the row's own "Not saved" line with Retry rather than a silent revert, and
// a Delete that fails puts the event back. This is a save path, so it
// follows the data-integrity rule the same as the punch and the timesheet.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AlarmClock, Check, Clock, ExternalLink, MoveRight, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useLayer } from "@/components/layout/os/shell-context";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/date-time-field";
import { Dots } from "@/components/ui/dots";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_LABEL,
  type CalendarEventKindWord,
} from "@/lib/calendar-event";
import { minutesUntil } from "@/lib/calendar-blocks";
import { KIND_LABEL, kindTone, type CalEvent } from "./calendar-grid";

const CARD_W = 320;
const MARGIN = 12;

/* ───────────────────────────── anchoring ───────────────────────────── */

/**
 * A card pinned beside the block that opened it and kept inside the
 * viewport. Fixed positioning, deliberately: the grid scrolls, and a card
 * that scrolls away from its own anchor reads as a bug even though it is
 * technically correct. It closes on outside pointer-down and on Escape
 * through the shell's LayerStack, so it never fights the drawer or a modal
 * for the key.
 */
export function AnchoredPopover({
  anchor, onClose, ariaLabel, children, layerId = "planner-popover", width = CARD_W,
}: {
  anchor: DOMRect;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  layerId?: string;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, { id: layerId, kind: "popover", close: onClose });

  // THE PLACEMENT IS WRITTEN TO THE NODE, NOT HELD IN STATE. It depends on
  // the card's own measured height, so state would mean render, measure,
  // setState, render again: a cascading render that the lint rule is right
  // to object to, and a visible jump on a slow frame. The card starts
  // hidden and one layout pass both measures it and reveals it, so it never
  // paints in the wrong place.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight || 260;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + 8;
    if (left + width + MARGIN > vw) left = anchor.left - width - 8;
    if (left < MARGIN) left = Math.max(MARGIN, Math.min(vw - width - MARGIN, anchor.left));
    let top = anchor.top;
    if (top + h + MARGIN > vh) top = Math.max(MARGIN, vh - h - MARGIN);
    el.style.top = `${top}px`;
    el.style.insetInlineStart = `${left}px`;
    el.style.visibility = "visible";
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    // Deferred by a frame so the very click that opened it does not close it.
    const t = window.setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => { window.clearTimeout(t); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ariaLabel}
      className="pln-pop os-chrome"
      style={{ width, top: anchor.top, insetInlineStart: anchor.left, visibility: "hidden" }}
    >
      {children}
    </div>
  );
}

function PopHeader({ kind, onClose, right }: { kind: string; onClose: () => void; right?: ReactNode }) {
  return (
    <div className="pln-pop__head">
      <span className="pln-pop__kind">{kind}</span>
      {right}
      <button type="button" className="pln-pop__x" onClick={onClose} aria-label="Close">
        <X aria-hidden />
      </button>
    </div>
  );
}

/* ─────────────────────────── personal event ─────────────────────────── */

export interface EventPopoverProps {
  event: CalEvent;
  anchor: DOMRect;
  onClose: () => void;
  /** Something was written, so the page refetches its range. */
  onChanged: () => void;
  timeFormat: "12h" | "24h" | null;
  /** The viewer's zone, for the date and time fields. */
  toLocalFields: (iso: string) => { dayKey: string; hhmm: string };
  toInstant: (dayKey: string, hhmm: string) => Date;
  /** The event's own description, which only the detail read carries. */
  description?: string | null;
}

export function EventPopover({
  event, anchor, onClose, onChanged, toLocalFields, toInstant,
}: EventPopoverProps) {
  const id = event.id.replace(/^cal:/, "");
  const startFields = toLocalFields(event.start);
  const endFields = toLocalFields(event.end);

  const [title, setTitle] = useState(event.title);
  // The description is not on the grid feed (it would be a paragraph per
  // block on a week read), so the popover fetches the one row it is about.
  // Until it arrives the field is disabled rather than empty-and-editable,
  // which is what would let a blur overwrite real text with "".
  const [description, setDescription] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [kind, setKind] = useState<CalendarEventKindWord>(
    (CALENDAR_EVENT_KINDS as readonly string[]).includes(event.status ?? "")
      ? (event.status as CalendarEventKindWord)
      : "EVENT",
  );
  const [dayKey, setDayKey] = useState(startFields.dayKey);
  const [startT, setStartT] = useState(startFields.hhmm);
  const [endT, setEndT] = useState(endFields.hhmm);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [confirming, setConfirming] = useState(false);
  const lastPatch = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await apiFetch<{ event?: { description?: string | null } }>(`/api/calendar/events/${id}`);
      if (!alive) return;
      setDescription(r.ok ? (r.data.event?.description ?? "") : "");
    })();
    return () => { alive = false; };
  }, [id]);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    lastPatch.current = patch;
    setState("saving");
    const r = await apiFetch(`/api/calendar/events/${id}`, { method: "PATCH", json: patch, keepalive: true });
    if (!r.ok) { setState("failed"); return; }
    setState("saved");
    onChanged();
  }, [id, onChanged]);

  const saveTimes = useCallback((next: { dayKey?: string; startT?: string; endT?: string }) => {
    const d = next.dayKey ?? dayKey;
    const s = next.startT ?? startT;
    const e = next.endT ?? endT;
    void save({ startAt: toInstant(d, s).toISOString(), endAt: toInstant(d, e).toISOString() });
  }, [dayKey, startT, endT, save, toInstant]);

  async function remove() {
    setState("saving");
    const r = await apiFetch(`/api/calendar/events/${id}`, { method: "DELETE", keepalive: true });
    if (!r.ok) { setState("failed"); setConfirming(false); return; }
    onChanged();
    onClose();
  }

  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} ariaLabel={`Event: ${event.title}`}>
      <PopHeader
        kind={CALENDAR_EVENT_KIND_LABEL[kind]}
        onClose={onClose}
        right={<SaveState state={state} onRetry={() => { if (lastPatch.current) void save(lastPatch.current); }} />}
      />
      <div className="pln-pop__body">
        <input
          className="pln-pop__title"
          value={title}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() !== event.title) void save({ title }); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        <SegmentedControl
          label="Kind"
          size="sm"
          value={kind}
          options={CALENDAR_EVENT_KINDS.map((k) => ({ value: k, label: CALENDAR_EVENT_KIND_LABEL[k] }))}
          onChange={(v) => { setKind(v); void save({ kind: v }); }}
        />
        {/* THE PRODUCT'S OWN PICKERS, NOT THE OPERATING SYSTEM'S. A native
            <input type=date> reads in the machine's locale and a native
            <input type=time> ignores home.locale.timeFormat, so this card
            printed "23/09/2026" on a page whose period label two rows up
            read "20 to 26 Sep 2026" (design-system 5.6, and the same rule
            the meeting detail's When row already follows). */}
        <div className="pln-pop__row">
          <span className="pln-pop__rowlabel">Date</span>
          <DateField
            value={dayKey}
            onChange={(v) => { if (!v) return; setDayKey(v); saveTimes({ dayKey: v }); }}
            allowClear={false}
            size="sm"
            ariaLabel="Date"
            className="min-w-0 flex-1"
          />
        </div>
        {!event.allDay ? (
          <div className="pln-pop__row">
            <span className="pln-pop__rowlabel">Time</span>
            <span className="pln-pop__times">
              <TimeField
                value={startT}
                onChange={(v) => { setStartT(v); saveTimes({ startT: v }); }}
                label="Start time"
                width={92}
              />
              <em>to</em>
              <TimeField
                value={endT}
                onChange={(v) => { setEndT(v); saveTimes({ endT: v }); }}
                label="End time"
                width={92}
              />
            </span>
          </div>
        ) : (
          <p className="pln-pop__note">All day</p>
        )}

        {/* Description. The New event modal has always written one; nothing
            in the unit read it back, so a description typed at create time
            was stored and then unreachable for ever. */}
        <label className="pln-pop__desc">
          <span>Description</span>
          <textarea
            rows={2}
            value={description ?? ""}
            disabled={description === null}
            placeholder={description === null ? "Reading it" : "Add a note"}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => { if (description !== null) void save({ description }); }}
          />
        </label>
      </div>
      <div className="pln-pop__foot">
        {confirming ? (
          <>
            <span className="pln-pop__confirm">Delete this event?</span>
            <button type="button" className="pln-pop__danger" onClick={() => { void remove(); }}>Delete</button>
            <button type="button" className="pln-pop__ghost" onClick={() => setConfirming(false)}>Keep</button>
          </>
        ) : (
          <>
            {/* "Move to..." is the spec's named alternative to dragging the
                block: without it there is no keyboard or touch route to
                rescheduling an event at all (spec-planner section 2, P-10). */}
            <span className="pln-pop__moveto">
              <button
                type="button"
                className="pln-pop__ghost"
                aria-expanded={moveOpen}
                onClick={() => setMoveOpen((o) => !o)}
              >
                <MoveRight aria-hidden /> Move to...
              </button>
              {moveOpen ? (
                <span className="pln-pop__movefields">
                  <DateField
                    value={dayKey}
                    onChange={(v) => { if (!v) return; setDayKey(v); saveTimes({ dayKey: v }); setMoveOpen(false); }}
                    allowClear={false}
                    size="sm"
                    ariaLabel="Move to date"
                  />
                  {!event.allDay ? (
                    <TimeField
                      value={startT}
                      onChange={(v) => {
                        // Keep the length: moving a 30 minute block must not
                        // make it end before it starts.
                        const span = Math.max(15, minutesOf(endT) - minutesOf(startT));
                        setStartT(v);
                        const nextEnd = hhmmOf(Math.min(24 * 60, minutesOf(v) + span));
                        setEndT(nextEnd);
                        saveTimes({ startT: v, endT: nextEnd });
                        setMoveOpen(false);
                      }}
                      label="Move to time"
                      width={92}
                    />
                  ) : null}
                </span>
              ) : null}
            </span>
            <button type="button" className="pln-pop__danger" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden /> Delete
            </button>
          </>
        )}
      </div>
    </AnchoredPopover>
  );
}

/** "HH:mm" to minutes past midnight, and back. Local to the Move control. */
function minutesOf(v: string): number {
  const [h, m] = String(v).split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
function hhmmOf(total: number): string {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(total)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function SaveState({ state, onRetry }: { state: "idle" | "saving" | "saved" | "failed"; onRetry: () => void }) {
  if (state === "saving") return <span className="pln-pop__save"><Dots variant="pending" /> Saving</span>;
  if (state === "saved") return <span className="pln-pop__save"><Check aria-hidden /> Saved</span>;
  if (state === "failed") {
    return (
      <span className="pln-pop__save is-bad">
        Not saved
        <button type="button" onClick={onRetry}>Retry</button>
      </span>
    );
  }
  return null;
}

/* ─────────────────────────── external event ─────────────────────────── */

export function ExternalEventPopover({
  event, anchor, onClose, timeRange,
}: {
  event: CalEvent;
  anchor: DOMRect;
  onClose: () => void;
  timeRange: string;
}) {
  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} ariaLabel={`Google event: ${event.title}`}>
      <PopHeader kind={KIND_LABEL.external} onClose={onClose} />
      <div className="pln-pop__body">
        <p className="pln-pop__readtitle">{event.title}</p>
        <p className="pln-pop__note">{event.allDay ? "All day" : timeRange}</p>
        {event.busyOnly ? (
          <p className="pln-pop__note">
            This person keeps their event titles private, so their calendar shows only that they are busy.
          </p>
        ) : (
          <p className="pln-pop__note">
            This event comes from Google Calendar. Edit it there and the change appears here after the next sync.
          </p>
        )}
        <a
          className="pln-pop__link"
          href="https://calendar.google.com"
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink aria-hidden /> Open Google Calendar
        </a>
      </div>
    </AnchoredPopover>
  );
}

/* ───────────────────────────── reminder ───────────────────────────── */

/** The snooze menu the bell, the fired card and this popover all share. */
export const SNOOZE_CHOICES: ReadonlyArray<{ label: string; minutes: () => number }> = [
  { label: "10 minutes", minutes: () => 10 },
  { label: "1 hour", minutes: () => 60 },
  { label: "This evening", minutes: () => minutesUntil(18, 0) },
  { label: "Tomorrow 9:00", minutes: () => minutesUntil(9, 0, 1) },
];

export { minutesUntil };

export function ReminderPopover({
  event, anchor, onClose, onChanged, when,
}: {
  event: CalEvent;
  anchor: DOMRect;
  onClose: () => void;
  onChanged: () => void;
  when: string;
}) {
  const id = event.id.replace(/^reminder:/, "");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setFailed(false);
    const r = await apiFetch(`/api/reminders/${id}`, { method: "PATCH", json: body, keepalive: true });
    setBusy(false);
    if (!r.ok) { setFailed(true); return; }
    window.dispatchEvent(new CustomEvent("workwrk:reminders-changed"));
    onChanged();
    onClose();
  }, [id, onChanged, onClose]);

  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} ariaLabel={`Reminder: ${event.title}`}>
      <PopHeader kind={KIND_LABEL.reminder} onClose={onClose} />
      <div className="pln-pop__body">
        <p className="pln-pop__readtitle">
          <AlarmClock aria-hidden /> {event.title}
        </p>
        <p className="pln-pop__note">{when}</p>
        <div className="pln-pop__snooze">
          <span className="pln-pop__snoozelabel"><Clock aria-hidden /> Snooze</span>
          {SNOOZE_CHOICES.map((s) => (
            <button key={s.label} type="button" disabled={busy} onClick={() => { void act({ snoozeMinutes: s.minutes() }); }}>
              {s.label}
            </button>
          ))}
        </div>
        {failed ? (
          <p className="pln-pop__bad">Couldn&rsquo;t update the reminder. Try again.</p>
        ) : null}
      </div>
      <div className="pln-pop__foot">
        <button type="button" className="pln-pop__ghost" disabled={busy} onClick={() => { void act({ action: "dismiss" }); }}>
          <Check aria-hidden /> Done
        </button>
      </div>
    </AnchoredPopover>
  );
}

/* ─────────────────────────── month day list ─────────────────────────── */

export function DayListPopover({
  dayKey, label, events, anchor, onClose, onOpen,
}: {
  dayKey: string;
  label: string;
  events: CalEvent[];
  anchor: DOMRect;
  onClose: () => void;
  onOpen: (e: CalEvent, anchor: DOMRect) => void;
}) {
  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} ariaLabel={`Everything on ${label}`} width={360} layerId="planner-day-list">
      <PopHeader kind={label} onClose={onClose} />
      <div className="pln-pop__daylist">
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            className="pln-pop__dayrow"
            onClick={(ev) => { onClose(); onOpen(e, ev.currentTarget.getBoundingClientRect()); }}
          >
            <i className="pln-pop__daydot" style={{ background: kindTone(e.kind) }} aria-hidden />
            <span>{e.title}</span>
            <em>{KIND_LABEL[e.kind]}</em>
          </button>
        ))}
        {events.length === 0 ? <p className="pln-pop__note">Nothing on {label}.</p> : null}
      </div>
      <span hidden data-day-key={dayKey} />
    </AnchoredPopover>
  );
}
