"use client";

// The generated index of one door (settings-architecture 8.2, 4.7 and 5.17):
// every page of the door in sidebar order, its tabs, and the individual
// settings the registry knows, with a filter over all of it. Nothing here is
// hand-written: it is the registry, so a page that ships appears here the
// moment its row does.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  filterSettingsEntries,
  filterSettingsPages,
  settingsHrefToday,
  SETTINGS_ENTRY_LIST,
  SETTINGS_PAGE_LIST,
  type SettingsDoor,
} from "@/lib/settings-registry";
import { SettingsCard } from "@/components/settings/settings-card";

const TAB_LABELS: Record<string, string> = {
  appearance: "Appearance",
  profile: "Profile",
  overview: "Overview",
  departments: "Departments",
  titles: "Job titles",
  fields: "Profile fields",
  types: "Task types",
  tags: "Tags",
  export: "Export",
  import: "Import",
};

export function AllSettingsIndex({ door, allowedExternalGates = [] }: { door: SettingsDoor; allowedExternalGates?: readonly ("manage_process")[] }) {
  const [query, setQuery] = useState("");
  const pages = useMemo(() => {
    const matched = new Set(filterSettingsPages(query, door).map((p) => p.key));
    return SETTINGS_PAGE_LIST.filter((p) => p.door === door && p.key !== "all" && p.key !== "account/all" && settingsHrefToday(p) !== null && matched.has(p.key));
  }, [door, query]);
  const entries = useMemo(
    () => (query.trim() ? filterSettingsEntries(query, { door, allowedExternalGates }) : SETTINGS_ENTRY_LIST.filter((e) => e.door === door && (!e.externalGate || allowedExternalGates.includes(e.externalGate as "manage_process")))),
    [door, query, allowedExternalGates],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex h-9 max-w-[560px] items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
        <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a setting"
          aria-label="Find a setting"
          className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>
      <SettingsCard wide="all.index" title="Pages">
        {pages.length === 0 ? (
          <p className="text-base text-ink-2">No page matches.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {pages.map((p) => (
              <li key={p.key} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <Link href={p.href} className="min-w-[200px] text-base font-medium text-ink hover:underline">{p.label}</Link>
                {p.tabs && p.tabs.length > 1 ? (
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-2">
                    {p.tabs.map((t) => (
                      <Link key={t} href={`${p.href}?tab=${t}`} className="hover:text-ink hover:underline">{TAB_LABELS[t] ?? t}</Link>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      {entries.length > 0 ? (
        <SettingsCard wide="all.index" title="Individual settings">
          <ul className="divide-y divide-line-soft">
            {entries.map((e) => (
              <li key={e.id} className="flex min-h-12 flex-col justify-center py-2">
                <Link href={e.href} className="text-base font-medium text-ink hover:underline">{e.label}</Link>
                <span className="text-sm text-ink-2">{e.description}</span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      ) : null}
    </div>
  );
}
