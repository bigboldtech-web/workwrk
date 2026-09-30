"use client";

// Workspace settings > Access, in its TRANSITIONAL form (spec-settings-
// workspace `/settings/access` and S3; settings-architecture 5.7). The old
// /settings/permissions 308s here.
//
//   Card 1  How access works: the model in plain words with live counts
//   Card 2  Public links (access toggle 10), the one toggle already read
//           by the product (share dialogs, the public SOP and doc links)
//   Legacy  the FOURTEEN cells of the old permission grid the server really
//           enforces (settings-architecture 5.7: people.create, sops.*,
//           policies.create, kras.*, assets.*, announcements.create), in
//           their own grid, still saved to Organization.settings.permissions
//           exactly as before
//   Other   every other cell of the old grid, behind a disclosure and
//           labelled for what it is: it changes what some menus show, and
//           the server does not check it. Kept editable so nothing an admin
//           configured stops being changeable before the ten access toggles
//           and the matrix export (access step 5) replace it
//
// The grid saves through the one Save bar (PATCH /api/permissions), and the
// page's client permission cache is dropped after a save.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useViewerRole } from "@/components/layout/os/boot-context";
import {
  PERMISSION_MODULES, ACCESS_LEVELS, PROTECTED_ADMIN_ROLES, checkPermission,
  type AccessLevel, type PermissionModule, type PermissionMatrix,
} from "@/lib/permissions";
import { PublicLinksCard } from "@/components/settings/public-links-card";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsReadOnlyBanner } from "@/components/settings/settings-read-only";
import { SaveBar } from "@/components/settings/save-bar";
import { ErrorState } from "@/components/ui/error-state";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-client";
import { invalidatePermissionCache } from "@/hooks/use-permission";

/** The cells the server enforces (settings-architecture 5.7, the 14). */
export const ENFORCED_CELLS: readonly (readonly [PermissionModule, string])[] = [
  ["people", "create"],
  ["sops", "create"], ["sops", "edit"], ["sops", "publish"], ["sops", "delete"],
  ["policies", "create"],
  ["kras", "create"], ["kras", "edit"], ["kras", "delete"], ["kras", "assign"],
  ["assets", "create"], ["assets", "edit"], ["assets", "delete"],
  ["announcements", "create"],
];
const ENFORCED = new Set(ENFORCED_CELLS.map(([m, a]) => `${m}.${a}`));

/** The column words (no raw enum is ever shown). */
const LEVEL_WORD: Record<AccessLevel, string> = {
  SUPER_ADMIN: "Owner", COMPANY_ADMIN: "Admin", C_LEVEL: "Executive", VP: "VP",
  DIRECTOR: "Director", HR: "People team", MANAGER: "Manager", TEAM_LEAD: "Team lead", EMPLOYEE: "Member", AGENT: "Agent",
};

const clone = (m: PermissionMatrix): PermissionMatrix => JSON.parse(JSON.stringify(m));
type Counts = { owners: number; admins: number; members: number; guests: number; peopleTeam: number };

