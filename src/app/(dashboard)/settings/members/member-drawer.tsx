"use client";

// Members > row drawer (520px): one person, every field autosaving on its
// own through PATCH /api/users/[id] (the per-field table of
// settings-architecture 9.2a; the server answers 403 field_forbidden naming
// any field this viewer may not write, never a silent drop).
//
//   Role and tier     Owner and Admin only; Owner only to or from Owner; a
//                     change to your own role or to or from Owner asks first
//                     and names who stays an Owner; a lowering takes effect on
//                     the person's next request (tokenVersion)
//   Job title, Department, Office, Reports to, Weekly capacity
//                     Owner, Admin and the People team
//   Deactivate, Reactivate, Remove
//                     Owner and Admin, through the transfer dialog
//
// A viewer who may not write a field sees its value as text.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { Drawer } from "@/components/ui/drawer";
import { SettingsRow } from "@/components/settings/settings-row";
import { ConfirmDialog, NativeSelect, NumberInput, btn } from "@/components/settings/settings-form";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { ROLE_WORD, STATUS_WORD, TIER_OPTIONS, type Lookup, type MemberRole, type MemberRow } from "./members-shared";

/** One field save that failed: what it sent and showed, so Retry resends exactly that. */
export interface FailedSave {
  memberId: string;
  body: Record<string, unknown>;
  optimistic: Partial<MemberRow>;
}

/**
 * The save keys one write replaces (pure; tested). Role and Tier both write
 * orgRole and memberTier, so a newer attempt on either row retires the older
 * one's failure: a stale Tier Retry must never undo a Role that has since
 * saved.
 */
export function saveGroup(key: string): string[] {
  return key === "role" || key === "tier" ? ["role", "tier"] : [key];
}

/** A copy of a keyed record without these keys (pure; tested). */
export function withoutKeys<T>(rec: Record<string, T>, keys: string[]): Record<string, T> {
  const n = { ...rec };
  for (const k of keys) delete n[k];
  return n;
}

/**
 * The save a Retry on this row resends, or null (pure; tested). Only a
 * failure for the person the drawer shows now counts, so an error left from
 * someone else never resends onto this person.
 */
export function retrySave(failed: Record<string, FailedSave>, key: string, memberId: string): FailedSave | null {
  const f = failed[key];
  return f && f.memberId === memberId ? f : null;
}

/**
 * The fields to put back when a save fails (pure; tested): only the ones this
 * save changed, read from before it, so a failed Department never undoes a
 * Role that saved while it was in flight.
 */
export function undoFor(before: MemberRow, optimistic: Partial<MemberRow>): Partial<MemberRow> {
  const undo: Record<string, unknown> = {};
  for (const k of Object.keys(optimistic)) undo[k] = before[k as keyof MemberRow];
  return undo as Partial<MemberRow>;
}

