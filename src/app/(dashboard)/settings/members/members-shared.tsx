"use client";

// Shared pieces of Workspace settings > Members: the row type the list API
// answers, the org lookups the pickers use, the role words and the transfer
// dialog (access invariant 13: a person's work is handed over before they
// are deactivated or removed, never orphaned).

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ConfirmDialog, Field } from "@/components/settings/settings-form";
import { PeoplePickerField, personName, type PickPerson } from "@/components/people/person-bits";
import { linesAlsoElsewhereNote, reportHandoverNote } from "@/lib/people/reporting-lines";

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
  /** Admin scopes an Owner gave (billing, security). */
  adminScopes?: string[];
  /** An Agent who still has people listed under them: how many, by kind (members-list.server.ts). */
  agentReports?: { solid: number; dotted: number } | null;
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
 * GET /api/users/[id]/handover?to=: where the direct reports go if `to` takes
 * the work, and who of them also reports to the person leaving in another
 * workspace (docs-found fixes batch 7: every report moves, and that
 * workspace's Audit log records it).
 */
type ReportsPlan = { reports: number; toRecipient: number; recipientIsAgent: boolean; rehomed: { to: string | null; count: number }[]; alsoElsewhere?: { id: string; name: string | null }[] };

/**
 * The transfer dialog (560px): what the person holds, a transferee picker
 * preselected to their manager else the acting admin, then the handover
 * (POST /api/users/[id]/handover) and the deactivation or removal. Remove
 * also asks for the person's name typed. When the person picked cannot take
 * the direct reports (an Agent is never anyone's manager, or a reporting
 * loop), the dialog says where they go instead, from the server's own plan,
 * before anything runs. Confirm waits for that plan: if it cannot be read,
 * the dialog says so and offers Retry, and Confirm stays held (Cancel
 * stays open), so a handover never runs without saying where the reports go.
 * Every report moves, a report who also reports to them in another
 * workspace too: the deactivation or removal that follows ends their account
 * there as well. The dialog names those reports before and after (batch 7;
 * batch 6 said they stayed, untrue once the removal landed). They move WITH
 * the deactivation or removal, never with the handover (batch 8: that step
 * can still be refused, and the other workspace's line must not change for
 * an account that did not end), so the dialog sends the person picked with
 * it (`handoverTo`), says before that the line moves once they are
 * deactivated or removed, and says after what that step moved.
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
  const [plan, setPlan] = useState<{ for: string; plan: ReportsPlan | null } | null>(null);
  // A Retry of the plan read asks again under a new key, so the failure it
  // answers never stands for the new attempt.
  const [planTry, setPlanTry] = useState(0);

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

  // Where the direct reports go if this person takes the work, asked again
  // whenever the pick changes, so the line below is never about someone else.
  const reportCount = summary && summary !== "error" ? summary.directReports.count : 0;
  const memberId = member?.id ?? null;
  const pickedId = to?.id ?? actingId;
  useEffect(() => {
    if (!memberId || reportCount === 0) return;
    let live = true;
    void apiFetch<{ reports: ReportsPlan }>(`/api/users/${memberId}/handover?to=${encodeURIComponent(pickedId)}`, { cache: "no-store" }).then((r) => {
      if (live) setPlan({ for: `${memberId}:${pickedId}:${planTry}`, plan: r.ok ? r.data.reports : null });
    });
    return () => { live = false; };
  }, [memberId, reportCount, pickedId, planTry]);

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
  const recipientId = to?.id ?? actingId;
  const needsPlan = !!s && s.directReports.count > 0;
  // Keyed by the person leaving, the person picked and the attempt, so a plan
  // for anyone else, or an older attempt's failure, never shows.
  const planKey = `${member.id}:${recipientId}:${planTry}`;
  const planNow = plan && plan.for === planKey ? plan.plan : null;
  // The plan read failed: Confirm stays held (it would run a handover the
  // dialog has not described), the dialog says why, and Retry asks again.
  const planFailed = needsPlan && plan?.for === planKey && !plan.plan;
  const reportsNote = planNow ? reportHandoverNote(planNow, to ? personName(to) : "you") : null;
  const ends = mode === "remove" ? "removed" : "deactivated";
  const elsewhereNote = planNow ? linesAlsoElsewhereNote(planNow.alsoElsewhere ?? [], member.name, ends) : null;

  type Moved = { reportsAlsoElsewhere?: { id: string; name: string | null }[]; reportsAtAccountEnd?: { id: string; name: string | null }[] };
  const run = async () => {
    setBusy(true);
    setError(null);
    const recipient = to?.id ?? actingId;
    // Moved by the handover (an account that had already ended) and by the
    // deactivation or removal itself (batch 8).
    const alsoMoved: { id: string; name: string | null }[] = [];
    let waiting: { id: string; name: string | null }[] = [];
    if (needsTransfer) {
      const h = await apiFetch<Moved>(`/api/users/${member.id}/handover`, { method: "POST", json: { reassignToId: recipient } });
      if (!h.ok) { setBusy(false); setError(h.error); return; }
      alsoMoved.push(...(h.data?.reportsAlsoElsewhere ?? []));
      waiting = h.data?.reportsAtAccountEnd ?? [];
    }
    // The person picked takes the reports the step moves itself too.
    const r = mode === "remove"
      ? await apiFetch<Moved>(`/api/users/${member.id}?handoverTo=${encodeURIComponent(recipient)}`, { method: "DELETE" })
      : await apiFetch<Moved>(`/api/users/${member.id}`, { method: "PATCH", json: { status: "INACTIVE", handoverTo: recipient } });
    setBusy(false);
    if (!r.ok) {
      // The handover ran, the step did not: the lines another workspace
      // relies on did not move, and the dialog says when they will.
      const left = linesAlsoElsewhereNote(waiting, member.name, ends);
      setError(left ? `${r.error} ${left}` : r.error);
      return;
    }
    alsoMoved.push(...(r.data?.reportsAlsoElsewhere ?? []));
    const done = mode === "remove" ? `${member.name} removed` : `${member.name} deactivated`;
    const said = linesAlsoElsewhereNote(alsoMoved, member.name, "done");
    onDone(said ? `${done}. ${said}` : done);
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
      busy={busy || summary === null || (needsPlan && plan?.for !== planKey)}
      confirmDisabled={planFailed}
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
            {reportsNote ? <p className="text-sm text-ink-2">{reportsNote}</p> : null}
            {elsewhereNote ? <p className="text-sm text-ink-2">{elsewhereNote}</p> : null}
            {planFailed ? (
              <p role="alert" className="text-sm text-danger-text">
                Couldn&apos;t check where their direct reports go, so this waits until it can.{" "}
                <button type="button" className="font-medium underline" onClick={() => setPlanTry((n) => n + 1)}>Retry</button>
              </p>
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
