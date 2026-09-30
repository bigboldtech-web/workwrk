"use client";

// WorkspaceMenu (spec-shell 2.14): the company account, opened from the
// sidebar header's workspace switcher. A 300px MenuList: a header with the
// org tile, name and "{plan} · N members"; Invite people, Manage members,
// Workspace settings and Upgrade for the people who may (rows are absent,
// never greyed); SWITCH WORKSPACE with one row per other org; Create
// workspace. No "Apps" or "Automations" coming-soon toasts, no Templates
// (Template Center lives in Create).
//
// "Delete workspace" (settings-architecture 2.4) opens Workspace settings >
// Identity & culture > Danger zone, the ONE delete surface (typed
// confirmation there, then a move to another workspace or sign out). The row
// is for the people that tab lets delete: every Admin until the Owner and
// Admin split, then Owners only (absent, never offered and refused).
//
// Invite people follows the PERMISSION MATRIX, not the org role: the API
// (POST /api/invitations) admits whoever holds people.create, so a Member or
// Manager the matrix lets invite gets the same row. For them it opens the
// InviteModal right here, since the members settings page is admin-only.
//
// Upgrade renders for Owners and Admins (the boot payload carries no admin
// scopes yet; every Admin can open Plan & billing through Workspace
// settings today, so the row matches the door rather than narrowing it).
//
//   GET  /api/me/orgs               memberships the viewer can switch into
//   GET  /api/settings              usage.users for the member count
//   POST /api/me/switch-org         flip the active org (then session.update())
//   POST /api/organizations/create  a new workspace

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { ArrowUpCircle, Plus, Settings, Trash2, UserPlus, Users } from "lucide-react";
import { MenuItem, MenuSectionLabel, MenuSeparator } from "@/components/ui/menu";
import { EntityTile } from "@/components/ui/entity-tile";
import { usePrompt } from "@/components/ui/dialog-provider";
import { usePermission } from "@/lib/access/use-legacy-permissions";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { apiFetch } from "@/lib/api-fetch";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { ChromePopover } from "./chrome-popover";
import { useBoot, useViewerRole } from "./boot-context";
import { useOsToast } from "./toast";
import { InviteModal } from "./invite-modal";
import { SwitchCover } from "./switch-cover";
import { ORG_ROLE_LABEL } from "@/lib/access/labels";
import { orgRoleOfMembership } from "@/lib/access/org-role";

interface OrgLite { id: string; name: string; slug: string | null; logo: string | null }
interface Membership { id: string; role: string; isPrimary: boolean; isCurrent: boolean; organization: OrgLite }

const PLAN_LABEL: Record<string, string> = {
  STARTER: "Free plan",
  GROWTH: "Growth plan",
  SCALE: "Scale plan",
  ENTERPRISE: "Enterprise",
};

function OrgTile({ org, size = "sm" }: { org: { name: string; logo: string | null }; size?: "sm" | "md" }) {
  if (org.logo) {
    const px = size === "md" ? 24 : 20;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={org.logo} alt="" className="shrink-0 rounded-md object-cover" style={{ width: px, height: px }} />;
  }
  return <EntityTile size={size} name={org.name} />;
}

