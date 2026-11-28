// The finance APIs that left the product (WorkwrK is a People + Project
// Management System since 2026-06-03; Finance came off the rail) and still
// answered (pen test 2026-11-28, V-61): an employee could submit a purchase
// order, an admin create vendors and fiscal years, and nothing in the product
// shows those rows, so each was stranded data and attack surface. They are
// closed at the proxy, one list, easy to read and to reopen; the routes'
// code stays. Settings > Data still exports what is already stored
// (/api/export/*, not listed here).
//
// Pure module.

export const RETIRED_API_PREFIXES: readonly string[] = [
  "/api/accounting-periods",
  "/api/budget-plans",
  "/api/fiscal-years",
  "/api/gl-accounts",
  "/api/invoices",
  "/api/journal-entries",
  "/api/plan-lines",
  "/api/plan-variance",
  "/api/purchase-orders",
  "/api/vendors",
];

/** Is this path one of the retired APIs (the prefix itself or anything under it)? */
export function isRetiredApi(path: string): boolean {
  return RETIRED_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