export function MemberDrawer({
  member,
  canEdit,
  canEditPeople,
  viewerId,
  viewerIsOwner,
  scopesLive = false,
  owners,
  lookups,
  onClose,
  onChanged,
  onDeactivate,
  onRemove,
}: {
  member: MemberRow;
  canEdit: boolean;
  canEditPeople: boolean;
  viewerId: string;
  /** Only an Owner changes, deactivates or removes an Owner (the server says so too). */
  viewerIsOwner: boolean;
  /** The Admin scopes are read (Owner split on and ACCESS_V2_TABLES on). */
  scopesLive?: boolean;
  owners: number;
  lookups: { roles: Lookup[]; depts: Lookup[]; offices: Lookup[] };
  onClose: () => void;
  onChanged: () => void;
  onDeactivate: () => void;
  onRemove: () => void;
}) {
  const { toast } = useOsToast();
  const [m, setM] = useState(member);
  const showUpcoming = useShowUpcoming();
  // The scopes a failed save meant to set, so Retry sends them again.
  const failedScopes = useRef<string[] | null>(null);
  // The field saves that failed, by row key, so each row's Retry resends
  // what that save sent (the capacity row keeps the typed hours in cap).
  const [failed, setFailed] = useState<Record<string, FailedSave>>({});
  // The newest attempt per save group: an older attempt that answers late
  // (two capacity pauses, say) never reverts or flags over a newer one.
  const attempt = useRef<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [confirmRole, setConfirmRole] = useState<{ role: MemberRole; tier: string | null; key: string } | null>(null);
  const [cap, setCap] = useState<number | "">(member.weeklyCapacityHours ?? "");
  const capTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => { setM(member); setCap(member.weeklyCapacityHours ?? ""); }, 0);
    return () => clearTimeout(t);
  }, [member]);

  const patch = async (key: string, body: Record<string, unknown>, optimistic: Partial<MemberRow>) => {
    // A new attempt (a fresh change or a Retry) replaces any older failure on
    // the same fields; its error clears while it is in flight and comes back
    // only if this attempt fails too.
    const group = saveGroup(key);
    const gid = group.join("+");
    const n = (attempt.current[gid] ?? 0) + 1;
    attempt.current[gid] = n;
    setFailed((f) => withoutKeys(f, group));
    setErrs((e) => withoutKeys(e, group));
    const undo = undoFor(m, optimistic);
    const memberId = m.id;
    setM((cur) => ({ ...cur, ...optimistic }));
    const r = await apiFetch(`/api/users/${memberId}`, { method: "PATCH", json: body });
    const newest = attempt.current[gid] === n;
    if (!r.ok) {
      if (!newest) return false; // the newer attempt's answer decides the row
      setM((cur) => ({ ...cur, ...undo }));
      setFailed((f) => ({ ...f, [key]: { memberId, body, optimistic } }));
      setErrs((e) => ({ ...e, [key]: r.error }));
      toast(r.error);
      return false;
    }
    setSaved((s) => ({ ...s, [key]: Date.now() }));
    onChanged();
    return true;
  };

  // The row's "Couldn't save" with a Retry that resends the failed save.
  const errFor = (key: string) => {
    const f = retrySave(failed, key, m.id);
    return errs[key] && f ? { message: errs[key], onRetry: () => { void patch(key, f.body, f.optimistic); } } : null;
  };

  const saveScopes = async (scopes: string[]) => {
    const prev = m;
    setM({ ...m, adminScopes: scopes });
    const r = await apiFetch("/api/settings/members/scopes", { method: "PATCH", json: { userId: m.id, scopes } });
    if (!r.ok) {
      setM(prev);
      setErrs((e) => ({ ...e, scopes: r.error }));
      failedScopes.current = scopes;
      return;
    }
    failedScopes.current = null;
    setErrs((e) => { const n = { ...e }; delete n.scopes; return n; });
    setSaved((x) => ({ ...x, scopes: Date.now() }));
    onChanged();
  };

  // key is the row that asked ("role" or "tier"), so a failure and its Retry
  // show on the row the person changed.
  const askRole = (role: MemberRole, tier: string | null, key: "role" | "tier" = "role") => {
    const sensitive = role === "OWNER" || m.role === "OWNER" || m.id === viewerId;
    if (sensitive) { setConfirmRole({ role, tier, key }); return; }
    void patch(key, { orgRole: role, memberTier: role === "MEMBER" ? tier : null }, { role, tier: role === "MEMBER" ? tier : null });
  };

  const pick = (list: Lookup[], cur: { id: string } | null) => [{ value: "", label: "None" }, ...list.map((l) => ({ value: l.id, label: l.label }))].concat(cur && !list.some((l) => l.id === cur.id) ? [{ value: cur.id, label: "Current" }] : []);
  const inactive = m.status === "INACTIVE";
  const managerPerson: PickPerson | null = m.manager ? { id: m.manager.id, firstName: m.manager.name, lastName: "", avatar: null, email: null } : null;

  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      layerId="member-drawer"
      ariaLabel={m.name}
      header={
        <>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar name={m.name} src={m.avatar} />
            <span className="truncate text-base font-semibold text-ink">{m.name}</span>
          </span>
          <Link href={`/people/${m.id}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
            Open profile <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </>
      }
    >
      <div className="flex flex-col p-5">
        <p className="mb-2 text-sm text-ink-2">{m.email}</p>
        <SettingsRow
          label="Role"
          helper={m.role === "OWNER" ? "Runs the company account." : m.role === "ADMIN" ? "Runs the workspace day to day." : "Works in the Spaces they are added to."}
          savedAt={saved.role}
          error={errFor("role")}
          readOnlyValue={canEdit && (viewerIsOwner || m.role !== "OWNER") ? undefined : ROLE_WORD[m.role]}
          control={
            <NativeSelect<MemberRole>
              ariaLabel="Role"
              value={m.role}
              options={(viewerIsOwner ? (["OWNER", "ADMIN", "MEMBER"] as MemberRole[]) : (["ADMIN", "MEMBER"] as MemberRole[])).map((r) => ({ value: r, label: ROLE_WORD[r] }))}
              onChange={(r) => askRole(r, r === "MEMBER" ? (m.tier ?? "EMPLOYEE") : null)}
            />
          }
        />
        {m.role === "ADMIN" && viewerIsOwner && (scopesLive || showUpcoming) ? (
          <SettingsRow
            label="Admin scopes"
            helper={
              scopesLive
                ? "Let this Admin open Billing, or Security and API keys, as an Owner does."
                : "Let this Admin open Billing, or Security and API keys. Not read yet: until the Owner and Admin split and the new access roles are both on, every Admin opens those pages. What you tick is kept for then."
            }
            savedAt={saved.scopes}
            error={errs.scopes ? { message: errs.scopes, onRetry: () => { if (failedScopes.current) void saveScopes(failedScopes.current); } } : null}
            control={
              <span className="inline-flex items-center gap-3">
                {(["billing", "security"] as const).map((scope) => (
                  <label key={scope} className="inline-flex items-center gap-1.5 text-base text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--os-brand)]"
                      checked={(m.adminScopes ?? []).includes(scope)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...new Set([...(m.adminScopes ?? []), scope])] : (m.adminScopes ?? []).filter((x) => x !== scope);
                        void saveScopes(next);
                      }}
                    />
                    {scope === "billing" ? "Billing" : "Security"}
                  </label>
                ))}
              </span>
            }
          />
        ) : null}
        {m.role === "MEMBER" ? (
          <SettingsRow
            label="Tier"
            helper="Decides which manager pages they open until the new access roles are on. Agent is for frontline staff."
            savedAt={saved.tier}
            error={errFor("tier")}
            readOnlyValue={canEdit ? undefined : m.tierLabel ?? "Member"}
            control={
              <NativeSelect
                ariaLabel="Tier"
                value={m.tier ?? "EMPLOYEE"}
                options={TIER_OPTIONS}
                onChange={(tier) => askRole("MEMBER", tier, "tier")}
              />
            }
          />
        ) : null}
        <SettingsRow
          label="Job title"
          savedAt={saved.roleId}
          error={errFor("roleId")}
          readOnlyValue={canEditPeople ? undefined : m.jobTitle?.title ?? "None"}
          control={
            <NativeSelect ariaLabel="Job title" value={m.jobTitle?.id ?? ""} options={pick(lookups.roles, m.jobTitle)} className="max-w-[220px]"
              onChange={(v) => { void patch("roleId", { roleId: v || null }, { jobTitle: v ? { id: v, title: lookups.roles.find((x) => x.id === v)?.label ?? "" } : null }); }} />
          }
        />
        <SettingsRow
          label="Department"
          savedAt={saved.departmentId}
          error={errFor("departmentId")}
          readOnlyValue={canEditPeople ? undefined : m.department?.name ?? "None"}
          control={
            <NativeSelect ariaLabel="Department" value={m.department?.id ?? ""} options={pick(lookups.depts, m.department)} className="max-w-[220px]"
              onChange={(v) => { void patch("departmentId", { departmentId: v || null }, { department: v ? { id: v, name: lookups.depts.find((x) => x.id === v)?.label ?? "" } : null }); }} />
          }
        />
        <SettingsRow
          label="Office"
          savedAt={saved.officeId}
          error={errFor("officeId")}
          readOnlyValue={canEditPeople ? undefined : m.office?.name ?? "None"}
          control={
            <NativeSelect ariaLabel="Office" value={m.office?.id ?? ""} options={pick(lookups.offices, m.office)} className="max-w-[220px]"
              onChange={(v) => { void patch("officeId", { officeId: v || null }, { office: v ? { id: v, name: lookups.offices.find((x) => x.id === v)?.label ?? "" } : null }); }} />
          }
        />
        <SettingsRow
          label="Reports to"
          savedAt={saved.managerId}
          error={errFor("managerId")}
          readOnlyValue={canEditPeople ? undefined : m.manager?.name ?? "Nobody"}
          control={
            <span className="w-[220px]">
              <PeoplePickerField
                ariaLabel="Reports to"
                managersOnly
                value={managerPerson ? [managerPerson.id] : []}
                people={managerPerson ? [managerPerson] : []}
                exclude={[m.id]}
                placeholder="Nobody"
                onChange={(ids, picked) => {
                  const p = picked[0] ?? null;
                  void patch("managerId", { managerId: ids[0] ?? null }, { manager: p ? { id: p.id, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() } : null });
                }}
              />
            </span>
          }
        />
        <SettingsRow
          label="Weekly capacity"
          helper="Blank uses the workspace's working week."
          savedAt={saved.cap}
          error={errFor("cap")}
          readOnlyValue={canEditPeople ? undefined : m.weeklyCapacityHours != null ? `${m.weeklyCapacityHours} hours` : "Workspace default"}
          control={
            <NumberInput value={cap} min={0} max={168} suffix="hours" ariaLabel="Weekly capacity hours"
              onChange={(n) => {
                setCap(n);
                if (n !== "" && (n < 0 || n > 168)) return;
                // Debounced 400ms: one write per pause, not per keystroke.
                window.clearTimeout(capTimer.current);
                capTimer.current = window.setTimeout(() => {
                  void patch("cap", { weeklyCapacityHours: n === "" ? null : n }, { weeklyCapacityHours: n === "" ? null : n });
                }, 400);
              }} />
          }
        />
        <SettingsRow label="Status" savedAt={saved.status} error={errFor("status")} readOnlyValue={STATUS_WORD[m.status] ?? m.status} />
        {canEdit && m.id !== viewerId && m.role === "OWNER" && !viewerIsOwner ? (
          <p className="mt-4 border-t border-line pt-4 text-sm text-ink-2">Only an Owner can change, deactivate or remove an Owner.</p>
        ) : canEdit && m.id !== viewerId ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {inactive ? (
              <button type="button" className={btn.secondary} onClick={() => { void patch("status", { status: "ACTIVE" }, { status: "ACTIVE" }); }}>Reactivate</button>
            ) : (
              <button type="button" className={btn.dangerGhost} onClick={onDeactivate}>Deactivate</button>
            )}
            <button type="button" className={btn.dangerGhost} onClick={onRemove}>Remove from workspace</button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!confirmRole}
        onOpenChange={(v) => { if (!v) setConfirmRole(null); }}
        title={confirmRole?.role === "OWNER" ? `Make ${m.name} an Owner?` : m.id === viewerId ? "Change your own role?" : `Change ${m.name}'s role?`}
        confirmLabel="Change role"
        danger={m.id === viewerId || m.role === "OWNER"}
        onConfirm={async () => {
          const c = confirmRole;
          setConfirmRole(null);
          if (c) await patch(c.key, { orgRole: c.role, memberTier: c.role === "MEMBER" ? c.tier : null }, { role: c.role, tier: c.role === "MEMBER" ? c.tier : null });
        }}
      >
        {confirmRole?.role === "OWNER" ? (
          <p>Owners handle billing, security and who else is an Owner. The workspace has {owners} {owners === 1 ? "Owner" : "Owners"} today.</p>
        ) : m.role === "OWNER" ? (
          <p>{m.name} stops being an Owner. {owners - 1 > 0 ? `${owners - 1} ${owners - 1 === 1 ? "Owner stays" : "Owners stay"}.` : "The workspace must keep at least one Owner, so this is refused if nobody else is one."}</p>
        ) : (
          <p>You become {ROLE_WORD[confirmRole?.role ?? "MEMBER"]}. Pages you can open now may close for you on your next click.</p>
        )}
      </ConfirmDialog>
    </Drawer>
  );
}

export function Avatar({ name, src, size = 24 }: { name: string; src: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-hover text-rail font-semibold text-ink-2" aria-hidden>
      {initials}
    </span>
  );
}
