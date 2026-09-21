"use client";

// The Defaults tab of Organize (spec-process section 2 `/sops/manage`): one
// settings card "Acknowledgements" (design-system 5.4) with three autosave
// rows, each with an id the settings registry links to
// (/sops/manage?tab=defaults#process.ack.<id>; the hash scrolls the row into
// view and pulses its border once):
//
//   process.ack.statement   the attestation, read by /policies/[id] as the
//                           placeholder and by POST /api/policies/[id]/acknowledge
//   process.ack.dueDays     "Acknowledge within" days, read by AssignDialog
//                           and POST /api/policies/[id]/assignments
//   process.ack.remindDays  "Remind before due" days, read by the reminders cron
//
// Every row saves on blur through PATCH /api/settings { section: "process" }
// with an inline "Saved ✓" that fades, and reverts to the stored value when
// the save fails (settings 9.3), so nothing silently reverts and nothing
// silently sticks.

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { DEFAULT_ACK_STATEMENT, type ProcessSettings } from "@/lib/process-settings";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "error";

export function OrganizeDefaults({ value, onChanged }: { value: ProcessSettings; onChanged: (next: Partial<ProcessSettings>) => void }) {
  const { toast } = useOsToast();
  const [statement, setStatement] = useState(value.ackStatement);
  const [dueDays, setDueDays] = useState(value.ackDueDays === null ? "" : String(value.ackDueDays));
  const [remindDays, setRemindDays] = useState(String(value.ackRemindDays));
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setStatement(value.ackStatement); setDueDays(value.ackDueDays === null ? "" : String(value.ackDueDays)); setRemindDays(String(value.ackRemindDays)); }

  // The registry deep link: scroll the row into view and pulse its border once.
  const [pulse, setPulse] = useState<string | null>(null);
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash.startsWith("process.ack.")) return;
    const t = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ block: "center" });
      setPulse(hash);
      setTimeout(() => setPulse(null), 1600);
    }, 100);
    return () => clearTimeout(t);
  }, []);

  const save = async (id: string, patch: Partial<ProcessSettings>, revert: () => void) => {
    setStates((s) => ({ ...s, [id]: "saving" }));
    const r = await apiFetch("/api/settings", { method: "PATCH", json: { section: "process", data: patch } });
    if (!r.ok) {
      setStates((s) => ({ ...s, [id]: "error" }));
      revert();
      toast(r.error || "Couldn't save. The previous value is back.", { tone: "danger" });
      return;
    }
    onChanged(patch);
    setStates((s) => ({ ...s, [id]: "saved" }));
    setTimeout(() => setStates((s) => (s[id] === "saved" ? { ...s, [id]: "idle" } : s)), 2000);
  };

  return (
    <section className="rounded-lg border border-line bg-raised p-6">
      <h2 className="text-lg font-semibold text-ink">Acknowledgements</h2>
      <p className="mt-1 text-sm text-ink-2">What people confirm when they acknowledge a policy, and how long they have.</p>
      <div className="mt-4 flex flex-col gap-4">
        <Row id="process.ack.statement" label="Attestation statement" help="Shown beside the Acknowledge button on every policy that sets none of its own, and recorded with each acknowledgement." state={states["process.ack.statement"] ?? "idle"} pulse={pulse === "process.ack.statement"}>
          <textarea id="process.ack.statement" value={statement} onChange={(e) => setStatement(e.target.value)} onBlur={() => { const next = statement.trim() || DEFAULT_ACK_STATEMENT; if (next === value.ackStatement) { setStatement(next); return; } void save("process.ack.statement", { ackStatement: next }, () => setStatement(value.ackStatement)); }} rows={3} className="w-full resize-none rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" placeholder={DEFAULT_ACK_STATEMENT} />
        </Row>
        <Row id="process.ack.dueDays" label="Acknowledge within" help="Days after an assignment before it is overdue. Blank means no due date." state={states["process.ack.dueDays"] ?? "idle"} pulse={pulse === "process.ack.dueDays"}>
          <span className="inline-flex items-center gap-2">
            <input id="process.ack.dueDays" type="number" min={0} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)} onBlur={() => { const n = dueDays.trim() === "" ? null : Math.max(0, Math.min(365, Math.floor(Number(dueDays)) || 0)); if (n === value.ackDueDays) { setDueDays(n === null ? "" : String(n)); return; } void save("process.ack.dueDays", { ackDueDays: n }, () => setDueDays(value.ackDueDays === null ? "" : String(value.ackDueDays))); }} className="h-9 w-24 rounded-md border border-line-strong bg-raised px-3 text-base tabular-nums text-ink focus:outline-none focus-visible:border-brand" placeholder="None" />
            <span className="text-sm text-ink-2">days</span>
          </span>
        </Row>
        <Row id="process.ack.remindDays" label="Remind before due" help="Days before the due date the reminder goes out. 0 turns reminders off." state={states["process.ack.remindDays"] ?? "idle"} pulse={pulse === "process.ack.remindDays"}>
          <span className="inline-flex items-center gap-2">
            <input id="process.ack.remindDays" type="number" min={0} max={90} value={remindDays} onChange={(e) => setRemindDays(e.target.value)} onBlur={() => { const n = Math.max(0, Math.min(90, Math.floor(Number(remindDays)) || 0)); if (n === value.ackRemindDays) { setRemindDays(String(n)); return; } void save("process.ack.remindDays", { ackRemindDays: n }, () => setRemindDays(String(value.ackRemindDays))); }} className="h-9 w-24 rounded-md border border-line-strong bg-raised px-3 text-base tabular-nums text-ink focus:outline-none focus-visible:border-brand" />
            <span className="text-sm text-ink-2">days</span>
          </span>
        </Row>
      </div>
    </section>
  );
}

function Row({ id, label, help, state, pulse, children }: { id: string; label: string; help: string; state: SaveState; pulse: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-setting={id} className={cn("flex flex-col gap-1.5 rounded-md border p-3 transition-colors", pulse ? "border-brand" : "border-transparent")}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
        <span className="ms-auto inline-flex items-center gap-1 text-xs font-medium" aria-live="polite">
          {state === "saving" ? <span className="text-ink-2">Saving</span> : state === "saved" ? <span className="inline-flex items-center gap-1 text-success-text"><Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> Saved</span> : state === "error" ? <span className="text-danger-text">Not saved</span> : null}
        </span>
      </div>
      <p className="text-sm text-ink-2">{help}</p>
      {children}
    </div>
  );
}
