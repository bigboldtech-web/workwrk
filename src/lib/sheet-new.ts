// One creator for new Excel-style sheets, shared by every entry point
// (worksheet sidebar, /tables card page). The two surfaces previously
// seeded differently — the sidebar's sheet opened as a single "Name"
// column with zero rows, which is exactly the empty-state ceremony the
// Excel-ification removed. A new sheet is 8 anonymous text columns (the
// header renders letters) and 30 blank rows, ready to type into.

export const NEW_SHEET_COLUMNS = 8;
export const NEW_SHEET_ROWS = 30;

function colId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** POST the table, then seed its starter rows in one batch call.
 *  Returns the created table's id. Throws only when the CREATE fails —
 *  a failed row seed still opens the sheet (the grid can add rows)
 *  rather than losing the table that was just created. */
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
  await fetch(`/api/tables/${t.id}/rows/batch`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inserts: Array.from({ length: NEW_SHEET_ROWS }, () => ({ values: {} })) }),
  }).catch(() => {});
  return { id: t.id };
}
