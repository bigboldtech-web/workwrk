// Data validation — Zoho/Sheets' "restrict what a cell accepts" (Tables).
//
// A validation rides the column (like format/rules) inside the columns
// Json; raw cell values never change shape. Validation v1 is REJECT-mode:
// an entry that fails is refused (the editor keeps the old value, paste
// skips the cell) rather than stored-with-a-warning. Pure + tested so the
// page and the paste/fill/stamp paths share one rule.

export type DataValidation =
  | { kind: "list"; values: string[] }                 // one of an explicit set (dropdown)
  | { kind: "number"; min?: number; max?: number }     // numeric range (inclusive)
  | { kind: "textLength"; min?: number; max?: number }; // character-count range (inclusive)

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/** Validate a STORED value (already coerced to the column's shape) against
 *  the column's validation. Empty/null always passes — clearing a cell is
 *  never blocked. Returns ok, or a short human reason for the toast. */
export function validateValue(validation: DataValidation | undefined, value: unknown): ValidationResult {
  if (!validation) return { ok: true };
  if (value === null || value === undefined || value === "") return { ok: true };

  switch (validation.kind) {
    case "list": {
      const v = String(value);
      // Multi-select arrays: every element must be allowed.
      if (Array.isArray(value)) {
        const bad = (value as unknown[]).map(String).find((x) => !validation.values.includes(x));
        return bad === undefined ? { ok: true } : { ok: false, reason: `"${bad}" isn't an allowed value` };
      }
      return validation.values.includes(v)
        ? { ok: true }
        : { ok: false, reason: `Must be one of: ${validation.values.slice(0, 6).join(", ")}${validation.values.length > 6 ? "…" : ""}` };
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) return { ok: false, reason: "Must be a number" };
      if (validation.min != null && n < validation.min) return { ok: false, reason: `Must be ≥ ${validation.min}` };
      if (validation.max != null && n > validation.max) return { ok: false, reason: `Must be ≤ ${validation.max}` };
      return { ok: true };
    }
    case "textLength": {
      const len = String(value).length;
      if (validation.min != null && len < validation.min) return { ok: false, reason: `Must be at least ${validation.min} characters` };
      if (validation.max != null && len > validation.max) return { ok: false, reason: `Must be at most ${validation.max} characters` };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/** A validation with no real constraint is inert — the editor keeps its
 *  plain form and nothing is enforced. Used to drop empty configs on save. */
export function isEmptyValidation(v: DataValidation | undefined): boolean {
  if (!v) return true;
  if (v.kind === "list") return v.values.length === 0;
  return v.min == null && v.max == null;
}
