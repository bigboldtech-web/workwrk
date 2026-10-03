"use client";

// "Who can do what" on Settings, Access: the read-only permission matrix
// (founder decision 3). Nothing here is a control. The List table's cells
// come from src/lib/access/permission-matrix.ts, which asks the task gate's
// own functions, so what this page says is what the product does.

import { Check } from "lucide-react";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { listMatrix, RELATIONSHIP_RULES, WORKSPACE_ROLES, type MatrixCell } from "@/lib/access/permission-matrix";

const CELL_WORD: Record<Exclude<MatrixCell, "yes">, string> = {
  no: "No",
  assigned: "Assigned to them",
  own: "Made by them",
  assignedOrOwn: "Assigned to or made by them",
};

function Cell({ value }: { value: MatrixCell }) {
  if (value === "yes") {
    return (
      <span className="inline-flex items-center justify-center text-[var(--os-brand)]">
        <Check className="h-4 w-4" strokeWidth={2} aria-hidden />
        <span className="sr-only">Yes</span>
      </span>
    );
  }
  return <span className={value === "no" ? "text-xs text-ink-3" : "text-xs font-medium text-ink"}>{CELL_WORD[value]}</span>;
}

export function PermissionMatrixView() {
  const m = listMatrix();
  return (
    <SettingsCardStack>
      <SettingsCard title="On a List and its tasks" wide="access.matrix" id="access.matrix">
        <p className="m-0 max-w-[720px] text-sm text-ink-2">
          The level someone is given when a List is shared with them. Every cell is worked out by the rule that enforces it, so this is what WorkwrK
          does today. A cell that names tasks applies to those tasks only: the ones assigned to them, or the ones they made.
        </p>
        {/* Positioned, so the cells' screen-reader words (absolutely placed)
            are clipped by this scroller instead of widening the page on a phone. */}
        <div className="relative mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">Who can do what on a List and its tasks, by the level the List is shared at</caption>
            <thead>
              <tr className="bg-[var(--os-table-head-bg)]">
                <th scope="col" className="sticky left-0 z-10 bg-[var(--os-table-head-bg)] px-3 py-2 text-start text-xs font-semibold text-ink-2">
                  What they can do
                </th>
                {m.columns.map((c) => (
                  <th key={c.role} scope="col" className="px-3 py-2 text-center text-xs font-semibold text-ink" title={c.blurb}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.key} className="border-t border-line-soft">
                  <th scope="row" className="sticky left-0 z-10 bg-raised px-3 py-2 text-start font-normal text-ink">
                    {r.label}
                  </th>
                  {r.cells.map((v, i) => (
                    <td key={m.columns[i].role} className="px-3 py-2 text-center">
                      <Cell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 grid max-w-[720px] gap-2 text-sm">
          {m.columns.map((c) => (
            <div key={c.role}>
              <dt className="inline font-medium text-ink">{c.label}:</dt> <dd className="m-0 inline text-ink-2">{c.blurb}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>

      <SettingsCard title="Rules that add to a share" id="access.matrix.rules">
        <ul className="m-0 flex max-w-[720px] list-none flex-col gap-2 p-0 text-sm">
          {RELATIONSHIP_RULES.map((r) => (
            <li key={r.key}>
              <span className="font-medium text-ink">{r.who}:</span> <span className="text-ink-2">{r.gets}</span>
            </li>
          ))}
        </ul>
        <p className="mb-0 mt-3 max-w-[720px] text-xs text-ink-3">
          A workspace made before the current sharing rules keeps the access people had then wherever it is higher, until an Owner moves it to the
          new rules.
        </p>
      </SettingsCard>

      <SettingsCard title="Workspace roles" id="access.matrix.roles">
        <ul className="m-0 flex max-w-[720px] list-none flex-col gap-2 p-0 text-sm">
          {WORKSPACE_ROLES.map((r) => (
            <li key={r.role}>
              <span className="font-medium text-ink">{r.role}:</span> <span className="text-ink-2">{r.summary}</span>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </SettingsCardStack>
  );
}
