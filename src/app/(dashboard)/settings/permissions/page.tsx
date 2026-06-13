"use client";

// Roles & Permissions — the governance control surface. Exposes the
// existing org permission matrix (src/lib/permissions.ts +
// /api/permissions) as a granular modules × actions × access-levels grid.
// This is the "who can create/assign/publish KRAs, KPIs, SOPs…" screen
// that was missing — the engine already existed, this is the knobs.
//
// Super Admin / Company Admin are always-full (PROTECTED_ADMIN_ROLES) and
// shown locked. Only those two roles can SAVE changes; everyone else sees
// the matrix read-only.

import { useEffect, useState } from "react";
import { ShieldCheck, ChevronRight, Check, AlertCircle, Loader2, Lock } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import {
  PERMISSION_MODULES, ACCESS_LEVELS, PROTECTED_ADMIN_ROLES, checkPermission,
  type AccessLevel, type PermissionModule, type PermissionMatrix,
} from "@/lib/permissions";

const SHORT: Record<AccessLevel, string> = {
  SUPER_ADMIN: "Super", COMPANY_ADMIN: "Admin", C_LEVEL: "C-Lvl", VP: "VP",
  DIRECTOR: "Dir", HR: "HR", MANAGER: "Mgr", TEAM_LEAD: "Lead", EMPLOYEE: "Emp", AGENT: "Agent",
};

// Governance-critical modules open by default; the rest collapsed.
const DEFAULT_OPEN = new Set<string>(["kras", "sops", "people", "reviews"]);

const clone = (m: PermissionMatrix): PermissionMatrix => JSON.parse(JSON.stringify(m));

export default function PermissionsPage() {
  const { accessLevel } = useRole();
  const canEdit = accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN";

  const [matrix, setMatrix] = useState<PermissionMatrix>({});
  const [openMods, setOpenMods] = useState<Set<string>>(() => new Set(DEFAULT_OPEN));
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/permissions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setMatrix(((d?.matrix as PermissionMatrix) ?? {})); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

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
    setBanner(null);
  };

  const save = async () => {
    setSaving(true); setBanner(null);
    try {
      const res = await fetch("/api/permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matrix }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Save failed");
      setMatrix((d?.matrix as PermissionMatrix) ?? matrix);
      setDirty(false);
      setBanner({ kind: "ok", text: "Permissions saved" });
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const modules = Object.entries(PERMISSION_MODULES) as [PermissionModule, (typeof PERMISSION_MODULES)[PermissionModule]][];

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Roles &amp; Permissions</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Control exactly who can do what. Each column is an access level; tick a capability to grant it.
        Super&nbsp;Admin and Company&nbsp;Admin always have full access.
        {canEdit ? "" : " You need Company Admin to make changes — this view is read-only."}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading permissions…
        </div>
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
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] font-medium text-zinc-900">
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-90" />
                  {def.label}
                  <span className="text-[12px] font-normal text-zinc-400">· {actions.length}</span>
                </summary>
                <div className="overflow-x-auto border-t border-zinc-100 px-2 pb-2">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-medium text-zinc-500">Capability</th>
                        {ACCESS_LEVELS.map((l) => (
                          <th key={l.value} title={`${l.label} — ${l.description}`}
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
        <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t border-zinc-200 bg-white/95 px-6 py-3 backdrop-blur">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[12px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </button>
          {dirty && !saving ? <span className="text-[12px] text-amber-600">Unsaved changes</span> : null}
          {banner ? (
            <span className={`inline-flex items-center gap-1 text-[12px] ${banner.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {banner.kind === "ok" ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {banner.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
