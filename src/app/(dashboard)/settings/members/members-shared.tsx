"use client";

// Shared pieces of Workspace settings > Members: the row type the list API
// answers, the org lookups the pickers use, the role words and the transfer
// dialog (access invariant 13: a person's work is handed over before they
// are deactivated or removed, never orphaned).

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ConfirmDialog, Field } from "@/components/settings/settings-form";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: MemberRole;
  tier: string | null;
  tierLabel: string | null;
  isAgent: boolean;
  jobTitle: { id: string; title: string } | null;
  department: { id: string; name: string } | null;
  office: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  peopleTeam: boolean;
  status: string;
  lastSignInAt: string | null;
  joinedAt: string;
  weeklyCapacityHours: number | null;
}

export interface Counts { owners: number; admins: number; members: number; guests: number; peopleTeam: number }

export const ROLE_WORD: Record<MemberRole, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

/** The member tiers (src/lib/access/membership.ts MEMBER_TIERS), in words. */
export const TIER_OPTIONS = [
  { value: "EMPLOYEE", label: "Member" },
  { value: "TEAM_LEAD", label: "Team lead" },
  { value: "MANAGER", label: "Manager" },
  { value: "DIRECTOR", label: "Director" },
  { value: "VP", label: "VP" },
  { value: "C_LEVEL", label: "Executive" },
  { value: "HR", label: "People team" },
  { value: "AGENT", label: "Agent" },
] as const;

export const STATUS_WORD: Record<string, string> = {
  ACTIVE: "Active", INACTIVE: "Deactivated", ON_LEAVE: "On leave", PROBATION: "Probation", PIP: "Improvement plan", NOTICE_PERIOD: "Notice period",
};

export type Lookup = { id: string; label: string };

/** Departments, job titles and offices for the pickers and filters. */
export function useLookups() {
  const [roles, setRoles] = useState<Lookup[]>([]);
  const [depts, setDepts] = useState<Lookup[]>([]);
  const [offices, setOffices] = useState<Lookup[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      void Promise.all([
        apiFetch<Array<{ id: string; title: string }>>("/api/roles", { cache: "no-store" }),
        apiFetch<Array<{ id: string; name: string }>>("/api/departments?fresh=1", { cache: "no-store" }),
        apiFetch<Array<{ id: string; name: string; city?: string | null }> | { data: Array<{ id: string; name: string; city?: string | null }> }>("/api/offices", { cache: "no-store" }),
      ]).then(([r, d, o]) => {
        if (r.ok) setRoles((Array.isArray(r.data) ? r.data : []).map((x) => ({ id: x.id, label: x.title })));
        if (d.ok) setDepts((Array.isArray(d.data) ? d.data : []).map((x) => ({ id: x.id, label: x.name })));
        if (o.ok) {
          const list = Array.isArray(o.data) ? o.data : o.data.data ?? [];
          setOffices(list.map((x) => ({ id: x.id, label: x.city ? `${x.name} · ${x.city}` : x.name })));
        }
      });
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return { roles, depts, offices };
}

type Handover = {
  openTasks: { count: number };
  okrs: { count: number };
  kras: { count: number };
  assets: { count: number };
  directReports: { count: number };
  containers?: { count: number; spaces: number; folders: number; lists: number };
};

/**
 * The transfer dialog (560px): what the person holds, a transferee picker
 * preselected to their manager else the acting admin, then the handover
 * (POST /api/users/[id]/handover) and the deactivation or removal. Remove
 * also asks for the person's name typed.
 */
export function TransferDialog({
  member,
  mode,
  actingId,
  onClose,
  onDone,
}: {
  member: MemberRow | null;
  mode: "deactivate" | "remove";
  actingId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [summary, setSummary] = useState<Handover | null | "error">(null);
  const [to, setTo] = useState<PickPerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    const t = setTimeout(() => {
      setSummary(null); setError(null);
      const first = member.manager ? { id: member.manager.id, firstName: member.manager.name, lastName: "", avatar: null, email: null } : null;
      setTo(first);
      void apiFetch<Handover>(`/api/users/${member.id}/handover`, { cache: "no-store" }).then((r) => setSummary(r.ok ? r.data : "error"));
    }, 0);
    return () => clearTimeout(t);
  }, [member]);

  if (!member) return null;
  const s = summary && summary !== "error" ? summary : null;
  const holds = s
    ? [
        [s.openTasks.count, "open task", "open tasks"],
        [s.directReports.count, "direct report", "direct reports"],
        [s.containers?.count ?? 0, "Space, Folder or List", "Spaces, Folders and Lists"],
        [s.okrs.count, "live goal", "live goals"],
        [s.kras.count, "KRA", "KRAs"],
        [s.assets.count, "asset", "assets"],
      ].filter(([n]) => (n as number) > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    : [];
  const needsTransfer = !!s && ((s.openTasks.count + s.directReports.count + (s.containers?.count ?? 0)) > 0);

  const run = async () => {
    setBusy(true);
    setError(null);
    const recipient = to?.id ?? actingId;
    if (needsTransfer) {
      const h = await apiFetch(`/api/users/${member.id}/handover`, { method: "POST", json: { reassignToId: recipient } });
      if (!h.ok) { setBusy(false); setError(h.error); return; }
    }
    const r = mode === "remove"
      ? await apiFetch(`/api/users/${member.id}`, { method: "DELETE" })
      : await apiFetch(`/api/users/${member.id}`, { method: "PATCH", json: { status: "INACTIVE" } });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onDone(mode === "remove" ? `${member.name} removed` : `${member.name} deactivated`);
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={mode === "remove" ? `Remove ${member.name}?` : `Deactivate ${member.name}?`}
      width={560}
      danger
      typed={mode === "remove" ? member.name : undefined}
      confirmLabel={mode === "remove" ? "Remove from workspace" : "Deactivate"}
      onConfirm={run}
      busy={busy || summary === null}
      error={error ?? (summary === "error" ? "Couldn't read what they hold. Try again." : null)}
    >
      <p>{mode === "remove" ? "They lose access at once and leave the directory." : "They lose access at once. Their record stays, and you can reactivate them."}</p>
      {s ? (
        holds.length ? (
          <>
            <p>They hold {holds.join(", ")}.</p>
            {needsTransfer ? (
              <Field label="Hand their open work, reports and Spaces to" helper="Done work keeps its owner. Nothing is deleted.">
                <PeoplePickerField
                  ariaLabel="Hand work to"
                  value={to ? [to.id] : []}
                  people={to ? [to] : []}
                  exclude={[member.id]}
                  placeholder="You"
                  onChange={(_ids, picked) => setTo(picked[0] ?? null)}
                />
              </Field>
            ) : null}
          </>
        ) : (
          <p className="text-ink-2">They hold no open work, reports or Spaces.</p>
        )
      ) : null}
      <p className="text-sm text-ink-2">If this happens through your identity provider instead, their manager takes over.</p>
    </ConfirmDialog>
  );
}
