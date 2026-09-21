"use client";

/* /sops/manage, "Organize" (spec-process section 2): the folders, tags and
 * categories that SOPs, policies and contracts are filed under, and the
 * defaults for acknowledgements.
 *
 *   header   BackButton "SOPs", title "Organize"; views row = the settings
 *            sub-tabs SOP folders · Tags · Policy categories · Contract
 *            folders · Defaults as text-tab pills. The open tab is the URL
 *            (?tab=sop-folders | tags | policy-categories | contract-folders
 *            | defaults): an unknown value falls back to SOP folders
 *            silently; a known value the viewer cannot hold renders SOP
 *            folders with the parameter stripped and one notice line (shape
 *            2, never a 404). Clicking a pill is a router.replace.
 *   body     760 max, the settings-form look; the one blue button sits
 *            inside each tab ("New folder", "New category").
 *
 * Who: Owner, Admin and the People team hold every tab (the manage_process
 * rule, transcribed as today's admin tier); a manager who can create SOPs
 * reaches SOP folders and Tags. Everyone else gets the in-shell 404 (shape
 * 1: the Organize entry points render only for people who pass).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { NotFoundView } from "@/components/access/not-found-view";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useRole } from "@/hooks/use-role";
import { SopFoldersTagsManager } from "@/components/settings/sop-folders-tags-manager";
import { OrganizeListTab } from "@/components/settings/organize-list-tab";
import { OrganizeDefaults } from "@/components/settings/organize-defaults";
import { apiFetch } from "@/lib/api-fetch";
import { ORGANIZE_TABS, ORGANIZE_TAB_LABEL, resolveOrganizeTab, type OrganizeTab } from "@/lib/organize-tabs";
import type { ProcessSettings } from "@/lib/process-settings";

type ProcessPayload = { process: ProcessSettings; policyCategoryCounts: Record<string, number>; contractFolderCounts: Record<string, number> };

export default function SopManagePage() {
  const { canManageSOPs, isAdmin } = useRole();
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const resolved = useMemo(() => resolveOrganizeTab(raw, { manageProcess: isAdmin, manageSops: canManageSOPs }), [raw, isAdmin, canManageSOPs]);
  const tab = resolved.tab;
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!resolved.strip) return;
    const t = setTimeout(() => { if (resolved.notice) setNotice(resolved.notice); router.replace("/sops/manage"); }, 0);
    return () => clearTimeout(t);
  }, [resolved.strip, resolved.notice, router]);

  const [process, setProcess] = useState<ProcessPayload | null>(null);
  const [processError, setProcessError] = useState(false);
  const loadProcess = useCallback(async () => {
    const r = await apiFetch<ProcessPayload>("/api/settings/process", { cache: "no-store" });
    if (!r.ok) { setProcessError(true); return; }
    setProcessError(false);
    setProcess(r.data);
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => void loadProcess(), 0);
    return () => clearTimeout(t);
  }, [isAdmin, loadProcess]);

  if (!canManageSOPs && !isAdmin) return <NotFoundView />;

  // spec-process section 2 `/sops/manage`: Tags, Policy categories, Contract
  // folders and Defaults do not render for a Full holder; only the folders tab.
  const tabs: OrganizeTab[] = ORGANIZE_TABS.filter((t) => (isAdmin ? true : t === "sop-folders"));
  const href = (t: OrganizeTab) => (t === "sop-folders" ? "/sops/manage" : `/sops/manage?tab=${t}`);

  return (
    <>
      <Breadcrumb items={[{ label: "SOPs", href: "/sops" }, { label: "Organize" }]} />
      <OsPageHeader
        title="Organize"
        back={{ fallbackHref: "/sops", label: "SOPs" }}
        views={tabs.length > 1 ? tabs.map((t) => <ViewTab key={t} label={ORGANIZE_TAB_LABEL[t]} active={tab === t} onClick={() => { setNotice(null); router.replace(href(t)); }} />) : undefined}
      />
      {notice ? <p className="os-chrome px-6 pt-1 text-sm text-ink-2">{notice}</p> : null}
      <div className="os-chrome px-6 py-4">
        <div className="flex max-w-[760px] flex-col gap-6">
          {tab === "sop-folders" || tab === "tags" ? (
            <SopFoldersTagsManager tab={tab === "tags" ? "tags" : "folders"} canCreateTopLevel={isAdmin || canManageSOPs} />
          ) : processError ? (
            <OsEmptyView variant="error" compact title="Couldn't load this tab" action={{ label: "Retry", onClick: () => void loadProcess() }} />
          ) : tab === "policy-categories" ? (
            <OrganizeListTab kind="policy-categories" items={process ? process.process.policyCategories : null} counts={process?.policyCategoryCounts ?? {}} onChanged={() => void loadProcess()} />
          ) : tab === "contract-folders" ? (
            <OrganizeListTab kind="contract-folders" items={process ? process.process.contractFolders : null} counts={process?.contractFolderCounts ?? {}} onChanged={() => void loadProcess()} />
          ) : process ? (
            <OrganizeDefaults value={process.process} onChanged={(next) => setProcess((p) => (p ? { ...p, process: { ...p.process, ...next } } : p))} />
          ) : (
            <div className="rounded-lg border border-line bg-raised p-6"><SkeletonRows rows={3} rowHeight="44px" /></div>
          )}
        </div>
      </div>
    </>
  );
}
