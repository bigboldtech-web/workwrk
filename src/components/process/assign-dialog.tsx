"use client";

// AssignDialog (spec-process section 3): one modal for assigning a SOP or a
// policy. Audience = Everyone at {org} / a Department (a live group) /
// named People (a directory picker), a "Due" date, a Mandatory switch, one
// primary "Assign". The API decides who the caller may actually reach (the
// manager chain, the People team, admins) and answers 403 with its reason.

import { useEffect, useMemo, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { apiFetch } from "@/lib/api-fetch";

type Audience = "everyone" | "department" | "people";
type Dept = { id: string; name: string; _count?: { members?: number } };

const FIELD = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand";
const LABEL = "text-sm font-medium text-ink-2";

function personName(p: PersonRef): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown";
}

export function AssignDialog({ open, onClose, object, defaults, alreadyAssigned = [], onAssigned }: {
  open: boolean;
  onClose: () => void;
  object: { type: "sop" | "policy"; id: string; title?: string };
  defaults?: { dueDate?: string | null; mandatory?: boolean };
  /** User ids that already hold an assignment; shown, not offered twice. */
  alreadyAssigned?: string[];
  onAssigned?: (count: number) => void;
}) {
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const [audience, setAudience] = useState<Audience>("people");
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [dueDate, setDueDate] = useState(defaults?.dueDate?.slice(0, 10) ?? "");
  const [mandatory, setMandatory] = useState(defaults?.mandatory ?? true);
  const [busy, setBusy] = useState(false);

  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) { setAudience("people"); setSelected([]); setDeptId(null); setDueDate(defaults?.dueDate?.slice(0, 10) ?? ""); setMandatory(defaults?.mandatory ?? true); }
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const [p, d] = await Promise.all([
        apiFetch<{ data?: PersonRef[] } | PersonRef[]>("/api/users?scope=all&limit=500", { cache: "no-store" }),
        apiFetch<Dept[] | { data?: Dept[] }>("/api/departments", { cache: "no-store" }),
      ]);
      if (!live) return;
      setPeople(p.ok ? (Array.isArray(p.data) ? p.data : p.data?.data ?? []) : []);
      setDepts(d.ok ? (Array.isArray(d.data) ? d.data : d.data?.data ?? []) : []);
    })();
    return () => { live = false; };
  }, [open]);

  const already = useMemo(() => new Set(alreadyAssigned), [alreadyAssigned]);
  const options: PickerOption[] = people.map((p) => ({
    value: p.id,
    label: personName(p),
    description: already.has(p.id) ? "Already assigned" : p.email ?? undefined,
    glyph: <PersonAvatar person={p} size={20} />,
    disabled: already.has(p.id),
  }));
  const chosen = people.filter((p) => selected.includes(p.id));
  const dept = depts.find((d) => d.id === deptId) ?? null;

  const canSubmit = audience === "everyone" || (audience === "department" && !!deptId) || (audience === "people" && selected.length > 0);

  async function assign() {
    if (!canSubmit || busy) return;
    setBusy(true);
    const isSop = object.type === "sop";
    const url = isSop ? "/api/sop-assignments" : `/api/policies/${object.id}/assignments`;
    const body: Record<string, unknown> = { dueDate: dueDate || undefined, mandatory };
    if (isSop) body.sopId = object.id;
    if (audience === "everyone") {
      if (isSop) body.userIds = people.filter((p) => !already.has(p.id)).map((p) => p.id);
      else body.all = true;
    } else if (audience === "department") {
      if (isSop) body.departmentId = deptId;
      else body.userIds = people.filter((p) => (p as { department?: { id?: string } }).department?.id === deptId && !already.has(p.id)).map((p) => p.id);
    } else {
      body.userIds = selected;
    }
    const r = await apiFetch<{ count?: number; data?: { count?: number } }>(url, { method: "POST", json: body });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't assign", { tone: "danger" }); return; }
    const count = r.data?.count ?? r.data?.data?.count ?? (audience === "people" ? selected.length : 0);
    toast(count ? `Assigned to ${count} ${count === 1 ? "person" : "people"}` : "Assigned");
    onAssigned?.(count);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>Assign</DialogTitle>
        <DialogDescription>{object.title ? `Who has to ${object.type === "sop" ? "read or run" : "acknowledge"} "${object.title}".` : "Who this is for."}</DialogDescription>
        <div className="mt-2 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Audience</span>
            <SegmentedControl<Audience>
              label="Audience"
              value={audience}
              onChange={setAudience}
              options={[{ value: "everyone", label: `Everyone at ${boot.org.name}` }, { value: "department", label: "Department" }, { value: "people", label: "People" }]}
            />
          </div>
          {audience === "department" ? (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Department</span>
              <span className="relative block">
                <button type="button" onClick={() => setDeptOpen((o) => !o)} className={`${FIELD} flex items-center text-start`}>
                  <span className={dept ? "" : "text-ink-3"}>{dept ? dept.name : depts.length === 0 ? "No departments yet" : "Choose a department"}</span>
                </button>
                <Picker open={deptOpen} onClose={() => setDeptOpen(false)} ariaLabel="Department" searchPlaceholder="Find a department" selected={deptId}
                  onSelect={(v) => { setDeptId(v); setDeptOpen(false); }}
                  sections={[{ options: depts.map((d) => ({ value: d.id, label: d.name, hint: d._count?.members != null ? `${d._count.members}` : undefined })) }]} width={320} />
              </span>
            </label>
          ) : null}
          {audience === "people" ? (
            <div className="flex flex-col gap-1">
              <span className={LABEL}>People</span>
              <span className="relative block">
                <button type="button" onClick={() => setPickOpen((o) => !o)} className={`${FIELD} flex min-h-9 h-auto flex-wrap items-center gap-1.5 py-1 text-start`}>
                  {chosen.length === 0 ? <span className="text-ink-3">Choose people</span> : chosen.map((p) => (
                    <span key={p.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-active px-1.5 text-xs font-medium text-ink">
                      <PersonAvatar person={p} size={16} />{personName(p)}
                      <span role="button" tabIndex={0} aria-label={`Remove ${personName(p)}`} onClick={(e) => { e.stopPropagation(); setSelected((s) => s.filter((id) => id !== p.id)); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setSelected((s) => s.filter((id) => id !== p.id)); } }} className="inline-flex h-4 w-4 items-center justify-center rounded text-ink-2 hover:text-ink"><X className="h-3 w-3" aria-hidden /></span>
                    </span>
                  ))}
                </button>
                <Picker open={pickOpen} onClose={() => setPickOpen(false)} ariaLabel="People" searchPlaceholder="Find a person" multi selected={selected}
                  onSelect={(v) => setSelected((s) => (s.includes(v) ? s.filter((id) => id !== v) : [...s, v]))} sections={[{ options }]} width={320} />
              </span>
            </div>
          ) : null}
          {audience === "everyone" ? <p className="text-sm text-ink-2">Everyone at {boot.org.name} who is not already assigned.</p> : null}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Due</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={FIELD} />
            </label>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Mandatory</span>
              <span className="inline-flex h-9 items-center gap-2 text-base text-ink"><Switch checked={mandatory} onChange={setMandatory} /> {mandatory ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void assign()} disabled={busy || !canSubmit} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
            {busy ? <Dots variant="pending" /> : <UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            Assign
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
