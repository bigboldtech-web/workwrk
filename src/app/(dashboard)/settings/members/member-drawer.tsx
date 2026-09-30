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
import { ROLE_WORD, STATUS_WORD, TIER_OPTIONS, type Lookup, type MemberRole, type MemberRow } from "./members-shared";

export function MemberDrawer({
  member,
  canEdit,
  canEditPeople,
  viewerId,
  viewerIsOwner,
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
  owners: number;
  lookups: { roles: Lookup[]; depts: Lookup[]; offices: Lookup[] };
  onClose: () => void;
  onChanged: () => void;
  onDeactivate: () => void;
  onRemove: () => void;
}) {
  const { toast } = useOsToast();
  const [m, setM] = useState(member);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [confirmRole, setConfirmRole] = useState<{ role: MemberRole; tier: string | null } | null>(null);
  const [cap, setCap] = useState<number | "">(member.weeklyCapacityHours ?? "");
  const capTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => { setM(member); setCap(member.weeklyCapacityHours ?? ""); }, 0);
    return () => clearTimeout(t);
  }, [member]);

  const patch = async (key: string, body: Record<string, unknown>, optimistic: Partial<MemberRow>) => {
    const prev = m;
    setM({ ...m, ...optimistic });
    const r = await apiFetch(`/api/users/${m.id}`, { method: "PATCH", json: body });
    if (!r.ok) {
      setM(prev);
      setErrs((e) => ({ ...e, [key]: r.error }));
      toast(r.error);
      return false;
    }
    setErrs((e) => { const n = { ...e }; delete n[key]; return n; });
    setSaved((s) => ({ ...s, [key]: Date.now() }));
    onChanged();
    return true;
  };

  const saveScopes = async (scopes: string[]) => {
    const prev = m;
    setM({ ...m, adminScopes: scopes });
    const r = await apiFetch("/api/settings/members/scopes", { method: "PATCH", json: { userId: m.id, scopes } });
    if (!r.ok) {
      setM(prev);
      setErrs((e) => ({ ...e, scopes: r.error }));
      return;
    }
    setErrs((e) => { const n = { ...e }; delete n.scopes; return n; });
    setSaved((x) => ({ ...x, scopes: Date.now() }));
    onChanged();
  };

  const askRole = (role: MemberRole, tier: string | null) => {
    const sensitive = role === "OWNER" || m.role === "OWNER" || m.id === viewerId;
    if (sensitive) { setConfirmRole({ role, tier }); return; }
    void patch("role", { orgRole: role, memberTier: role === "MEMBER" ? tier : null }, { role, tier: role === "MEMBER" ? tier : null });
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
          error={errs.role ? { message: errs.role, onRetry: () => setErrs((e) => { const n = { ...e }; delete n.role; return n; }) } : null}
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
        {m.role === "ADMIN" && viewerIsOwner ? (
          <SettingsRow
            label="Admin scopes"
            helper="Let this Admin open Billing, or Security and API keys. Read by the new access engine; until it is on, Owner pages follow the Owner split."
            savedAt={saved.scopes}
            error={errs.scopes ? { message: errs.scopes, onRetry: () => setErrs((e) => { const n = { ...e }; delete n.scopes; return n; }) } : null}
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
            savedAt={saved.role}
            readOnlyValue={canEdit ? undefined : m.tierLabel ?? "Member"}
            control={
              <NativeSelect
                ariaLabel="Tier"
                value={m.tier ?? "EMPLOYEE"}
                options={TIER_OPTIONS}
                onChange={(tier) => askRole("MEMBER", tier)}
              />
            }
          />
        ) : null}
        <SettingsRow
          label="Job title"
          savedAt={saved.roleId}
          readOnlyValue={canEditPeople ? undefined : m.jobTitle?.title ?? "None"}
          control={
            <NativeSelect ariaLabel="Job title" value={m.jobTitle?.id ?? ""} options={pick(lookups.roles, m.jobTitle)} className="max-w-[220px]"
              onChange={(v) => { void patch("roleId", { roleId: v || null }, { jobTitle: v ? { id: v, title: lookups.roles.find((x) => x.id === v)?.label ?? "" } : null }); }} />
          }
        />
        <SettingsRow
          label="Department"
          savedAt={saved.departmentId}
          readOnlyValue={canEditPeople ? undefined : m.department?.name ?? "None"}
          control={
            <NativeSelect ariaLabel="Department" value={m.department?.id ?? ""} options={pick(lookups.depts, m.department)} className="max-w-[220px]"
              onChange={(v) => { void patch("departmentId", { departmentId: v || null }, { department: v ? { id: v, name: lookups.depts.find((x) => x.id === v)?.label ?? "" } : null }); }} />
          }
        />
        <SettingsRow
          label="Office"
          savedAt={saved.officeId}
          readOnlyValue={canEditPeople ? undefined : m.office?.name ?? "None"}
          control={
            <NativeSelect ariaLabel="Office" value={m.office?.id ?? ""} options={pick(lookups.offices, m.office)} className="max-w-[220px]"
              onChange={(v) => { void patch("officeId", { officeId: v || null }, { office: v ? { id: v, name: lookups.offices.find((x) => x.id === v)?.label ?? "" } : null }); }} />
          }
        />
        <SettingsRow
          label="Reports to"
          savedAt={saved.managerId}
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
        <SettingsRow label="Status" readOnlyValue={STATUS_WORD[m.status] ?? m.status} />
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
          if (c) await patch("role", { orgRole: c.role, memberTier: c.role === "MEMBER" ? c.tier : null }, { role: c.role, tier: c.role === "MEMBER" ? c.tier : null });
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
