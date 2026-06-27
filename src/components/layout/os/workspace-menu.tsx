"use client";

// WorkspaceMenu — popover that drops out of the top-left workspace
// switcher. Now data-driven: the org header, member count, plan, and the
// "Switch Workspaces" list all come from real APIs instead of hardcoded
// rows.
//
//   GET  /api/me/orgs        → memberships the user can switch into
//   GET  /api/settings       → current org plan + member count (usage.users)
//   POST /api/me/switch-org  → flip the active org (then session.update())
//   POST /api/organizations/delete → schedule the current org for deletion
//
// Click outside or press Escape to close.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  Settings as SettingsIcon, Users as UsersIcon, Sparkles, LayoutGrid, Zap,
  Plus, Loader2, Trash2, AlertTriangle,
} from "lucide-react";
import { MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { usePrompt } from "@/components/ui/dialog-provider";
import { useRole } from "@/hooks/use-role";

interface WorkspaceMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

type Tab = "settings" | "people";

interface OrgLite {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
}
interface Membership {
  id: string;
  role: string;
  isPrimary: boolean;
  isCurrent: boolean;
  organization: OrgLite;
}

// STARTER is the free tier — keep the "Free Forever" copy from the mockup
// for it; paid tiers show their plan name.
const PLAN_LABEL: Record<string, string> = {
  STARTER: "Free Forever",
  GROWTH: "Growth plan",
  SCALE: "Scale plan",
  ENTERPRISE: "Enterprise",
};

function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const out = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return out || "?";
}

