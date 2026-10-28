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
//
// Settings clean-up Phase 5 (B4, B6): every card says one or two sentences
// and keeps the rest behind Show more; a sentence that says what a control
// does to someone's access stays visible. Public links is a SettingsCard.
// Each grid is a TableCard (PermissionGrid) that scrolls sideways inside
// itself with its "What" column pinned, so the Member and Agent columns are
// reached without the page ever scrolling.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useViewerRole } from "@/components/layout/os/boot-context";
import {
  PERMISSION_MODULES, PROTECTED_ADMIN_ROLES, checkPermission,
  type AccessLevel, type PermissionModule, type PermissionMatrix,
} from "@/lib/permissions";
import { PermissionGrid } from "@/components/settings/permission-grid";
import { SettingsSection } from "@/components/settings/settings-section";
import { btn } from "@/components/settings/settings-form";
import { PublicLinksCard } from "@/components/settings/public-links-card";
import { AccessTogglesCard } from "@/components/settings/access-toggles-card";
import { AccessRequestsCard } from "@/components/settings/access-requests-card";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { settingsTabs } from "@/lib/settings-registry";
import { PermissionMatrixView } from "@/components/settings/permission-matrix-view";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsReadOnlyBanner } from "@/components/settings/settings-read-only";
import { SaveBar } from "@/components/settings/save-bar";
import { ErrorState } from "@/components/ui/error-state";
import type { TableFooter } from "@/components/ui/table-card";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-client";
import { invalidatePermissionCache } from "@/lib/access/use-legacy-permissions";

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

const clone = (m: PermissionMatrix): PermissionMatrix => JSON.parse(JSON.stringify(m));
type Counts = { owners: number; admins: number; members: number; guests: number; peopleTeam: number };

/** Settings, and "Who can do what", the read-only permission matrix. */
const ACCESS_TABS: readonly SettingsTab[] = settingsTabs("access");

/**
 * The Legacy grid's visible line: what it is, who it never limits (the grid
 * has no Owner or Admin column: they always can, final Settings review, M2),
 * and that a change to it still applies (the consequence of a tick, saved
 * through the Save bar). Its Show more ends the line.
 */
const LEGACY_LINE = "The old grid's rules, which still apply. Owners and Admins always can. A change here applies to everyone once saved.";
/** The rest of the Legacy explanation, behind Show more. */
const LEGACY_MORE =
  "When the new access rules are turned on, this grid is replaced by ten plain switches and Lock it down, and a copy of it as it stood is kept for download on Data > Export. Until then it keeps working exactly as before.";

/**
 * How access works, past its two lines: only what they do not already say
 * (Phase 5 review, L5: the opened text used to repeat what Admins and Members
 * do), then the People team, the share levels and where to see who can open
 * something.
 */
