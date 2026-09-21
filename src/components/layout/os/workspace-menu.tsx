"use client";

// WorkspaceMenu (spec-shell 2.14): the company account, opened from the
// sidebar header's workspace switcher. A 300px MenuList: a header with the
// org tile, name and "{plan} · N members"; Invite people, Manage members,
// Workspace settings and Upgrade for the people who may (rows are absent,
// never greyed); SWITCH WORKSPACE with one row per other org; Create
// workspace. No "Apps" or "Automations" coming-soon toasts, no Templates
// (Template Center lives in Create).
//
// DELIBERATE DEVIATION from 2.14, tracked for the settings unit: "Delete
// workspace" stays reachable here for Owners and Admins until Identity ›
// Danger zone exists (no destination is removed before its next door
// exists); it is the last row, destructive, and opens the typed-confirmation
// dialog. Delete this row and the dialog in the same PR as that card.
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
//   POST /api/organizations/delete  schedule the current org for deletion

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { signOut, useSession } from "next-auth/react";
import { ArrowUpCircle, Plus, Settings, Trash2, UserPlus, Users } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { MenuItem, MenuSectionLabel, MenuSeparator } from "@/components/ui/menu";
import { EntityTile } from "@/components/ui/entity-tile";
import { usePrompt } from "@/components/ui/dialog-provider";
import { usePermission } from "@/hooks/use-permission";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { apiFetch } from "@/lib/api-fetch";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { ChromePopover } from "./chrome-popover";
import { useBoot, useViewerRole } from "./boot-context";
import { useLayer } from "./shell-context";
import { useOsToast } from "./toast";
import { InviteModal } from "./invite-modal";

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
  const { isAdmin, isGuest } = useViewerRole();
  const { update } = useSession();
  const { openSettings } = useSettingsNav();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  const switchTo = useCallback(async (orgId: string) => {
    if (switchingId) return;
    setSwitchingId(orgId);
    const r = await apiFetch("/api/me/switch-org", { method: "POST", json: { organizationId: orgId } });
    if (!r.ok) {
      toast("Couldn't switch workspace. Try again");
      setSwitchingId(null);
      return;
    }
    await update?.();
    window.location.href = WORK_HOME_HREF;
  }, [switchingId, toast, update]);

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
    const r = await apiFetch<{ data?: { organization?: { id?: string } }; organization?: { id?: string } }>("/api/organizations/create", { method: "POST", json: { name } });
    if (!r.ok) {
      toast("Couldn't create workspace. Try again");
      setCreating(false);
      return;
    }
    const newId = r.data?.data?.organization?.id ?? r.data?.organization?.id;
    if (newId) {
      const sw = await apiFetch("/api/me/switch-org", { method: "POST", json: { organizationId: newId } });
      if (sw.ok) { await update?.(); window.location.href = WORK_HOME_HREF; return; }
    }
    window.location.reload();
  }, [creating, promptDialog, toast, update]);

  const others = (memberships ?? []).filter((m) => !m.isCurrent);
  const plan = PLAN_LABEL[boot.org.plan] ?? boot.org.plan;
  const showUpgrade = isAdmin && boot.org.plan !== "ENTERPRISE";
  const otherOrg = others[0]?.organization ?? null;

  return (
    <>
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
                    busy={switchingId === m.organization.id}
                    onClick={() => { void switchTo(m.organization.id); }}
                  />
                ))}
              </>
            ) : null}
            <MenuItem icon={Plus} label="Create workspace" busy={creating} onClick={() => { void createWorkspace(); }} />
            {isAdmin ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete workspace" destructive onClick={() => { setOpen(false); setDeleteOpen(true); }} />
              </>
            ) : null}
          </div>
        ) : null}
      </ChromePopover>
      {inviteOpen ? <InviteModal open onOpenChange={(v) => { if (!v) setInviteOpen(false); }} /> : null}
      {deleteOpen ? (
        <DeleteWorkspaceDialog
          org={boot.org}
          switchToOrg={otherOrg}
          onSwitchAway={(id) => { void switchTo(id); }}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
    </>
  );
}

/* ───────────────────────── delete confirm dialog ───────────────────────── */
// A 400 Radix modal on the design-system anatomy (5.5): header 56 with a
// title, body 24, footer with Cancel left of the one destructive primary.
// Two-key confirm (exact org name + the word DELETE) mirrors the API.

function DeleteWorkspaceDialog({
  org, switchToOrg, onSwitchAway, onClose,
}: {
  org: { id: string; name: string };
  switchToOrg: OrgLite | null;
  onSwitchAway: (orgId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const { toast } = useOsToast();
  useLayer(true, { id: "delete-workspace", kind: "modal", close: onClose });

  const canSubmit = name === org.name && phrase === "DELETE" && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const r = await apiFetch<{ message?: string }>("/api/organizations/delete", { method: "POST", json: { confirmName: name, confirmPhrase: phrase } });
    if (!r.ok) {
      toast("Couldn't delete workspace. Try again");
      setSubmitting(false);
      return;
    }
    if (switchToOrg) {
      toast(`Workspace scheduled for deletion. Switching you to ${switchToOrg.name}`);
      onSwitchAway(switchToOrg.id);
      return;
    }
    setDone(r.data?.message ?? "Workspace scheduled for deletion.");
  };

  const input = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus";

  return (
    <DialogPrimitive.Root open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[var(--os-scrim)]" />
        <DialogPrimitive.Content className="workwrk-os os-chrome fixed inset-x-0 mx-auto top-1/2 z-[61] w-[400px] max-w-[calc(100vw-24px)] -translate-y-1/2 rounded-xl border border-line bg-raised text-ink shadow-[var(--os-shadow-modal)] outline-none">
          <div className="flex h-14 items-center px-6">
            <DialogPrimitive.Title className="text-lg font-semibold text-danger-text">
              {done ? "Deletion scheduled" : "Delete this workspace?"}
            </DialogPrimitive.Title>
          </div>
          {done ? (
            <>
              <div className="px-6 pb-2 text-base text-ink-2">
                <p className="m-0">{done}</p>
                <p className="mt-2">You can undo this during the grace period from the staff console or by contacting support.</p>
              </div>
              <div className="flex h-16 items-center justify-end gap-2 px-6">
                <button type="button" onClick={onClose} className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover">Close</button>
                <button type="button" onClick={() => { void signOut({ callbackUrl: "/login" }); }} className="h-9 rounded-md bg-brand px-3 text-base font-medium text-ink-inv hover:bg-brand-hover">{SHELL_LABELS.logOut}</button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-4 px-6 pb-2">
                <DialogPrimitive.Description className="m-0 text-base text-ink-2">
                  This schedules the entire <span className="font-medium text-ink">{org.name}</span> workspace and all of its data for deletion. It stays recoverable for 30 days, then is permanently removed. {switchToOrg ? `You'll be moved to ${switchToOrg.name}.` : "You'll be logged out."}
                </DialogPrimitive.Description>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                  Type the workspace name to confirm
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder={org.name} className={input} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                  Type DELETE to confirm
                  <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="DELETE" className={input} />
                </label>
              </div>
              <div className="flex h-16 items-center justify-end gap-2 px-6">
                <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
                <button
                  type="button"
                  onClick={() => { void submit(); }}
                  disabled={!canSubmit}
                  className="h-9 rounded-md bg-danger-solid px-3 text-base font-medium text-ink-inv disabled:bg-active disabled:text-ink-4"
                >
                  {submitting ? "Deleting…" : "Delete workspace"}
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
