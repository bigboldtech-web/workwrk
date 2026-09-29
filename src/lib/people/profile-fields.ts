// Custom profile fields (decided addition c, competitor-gap-2026-09 section
// 7): the org defines the fields (Organization.settings.people.profileFields,
// written from Settings > Structure > Profile fields by Owner, Admin and the
// People team) and each person's values live in User.customFields, keyed by
// the field's key.
//
// Worst cases this closes:
//   * a value for a field nobody defined, or a 200,000 character value, is
//     a 400, never stored;
//   * two editors saving different fields never overwrite each other: a
//     write names only the keys it changes (null clears one) and the route
//     merges them in one statement;
//   * removing a definition never deletes anyone's value: the value stays in
//     the column and comes back if the field is defined again with the same
//     key. Readers show only defined fields.
//
// Pure: no imports. Client safe.

export interface ProfileFieldDef {
  /** Stable key, a-z 0-9 and underscores, 1 to 40 characters. */
  key: string;
  /** What the record shows, 1 to 60 characters. */
  label: string;
}

export const MAX_PROFILE_FIELDS = 25;
export const MAX_PROFILE_VALUE = 500;
const KEY_RE = /^[a-z0-9_]{1,40}$/;

/** Read the definitions out of Organization.settings (anything malformed is skipped). */
export function readProfileFieldDefs(settings: unknown): ProfileFieldDef[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
  const people = (settings as Record<string, unknown>).people;
  if (!people || typeof people !== "object" || Array.isArray(people)) return [];
  const raw = (people as Record<string, unknown>).profileFields;
  if (!Array.isArray(raw)) return [];
  const out: ProfileFieldDef[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const key = (r as { key?: unknown }).key;
    const label = (r as { label?: unknown }).label;
    if (typeof key !== "string" || !KEY_RE.test(key) || seen.has(key)) continue;
    if (typeof label !== "string" || !label.trim()) continue;
    seen.add(key);
    out.push({ key, label: label.trim().slice(0, 60) });
    if (out.length >= MAX_PROFILE_FIELDS) break;
  }
  return out;
}

/** A key for a new label: lowercased, underscores, unique among `taken`. */
export function keyForLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "field";
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  return key;
}

/** Validate a full definitions list sent by the settings editor. */
export function validateProfileFieldDefs(
  body: unknown,
): { ok: true; value: ProfileFieldDef[] } | { ok: false; error: string } {
  if (!Array.isArray(body)) return { ok: false, error: "Send the list of fields" };
  if (body.length > MAX_PROFILE_FIELDS) return { ok: false, error: `Up to ${MAX_PROFILE_FIELDS} profile fields` };
  const out: ProfileFieldDef[] = [];
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const r of body) {
    const key = (r as { key?: unknown } | null)?.key;
    const label = (r as { label?: unknown } | null)?.label;
    if (typeof label !== "string" || !label.trim() || label.trim().length > 60) return { ok: false, error: "A field name is 1 to 60 characters" };
    if (typeof key !== "string" || !KEY_RE.test(key)) return { ok: false, error: "A field key is lowercase letters, digits and underscores" };
    if (keys.has(key)) return { ok: false, error: "Two fields share a key" };
    const lower = label.trim().toLowerCase();
    if (labels.has(lower)) return { ok: false, error: `There are two fields named ${label.trim()}` };
    keys.add(key);
    labels.add(lower);
    out.push({ key, label: label.trim() });
  }
  return { ok: true, value: out };
}

/**
 * Validate a PATCH of profile values: only defined keys, strings up to 500
 * characters, null (or "") clears. Returns what to set and what to remove.
 */
export function validateProfileValues(
  body: unknown,
  defs: ProfileFieldDef[],
): { ok: true; set: Record<string, string>; remove: string[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Profile fields are an object of field values" };
  const known = new Set(defs.map((d) => d.key));
  const set: Record<string, string> = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!known.has(key)) return { ok: false, error: `No profile field is called ${key}` };
    if (value === null || value === "") { remove.push(key); continue; }
    if (typeof value !== "string") return { ok: false, error: "A profile field value is text" };
    const v = value.trim();
    if (v.length > MAX_PROFILE_VALUE) return { ok: false, error: `A profile field value is up to ${MAX_PROFILE_VALUE} characters` };
    if (!v) remove.push(key);
    else set[key] = v;
  }
  if (Object.keys(set).length === 0 && remove.length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, set, remove };
}

/** The defined fields with this person's values, in definition order. */
export function profileFieldRows(defs: ProfileFieldDef[], values: unknown): Array<{ key: string; label: string; value: string | null }> {
  const v = values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  return defs.map((d) => ({ key: d.key, label: d.label, value: typeof v[d.key] === "string" ? (v[d.key] as string) : null }));
}