function AccessExplainerMore({ peopleTeam }: { peopleTeam: number | null }) {
  const b = "font-medium text-ink";
  return (
    <>
      <p>
        Owners run the company account: billing, ownership and security. Admins also invite people and use every Settings page, and Members also see what is open
        to the whole company.
      </p>
      <p>
        The <span className={b}>People team</span>{peopleTeam !== null ? ` (${peopleTeam})` : ""}{" "}looks after everyone&apos;s people information. Until the new roles
        are switched on, a Member also carries a seniority tier (Manager, Director and so on) that decides which manager pages they open; set it on their row in Members.
      </p>
      <p>
        Each thing you share offers its own levels: <span className={b}>Full access</span> and <span className={b}>Can edit</span> on everything, <span className={b}>Can view</span> on
        all but tables, <span className={b}>Can comment</span> on Docs and Lists, <span className={b}>Can edit assigned tasks</span> on Lists (read and discuss every task, change only
        the tasks assigned to them or that they made), and <span className={b}>Owner</span> on a Space. Sharing flows down from a Space to its Folders and Lists, a share only adds
        to what someone already has, and <span className={b}>Private</span> on a Folder or List stops it taking access from above. Assigning someone a task lets them open it and
        change it, and you have Full access to what you made, unless Can comment on a List is all the access someone holds there: then they change nothing in it.{" "}
        <span className={b}>Who can do what</span> above lays it all out.
      </p>
      <p>See who can open something: its ••• menu, then Share.</p>
    </>
  );
}

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
  // Phase 8 stage E: with ACCESS_V2_RESOLVER on the engine answers the grid's
  // enforced cells (matrix-rules.ts), so the grid retires from this page;
  // off, it keeps deciding and stays editable here.
  const [matrixDecides, setMatrixDecides] = useState(true);
  const [retired, setRetired] = useState<{ stored: boolean; at: string | null; mayExport: boolean }>({ stored: false, at: null, mayExport: false });
  const [showRetired, setShowRetired] = useState(false);
  const onModel = useCallback((m: { matrixDecides: boolean; matrixStored?: boolean; matrixRetiredAt?: string | null; mayExportMatrix?: boolean }) => {
    setMatrixDecides(m.matrixDecides);
    setRetired({ stored: !!m.matrixStored, at: m.matrixRetiredAt ?? null, mayExport: !!m.mayExportMatrix });
  }, []);
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

  const grid = (rows: { mod: PermissionModule; action: string; label: string }[], ariaLabel: string, readOnly = false, footer?: TableFooter) => (
    <PermissionGrid
      rows={loading ? null : rows}
      skeletonRows={rows.length}
      ariaLabel={ariaLabel}
      allows={(level, r) => checkPermission(level, matrix, r.mod, r.action)}
      canEdit={canEdit}
      readOnly={readOnly}
      onToggle={toggle}
      footer={footer}
    />
  );
  // The rest of the old grid opens from the enforced grid's own footer,
  // inside its border, never a link floating under the card (final
  // Settings review, M2). No total: the line is the disclosure itself.
  const othersToggle: TableFooter = {
    total: legacyRows.length,
    noun: "rules",
    from: 1,
    to: legacyRows.length,
    hideTotal: true,
    hidePaging: true,
    leading: (
      <button type="button" className="text-sm font-medium text-brand-deep hover:underline" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}>
        {showOthers ? "Hide" : "Show"} the rest of the old grid ({otherRows.length} rules)
      </button>
    ),
  };

  return (
    <SettingsPage pageKey="access" tabs={ACCESS_TABS}>
      {(tab) => tab === "matrix" ? <PermissionMatrixView /> : (<>
      <SettingsCardStack>
        {canEdit ? null : <SettingsReadOnlyBanner>You can look at how access works here. Ask an Owner or Admin to change it.</SettingsReadOnlyBanner>}
        <SettingsCard
          title="How access works"
          id="access.explainer"
          description={
            <>
              Everyone here is an Owner{counts ? ` (${counts.owners})` : ""}, an Admin{counts ? ` (${counts.admins})` : ""} or a Member{counts ? ` (${counts.members})` : ""}.
              {" "}Admins run the workspace and open every Space; Members work in the Spaces they are added to.
            </>
          }
          more={<AccessExplainerMore peopleTeam={counts?.peopleTeam ?? null} />}
          actions={<Link href="/settings/members" className={btn.link}>Manage people</Link>}
        />

        <AccessTogglesCard onModel={onModel} />

        <PublicLinksCard canEdit={canEdit} />

        <AccessRequestsCard />

        {!matrixDecides ? (
          <SettingsSection label="Legacy" id="access.legacy" description="The grid has retired: the switches above and the fixed rules decide now.">
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-ink-2">
                {!retired.stored
                  ? "This workspace never changed it, so it followed the shipped defaults."
                  : retired.at && retired.mayExport
                    ? <>A copy as this workspace stored it is on <Link href="/settings/data?tab=export" className="font-medium text-brand-deep underline underline-offset-2">Data &gt; Export</Link>.</>
                    : retired.at
                      ? "A copy as this workspace stored it is kept on Data > Export, which an Owner can download."
                      : "The copy for Data > Export has not been written yet; the grid as stored is below, read-only."}
              </p>
              <div>
                <button type="button" className="text-sm font-medium text-brand-deep hover:underline" aria-expanded={showRetired} onClick={() => setShowRetired((v) => !v)}>
                  {showRetired ? "Hide" : "Show"} the grid as it stood (read-only)
                </button>
                {showRetired ? (
                  <div className="mt-2 flex flex-col gap-4">
                    {loadError ? (
                      <ErrorState what="the permission grid" hint={loadError} onRetry={() => { void load(); }} />
                    ) : (
                      <>
                        {grid(legacyRows, "Retired enforced permissions", true)}
                        {grid(otherRows, "Retired other permissions", true)}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </SettingsSection>
        ) : (
          <SettingsSection label="Legacy" id="access.legacy" description={LEGACY_LINE} more={<p className="m-0">{LEGACY_MORE}</p>}>
            {loadError ? (
              <ErrorState what="the permission grid" hint={loadError} onRetry={() => { void load(); }} />
            ) : (
              <div className="flex flex-col gap-4">
                {grid(legacyRows, "Enforced permissions", false, othersToggle)}
                {showOthers ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-ink-2">The server does not check these; some change what a menu shows. They are kept until the new access settings replace them, and a copy is offered on Data when the grid retires.</p>
                    {grid(otherRows, "Other permissions")}
                  </div>
                ) : null}
              </div>
            )}
          </SettingsSection>
        )}
      </SettingsCardStack>
      {canEdit && matrixDecides ? <SaveBar dirty={dirty} saving={saving} onDiscard={() => setMatrix(original)} onSave={save} /> : null}
      </>)}
    </SettingsPage>
  );
}
