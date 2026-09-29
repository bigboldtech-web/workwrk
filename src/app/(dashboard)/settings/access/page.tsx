"use client";

// Access (Workspace settings; the old /settings/permissions 308s here). In
// its transitional form (spec-settings-workspace S3/S6): the Public links
// toggle and the permission matrix, until the ten access toggles and Lock
// it down replace the matrix and the matrix is exported to
// access.matrix_retired. Until then the matrix keeps working exactly as it
// did, so nothing an admin configured stops applying.
//
// The governance control surface. Exposes the
// existing org permission matrix (src/lib/permissions.ts +
// /api/permissions) as a granular modules × actions × access-levels grid.
// This is the "who can create/assign/publish KRAs, KPIs, SOPs…" screen
// that was missing: the engine already existed, this is the knobs.
//
// Super Admin / Company Admin are always-full (PROTECTED_ADMIN_ROLES) and
// shown locked. Only those two roles can SAVE changes; everyone else sees
// the matrix read-only.

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useRole } from "@/hooks/use-role";
import {
  PERMISSION_MODULES, ACCESS_LEVELS, PROTECTED_ADMIN_ROLES, checkPermission,
  type AccessLevel, type PermissionModule, type PermissionMatrix,
} from "@/lib/permissions";
import { PublicLinksCard } from "@/components/settings/public-links-card";
import { SettingsPage } from "@/components/settings/settings-page";
import { SaveBar } from "@/components/settings/save-bar";
import { ErrorState } from "@/components/ui/error-state";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-client";
import { invalidatePermissionCache } from "@/hooks/use-permission";

const SHORT: Record<AccessLevel, string> = {
  SUPER_ADMIN: "Super", COMPANY_ADMIN: "Admin", C_LEVEL: "C-Lvl", VP: "VP",
  DIRECTOR: "Dir", HR: "HR", MANAGER: "Mgr", TEAM_LEAD: "Lead", EMPLOYEE: "Emp", AGENT: "Agent",
};

// Governance-critical modules open by default; the rest collapsed.
const DEFAULT_OPEN = new Set<string>(["kras", "sops", "people", "reviews"]);

const clone = (m: PermissionMatrix): PermissionMatrix => JSON.parse(JSON.stringify(m));

export default function AccessSettingsPage() {
  const { accessLevel } = useRole();
  const canEdit = accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN";

  const [matrix, setMatrix] = useState<PermissionMatrix>({});
  const [original, setOriginal] = useState<PermissionMatrix>({});
  const [openMods, setOpenMods] = useState<Set<string>>(() => new Set(DEFAULT_OPEN));
  const [loading, setLoading] = useState(true);
  // A failed read renders ErrorState, never an editable empty matrix: a
  // Save over an empty matrix would have reset every customised cell.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const r = await apiFetch<{ matrix?: PermissionMatrix }>("/api/permissions", { cache: "no-store" });
    if (r.ok) {
      const m = (r.data?.matrix as PermissionMatrix) ?? {};
      setMatrix(m);
      setOriginal(m);
      setDirty(false);
    } else {
      setLoadError(r.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = (level: AccessLevel, mod: PermissionModule, action: string) => {
    if (!canEdit || PROTECTED_ADMIN_ROLES.includes(level)) return;
    setMatrix((prev) => {
      const next = clone(prev);
      const cur = checkPermission(level, prev, mod, action);
      const lvl = (next[level] ?? (next[level] = {})) as Record<string, Record<string, boolean>>;
      lvl[mod] = { ...(lvl[mod] ?? {}), [action]: !cur };
      return next;
    });
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const r = await apiFetch<{ matrix?: PermissionMatrix }>("/api/permissions", { method: "PATCH", json: { matrix } });
    setSaving(false);
    if (!r.ok) {
      toast(r.error || "Couldn't save the permissions");
      return false;
    }
    const saved = (r.data?.matrix as PermissionMatrix) ?? matrix;
    setMatrix(saved);
    setOriginal(saved);
    setDirty(false);
    // The client hooks cache the matrix per page load; drop it so this
    // session's chrome follows the save at once.
    invalidatePermissionCache();
    toast("Permissions saved");
    return true;
  };


  const modules = Object.entries(PERMISSION_MODULES) as [PermissionModule, (typeof PERMISSION_MODULES)[PermissionModule]][];

  return (
    <SettingsPage pageKey="access" width="list">
      <p className="mb-5 max-w-2xl text-base text-ink-2">
        Control exactly who can do what. Each column is an access level; tick a capability to grant it.
        Super&nbsp;Admin and Company&nbsp;Admin always have full access.
        {canEdit ? "" : " You need Company Admin to make changes; this view is read-only."}
      </p>

      {/* Access toggle 10. The share dialogs on SOPs and docs send admins
          here when a public link is refused, so the control lives on the
          same page as the rest of the access rules. */}
      <div className="mb-5 max-w-2xl">
        <PublicLinksCard canEdit={canEdit} />
      </div>

      {loadError ? (
        <ErrorState what="the permission matrix" hint={loadError} onRetry={() => { void load(); }} />
      ) : loading ? (
        <div className="max-w-2xl"><SkeletonRows rows={5} rowHeight="44px" /></div>
      ) : (
        <div className="space-y-2.5 pb-4">
          {modules.map(([mod, def]) => {
            const actions = Object.entries(def.actions) as [string, string][];
            return (
              <details
                key={mod}
                open={openMods.has(mod)}
                onToggle={(e) => {
                  const isOpen = e.currentTarget.open;
                  setOpenMods((prev) => {
                    const n = new Set(prev);
                    if (isOpen) n.add(mod); else n.delete(mod);
                    return n;
                  });
                }}
                className="group rounded-xl border border-zinc-200 bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-base font-medium text-zinc-900">
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-90" />
                  {def.label}
                  <span className="text-sm font-normal text-zinc-400">· {actions.length}</span>
                </summary>
                <div className="overflow-x-auto border-t border-zinc-100 px-2 pb-2">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-medium text-zinc-500">Capability</th>
                        {ACCESS_LEVELS.map((l) => (
                          <th key={l.value} title={`${l.label}: ${l.description}`}
                              className="whitespace-nowrap px-1.5 py-2 text-center font-medium text-zinc-500">
                            {SHORT[l.value]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {actions.map(([action, label]) => (
                        <tr key={action} className="border-t border-zinc-100">
                          <td className="sticky left-0 z-10 bg-white px-2 py-1.5 text-zinc-700">{label}</td>
                          {ACCESS_LEVELS.map((l) => {
                            const on = checkPermission(l.value, matrix, mod, action);
                            const isProtected = PROTECTED_ADMIN_ROLES.includes(l.value);
                            return (
                              <td key={l.value} className="px-1.5 py-1.5 text-center">
                                {isProtected ? (
                                  <Lock className="mx-auto h-3 w-3 text-zinc-300" />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    disabled={!canEdit}
                                    onChange={() => toggle(l.value, mod, action)}
                                    className="h-3.5 w-3.5 accent-zinc-900 disabled:opacity-40"
                                    aria-label={`${l.label}: ${label}`}
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          onDiscard={() => { setMatrix(original); setDirty(false); }}
          onSave={save}
        />
      ) : null}
    </SettingsPage>
  );
}
