// One creator for new Google-Sheets-style spreadsheets, shared by every
// entry point (worksheet sidebar, /tables card page, bottom sheet-tabs "+").
//
// Creating a sheet asks NOTHING: no name prompt, no type ceremony. Like
// Sheets, a new spreadsheet is born "Untitled spreadsheet" (auto-suffixed
// " 2", " 3"… against the caller's list), opens straight into the grid
// with 26 lettered columns (A..Z) and 1000 blank rows ready to type into,
// and gets renamed inline via the title row. The server does not enforce
// name uniqueness (checked: POST /api/tables only trims/caps the name),
// so the suffix is purely cosmetic — callers without a list may omit it.

export const NEW_SHEET_COLUMNS = 26; // A..Z, like a fresh Sheets tab
// Sheets seeds 1000 rows on a fresh spreadsheet; so do we. The batch API
// caps each call at 500 ops of one kind, so the seed ships in chunks.
export const NEW_SHEET_ROWS = 1000;
const SEED_CHUNK = 500; // the batch route's MAX_OPS

export const UNTITLED_SHEET_NAME = "Untitled spreadsheet";

function colId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** "Untitled spreadsheet", or the first free " 2"/" 3"… variant against
 *  the caller's (trimmed) existing names. Cosmetic only — see header. */
export function untitledSheetName(existingNames: string[] = []): string {
  const taken = new Set(existingNames.map((n) => n.trim()));
  if (!taken.has(UNTITLED_SHEET_NAME)) return UNTITLED_SHEET_NAME;
  let n = 2;
  while (taken.has(`${UNTITLED_SHEET_NAME} ${n}`)) n++;
  return `${UNTITLED_SHEET_NAME} ${n}`;
}

/** POST the table, then seed its starter rows in sequential batch calls.
 *  Returns the created table's id. Throws only when the CREATE fails —
 *  a failed row seed still opens the sheet (the grid can add rows)
 *  rather than losing the table that was just created.
 *  Kept name-taking for the CSV-import path; interactive creates go
 *  through createUntitledSheet below. */
export async function createExcelSheet(name: string): Promise<{ id: string }> {
  const columns = Array.from({ length: NEW_SHEET_COLUMNS }, () => ({
    id: colId(), type: "short_text", label: "",
  }));
  const res = await fetch("/api/tables", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, columns }),
  });
  if (!res.ok) throw new Error(`POST /api/tables ${res.status}`);
  const d = await res.json();
  const t = d.data ?? d;
  // Sequential, not parallel: the server allocates positions (max+1 under
  // an advisory lock), and awaiting each chunk keeps position order equal
  // to chunk order. No explicit positions are ever sent from here — a
  // blank seed has no layout to preserve. Best-effort per chunk: a failed
  // slice costs some starter rows, never the sheet.
  for (let i = 0; i < NEW_SHEET_ROWS; i += SEED_CHUNK) {
    await fetch(`/api/tables/${t.id}/rows/batch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inserts: Array.from({ length: Math.min(SEED_CHUNK, NEW_SHEET_ROWS - i) }, () => ({ values: {} })),
      }),
    }).catch(() => {});
  }
  return { id: t.id };
}

/** The no-prompt create every "+ new" surface calls: names itself, seeds
 *  the grid, and hands back the id to navigate into. */
export function createUntitledSheet(existingNames?: string[]): Promise<{ id: string }> {
  return createExcelSheet(untitledSheetName(existingNames));
}
