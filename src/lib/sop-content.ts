// Empty-content detection for SOP rows. We had four prod SOPs end up
// empty because the publish handler accepted blank form values and the
// inline emptiness check missed `content: {}`, `content: null`, and
// shapes that were a mix of declared+missing keys. Anything that mutates
// SOP.content should route through `isSOPContentEmpty` so the guard
// stays consistent across publish, edit, rollback, and any future paths.

export type SOPContentShape = {
  type?: string;
  html?: string;
  steps?: unknown[];
  sections?: unknown[];
};

export function isSOPContentEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object") return true;

  const c = raw as SOPContentShape;
  if (Object.keys(c).length === 0) return true;

  if (typeof c.html === "string") {
    const stripped = c.html.replace(/<[^>]+>/g, "").trim();
    if (stripped !== "") return false;
  }
  if (Array.isArray(c.steps) && c.steps.length > 0) return false;
  if (Array.isArray(c.sections) && c.sections.length > 0) return false;

  return true;
}

export function isSOPTitleEmpty(raw: unknown): boolean {
  return typeof raw !== "string" || raw.trim() === "";
}
