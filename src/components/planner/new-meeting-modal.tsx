"use client";

// NewMeetingModal (spec-planner.md section 3): the form that replaced
// "New meeting" minting an "Untitled meeting" at the top of the next hour
// with nobody in it and then reloading the whole document to reach it.
//
// WHAT CHANGED, EXACTLY. Before this, the button POSTed a hard-coded body
// and then did `window.location.href = ...`, so a person got a meeting
// called "Untitled meeting" with one attendee (themselves) and lost the
// shell, the rail and any call in the dock on the way to it. Here they say
// what it is, when, how long, who is in it and what it is about, and the
// navigation is a client push.
//
// THE PEOPLE PICKER reads GET /api/people/pick (usePeoplePicker), the read
// spec-planner names: active people in the whole workspace, searched as the
// person types. It used to read /api/users?scope=all, which answers anybody
// below an org-wide level with their own report tree, so an Employee could
// invite nobody but themselves to a meeting.
//
// A FAILED CREATE KEEPS THE MODAL OPEN with everything typed and a Retry.
// Losing a filled-in form to a toast that fades is the exact save-path
// failure the data-integrity rule forbids.

import { useEffect, useMemo, useState } from "react";
import { Dots } from "@/components/ui/dots";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { DateTimeField } from "@/components/ui/date-time-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { apiFetchWithRetry } from "@/lib/api-fetch";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { zonedInputToIso, zonedInputValue } from "@/lib/zoned-input";
import {
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  type MeetingTypeWord,
} from "@/lib/meeting-type";
import { MEETING_LENGTHS } from "@/lib/meeting-list";
import { usePeoplePicker } from "@/components/people/use-people-picker";

type UserLite = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null };

function fullName(u: UserLite): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || (u.email ?? "Someone");
}

/**
 * The next whole hour.
 *
 * Rounded on the INSTANT, not on the browser's wall clock: every zone this
 * product supports is a whole or half hour from UTC, so the top of the hour
 * is the top of the hour everywhere, and the field then renders it in the
 * viewer's own zone (src/lib/zoned-input.ts).
 */
function nextHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export interface NewMeetingModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new meeting's id. The caller navigates. */
  onCreated: (id: string) => void;
  /** Prefill the start, from a calendar sweep or a day cell. */
  initialStart?: Date;
}

