"use client";

/* /imports (spec-tables-forms section 2): KEPT at its URL, inside the
 * settings takeover, for Owners and Admins (the layout shows everyone else
 * the AdminOnly card with the "Import a CSV into a table" link).
 *
 * What changed, and where every old door went:
 *   - "CSV into a table" was a link card that sent you to /tables to find an
 *     Import button. It is the in-place CSV import dialog now, opened right
 *     here (and from /tables, the sheet's File menu and the Tables hub "+"
 *     for any Member).
 *   - "People CSV" linked to the Directory, which has no import control: a
 *     dead end, removed. The real People importer is the settings unit's
 *     Settings > Data > Import tab (Phase 8), wired to /api/people/bulk-import.
 *   - The five competitor tiles are one line, and only under "Show upcoming
 *     features".
 *   - The "Database" wording is gone (naming canon: Table).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Table2, Upload } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { CsvImportDialog } from "@/components/tables/csv-import-dialog";

export default function ImportsPage() {
  const router = useRouter();
  const showUpcoming = useShowUpcoming();
  const { prefs } = useOsShell();
  const tablesOn = Array.isArray(prefs.modules?.activeAppKeys) && prefs.modules.activeAppKeys.includes("tables");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* No in-page title bar (spec /imports: the settings takeover's navy
          bar carries the one breadcrumb, Settings > Workspace settings >
          Data > Import); the heading is for assistive tech only. */}
      <h1 className="sr-only">Import</h1>
      <div className="os-chrome flex-1 overflow-y-auto px-6 pb-10 pt-4">
        <p className="m-0 mb-6 max-w-2xl text-base text-ink-2">Bring existing work into this workspace.</p>
        <section className="max-w-2xl rounded-lg border border-line bg-raised" aria-labelledby="imp-table">
          <div className="flex items-start gap-3 px-5 py-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-hover text-ink-2" aria-hidden>
              <Table2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="imp-table" className="m-0 text-base font-semibold text-ink">A CSV into a table</h2>
              <p className="m-0 mt-0.5 text-base text-ink-2">
                Create a new table from a CSV file, or add its rows to a table you already have. Check a preview of the first rows and name and type each column before anything is written.
              </p>
              {!tablesOn ? (
                <p className="m-0 mt-2 text-sm text-ink-2">
                  Tables is turned off for this workspace. <Link href="/settings/modules" className="font-medium text-brand-deep hover:underline">Turn it on in Apps and modules</Link> to import a CSV into a table.
                </p>
              ) : null}
            </div>
            {tablesOn ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-ink-inv hover:bg-brand-hover"
              >
                <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                Import a CSV
              </button>
            ) : null}
          </div>
        </section>
        {showUpcoming ? (
          <p className="m-0 mt-4 max-w-2xl text-sm text-ink-3">Imports from ClickUp, Asana, Trello, Excel and Google Sheets are coming.</p>
        ) : null}
      </div>
      {tablesOn ? (
        <CsvImportDialog
          open={open}
          onClose={() => setOpen(false)}
          onDone={({ tableId, created }) => { if (created) router.push(`/tables/${tableId}`); }}
        />
      ) : null}
    </div>
  );
}
