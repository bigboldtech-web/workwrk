"use client";

// Workspace settings > Overview (spec-settings-workspace `/settings`,
// settings-architecture 5.1).
//
//   1. Search settings (480px), backed by the registry: pages and fields,
//      grouped by page; Enter opens the first result. Results replace the
//      tile grid while the field has text.
//   2. Set up {Org}, first run only (SetupCard; data-derived ticks).
//   3. One LINK TILE per sidebar page, in the sidebar's order and groups,
//      each with two live values from GET /api/settings/overview (one round
//      trip). No tile links to /settings and none leaves the door.
//
// Zero blue buttons: the primary action of an overview is to leave it.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Search } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsShell } from "@/components/layout/os/shell-context";
import { SettingsPage } from "@/components/settings/settings-page";
import { SetupCard } from "@/components/settings/setup-card";
import { SETTINGS_ICONS } from "@/components/settings/settings-icons";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SETTINGS_PAGES,
  WORKSPACE_GROUP_ORDER,
  filterSettingsEntries,
  filterSettingsPages,
  settingsSidebar,
  settingsTabs,
  type SettingsPage as RegistryPage,
} from "@/lib/settings-registry";
import type { SettingsPageKey } from "@/lib/access/types";

interface OverviewBody {
  org: { name: string; plan: string; status: string };
  members: number;
  pendingInvites: number;
  cards: Partial<Record<SettingsPageKey, [string, string]>>;
  ownerOnly: string[];
  setup: { consoleRaw: unknown; hasLogoOrMission: boolean; activeUsers: number; activeModules: number };
}

/** One line per page, what it is for (the tile's 13/400 line). */
const PAGE_LINES: Partial<Record<SettingsPageKey, string>> = {
  identity: "Name, logo, mission and the look everyone starts with.",
  locale: "Time zone, money, fiscal year and the working week.",
  apps: "Modules, and what shows in everyone's rail.",
  members: "Everyone who works here, their role and their manager.",
  structure: "Departments, job titles, offices and the org chart.",
  access: "Who can create, share and invite.",
  tasks: "Task types, tags and the templates people start from.",
  scoring: "Review cadence, score weights and bands.",
  security: "How people sign in: passwords, sessions, two step verification.",
  data: "Export, import, retention and Trash.",
  audit: "What happened, who did it and what changed.",
  api: "Keys for anything that connects from outside.",
  billing: "Your plan, seats and invoices.",
  all: "Every workspace setting on one page.",
};

