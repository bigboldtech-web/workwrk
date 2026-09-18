"use client";

/* Imports — the hub the sidebar "+" menu's Import button lands on.
 *
 * v1 surfaces the two CSV paths that already exist (Database CSV
 * import, People bulk-import) and previews the roadmap sources.
 *
 * TODO(plus-create-menu-plan §4): inline import sources — pick a
 * source + upload inside this page (ClickUp / Asana / Trello / Excel /
 * Google Sheets) instead of deep-linking to per-surface importers.
 */

import Link from "next/link";
import {
  ArrowRight,
  Database,
  Table2,
  Users,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { ComingSoonRow, useShowUpcoming } from "@/components/ui/coming-soon-row";

const COMING_SOON = ["ClickUp", "Asana", "Trello", "Excel", "Google Sheets"];

export default function ImportsPage() {
  // Not-yet-wired sources render only for a viewer who opted in
  // (spec-shell 1.15); otherwise they are absent, not dressed as chips.
  const showUpcoming = useShowUpcoming();
  return (
    <div className="flex h-full flex-col">
      <OsPageHeader title="Imports" />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Available now
        </div>
        <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/tables"
            className="group rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            <div className="mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-600" />
              <span className="text-base font-semibold text-zinc-900">CSV → Database</span>
              <ArrowRight className="ml-auto h-3.5 w-3.5 text-zinc-300 transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="text-base text-zinc-500">
              Import a CSV into a spreadsheet-style Database. Open (or create) a database,
              then use its Import button — new columns are added automatically.
            </p>
          </Link>
          <Link
            href="/people"
            className="group rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            <div className="mb-2 flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              <span className="text-base font-semibold text-zinc-900">People CSV</span>
              <ArrowRight className="ml-auto h-3.5 w-3.5 text-zinc-300 transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="text-base text-zinc-500">
              Bulk-import employees from a CSV on the People page — names, emails, titles,
              departments and more.
            </p>
          </Link>
        </div>

        {showUpcoming ? (
          <>
            <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Upcoming
            </div>
            <div className="max-w-3xl">
              {COMING_SOON.map((source) => (
                <ComingSoonRow key={source} label={`Import from ${source}`} icon={Table2} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
