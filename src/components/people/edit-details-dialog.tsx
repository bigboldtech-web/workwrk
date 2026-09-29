"use client";

// Edit details (spec-teams-people /people/[id], settings 9.2a): 560 on
// ui/dialog. Only the fields the server says this viewer may write render
// (the record's `access.editable`, from src/lib/people/person-fields.ts), so
// no control here is ever disabled or refused. Every field saves on its own
// the moment it changes (one PATCH per field) with an inline tick, and a
// refused field shows the server's reason under it; the footer has only
// Close. Org role, Agent and access are the Members drawer's.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { apiFetch } from "@/lib/api-fetch";
import { recordWriteQueue } from "@/lib/people/record-write-queue";
import { describeSchedule } from "@/lib/work-schedule";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { PeoplePickerField, type PickPerson } from "./person-bits";

export interface EditablePerson {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  status: string;
  role: { id: string; title: string } | null;
  department: { id: string; name: string } | null;
  office: { id: string; name: string } | null;
  manager: PickPerson | null;
  dottedManagers: PickPerson[];
  /** The record's direct reports: left out of the Dotted-line managers picker at once, before the full tree loads. */
  directReports?: Array<{ id: string }>;
  weeklyCapacityHours?: number | null;
  workSchedule?: { workdays: number[]; hoursPerDay: number } | null;
  orgSchedule?: { workdays: number[]; hoursPerDay: number } | null;
  defaultWeeklyHours?: number | null;
  profileFields?: Array<{ key: string; label: string; value: string | null }>;
  access: { editable: string[]; dottedLines: boolean; manageMembers: boolean };
}

type Opt = { id: string; label: string };
type FieldState = "idle" | "saving" | "saved" | "retrying" | { error: string };
type Side = "bottom" | "top";

/**
 * The pickers here are absolute children of their trigger (they must stay
 * inside the dialog's focus trap, no body portal), so the dialog's own
 * scroll box clips whatever hangs past its edge. FlipSlot measures the
 * trigger against that box the moment it is pressed: when the list does
 * not fit below but does fit above, it opens upward. Otherwise it opens
 * downward and the dialog scrolls it into view, because a list hanging past
 * the bottom can be scrolled to and one past the top never can.
 * PICKER_ROOM is the Picker's tallest: the search row, the 280 list, padding.
 */
