// The ONE create recipe for a table (spec-tables-forms section 1, Naming
// canon: "one create recipe replaces four"). Every "new table" door, the hub
// "+", the /tables split button, the sidebar ghost row, the sheet's File menu,
// the Space popover and quick start, calls POST /api/tables with no columns,
// and the SERVER applies the canonical seed: name "Untitled table", 26
// unnamed columns A to Z, 1,000 blank rows. The door then lands on
// /tables/[id]?new=1, which focuses A1 and selects the name.
//
// Creating a table asks NOTHING: no name prompt, no type ceremony. The name
// is edited inline in the title row.
//
// The constants stay here (not in the route) so the sheet's own "Start the
// sheet" repair for a columnless table seeds the same shape.

export const NEW_SHEET_COLUMNS = 26; // A..Z, like a fresh Sheets tab
// Sheets seeds 1000 rows on a fresh spreadsheet; so do we.
export const NEW_SHEET_ROWS = 1000;

/** The name every new table is born with (naming canon: never "spreadsheet"). */
export const UNTITLED_TABLE_NAME = "Untitled table";

/** POST the canonical seed (the server seeds columns and rows) and return the id. */
export async function createNewTable(opts: { spaceId?: string | null; name?: string } = {}): Promise<{ id: string }> {
  const res = await fetch("/api/tables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(opts.name ? { name: opts.name } : {}), ...(opts.spaceId ? { spaceId: opts.spaceId } : {}) }),
  });
  if (!res.ok) throw new Error(`POST /api/tables ${res.status}`);
  const d = await res.json();
  const t = (d?.data ?? d) as { id?: string };
  if (!t?.id) throw new Error("POST /api/tables returned no id");
  return { id: t.id };
}

/** Where a create door lands: the new table's own URL with the ?new=1 latch. */
export function newTableHref(id: string): string {
  return `/tables/${id}?new=1`;
}