export default function AccessSettingsPage() {
  const { isAdmin } = useViewerRole();
  const canEdit = isAdmin;
  const [matrix, setMatrix] = useState<PermissionMatrix>({});
  const [original, setOriginal] = useState<PermissionMatrix>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [r, c] = await Promise.all([
      apiFetch<{ matrix?: PermissionMatrix }>("/api/permissions", { cache: "no-store" }),
      apiFetch<{ counts: Counts }>("/api/settings/role-counts", { cache: "no-store" }),
    ]);
    if (r.ok) {
      const m = (r.data?.matrix as PermissionMatrix) ?? {};
      setMatrix(m);
      setOriginal(m);
    } else setLoadError(r.error);
    if (c.ok) setCounts(c.data.counts);
    setLoading(false);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(matrix) !== JSON.stringify(original), [matrix, original]);

  const toggle = (level: AccessLevel, mod: PermissionModule, action: string) => {
    if (!canEdit || PROTECTED_ADMIN_ROLES.includes(level)) return;
    setMatrix((prev) => {
      const next = clone(prev);
      const cur = checkPermission(level, prev, mod, action);
      const lvl = (next[level] ?? (next[level] = {})) as Record<string, Record<string, boolean>>;
      lvl[mod] = { ...(lvl[mod] ?? {}), [action]: !cur };
      return next;
    });
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const r = await apiFetch<{ matrix?: PermissionMatrix }>("/api/permissions", { method: "PATCH", json: { matrix } });
    setSaving(false);
    if (!r.ok) { toast(r.error || "Couldn't save the permissions"); return false; }
    const saved = (r.data?.matrix as PermissionMatrix) ?? matrix;
    setMatrix(saved);
    setOriginal(saved);
    invalidatePermissionCache();
    toast("Permissions saved");
    return true;
  };

  const legacyRows = ENFORCED_CELLS.map(([mod, action]) => ({ mod, action, label: (PERMISSION_MODULES[mod].actions as Record<string, string>)[action] ?? `${mod}.${action}` }));
  const otherRows = (Object.entries(PERMISSION_MODULES) as [PermissionModule, (typeof PERMISSION_MODULES)[PermissionModule]][])
    .flatMap(([mod, def]) => (Object.entries(def.actions) as [string, string][]).filter(([a]) => !ENFORCED.has(`${mod}.${a}`)).map(([action, label]) => ({ mod, action, label: `${def.label}: ${label}` })));

  const grid = (rows: { mod: PermissionModule; action: string; label: string }[], ariaLabel: string) => (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm" aria-label={ariaLabel}>
        <thead>
          <tr className="bg-hover">
            <th className="sticky start-0 z-10 min-w-[200px] bg-hover px-3 py-2 text-start font-medium text-ink-2">What</th>
            {ACCESS_LEVELS.map((l) => (
              <th key={l.value} className="whitespace-nowrap px-2 py-2 text-center font-medium text-ink-2">{LEVEL_WORD[l.value]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.mod}.${r.action}`} className="border-t border-line-soft">
              <td className="sticky start-0 z-10 bg-raised px-3 py-2 text-ink">{r.label}</td>
              {ACCESS_LEVELS.map((l) => {
                const on = checkPermission(l.value, matrix, r.mod, r.action);
                const locked = PROTECTED_ADMIN_ROLES.includes(l.value);
                return (
                  <td key={l.value} className="px-2 py-2 text-center">
                    {locked ? (
                      <Lock className="mx-auto h-3.5 w-3.5 text-ink-3" strokeWidth={1.5} aria-label={`${LEVEL_WORD[l.value]} always can`} />
                    ) : canEdit ? (
                      <input type="checkbox" checked={on} onChange={() => toggle(l.value, r.mod, r.action)} className="h-4 w-4 accent-[var(--os-brand)]" aria-label={`${LEVEL_WORD[l.value]}: ${r.label}`} />
                    ) : (
                      <span className="text-ink-2">{on ? "Yes" : "No"}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <SettingsPage pageKey="access" subtitle="Who can create, share and invite. A small team rarely needs to change these.">
      <SettingsCardStack>
        {canEdit ? null : <SettingsReadOnlyBanner>You can look at how access works here. Ask an Owner or Admin to change it.</SettingsReadOnlyBanner>}
        <SettingsCard title="How access works" wide="access.toggles" id="access.explainer">
          <div className="flex max-w-[720px] flex-col gap-3 text-base leading-relaxed text-ink">
            <p>
              Everyone here is an <strong>Owner</strong>{counts ? ` (${counts.owners})` : ""}, an <strong>Admin</strong>{counts ? ` (${counts.admins})` : ""} or a <strong>Member</strong>{counts ? ` (${counts.members})` : ""}.
 Owners run the company account: billing, ownership and security. Admins run the workspace day to day: they open every Space, invite people and use every Settings page.
              Members work in the Spaces they are added to and see what is open to the whole company.
            </p>
            <p>
              The <strong>People team</strong>{counts ? ` (${counts.peopleTeam})` : ""}{" "}looks after everyone&apos;s people information. Until the new roles are switched on, a Member also carries a seniority tier (Manager, Director and so on) that decides which manager pages they open; set it on their row in Members.
            </p>
            <p>
              Everything you make can be shared at one of four levels: <strong>Full access</strong>, <strong>Can edit</strong>, <strong>Can comment</strong> or <strong>Can view</strong>. Sharing flows down from a Space to its Folders and Lists, adding someone never takes anything away, and <strong>Private</strong> on a Folder or List stops it taking access from above. Assigning someone a task lets them open it; you have Full access to what you made.
            </p>
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Link href="/settings/members" className="font-medium text-brand-deep hover:underline">Manage people</Link>
              <span className="text-ink-2">See who can open something: its ••• menu, then Share.</span>
            </p>
          </div>
        </SettingsCard>

        <div className="w-full max-w-[560px]" id="access.publicLinks">
          <PublicLinksCard canEdit={canEdit} />
        </div>

        <section aria-label="Legacy" id="access.legacy">
          <div className="mb-2 flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">Legacy<span className="h-px flex-1 bg-line" aria-hidden /></div>
          <p className="mb-1 text-sm text-ink-2">These are the rules from the old permissions grid that the server actually checks. They become part of the access model above.</p>
          <p className="mb-3 text-sm text-ink-2">
            When the new access engine is switched on, this grid retires into ten plain switches and Lock it down, and a copy of it as it stood is kept for download on Data &gt; Export. Until then it keeps working exactly as before. The Owner column is the stored Owner level; the workspace&apos;s first Admin is an Owner too and follows the Admin column.
          </p>
          {loadError ? (
            <ErrorState what="the permission grid" hint={loadError} onRetry={() => { void load(); }} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : (
            <div className="flex flex-col gap-4">
              {grid(legacyRows, "Enforced permissions")}
              <div>
                <button type="button" className="text-sm font-medium text-brand-deep hover:underline" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}>
                  {showOthers ? "Hide" : "Show"} the rest of the old grid ({otherRows.length} rules)
                </button>
                {showOthers ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-sm text-ink-2">The server does not check these; some change what a menu shows. They are kept until the new access settings replace them, and a copy is offered on Data when the grid retires.</p>
                    {grid(otherRows, "Other permissions")}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </SettingsCardStack>
      {canEdit ? <SaveBar dirty={dirty} saving={saving} onDiscard={() => setMatrix(original)} onSave={save} /> : null}
    </SettingsPage>
  );
}