export function WorkspaceMenu({ open, onClose, anchorRef }: WorkspaceMenuProps) {
  const [tab, setTab] = useState<Tab>("settings");
  const popoverRef = useRef<HTMLDivElement>(null);
  const { update } = useSession();
  const toast = useToast();
  const { accessLevel } = useRole();
  const canDelete = accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN";

  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const promptDialog = usePrompt();

  // Pull real data each time the menu opens (cheap, and keeps the member
  // count / plan fresh after edits elsewhere).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const [orgsR, setR] = await Promise.all([
          fetch("/api/me/orgs"),
          fetch("/api/settings"),
        ]);
        if (alive && orgsR.ok) {
          const d = await orgsR.json();
          setMemberships(Array.isArray(d?.memberships) ? d.memberships : []);
        } else if (alive) {
          setMemberships([]);
        }
        if (alive && setR.ok) {
          const s = await setR.json();
          setPlan(typeof s?.organization?.plan === "string" ? s.organization.plan : null);
          setMemberCount(typeof s?.usage?.users === "number" ? s.usage.users : null);
        }
      } catch {
        if (alive) setMemberships([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  // Click outside closes — but not while the delete confirm modal (portaled
  // outside this popover) is up.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (deleteOpen) return;
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef, deleteOpen]);

  // Escape closes (modal handles its own Escape when it's the topmost layer).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleteOpen) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, deleteOpen]);

  const current = memberships?.find((m) => m.isCurrent)?.organization ?? null;

  const switchTo = useCallback(
    async (orgId: string, isCurrent: boolean) => {
      if (isCurrent || switchingId) return;
      setSwitchingId(orgId);
      try {
        const res = await fetch("/api/me/switch-org", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error("Couldn't switch workspace", body?.error ?? "Please try again.");
          setSwitchingId(null);
          return;
        }
        // Refresh the JWT so the new org is live, then hard-navigate so every
        // server component re-renders under the new tenant.
        await update?.();
        window.location.href = "/today";
      } catch {
        toast.error("Couldn't switch workspace", "Network error. Please try again.");
        setSwitchingId(null);
      }
    },
    [switchingId, toast, update],
  );

  const comingSoon = useCallback(
    (what: string) =>
      toast.info(what, "This part of the workspace menu isn't available yet — coming soon."),
    [toast],
  );

  const createWorkspace = useCallback(async () => {
    if (creating) return;
    const name = (await promptDialog({
      title: "Create workspace",
      description: "Give your new workspace a name.",
      placeholder: "e.g. Acme HQ",
      submitLabel: "Create workspace",
      required: true,
    }))?.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/organizations/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Couldn't create workspace", body?.error ?? "Please try again.");
        setCreating(false);
        return;
      }
      const newId = body?.data?.organization?.id ?? body?.organization?.id;
      if (newId) {
        // Switch into the new workspace, refresh the JWT, then hard-navigate.
        const sw = await fetch("/api/me/switch-org", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: newId }),
        });
        if (sw.ok) { await update?.(); window.location.href = "/today"; return; }
      }
      window.location.reload();
    } catch {
      toast.error("Couldn't create workspace", "Network error. Please try again.");
      setCreating(false);
    }
  }, [creating, toast, update, promptDialog]);

  if (!open) return null;

  const showUpgrade = plan !== "ENTERPRISE";

  return (
    <>
      <div
        ref={popoverRef}
        className="absolute left-3 top-[52px] w-[360px] bg-white dark:bg-[#1B1F26] rounded-lg shadow-xl border border-zinc-200 dark:border-[#2A2F38] z-50"
        role="menu"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-3">
            {current?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.logo} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
            ) : (
              <span className="w-10 h-10 rounded-md bg-zinc-900 text-white flex items-center justify-center text-base font-bold shrink-0">
                {current ? orgInitials(current.name) : "·"}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {current?.name ?? "Workspace"}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                {memberCount != null ? `${memberCount} member${memberCount === 1 ? "" : "s"}` : null}
                {memberCount != null && plan ? " · " : null}
                {plan ? (PLAN_LABEL[plan] ?? plan) : null}
                {showUpgrade ? (
                  <>
                    {memberCount != null || plan ? " · " : null}
                    <Link
                      href="/settings/billing"
                      onClick={onClose}
                      className="hover:underline"
                      style={{ color: "var(--os-brand)" }}
                    >
                      Upgrade
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              type="button"
              onClick={() => setTab("settings")}
              className={`flex items-center justify-center gap-1.5 h-8 rounded-md text-sm transition-colors ${
                tab === "settings"
                  ? "bg-zinc-100 dark:bg-white/5 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/10"
              }`}
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              Settings
            </button>
            <button
              type="button"
              onClick={() => setTab("people")}
              className={`flex items-center justify-center gap-1.5 h-8 rounded-md text-sm transition-colors ${
                tab === "people"
                  ? "bg-zinc-100 dark:bg-white/5 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/10"
              }`}
            >
              <UsersIcon className="w-3.5 h-3.5" />
              People
            </button>
          </div>
        </div>

        {tab === "settings" ? (
          <>
            {/* Manage section */}
            <div className="px-4 pb-2 pt-1">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-medium mb-1.5">Manage</div>
              <ul className="space-y-0.5">
                <li><MenuItem variant="inset" icon={Sparkles}   label="Apps"        onClick={() => comingSoon("Apps")} /></li>
                <li><MenuItem variant="inset" icon={LayoutGrid} label="Templates"   href="/templates" onClick={onClose} /></li>
                <li><MenuItem variant="inset" icon={Zap}        label="Automations" onClick={() => comingSoon("Automations")} /></li>
              </ul>
            </div>

            {/* Divider */}
            <div className="border-t border-zinc-100 dark:border-[#2A2F38] mx-4" />

            {/* Switch Workspaces */}
            <div className="px-4 py-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-medium mb-1.5">Switch Workspaces</div>
              <ul className="space-y-0.5">
                {memberships == null ? (
                  <li className="px-2 py-2 text-[13px] text-zinc-400 dark:text-zinc-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                  </li>
                ) : memberships.length === 0 ? (
                  <li className="px-2 py-2 text-[13px] text-zinc-400 dark:text-zinc-400">No workspaces found.</li>
                ) : (
                  memberships.map((m) => (
                    <li key={m.id}>
                      <MenuItem
                        variant="inset"
                        leading={
                          m.organization.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.organization.logo} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" />
                          ) : (
                            <span className="w-6 h-6 rounded-md bg-zinc-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                              {orgInitials(m.organization.name)}
                            </span>
                          )
                        }
                        label={m.organization.name}
                        selected={m.isCurrent}
                        busy={switchingId === m.organization.id}
                        onClick={() => switchTo(m.organization.id, m.isCurrent)}
                      />
                    </li>
                  ))
                )}
              </ul>
            </div>

            {/* Create Workspace */}
            <div className="px-3 pb-3 pt-1">
              <button
                type="button"
                onClick={createWorkspace}
                disabled={creating}
                className="w-full flex items-center justify-center gap-1.5 h-9 rounded-md border border-zinc-200 dark:border-[#2A2F38] hover:bg-zinc-50 dark:hover:bg-white/10 text-sm text-zinc-700 dark:text-zinc-200 disabled:opacity-60"
              >
                <Plus className="w-3.5 h-3.5" />
                {creating ? "Creating…" : "Create Workspace"}
              </button>
            </div>

            {/* Danger zone — schedule the current workspace for deletion. */}
            {canDelete && current ? (
              <>
                <div className="border-t border-zinc-100 dark:border-[#2A2F38] mx-4" />
                <div className="px-4 py-2">
                  <MenuItem
                    variant="inset"
                    icon={Trash2}
                    label="Delete workspace"
                    destructive
                    onClick={() => setDeleteOpen(true)}
                  />
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div className="px-4 pb-4 pt-2">
            <ul className="space-y-0.5">
              <li>
                <MenuItem
                  variant="inset"
                  icon={UsersIcon}
                  label="Manage members"
                  description="Roles, reporting line & access"
                  href="/settings/members"
                  onClick={onClose}
                />
              </li>
              <li>
                <MenuItem
                  variant="inset"
                  icon={Plus}
                  label="Invite people"
                  description="Add teammates by email"
                  href="/settings/members"
                  onClick={onClose}
                />
              </li>
            </ul>
          </div>
        )}
      </div>

      {deleteOpen && current && typeof document !== "undefined"
        ? createPortal(
            <DeleteWorkspaceModal
              org={current}
              toast={toast}
              onClose={() => setDeleteOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/* ───────────────────────── delete confirm modal ────────────────────────── */
// Portaled to document.body so it renders OUTSIDE `.workwrk-os` — that keeps
// the global input/button reset from stripping its styling. Two-key confirm
// (exact org name + the word DELETE) mirrors POST /api/organizations/delete.

function DeleteWorkspaceModal({
  org,
  toast,
  onClose,
}: {
  org: OrgLite;
  toast: ReturnType<typeof useToast>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const canSubmit = name === org.name && phrase === "DELETE" && !submitting;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/organizations/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: name, confirmPhrase: phrase }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Couldn't delete workspace", body?.error ?? "Please try again.");
        setSubmitting(false);
        return;
      }
      setDoneMessage(body?.message ?? "Workspace scheduled for deletion.");
      toast.success("Workspace scheduled for deletion", body?.message);
    } catch {
      toast.error("Couldn't delete workspace", "Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-[#1B1F26] shadow-2xl">
        {doneMessage ? (
          <div className="p-5">
            <h2 className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-100">Deletion scheduled</h2>
            <p className="mt-2 text-[13px] text-zinc-600 dark:text-zinc-300">{doneMessage}</p>
            <p className="mt-2 text-[12.5px] text-zinc-500 dark:text-zinc-400">
              You can undo this during the grace period — contact support or restore from the
              admin tools before the window closes.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="h-8 rounded-md border border-zinc-200 dark:border-[#2A2F38] px-3 text-[13px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
              >
                Close
              </button>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="h-8 rounded-md bg-zinc-900 px-3 text-[13px] font-medium text-white hover:bg-zinc-800"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h2 className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-100">Delete this workspace?</h2>
            </div>
            <p className="mt-2 text-[13px] text-zinc-600 dark:text-zinc-300">
              This schedules{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{org.name}</span> for deletion.
              Sign-in is blocked right away and all data is permanently removed after a 30-day
              grace period. It stays recoverable until then.
            </p>

            <label className="mt-4 block text-[12.5px] font-medium text-zinc-700 dark:text-zinc-200">
              Type the workspace name to confirm
            </label>
            <div className="mt-1 rounded-md border border-zinc-300 dark:border-[#2A2F38] dark:bg-[#14171D] px-2.5 focus-within:border-zinc-900 dark:focus-within:border-zinc-100">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={org.name}
                className="h-9 w-full bg-transparent text-[13px] text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            </div>

            <label className="mt-3 block text-[12.5px] font-medium text-zinc-700 dark:text-zinc-200">
              Type <span className="font-semibold">DELETE</span> to confirm
            </label>
            <div className="mt-1 rounded-md border border-zinc-300 dark:border-[#2A2F38] dark:bg-[#14171D] px-2.5 focus-within:border-zinc-900 dark:focus-within:border-zinc-100">
              <input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="DELETE"
                className="h-9 w-full bg-transparent text-[13px] text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="h-8 rounded-md border border-zinc-200 dark:border-[#2A2F38] px-3 text-[13px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-[13px] font-medium text-white hover:bg-red-700 disabled:opacity-40"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete workspace
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