const PICKER_ROOM = 340;
/** The same cap as the org chart's DOTTED_EXCLUDE_CAP (org-tree.tsx), for the same reason. */
const DOTTED_EXCLUDE_CAP = 200;
function FlipSlot({ children }: { children: (side: Side) => ReactNode }) {
  const [side, setSide] = useState<Side>("bottom");
  const measure = (el: HTMLElement) => {
    // Measure against the scrolling field area (the header and footer stay
    // put around it), falling back to the dialog for any other host.
    const box = (el.closest("[data-dialog-body]") ?? el.closest('[role="dialog"]'))?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    const below = box.bottom - r.bottom;
    const above = r.top - box.top;
    if (below < PICKER_ROOM && above >= PICKER_ROOM) { setSide("top"); return; }
    setSide("bottom");
    if (below < PICKER_ROOM) {
      // After the click has opened it, bring the whole list into view, and
      // again as it grows: the people list arrives a moment after opening.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const pop = el.querySelector('[role="listbox"]')?.parentElement;
        if (!pop) return;
        const reveal = () => pop.scrollIntoView({ block: "nearest" });
        reveal();
        if (typeof ResizeObserver === "undefined") return;
        const watch = new ResizeObserver(reveal);
        watch.observe(pop);
        setTimeout(() => watch.disconnect(), 1500);
      }));
    }
  };
  // Only a press on the closed trigger measures: a click on an option or a
  // space typed in the search box must never move a list that is open.
  const opening = (e: { target: EventTarget; currentTarget: HTMLElement }) => {
    const trigger = (e.target as HTMLElement).closest?.('[aria-haspopup="listbox"]');
    if (trigger && e.currentTarget.contains(trigger) && trigger.getAttribute("aria-expanded") !== "true") measure(e.currentTarget);
  };
  return (
    <div
      onPointerDownCapture={opening}
      onKeyDownCapture={(e: KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" || e.key === " ") opening(e); }}
    >
      {children(side)}
    </div>
  );
}

function OptionField({ value, options, onPick, ariaLabel, noneLabel, footer, side = "bottom" }: { value: string | null; options: Opt[]; onPick: (id: string | null) => void; ariaLabel: string; noneLabel: string; footer?: ReactNode; side?: Side }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <div className="relative">
      <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-ink hover:border-line-strong">
        <span className={`min-w-0 flex-1 truncate text-start ${current ? "" : "text-ink-3"}`}>{current?.label ?? noneLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={ariaLabel}
        selected={value ?? "__none__"}
        searchPlaceholder="Search"
        sections={[{ options: [{ value: "__none__", label: noneLabel }, ...options.map((o) => ({ value: o.id, label: o.label }))] }]}
        onSelect={(v) => { setOpen(false); onPick(v === "__none__" ? null : v); }}
        footer={footer}
        side={side}
        className={side === "top" ? "absolute start-0 z-50" : "absolute start-0 top-10 z-50"}
      />
    </div>
  );
}

const WEEKDAYS: Array<{ d: number; short: string; long: string }> = [
  { d: 1, short: "M", long: "Monday" }, { d: 2, short: "T", long: "Tuesday" }, { d: 3, short: "W", long: "Wednesday" },
  { d: 4, short: "T", long: "Thursday" }, { d: 5, short: "F", long: "Friday" }, { d: 6, short: "S", long: "Saturday" }, { d: 0, short: "S", long: "Sunday" },
];

/**
 * A person's own working days and hours over the org schedule (decided
 * addition a). "Org schedule" stores null; "Their own" starts from the org's
 * days and hours so nothing jumps.
 */
function ScheduleField({ value, org, onChange }: {
  value: { workdays: number[]; hoursPerDay: number } | null;
  org: { workdays: number[]; hoursPerDay: number } | null;
  onChange: (next: { workdays: number[]; hoursPerDay: number } | null) => void;
}) {
  const base = org ?? { workdays: [1, 2, 3, 4, 5], hoursPerDay: 8 };
  const [hours, setHours] = useState(String(value?.hoursPerDay ?? base.hoursPerDay));
  const own = value !== null;
  const segment = "inline-flex h-7 items-center rounded-md px-2.5 text-sm font-medium";
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Work schedule" className="inline-flex w-fit gap-0.5 rounded-md border border-line p-0.5">
        <button type="button" role="radio" aria-checked={!own} className={`${segment} ${!own ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover"}`} onClick={() => { if (own) onChange(null); }}>
          Org schedule
        </button>
        <button type="button" role="radio" aria-checked={own} className={`${segment} ${own ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover"}`} onClick={() => { if (!own) onChange({ workdays: [...base.workdays], hoursPerDay: base.hoursPerDay }); }}>
          Their own
        </button>
      </div>
      {own && value ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Working days">
            {WEEKDAYS.map((w) => {
              const on = value.workdays.includes(w.d);
              return (
                <button
                  key={w.d}
                  type="button"
                  aria-pressed={on}
                  aria-label={w.long}
                  title={w.long}
                  onClick={() => onChange({ ...value, workdays: on ? value.workdays.filter((x) => x !== w.d) : [...value.workdays, w.d].sort((a, b) => a - b) })}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm font-medium ${on ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-hover"}`}
                >
                  {w.short}
                </button>
              );
            })}
          </div>
          <input
            type="number" inputMode="decimal" min={0.5} max={24} step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            onBlur={() => {
              const h = Number(hours);
              if (!Number.isFinite(h) || h <= 0 || h > 24) { setHours(String(value.hoursPerDay)); return; }
              if (h !== value.hoursPerDay) onChange({ ...value, hoursPerDay: h });
            }}
            aria-label="Hours a day"
            className="h-7 w-16 rounded-md border border-line bg-raised px-2 text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
          />
          <span className="text-sm text-ink-2">hours a day</span>
        </div>
      ) : (
        <span className="text-sm text-ink-2">{describeSchedule(base)}</span>
      )}
    </div>
  );
}

function Row({ label, state, children }: { label: string; state: FieldState; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr_20px] items-start gap-3 py-1.5">
      <span className="pt-1.5 text-sm font-medium text-ink-2">{label}</span>
      <div className="min-w-0">
        {children}
        {typeof state === "object" ? <p role="alert" className="mt-1 text-xs text-danger-text">{state.error}</p> : null}
        {state === "retrying" ? <p role="status" className="mt-1 text-xs text-danger-text">Not saved, retrying. It saves when you reconnect, even if you close this.</p> : null}
      </div>
      <span className="pt-2" aria-live="polite">
        {state === "saved" ? <Check className="h-4 w-4 text-success-text" aria-label="Saved" /> : state === "saving" ? <span className="sr-only">Saving</span> : null}
      </span>
    </div>
  );
}