export function WorkspaceMenu({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { boot } = useBoot();
  const { isAdmin, isGuest, ownerActionsLocked } = useViewerRole();
  const { update } = useSession();
  const { openSettings } = useSettingsNav();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const canInvite = usePermission("people", "create") === true;

  const load = useCallback(async () => {
    const [orgs, settings] = await Promise.all([
      apiFetch<{ memberships?: Membership[] }>("/api/me/orgs", { cache: "no-store" }),
      apiFetch<{ usage?: { users?: number } }>("/api/settings", { cache: "no-store" }),
    ]);
    if (orgs.ok) {
      setMembersError(false);
      setMemberships(Array.isArray(orgs.data?.memberships) ? orgs.data.memberships : []);
    } else if (orgs.status !== 401) setMembersError(true);
    if (settings.ok && typeof settings.data?.usage?.users === "number") setMemberCount(settings.data.usage.users);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [open, load]);

  // The switch (spec-account-auth "Switch workspace"): one at a time (the
  // row's pending glyph, every other row inert), the boot cover from the
  // request until the FULL document navigation, never a client push, so no
  // cached query or open stream of the old workspace survives into the new
  // one. A 403 means the membership went away while the menu was open: say
  // why and refresh the list.
  const [coverName, setCoverName] = useState<string | null>(null);
  const retryRef = useRef<(orgId: string, orgName: string) => Promise<void>>(async () => {});
  const switchTo = useCallback(async (orgId: string, orgName: string) => {
    if (switchingId) return;
    setSwitchingId(orgId);
    const r = await apiFetch("/api/me/switch-org", { method: "POST", json: { organizationId: orgId } });
    if (!r.ok) {
      toast(`Couldn't switch workspace. ${r.error || "Try again"}`, { action: { label: "Retry", onClick: () => { void retryRef.current(orgId, orgName); } } });
      setSwitchingId(null);
      if (r.status === 403) void load();
      return;
    }
    setOpen(false);
    setCoverName(orgName);
    await update?.();
    window.location.href = WORK_HOME_HREF;
  }, [switchingId, toast, update, load]);
  useEffect(() => { retryRef.current = switchTo; }, [switchTo]);

  const createWorkspace = useCallback(async () => {
    setOpen(false);
    const name = (await promptDialog({
      title: "Create workspace",
      description: "Give your new workspace a name.",
      placeholder: "e.g. Acme HQ",
      submitLabel: "Create workspace",
      required: true,
    }))?.trim();
    if (!name || creating) return;
    setCreating(true);
    // The browser's zone seeds the new workspace's locale (seedOrgDefaults).
    const timezone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
    const r = await apiFetch<{ data?: { organization?: { id?: string } }; organization?: { id?: string } }>("/api/organizations/create", { method: "POST", json: { name, timezone } });
    if (!r.ok) {
      toast("Couldn't create workspace. Try again");
      setCreating(false);
      return;
    }
    const newId = r.data?.data?.organization?.id ?? r.data?.organization?.id;
    if (newId) {
      const sw = await apiFetch("/api/me/switch-org", { method: "POST", json: { organizationId: newId } });
      // A brand new workspace opens on its setup wizard, the same offer a
      // signup gets (never a gate: Finish later and Skip are one click).
      if (sw.ok) { await update?.(); window.location.href = "/onboard"; return; }
    }
    window.location.reload();
  }, [creating, promptDialog, toast, update]);

  const others = (memberships ?? []).filter((m) => !m.isCurrent);
  const plan = PLAN_LABEL[boot.org.plan] ?? boot.org.plan;
  const showUpgrade = isAdmin && boot.org.plan !== "ENTERPRISE";

  return (
    <>
      {coverName !== null ? <SwitchCover orgName={coverName} /> : null}
      <ChromePopover
        open={open}
        onOpenChange={setOpen}
        width={300}
        align="start"
        layerId="workspace-menu"
        ariaLabel={SHELL_LABELS.switchWorkspace}
        trigger={trigger}
      >
        <div className="flex h-16 items-center gap-3 px-4">
          <OrgTile org={boot.org} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium text-ink">{boot.org.name}</div>
            {!isGuest ? (
              <div className="truncate text-sm text-ink-2">
                {plan}
                {memberCount !== null ? ` · ${memberCount} member${memberCount === 1 ? "" : "s"}` : ""}
              </div>
            ) : null}
          </div>
        </div>
        {!isGuest ? (
          <div className="py-1">
            {isAdmin ? (
              <MenuItem icon={UserPlus} label="Invite people" onClick={() => { setOpen(false); openSettings("/settings/members?invite=1"); }} />
            ) : canInvite ? (
              <MenuItem icon={UserPlus} label="Invite people" onClick={() => { setOpen(false); setInviteOpen(true); }} />
            ) : null}
            {isAdmin ? (
              <>
                <MenuItem icon={Users} label="Manage members" onClick={() => { setOpen(false); openSettings("/settings/members"); }} />
                <MenuItem icon={Settings} label={SHELL_LABELS.workspaceSettings} onClick={() => { setOpen(false); openSettings("/settings"); }} />
              </>
            ) : null}
            {showUpgrade ? (
              <MenuItem icon={ArrowUpCircle} label="Upgrade" onClick={() => { setOpen(false); openSettings("/settings/billing"); }} />
            ) : null}
            {(isAdmin || canInvite || showUpgrade) ? <MenuSeparator /> : null}
            {memberships === null && !membersError ? (
              <ul className="px-2 py-1" aria-hidden>
                {["60%", "40%", "80%"].map((w, i) => (
                  <li key={i} className="flex h-9 items-center gap-3 px-2">
                    <span className="h-5 w-5 shrink-0 rounded-md bg-skeleton os-skeleton-pulse" />
                    <span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />
                  </li>
                ))}
              </ul>
            ) : membersError ? (
              <div className="flex h-9 items-center gap-1 px-3 text-sm text-ink-2">
                Couldn&apos;t load workspaces ·
                <button type="button" onClick={() => { void load(); }} className="font-medium text-brand-deep hover:underline">Try again</button>
              </div>
            ) : others.length > 0 ? (
              <>
                <MenuSectionLabel>Switch workspace</MenuSectionLabel>
                {others.map((m) => (
                  <MenuItem
                    key={m.id}
                    leading={<OrgTile org={m.organization} />}
                    label={m.organization.name}
                    trailing={<span className="text-xs font-medium text-ink-2">{ORG_ROLE_LABEL[orgRoleOfMembership(m.role)]}</span>}
                    busy={switchingId === m.organization.id}
                    disabled={!!switchingId && switchingId !== m.organization.id}
                    onClick={() => { void switchTo(m.organization.id, m.organization.name); }}
                  />
                ))}
              </>
            ) : null}
            <MenuItem icon={Plus} label="Create workspace" busy={creating} onClick={() => { void createWorkspace(); }} />
            {isAdmin && !ownerActionsLocked ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete workspace" destructive onClick={() => { setOpen(false); openSettings("/settings/identity?tab=danger"); }} />
              </>
            ) : null}
          </div>
        ) : null}
      </ChromePopover>
      {inviteOpen ? <InviteModal open onOpenChange={(v) => { if (!v) setInviteOpen(false); }} /> : null}
    </>
  );
}
