"use client";

// ReminderPopover — quick reminder creator opened from the topbar "Reminder"
// quick-tool (workwrk:tool event, detail "reminder"). Fires in-app + email at
// the chosen time (see /api/reminders + the ticker/cron).

import { useEffect, useState } from "react";
import { X, AlarmClock, Loader2 } from "lucide-react";
import { useOsToast } from "./toast";

function pad(n: number) { return String(n).padStart(2, "0"); }
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function inHour() { return new Date(Date.now() + 60 * 60 * 1000); }
function thisEvening() {
  const d = new Date(); d.setHours(18, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d;
}
function tomorrowMorning() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  return d;
}

export function ReminderPopover() {
  const { toast } = useOsToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => toLocalInput(inHour()));
  const [email, setEmail] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onTool(e: Event) {
      if ((e as CustomEvent).detail === "reminder") {
        setTitle(""); setWhen(toLocalInput(inHour())); setEmail(false); setOpen(true);
      }
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("workwrk:tool", onTool as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("workwrk:tool", onTool as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  async function create() {
    if (!title.trim() || saving) return;
    const remindAt = new Date(when);
    if (isNaN(remindAt.getTime())) { toast("Pick a valid time"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), remindAt: remindAt.toISOString(), notifyEmail: email }),
      });
      if (!res.ok) { toast("Couldn't set reminder"); return; }
      toast(`Reminder set for ${remindAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
      setOpen(false);
    } catch { toast("Couldn't set reminder"); }
    finally { setSaving(false); }
  }

  if (!open) return null;
  const chip = "px-2.5 py-1 rounded-md text-[12px] border border-zinc-200 dark:border-[#2A2F38] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10";

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center pt-[12vh] bg-black/30" onClick={() => setOpen(false)}>
      <div className="w-[400px] max-w-[92vw] rounded-xl bg-white dark:bg-[#181C22] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 h-12 border-b border-zinc-100 dark:border-[#2A2F38]">
          <AlarmClock className="w-4 h-4 text-[#FB5A6F]" />
          <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100 flex-1">New reminder</div>
          <button type="button" onClick={() => setOpen(false)} className="w-7 h-7 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500 dark:text-zinc-400" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            autoFocus
            placeholder="Remind me to…"
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-[#14171D] text-[14px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-zinc-400"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" className={chip} onClick={() => setWhen(toLocalInput(inHour()))}>In 1 hour</button>
            <button type="button" className={chip} onClick={() => setWhen(toLocalInput(thisEvening()))}>This evening</button>
            <button type="button" className={chip} onClick={() => setWhen(toLocalInput(tomorrowMorning()))}>Tomorrow 9am</button>
          </div>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-[#14171D] text-[13px] text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 [color-scheme:light] dark:[color-scheme:dark]"
          />
          <label className="flex items-center gap-2 text-[13px] text-zinc-700 dark:text-zinc-200 cursor-pointer select-none">
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="accent-[#0073EA]" />
            Also email me
          </label>
        </div>
        <div className="flex justify-end gap-2 px-4 h-14 items-center border-t border-zinc-100 dark:border-[#2A2F38]">
          <button type="button" onClick={() => setOpen(false)} className="px-3 h-8 rounded-md text-[13px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10">Cancel</button>
          <button type="button" onClick={() => void create()} disabled={!title.trim() || saving} className="px-3.5 h-8 rounded-md text-[13px] font-medium text-white bg-[#0073EA] hover:bg-[#0060B9] disabled:opacity-40 inline-flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Set reminder
          </button>
        </div>
      </div>
    </div>
  );
}