export function EditDetailsDialog({ person, onClose, onSaved }: { person: EditablePerson; onClose: () => void; onSaved: () => void }) {
  const { openSettings } = useSettingsNav();
  const can = (f: string) => person.access.editable.includes(f);
  const [roles, setRoles] = useState<Opt[]>([]);
  const [depts, setDepts] = useState<Opt[]>([]);
  const [offices, setOffices] = useState<Opt[]>([]);
  const [state, setState] = useState<Record<string, FieldState>>({});
  const [roleId, setRoleId] = useState(person.role?.id ?? null);
  const [deptId, setDeptId] = useState(person.department?.id ?? null);
  const [officeId, setOfficeId] = useState(person.office?.id ?? null);
  const [manager, setManager] = useState<PickPerson | null>(person.manager);
  const [dotted, setDotted] = useState<PickPerson[]>(person.dottedManagers);
  // Everyone below this person (solid and dotted, any depth), from the
  // dotted-lines route. None of them may be a dotted-line manager: that would
  // put the person in their own report's tree and let the report read their
  // people data. Direct reports are known at once; the full tree follows.
  const [below, setBelow] = useState<string[]>(() => (person.directReports ?? []).map((r) => r.id));
  const [capacity, setCapacity] = useState(person.weeklyCapacityHours == null ? "" : String(person.weeklyCapacityHours));
  const [dob, setDob] = useState(person.dateOfBirth && !person.dateOfBirth.startsWith("--") ? person.dateOfBirth : "");
  const [firstName, setFirstName] = useState(person.firstName);
  const [lastName, setLastName] = useState(person.lastName);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [changed, setChanged] = useState(false);
  const [schedule, setSchedule] = useState<{ workdays: number[]; hoursPerDay: number } | null>(person.workSchedule ?? null);
  const [profile, setProfile] = useState<Record<string, string>>(() =>
    Object.fromEntries((person.profileFields ?? []).map((f) => [f.key, f.value ?? ""])),
  );
  const [status, setStatus] = useState(person.status);

  useEffect(() => {
    if (!person.access.dottedLines) return;
    let live = true;
    void apiFetch<{ below?: string[] }>(`/api/users/${person.id}/dotted-lines`, { cache: "no-store" }).then((r) => {
      if (live && r.ok && Array.isArray(r.data.below)) setBelow((cur) => [...new Set([...cur, ...r.data.below!])]);
    });
    return () => { live = false; };
  }, [person.id, person.access.dottedLines]);

  useEffect(() => {
    const load = async () => {
      const [r, d, o] = await Promise.all([
        can("roleId") ? apiFetch<Array<{ id: string; title: string }>>("/api/roles", { cache: "no-store" }) : null,
        can("departmentId") ? apiFetch<Array<{ id: string; name: string }>>("/api/departments?fresh=1", { cache: "no-store" }) : null,
        can("officeId") ? apiFetch<Array<{ id: string; name: string; city?: string | null }> | { data: Array<{ id: string; name: string; city?: string | null }> }>("/api/offices", { cache: "no-store" }) : null,
      ]);
      if (r?.ok) setRoles((Array.isArray(r.data) ? r.data : []).map((x) => ({ id: x.id, label: x.title })));
      if (d?.ok) setDepts((Array.isArray(d.data) ? d.data : []).map((x) => ({ id: x.id, label: x.name })));
      if (o?.ok) {
        const list = Array.isArray(o.data) ? o.data : o.data.data ?? [];
        setOffices(list.map((x) => ({ id: x.id, label: x.city ? `${x.name} · ${x.city}` : x.name })));
      }
    };
    void load();
    // The pickers load once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every field write goes through the record write queue: a dropped
  // connection keeps the change and retries (on a backoff, and at once on
  // reconnect), even after this dialog closes, which is what the shell's
  // offline banner promises. A refusal is said under the field and dropped.
  const closedRef = useRef(false);
  async function save(field: string, body: Record<string, unknown>, url = `/api/users/${person.id}`, method: "PATCH" | "PUT" = "PATCH"): Promise<boolean> {
    setState((s) => ({ ...s, [field]: "saving" }));
    const r = await recordWriteQueue().write(method, url, body, {
      onRetrying: () => { if (!closedRef.current) setState((s) => ({ ...s, [field]: "retrying" })); },
    });
    if (!r.ok) {
      if (!closedRef.current) setState((s) => ({ ...s, [field]: { error: r.error || "Not saved" } }));
      return false;
    }
    if (closedRef.current) {
      // Landed after the dialog closed: refresh the record behind it.
      onSaved();
      return true;
    }
    setState((s) => ({ ...s, [field]: "saved" }));
    setChanged(true);
    return true;
  }

  const close = () => { closedRef.current = true; if (changed) onSaved(); onClose(); };
  const personal = can("firstName") || can("lastName") || can("phone");

  return (
    <Dialog open onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="flex max-w-[560px] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>Each change saves as you make it.</DialogDescription>
        </DialogHeader>
        {/* Only the fields scroll: the title, the close X and the Close
            footer stay in view on a short screen (the CSV import dialog's
            pattern). The box fills the dialog's 85vh, and FlipSlot measures
            each picker against it, so a list opens where it fits and is
            scrolled into view when it fits nowhere. */}
        <div data-dialog-body className="-mx-5 flex min-h-0 flex-1 flex-col overflow-y-auto px-5">
          {personal ? (
            <>
              {can("firstName") ? (
                <Row label="First name" state={state.firstName ?? "idle"}>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} onBlur={() => { if (firstName.trim() && firstName !== person.firstName) void save("firstName", { firstName }); }} aria-label="First name" className="h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none" />
                </Row>
              ) : null}
              {can("lastName") ? (
                <Row label="Last name" state={state.lastName ?? "idle"}>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} onBlur={() => { if (lastName.trim() && lastName !== person.lastName) void save("lastName", { lastName }); }} aria-label="Last name" className="h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none" />
                </Row>
              ) : null}
              {can("phone") ? (
                <Row label="Phone" state={state.phone ?? "idle"}>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => { if (phone !== (person.phone ?? "")) void save("phone", { phone: phone || null }); }} aria-label="Phone" maxLength={40} className="h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none" />
                </Row>
              ) : null}
            </>
          ) : null}
          {can("roleId") ? (
            <Row label="Job title" state={state.roleId ?? "idle"}>
              <FlipSlot>{(side) => <OptionField side={side} ariaLabel="Job title" noneLabel="No job title" value={roleId} options={roles} onPick={(v) => { setRoleId(v); void save("roleId", { roleId: v }); }} />}</FlipSlot>
            </Row>
          ) : null}
          {can("departmentId") ? (
            <Row label="Department" state={state.departmentId ?? "idle"}>
              <FlipSlot>{(side) => <OptionField side={side} ariaLabel="Department" noneLabel="No department" value={deptId} options={depts} onPick={(v) => { setDeptId(v); void save("departmentId", { departmentId: v }); }} />}</FlipSlot>
            </Row>
          ) : null}
          {can("officeId") ? (
            <Row label="Office" state={state.officeId ?? "idle"}>
              <FlipSlot>{(side) => <OptionField side={side} ariaLabel="Office" noneLabel="No office" value={officeId} options={offices} onPick={(v) => { setOfficeId(v); void save("officeId", { officeId: v }); }} />}</FlipSlot>
            </Row>
          ) : null}
          {can("managerId") ? (
            <Row label="Reports to" state={state.managerId ?? "idle"}>
              <FlipSlot>{(side) => (
              <PeoplePickerField
                side={side}
                ariaLabel="Reports to"
                managersOnly
                exclude={[person.id]}
                value={manager ? [manager.id] : []}
                people={manager ? [manager] : []}
                placeholder="Nobody"
                onChange={(_ids, picked) => {
                  const prev = manager;
                  const next = picked[0] ?? null;
                  setManager(next);
                  void save("managerId", { managerId: next?.id ?? null }).then((ok) => { if (!ok) setManager(prev); });
                }}
              />
              )}</FlipSlot>
            </Row>
          ) : null}
          {person.access.dottedLines ? (
            <Row label="Dotted-line managers" state={state.dotted ?? "idle"}>
              <FlipSlot>{(side) => (
              <PeoplePickerField
                side={side}
                ariaLabel="Dotted-line managers"
                multiple
                managersOnly
                // The cap keeps the /api/people/pick query string short for
                // someone with a whole org below them; the server's
                // dotted_line_cycle check still refuses anyone past it.
                exclude={[person.id, ...(manager ? [manager.id] : []), ...below.slice(0, DOTTED_EXCLUDE_CAP)]}
                value={dotted.map((d) => d.id)}
                people={dotted}
                placeholder="None"
                onChange={(ids, picked) => {
                  const prev = dotted;
                  setDotted(picked);
                  void save("dotted", { managerIds: ids }, `/api/users/${person.id}/dotted-lines`, "PUT").then((ok) => { if (!ok) setDotted(prev); });
                }}
              />
              )}</FlipSlot>
            </Row>
          ) : null}
          {can("weeklyCapacityHours") ? (
            <Row label="Weekly capacity" state={state.weeklyCapacityHours ?? "idle"}>
              <div className="flex items-center gap-2">
                <input
                  type="number" inputMode="decimal" min={0} max={168} step={0.5}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  onBlur={() => {
                    const v = capacity.trim() === "" ? null : Number(capacity);
                    if (v !== (person.weeklyCapacityHours ?? null)) void save("weeklyCapacityHours", { weeklyCapacityHours: v });
                  }}
                  placeholder={person.defaultWeeklyHours != null ? `${person.defaultWeeklyHours}` : "Org default"}
                  aria-label="Weekly capacity hours"
                  className="h-8 w-28 rounded-md border border-line bg-raised px-2 text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
                />
                <span className="text-sm text-ink-2">
                  hours a week. Blank uses {person.workSchedule ? "their schedule" : "the org default"}
                  {person.defaultWeeklyHours != null ? ` (${person.defaultWeeklyHours}h)` : ""}.
                </span>
              </div>
            </Row>
          ) : null}
          {can("workSchedule") ? (
            <Row label="Work schedule" state={state.workSchedule ?? "idle"}>
              <ScheduleField
                value={schedule}
                org={person.orgSchedule ?? null}
                onChange={(next) => {
                  const prev = schedule;
                  setSchedule(next);
                  void save("workSchedule", { workSchedule: next }).then((ok) => { if (!ok) setSchedule(prev); });
                }}
              />
            </Row>
          ) : null}
          {can("customFields")
            ? (person.profileFields ?? []).map((f) => (
                <Row key={f.key} label={f.label} state={state[`cf:${f.key}`] ?? "idle"}>
                  <input
                    value={profile[f.key] ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, [f.key]: e.target.value }))}
                    onBlur={() => {
                      const v = (profile[f.key] ?? "").trim();
                      if (v !== (f.value ?? "")) void save(`cf:${f.key}`, { customFields: { [f.key]: v || null } });
                    }}
                    maxLength={500}
                    aria-label={f.label}
                    className="h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </Row>
              ))
            : null}
          {can("dateOfBirth") ? (
            <Row label="Date of birth" state={state.dateOfBirth ?? "idle"}>
              <input type="date" value={dob} onChange={(e) => { setDob(e.target.value); void save("dateOfBirth", { dateOfBirth: e.target.value || null }); }} aria-label="Date of birth" className="h-8 rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none" />
            </Row>
          ) : null}
          {can("status") && ["ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"].includes(status) ? (
            // The old dialog's one status move: a legacy lifecycle status back
            // to Active. Deactivating is the Members drawer's.
            <Row label="Status" state={state.status ?? "idle"}>
              <div className="flex items-center gap-2 pt-1.5 text-sm text-ink">
                <span>{status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>
                <button type="button" className="text-brand-deep hover:underline" onClick={() => void save("status", { status: "ACTIVE" }).then((ok) => { if (ok) setStatus("ACTIVE"); })}>Set to Active</button>
              </div>
            </Row>
          ) : null}
          {person.access.manageMembers ? (
            <p className="mt-3 text-sm text-ink-2">
              {(person.profileFields ?? []).length === 0 ? "No profile fields yet. " : ""}
              <button type="button" className="text-brand-deep hover:underline" onClick={() => { onClose(); openSettings("/settings/structure?tab=fields"); }}>
                {(person.profileFields ?? []).length === 0 ? "Add profile fields" : "Manage profile fields"}
              </button>
              {" "}in Settings, like Employee ID or Pronouns.
            </p>
          ) : null}
          {person.access.manageMembers ? (
            <p className="mt-3 text-sm text-ink-2">
              Role and access are managed in{" "}
              <button type="button" className="text-brand-deep hover:underline" onClick={() => { onClose(); openSettings(`/settings/members?open=${person.id}`); }}>Members</button>.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
