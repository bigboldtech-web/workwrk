// The New app modal's draft (spec-tools-misc 2.3): what "Generate" proposes
// and "Start blank" begins with, and the checks "Create app" runs before it
// calls POST /api/build/apps. Pure, so the rules the API enforces with zod
// are checked the same way on screen before anything is sent.

export const FIELD_TYPES = ["TEXT", "TEXTAREA", "NUMBER", "DATE", "CHECKBOX", "SELECT", "MULTI_SELECT", "URL", "EMAIL"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text",
  TEXTAREA: "Long text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  SELECT: "Dropdown",
  MULTI_SELECT: "Multiple choice",
  URL: "Link",
  EMAIL: "Email",
};

export interface DraftField {
  key: string;
  label: string;
  fieldType: FieldType;
  options?: unknown;
}

export interface AppDraft {
  name: string;
  slug: string;
  description: string;
  fields: DraftField[];
  sampleRows: Record<string, unknown>[];
  prompt?: string;
}

/** kebab-case, starting with a letter or digit, at most 60 characters. */
export function slugify(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  return s || "app";
}

/** snake_case, starting with a letter. */
export function toFieldKey(label: string): string {
  const s = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!s) return "field";
  return /^[a-z]/.test(s) ? s : `f_${s}`;
}

/** A key that no other field in the list already uses. */
export function uniqueFieldKey(label: string, taken: readonly string[]): string {
  const base = toFieldKey(label);
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now()}`;
}

export function blankDraft(): AppDraft {
  return { name: "", slug: "", description: "", fields: [{ key: "name", label: "Name", fieldType: "TEXT" }], sampleRows: [] };
}

/**
 * Turn whatever the generator returned into a draft the modal can show.
 * Unknown field types fall back to Text, keys are re-derived when invalid,
 * and sample rows keep only the keys that exist.
 */
export function draftFromGenerated(raw: unknown, prompt: string): AppDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const name = typeof g.name === "string" ? g.name.trim().slice(0, 80) : "";
  const rawFields = Array.isArray(g.fields) ? g.fields : [];
  const fields: DraftField[] = [];
  for (const f of rawFields.slice(0, 20)) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 80) : null;
    if (!label) continue;
    const type = (FIELD_TYPES as readonly string[]).includes(String(r.fieldType)) ? (r.fieldType as FieldType) : "TEXT";
    const key = typeof r.key === "string" && /^[a-z][a-z0-9_]*$/.test(r.key) && !fields.some((x) => x.key === r.key)
      ? r.key
      : uniqueFieldKey(label, fields.map((x) => x.key));
    fields.push({ key, label, fieldType: type, ...(r.options !== undefined ? { options: r.options } : {}) });
  }
  if (!name || fields.length === 0) return null;
  const keys = new Set(fields.map((f) => f.key));
  const sampleRows = (Array.isArray(g.sampleRows) ? g.sampleRows : [])
    .slice(0, 50)
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keys.has(k))));
  const slug = typeof g.slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(g.slug) ? g.slug.slice(0, 60) : slugify(name);
  return {
    name,
    slug,
    description: typeof g.description === "string" ? g.description.slice(0, 400) : "",
    fields,
    sampleRows,
    prompt,
  };
}

/** The first problem with a field list, in words, or null when it can be saved. */
export function fieldsProblem(fields: readonly DraftField[]): string | null {
  if (fields.length === 0) return "Add at least one field.";
  if (fields.length > 20) return "An app can have up to 20 fields.";
  const keys = new Set<string>();
  for (const f of fields) {
    if (!f.label.trim()) return "Every field needs a name.";
    if (keys.has(f.key)) return `Two fields are both called "${f.label}".`;
    keys.add(f.key);
  }
  return null;
}

/** The first problem with a draft, in words, or null when it can be created. */
export function draftProblem(d: AppDraft): string | null {
  if (!d.name.trim()) return "Give the app a name.";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(d.slug)) return "The address can use lowercase letters, numbers and dashes.";
  return fieldsProblem(d.fields);
}
