"use client";

// Edit details (spec-teams-people /people/[id], settings 9.2a): 560 on
// ui/dialog. Only the fields the server says this viewer may write render
// (the record's `access.editable`, from src/lib/people/person-fields.ts), so
// no control here is ever disabled or refused. Every field saves on its own
// the moment it changes (one PATCH per field) with an inline tick, and a
// refused field shows the server's reason under it; the footer has only
// Close. Org role, Agent and access are the Members drawer's.

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { apiFetch } from "@/lib/api-fetch";
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
  weeklyCapacityHours?: number | null;
  access: { editable: string[]; dottedLines: boolean; manageMembers: boolean };
}

type Opt = { id: string; label: string };
type FieldState = "idle" | "saving" | "saved" | { error: string };

function OptionField({ value, options, onPick, ariaLabel, noneLabel, footer }: { value: string | null; options: Opt[]; onPick: (id: string | null) => void; ariaLabel: string; noneLabel: string; footer?: ReactNode }) {
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
        className="absolute start-0 top-10 z-50"
      />
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
  const [capacity, setCapacity] = useState(person.weeklyCapacityHours == null ? "" : String(person.weeklyCapacityHours));
  const [dob, setDob] = useState(person.dateOfBirth && !person.dateOfBirth.startsWith("--") ? person.dateOfBirth : "");
  const [firstName, setFirstName] = useState(person.firstName);
  const [lastName, setLastName] = useState(person.lastName);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [changed, setChanged] = useState(false);
  const [status, setStatus] = useState(person.status);

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

  async function save(field: string, body: Record<string, unknown>, url = `/api/users/${person.id}`, method: "PATCH" | "PUT" = "PATCH"): Promise<boolean> {
    setState((s) => ({ ...s, [field]: "saving" }));
    const r = await apiFetch(url, { method, json: body });
    if (!r.ok) {
      setState((s) => ({ ...s, [field]: { error: r.error || "Not saved" } }));
      return false;
    }
    setState((s) => ({ ...s, [field]: "saved" }));
    setChanged(true);
    return true;
  }

  const close = () => { if (changed) onSaved(); onClose(); };
  const personal = can("firstName") || can("lastName") || can("phone");

  return (
    <Dialog open onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>Each change saves as you make it.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[62vh] flex-col overflow-y-auto">
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
              <OptionField ariaLabel="Job title" noneLabel="No job title" value={roleId} options={roles} onPick={(v) => { setRoleId(v); void save("roleId", { roleId: v }); }} />
            </Row>
          ) : null}
          {can("departmentId") ? (
            <Row label="Department" state={state.departmentId ?? "idle"}>
              <OptionField ariaLabel="Department" noneLabel="No department" value={deptId} options={depts} onPick={(v) => { setDeptId(v); void save("departmentId", { departmentId: v }); }} />
            </Row>
          ) : null}
          {can("officeId") ? (
            <Row label="Office" state={state.officeId ?? "idle"}>
              <OptionField ariaLabel="Office" noneLabel="No office" value={officeId} options={offices} onPick={(v) => { setOfficeId(v); void save("officeId", { officeId: v }); }} />
            </Row>
          ) : null}
          {can("managerId") ? (
            <Row label="Reports to" state={state.managerId ?? "idle"}>
              <PeoplePickerField
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
            </Row>
          ) : null}
          {person.access.dottedLines ? (
            <Row label="Dotted-line managers" state={state.dotted ?? "idle"}>
              <PeoplePickerField
                ariaLabel="Dotted-line managers"
                multiple
                managersOnly
                exclude={[person.id, ...(manager ? [manager.id] : [])]}
                value={dotted.map((d) => d.id)}
                people={dotted}
                placeholder="None"
                onChange={(ids, picked) => {
                  const prev = dotted;
                  setDotted(picked);
                  void save("dotted", { managerIds: ids }, `/api/users/${person.id}/dotted-lines`, "PUT").then((ok) => { if (!ok) setDotted(prev); });
                }}
              />
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
                  placeholder="Org default"
                  aria-label="Weekly capacity hours"
                  className="h-8 w-28 rounded-md border border-line bg-raised px-2 text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
                />
                <span className="text-sm text-ink-2">hours a week. Blank uses the org default.</span>
              </div>
            </Row>
          ) : null}
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
