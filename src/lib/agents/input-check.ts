// A tool's input as the model sent it, checked against the tool's own
// input_schema before anything reads it. Pure.
//
// WHY. The model API does not enforce input_schema, so the input is whatever
// the model wrote, and text a teammate read (a planted Talk message, a task
// title) can steer what it writes. An object where a string belongs, such as
// {"equals": "ceo@acme.com"} for an email, reached a Prisma where clause as a
// filter: the preview read it as no email at all and asked nobody, while the
// handler resolved it to someone else (review round 1). So every teammate
// tool call is checked here first: each property must have the type its
// schema declares (an array's items too), null counts as absent, and a
// property the schema does not declare is dropped, never passed on.

interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}

export type InputCheck = { ok: true; input: Record<string, unknown> } | { ok: false; field: string };

export function checkToolInput(schema: unknown, raw: unknown): InputCheck {
  if (raw === undefined || raw === null) return { ok: true, input: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "input" };
  const props = (schema as Schema | undefined)?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
    if (value === null || value === undefined) continue;
    if (!matches(props[key], value)) return { ok: false, field: key };
    out[key] = value;
  }
  return { ok: true, input: out };
}

function matches(p: Schema | undefined, v: unknown): boolean {
  const types = Array.isArray(p?.type) ? p.type : p?.type ? [p.type] : [];
  // A property with no declared type takes text, a number or a flag, never
  // an object or a list (the shapes a filter injection needs).
  if (types.length === 0) return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  return types.some((t) => typeMatches(t, p ?? {}, v));
}

function typeMatches(t: string, p: Schema, v: unknown): boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v) && (!p.items || v.every((x) => matches(p.items, x)));
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    default:
      return false;
  }
}

/** The tool row's sentence for an input the tool cannot take. */
export function badInputSentence(field: string): string {
  return field === "input"
    ? "That request wasn't in a form the tool can use, so nothing was done."
    : `That request's ${field} wasn't in a form the tool can use, so nothing was done.`;
}