function tabLabel(pageKey: SettingsPageKey, href: string): string | null {
  const m = /[?&]tab=([^&#]+)/.exec(href);
  if (!m) return null;
  return settingsTabs(pageKey).find((t) => t.key === m[1])?.label ?? null;
}

/** "{N} settings", "across {N} pages" for the All settings tile (the registry is local). */
function countAll(): [string, string] {
  const entries = filterSettingsEntries("", { door: "workspace", allowedExternalGates: ["manage_process"] });
  const pages = new Set(entries.map((e) => e.page ?? e.href.split("?")[0]));
  return [`${entries.length} settings`, `across ${pages.size} pages`];
}

export function SettingsOverviewClient() {
  const router = useRouter();
  const { rowVersion } = useOsShell();
  const [data, setData] = useState<OverviewBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<OverviewBody>("/api/settings/overview", { cache: "no-store" });
    if (r.ok) setData(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onChanged = () => { void load(); };
    window.addEventListener("workwrk:prefs-changed", onChanged);
    return () => {
      clearTimeout(t);
      window.removeEventListener("workwrk:prefs-changed", onChanged);
    };
  }, [load]);
  const v = rowVersion("settings");
  useEffect(() => {
    if (v <= 0) return;
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [v, load]);

  // Results: matching pages, then matching fields under their page.
  const results = useMemo(() => {
    const query = q.trim();
    if (!query) return null;
    const pages = filterSettingsPages(query, "workspace").filter((p) => p.key !== "overview");
    const entries = filterSettingsEntries(query, { door: "workspace", allowedExternalGates: ["manage_process"] });
    const groups = new Map<string, { label: string; href: string; rows: { key: string; label: string; href: string; tab: string | null }[] }>();
    for (const p of pages) groups.set(p.key, { label: p.label, href: p.href, rows: [] });
    for (const e of entries) {
      const key = e.page ?? "other";
      const page = e.page ? SETTINGS_PAGES[e.page] : null;
      if (!groups.has(key)) groups.set(key, { label: page?.label ?? "Elsewhere", href: page?.href ?? e.href, rows: [] });
      groups.get(key)!.rows.push({ key: e.id, label: e.label, href: e.href, tab: e.page ? tabLabel(e.page, e.href) : null });
    }
    return [...groups.values()];
  }, [q]);

  const firstResultHref = results?.[0] ? (results[0].rows[0]?.href ?? results[0].href) : null;

  const tiles = useMemo(() => {
    const pages = settingsSidebar("workspace").filter((p) => p.key !== "overview");
    const out: { group: string | null; pages: RegistryPage[] }[] = [];
    for (const g of WORKSPACE_GROUP_ORDER) {
      const rows = pages.filter((p) => p.group === g);
      if (rows.length) out.push({ group: g, pages: rows });
    }
    const rest = pages.filter((p) => !p.group);
    if (rest.length) out.push({ group: null, pages: rest });
    return out;
  }, []);

  const plan = data ? `${data.org.plan.charAt(0)}${data.org.plan.slice(1).toLowerCase()}` : "";
  const subtitle = data ? `${data.org.name} · ${plan} · ${data.members} ${data.members === 1 ? "member" : "members"}` : undefined;

  return (
    <SettingsPage pageKey="overview" width="list" subtitle={subtitle}>
      <div className="flex flex-col gap-6">
        <label className="flex h-9 w-full max-w-[480px] items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
          <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && firstResultHref) router.push(firstResultHref);
              if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); }
            }}
            placeholder="Search settings"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </label>

        {results ? (
          <div className="w-full max-w-[760px] rounded-lg border border-line bg-raised">
            {results.length === 0 ? (
              <p className="flex h-11 items-center px-4 text-base text-ink-2">
                No results ·
                <button type="button" className="ms-1 text-brand-deep hover:underline" onClick={() => setQ("")}>Clear search</button>
              </p>
            ) : (
              results.map((g) => (
                <div key={g.label} className="border-b border-line-soft py-2 last:border-b-0">
                  <Link href={g.href} className="block px-4 py-1 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2 hover:text-ink">
                    {g.label}
                  </Link>
                  {g.rows.map((r) => (
                    <Link key={r.key} href={r.href} className="flex h-9 items-center gap-3 px-4 text-base text-ink hover:bg-hover">
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {r.tab ? <span className="text-sm text-ink-2">{r.tab}</span> : null}
                    </Link>
                  ))}
                </div>
              ))
            )}
            <div className="border-t border-line-soft px-4 py-2">
              <Link href="/settings/all" className="text-sm font-medium text-brand-deep hover:underline">See all settings</Link>
            </div>
          </div>
        ) : error ? (
          <ErrorState what="the workspace overview" hint={error} onRetry={() => { void load(); }} />
        ) : (
          <>
            {data ? (
              <SetupCard
                orgName={data.org.name}
                consoleRaw={data.setup.consoleRaw}
                hasLogoOrMission={data.setup.hasLogoOrMission}
                activeUsers={data.setup.activeUsers}
                activeModules={data.setup.activeModules}
                onChanged={() => { void load(); }}
              />
            ) : null}
            {tiles.map((section) => (
              <section key={section.group ?? "rest"} aria-label={section.group ?? "More"}>
                {section.group ? (
                  <div className="mb-2 flex items-center gap-3">
                    <h2 className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">{section.group}</h2>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2 min-[1120px]:grid-cols-3">
                  {section.pages.map((p) => (
                    <OverviewTile
                      key={p.key}
                      page={p}
                      values={p.key === "all" ? countAll() : (data?.cards[p.key] ?? null)}
                      locked={!!data?.ownerOnly.includes(p.key)}
                      loading={!data}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </SettingsPage>
  );
}

function OverviewTile({ page, values, locked, loading }: { page: RegistryPage; values: [string, string] | null; locked: boolean; loading: boolean }) {
  const Icon = SETTINGS_ICONS[page.icon] ?? SETTINGS_ICONS.List;
  return (
    <Link href={page.href} className="flex min-h-[132px] flex-col rounded-lg border border-line bg-raised p-4 transition-colors hover:bg-hover">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-deep" aria-hidden>
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-ink">{page.label}</span>
            {locked ? <Lock className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-label="Owners only" /> : null}
          </div>
          <p className="mt-0.5 text-sm text-ink-2">{PAGE_LINES[page.key] ?? ""}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-0.5 pt-3 text-base text-ink">
        {values ? (
          <>
            <span>{values[0]}</span>
            <span className="text-ink-2">{locked ? "Owners only" : values[1]}</span>
          </>
        ) : loading ? (
          <>
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
          </>
        ) : null}
      </div>
    </Link>
  );
}
