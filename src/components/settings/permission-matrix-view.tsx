"use client";

// "Who can do what" on Settings, Access: the read-only permission matrix
// (founder decision 3). Nothing here is a control. The List table's cells
// come from src/lib/access/permission-matrix.ts, which asks the task gate's
// own functions, so what this page says is what the product does.
//
// Each card is a title, one line, and its long list behind Show more (final
// Settings review, H1: about 35 lines of bold-led definitions read as a wall
// of text). What a level means is behind its own Show more under the table.
// A line that says what something leads to stays in view (Decided: a
// consequence is never folded away): that assigning a task opens it to the
// person assigned, and that an older workspace keeps any higher access it
// had. The definitions go behind Show more.

import { Check } from "lucide-react";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsMore } from "@/components/settings/settings-more";
import { listMatrix, RELATIONSHIP_RULES, WORKSPACE_ROLES, type MatrixCell, type MatrixRule } from "@/lib/access/permission-matrix";

const CELL_WORD: Record<Exclude<MatrixCell, "yes">, string> = {
  no: "No",
  assigned: "Assigned to them",
  own: "Made by them",
  assignedOrOwn: "Assigned to or made by them",
};

/** The share rules that are consequences, kept in view; the rest are definitions, behind Show more. */
export const SHOWN_RULES: ReadonlySet<string> = new Set(["assigning"]);

/** The rules card's one line, and the roles card's (final Settings review, H1). */
export const RULES_LINE = "What can raise or limit the level a List share gives someone.";
export const ROLES_LINE = "What Owners, Admins, Members and Agents can do across the workspace.";

/** One bold-led line: who, then what they get. */
function RuleLine({ rule }: { rule: Pick<MatrixRule, "who" | "gets"> }) {
  return (
    <li>
      <span className="font-medium text-ink">{rule.who}:</span> <span className="text-ink-2">{rule.gets}</span>
    </li>
  );
}

function Cell({ value }: { value: MatrixCell }) {
  if (value === "yes") {
    return (
      <span className="inline-flex items-center justify-center text-[var(--os-brand)]">
        <Check className="h-4 w-4" strokeWidth={2} aria-hidden />
        <span className="sr-only">Yes</span>
      </span>
    );
  }
  // "No" is an answer, drawn at --os-ink-2 (AA), quieter than the
  // conditional cells but never below contrast (settings-cleanup Phase 5).
  return <span className={value === "no" ? "text-xs text-ink-2" : "text-xs font-medium text-ink"}>{CELL_WORD[value]}</span>;
}

export function PermissionMatrixView() {
  const m = listMatrix();
  return (
    <SettingsCardStack>
      {/* Two lines that say how to read a cell stay in the description; how
          the cells are worked out is behind Show more (B4, B6). */}
      <SettingsCard
        title="On a List and its tasks"
        id="access.matrix"
        description="The level someone is given when a List is shared with them. A cell that names tasks applies to those tasks only: the ones assigned to them, or the ones they made."
        more={<p>Every cell is worked out by the rule that enforces it, so this is what WorkwrK does today.</p>}
      >
        {/* Positioned, so the cells' screen-reader words (absolutely placed)
            are clipped by this scroller instead of widening the page on a phone. */}
        <div className="relative overflow-x-auto rounded-lg border border-line">
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
        {/* The level words, each column's own blurb (also its header's
            title), behind Show more under the table they explain. */}
        <SettingsMore label="Show what each level means" openLabel="Hide what each level means">
          <dl className="m-0 grid max-w-[720px] gap-2 text-sm">
            {m.columns.map((c) => (
              <div key={c.role}>
                <dt className="inline font-medium text-ink">{c.label}:</dt> <dd className="m-0 inline text-ink-2">{c.blurb}</dd>
              </div>
            ))}
          </dl>
        </SettingsMore>
      </SettingsCard>

      <SettingsCard
        title="Rules that add to a share"
        id="access.matrix.rules"
        description={RULES_LINE}
        more={
          <ul className="m-0 flex max-w-[720px] list-none flex-col gap-2 p-0 text-sm">
            {RELATIONSHIP_RULES.filter((r) => !SHOWN_RULES.has(r.key)).map((r) => <RuleLine key={r.key} rule={r} />)}
          </ul>
        }
      >
        {/* The consequences, in view: who an assignment opens a task to. */}
        <ul className="m-0 flex max-w-[720px] list-none flex-col gap-2 p-0 text-sm">
          {RELATIONSHIP_RULES.filter((r) => SHOWN_RULES.has(r.key)).map((r) => <RuleLine key={r.key} rule={r} />)}
        </ul>
        {/* Who keeps more access than these rules give: an access sentence,
            so 13/400 --os-ink-2 like the rules above it, never 12px --os-ink-3. */}
        <p className="m-0 max-w-[720px] text-sm text-ink-2">
          A workspace made before the current sharing rules keeps the access people had then wherever it is higher, until an Owner moves it to the
          new rules.
        </p>
      </SettingsCard>

      <SettingsCard
        title="Workspace roles"
        id="access.matrix.roles"
        description={ROLES_LINE}
        more={
          <ul className="m-0 flex max-w-[720px] list-none flex-col gap-2 p-0 text-sm">
            {WORKSPACE_ROLES.map((r) => <RuleLine key={r.role} rule={{ who: r.role, gets: r.summary }} />)}
          </ul>
        }
      />
    </SettingsCardStack>
  );
}
