"use client";

// The generated index of one door (settings-architecture 8.2, 4.7 and 5.17):
// every page of the door in sidebar order, its tabs, and the individual
// settings the registry knows, with a filter over all of it. Nothing here is
// hand-written: it is the registry, so a page that ships appears here the
// moment its row does.
//
// Settings clean-up Phase 7 (B1, B10): the search field is Overview's, the
// same look and the same 480 width (SETTINGS_SEARCH_FIELD), and Esc empties
// it as Overview's does; the two cards fill the page column; a search that
// finds no page says so in one line, with its action, Clear search, only
// when no individual setting matches either (Phase 7 review, L1: it offered
// to clear a search whose results sat right under it).

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  filterSettingsEntries,
  filterSettingsPages,
  settingsHrefToday,
  settingsTabs,
  SETTINGS_ENTRY_LIST,
  SETTINGS_PAGE_LIST,
  type SettingsDoor,
} from "@/lib/settings-registry";
import { SettingsCard } from "@/components/settings/settings-card";
import { SETTINGS_SEARCH_FIELD } from "@/components/settings/settings-page";
import { useViewerRole } from "@/components/layout/os/boot-context";


export function AllSettingsIndex({ door, allowedExternalGates = [] }: { door: SettingsDoor; allowedExternalGates?: readonly ("manage_process")[] }) {
  const [query, setQuery] = useState("");
  const pages = useMemo(() => {
    const matched = new Set(filterSettingsPages(query, door).map((p) => p.key));
    return SETTINGS_PAGE_LIST.filter((p) => p.door === door && p.key !== "all" && p.key !== "account/all" && settingsHrefToday(p) !== null && matched.has(p.key));
  }, [door, query]);
  const { isGuest } = useViewerRole();
  const entries = useMemo(
    () => (query.trim()
      ? filterSettingsEntries(query, { door, allowedExternalGates, guest: isGuest })
      : SETTINGS_ENTRY_LIST.filter((e) => e.door === door && !(isGuest && e.notForGuests) && (!e.externalGate || allowedExternalGates.includes(e.externalGate as "manage_process")))),
    [door, query, allowedExternalGates, isGuest],
  );

  return (
    <div className="flex flex-col gap-6">
      <label className={SETTINGS_SEARCH_FIELD}>
        <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Esc empties the field first, and only then leaves it to the page.
          onKeyDown={(e) => { if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); } }}
          placeholder="Find a setting"
          aria-label="Find a setting"
          className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </label>
      <SettingsCard title="Pages">
        {pages.length === 0 ? (
          <p className="m-0 flex min-h-11 items-center text-base text-ink-2">
            {entries.length === 0 ? (
              <>
                No pages match ·
                <button type="button" className="ms-1 text-brand-deep hover:underline" onClick={() => setQuery("")}>Clear search</button>
              </>
            ) : (
              "No pages match"
            )}
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {pages.map((p) => (
              <li key={p.key} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <Link href={p.href} className="min-w-[200px] text-base font-medium text-ink hover:underline">{p.label}</Link>
                {p.tabs && p.tabs.length > 1 ? (
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-2">
                    {settingsTabs(p.key).map((t) => (
                      <Link key={t.key} href={`${p.href}?tab=${t.key}`} className="hover:text-ink hover:underline">{t.label}</Link>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      {entries.length > 0 ? (
        <SettingsCard title="Individual settings">
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
