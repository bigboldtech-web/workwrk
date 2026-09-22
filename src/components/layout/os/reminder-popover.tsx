"use client";

// ReminderCreate: the panel that sets an alarm (spec-planner.md section 2,
// Reminders, "Reminder create panel").
//
// Opened by the top bar "+" > Reminder, the Planner sidebar "+" > Reminder
// and the Calendar's New event split menu, all three through the shell's
// `workwrk:tool` window event with detail "reminder", which is the contract
// that already existed and is deliberately unchanged.
//
// WHAT PHASE 4 CHANGED:
//
//   * FOUR QUICK CHIPS, NOT THREE, and they are the SAME four the fired
//     card and the calendar's reminder popover offer, imported from one
//     place so the three surfaces cannot drift apart.
//   * THE CHOSEN TIME IS SHOWN as a sentence in the viewer's own format,
//     under the chips, rather than left to be read off a raw
//     `datetime-local` control. The control is still there, because "pick
//     an exact time" is a real thing to want.
//   * "Also email me" REMEMBERS the last choice in
//     `home.notifications.reminderEmailDefault`, which is the open question
//     spec-planner section 2 Reminders answers that way.
//   * TOKENS, NOT HEXES, and the toast on success carries an Undo that
//     actually dismisses the reminder it just made.
//
// The Esc key goes through the shell's LayerStack, not a listener here.

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, X } from "lucide-react";
import { useOsToast } from "./toast";
import { useLayer, useOsShell } from "./shell-context";
import { Dots } from "@/components/ui/dots";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { useEffectiveLocale } from "@/hooks/use-effective-locale";
import { hhmm, minutesOfHhmm } from "@/lib/calendar-blocks";
import { zonedDayKey, zonedMinutesOfDay } from "@/lib/calendar-grid";
import { SNOOZE_CHOICES } from "@/components/planner/event-popover";

/**
 * A Date as the string a `datetime-local` wants, IN THE VIEWER'S ZONE.
 *
 * `d.getHours()` would read the machine's zone, so a person whose
 * preference says New York on a laptop set to Kolkata typed "4:31 PM" and
 * the panel then told them, correctly and uselessly, that it would go off
 * at 7:01 AM. The control and the sentence under it now agree because both
 * are the preference's zone.
 */
function toZonedInput(d: Date, zone: string | null): string {
  return `${zonedDayKey(d, zone)}T${hhmm(zonedMinutesOfDay(d, zone))}`;
}

/** The four quick chips, expressed as the instants they mean. */
const QUICK = SNOOZE_CHOICES.map((c) => ({
  label: c.label === "10 minutes" ? "In 10 minutes" : c.label === "1 hour" ? "In 1 hour" : c.label,
  at: () => new Date(Date.now() + c.minutes() * 60_000),
}));

export function ReminderPopover() {
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const fmt = useFormat();
  const locale = useEffectiveLocale();
  const zone = locale.timezone;

  /** The instant a `datetime-local` string means, read in the viewer's zone. */
  const parseZoned = useCallback((v: string): Date => {
    const [day, time] = String(v).split("T");
    if (!day || !time) return new Date(NaN);
    return locale.instantAt(day, minutesOfHhmm(time));
  }, [locale]);

  const emailDefault = prefs.home.notifications?.reminderEmailDefault === true;

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => toZonedInput(new Date(Date.now() + 3_600_000), zone));
  const [email, setEmail] = useState(emailDefault);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const onTool = (e: Event) => {
      if ((e as CustomEvent).detail !== "reminder") return;
      setTitle("");
      setWhen(toZonedInput(new Date(Date.now() + 3_600_000), zone));
      setEmail(emailDefault);
      setFailure(null);
      setOpen(true);
    };
    window.addEventListener("workwrk:tool", onTool as EventListener);
    return () => window.removeEventListener("workwrk:tool", onTool as EventListener);
  }, [emailDefault, zone]);

  useLayer(open, { id: "reminder-create", kind: "popover", close: () => setOpen(false) });

  const create = useCallback(async () => {
    if (!title.trim() || saving) return;
    const remindAt = parseZoned(when);
    if (Number.isNaN(remindAt.getTime())) { setFailure("Pick a time that exists."); return; }
    setSaving(true);
    setFailure(null);
    const r = await apiFetch<{ reminder?: { id: string } }>("/api/reminders", {
      method: "POST",
      json: { title: title.trim(), remindAt: remindAt.toISOString(), notifyEmail: email },
      keepalive: true,
    });
    setSaving(false);
    // A failed create KEEPS THE PANEL OPEN with what was typed: the old one
    // toasted and closed, so the sentence was gone with the failure.
    if (!r.ok) { setFailure(r.error); return; }
    setOpen(false);
    // Remember the email choice, so the switch matches what this person does.
    if (email !== emailDefault) void patchPrefs({ home: { notifications: { reminderEmailDefault: email } } });
    window.dispatchEvent(new CustomEvent("workwrk:reminders-changed"));
    const id = r.data?.reminder?.id;
    toast(`Reminder set for ${fmt.date(remindAt, "datetime")}`, {
      ...(id
        ? { onUndo: () => { void apiFetch(`/api/reminders/${id}`, { method: "DELETE", keepalive: true }).then(() => window.dispatchEvent(new CustomEvent("workwrk:reminders-changed"))); } }
        : {}),
    });
  }, [title, when, email, emailDefault, saving, patchPrefs, toast, fmt, parseZoned]);

  if (!open) return null;

  const parsed = parseZoned(when);
  const whenSentence = Number.isNaN(parsed.getTime()) ? null : fmt.date(parsed, "datetime");

  return (
    <div className="rmn os-chrome" onPointerDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New reminder"
        className="rmn__card"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="rmn__head">
          <AlarmClock aria-hidden />
          <h2>New reminder</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close"><X aria-hidden /></button>
        </header>

        <div className="rmn__body">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            autoFocus
            placeholder="Remind me to..."
            aria-label="What to be reminded about"
            className="rmn__title"
          />

          <div className="rmn__chips">
            {QUICK.map((q) => (
              <button key={q.label} type="button" onClick={() => setWhen(toZonedInput(q.at(), zone))}>{q.label}</button>
            ))}
          </div>

          <label className="rmn__row">
            <span>When</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          {whenSentence ? <p className="rmn__note">Goes off {whenSentence}.</p> : null}

          <div className="rmn__row rmn__row--switch">
            <span id="rmn-email">Also email me</span>
            <Switch checked={email} onChange={setEmail} aria-labelledby="rmn-email" />
          </div>

          {failure ? <p className="rmn__bad">Couldn&rsquo;t set it. {failure}</p> : null}
        </div>

        <footer className="rmn__foot">
          <button type="button" className="rmn__ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="rmn__primary" onClick={() => { void create(); }} disabled={!title.trim() || saving}>
            {saving ? <Dots variant="pending" /> : null}
            {failure ? "Retry" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