export function NewMeetingModal({ open, onClose, onCreated, initialStart }: NewMeetingModalProps) {
  const tz = useDatePrefs().timezone;
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingTypeWord>("ADHOC");
  const [when, setWhen] = useState("");
  const [length, setLength] = useState<number>(30);
  const [customLength, setCustomLength] = useState("");
  const [agenda, setAgenda] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [typeOpen, setTypeOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open, so a cancelled meeting does not come back typed.
  useEffect(() => {
    if (!open) return;
    // On the next tick, so the effect body sets no state inside the render
    // that opened the dialog (react-hooks/set-state-in-effect).
    const t = setTimeout(() => {
      setTitle("");
      setType("ADHOC");
      setWhen(zonedInputValue(initialStart ?? nextHour(), tz));
      setLength(30);
      setCustomLength("");
      setAgenda("");
      setPeople([]);
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [open, initialStart, tz]);

  // You are always in your own meeting, so the picker never offers you.
  const picker = usePeoplePicker({ enabled: open, reach: "active", includeSelf: false, named: people });
  const peopleOptions = useMemo<PickerOption[]>(
    () => picker.people.map((u) => ({
      value: u.id,
      label: fullName(u),
      description: u.email ?? undefined,
      keywords: u.email ?? undefined,
    })),
    [picker.people],
  );

  const minutes = length === -1 ? Number(customLength) : length;
  const validMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60;
  const canCreate = title.trim().length > 0 && when.length > 0 && validMinutes && !saving;

  async function create() {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    // The typed wall clock is read as the VIEWER'S zone, so a meeting set
    // for 10:00 is 10:00 where they are, whatever the browser is set to.
    const scheduledAtIso = zonedInputToIso(when, tz);
    if (!scheduledAtIso) {
      setSaving(false);
      setError("That date could not be read. Pick a date and a time.");
      return;
    }
    const r = await apiFetchWithRetry<{ data?: { id: string } } | { id: string }>(
      "/api/meetings",
      {
        method: "POST",
        json: {
          title: title.trim(),
          type,
          scheduledAt: scheduledAtIso,
          duration: Math.round(minutes),
          agenda: agenda.trim() || undefined,
          attendeeIds: people,
        },
        keepalive: true,
      },
      { attempts: 2, retryWrites: false },
    );
    setSaving(false);
    if (!r.ok) {
      // The modal STAYS OPEN with everything typed still in it.
      setError(r.error);
      return;
    }
    const raw = r.data as Record<string, unknown>;
    const made = (raw.data ?? raw) as { id?: string };
    if (!made.id) { setError("The meeting was created but its address came back empty. Open Meetings to find it."); return; }
    onCreated(made.id);
  }

  const chosenNames = people.map((id) => picker.nameOf(id));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      {/* 560, one of design-system section 5's four modal sizes. `max-w-xl`
          resolved to 504 under the product's 14px root, which is not any of
          them. */}
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-sm text-ink-2">
          Title
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); void create(); } }}
            placeholder="Weekly review"
            className="h-9 rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          {/* The product's own date and time pickers, not the operating
              system's: a native datetime field renders the browser's format
              and ignores home.locale (design-system section 5). */}
          <div className="flex flex-col gap-1 text-sm text-ink-2">
            When
            <DateTimeField label="When" value={when} onChange={setWhen} />
          </div>

          <div className="relative flex flex-col gap-1 text-sm text-ink-2">
            Type
            <button
              type="button"
              onClick={() => setTypeOpen((o) => !o)}
              className="h-9 w-[160px] truncate rounded-md border border-line-strong bg-raised px-2 text-start text-base text-ink hover:bg-hover"
            >
              {MEETING_TYPE_LABELS[type]}
            </button>
            <Picker
              open={typeOpen}
              onClose={() => setTypeOpen(false)}
              ariaLabel="Meeting type"
              selected={type}
              sections={[{ options: MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABELS[t] })) }]}
              onSelect={(v) => { setType(v as MeetingTypeWord); setTypeOpen(false); }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-2">Length</span>
          <SegmentedControl<string>
            value={length === -1 ? "custom" : String(length)}
            onChange={(v) => {
              if (v === "custom") { setLength(-1); setCustomLength(String(minutes || 30)); }
              else setLength(Number(v));
            }}
            options={[
              ...MEETING_LENGTHS.map((m) => ({ value: String(m), label: String(m) })),
              { value: "custom", label: "Custom" },
            ]}
            label="Length in minutes"
          />
          {length === -1 ? (
            <input
              type="number"
              min={1}
              max={1440}
              value={customLength}
              onChange={(e) => setCustomLength(e.target.value)}
              aria-label="Length in minutes"
              className="h-8 w-20 rounded-md border border-line-strong bg-raised px-2 text-base tabular-nums text-ink outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
          ) : null}
          <span className="text-sm text-ink-3">minutes</span>
        </div>

        <div className="relative flex flex-col gap-1 text-sm text-ink-2">
          People
          <button
            type="button"
            onClick={() => setPeopleOpen((o) => !o)}
            className="h-9 truncate rounded-md border border-line-strong bg-raised px-2 text-start text-base text-ink hover:bg-hover"
          >
            {chosenNames.length === 0
              ? "Just me"
              : chosenNames.length <= 3
                ? chosenNames.join(", ")
                : `${chosenNames.slice(0, 3).join(", ")} and ${chosenNames.length - 3} more`}
          </button>
          <Picker
            open={peopleOpen}
            onClose={() => setPeopleOpen(false)}
            multi
            ariaLabel="Attendees"
            searchPlaceholder="Search people"
            selected={people}
            alwaysSearch
            onSearchChange={picker.setQuery}
            loading={picker.loading && peopleOptions.length === 0}
            sections={[{ options: peopleOptions }]}
            onSelect={(v) => setPeople((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))}
            emptyLabel={picker.query.trim() ? "No one matches" : "Nobody to add"}
          />
          <span className="text-sm text-ink-3">
            You are always in your own meeting. A video room is created with it.
          </span>
        </div>

        <label className="flex flex-col gap-1 text-sm text-ink-2">
          Agenda
          <textarea
            rows={3}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="What are we covering?"
            className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
        </label>

        {error ? (
          <p className="flex items-center gap-2 text-sm text-danger-solid">
            <span className="flex-1">Couldn&rsquo;t create the meeting. {error}</span>
            <button type="button" onClick={() => { void create(); }} className="h-7 rounded-md border border-line-strong px-2 text-sm font-medium text-ink hover:bg-hover">
              Retry
            </button>
          </p>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => { void create(); }}
            className="h-9 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            {saving ? <Dots variant="pending" /> : "Create"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
