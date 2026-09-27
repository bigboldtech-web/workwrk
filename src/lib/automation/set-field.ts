// The "Set a field" action's value rules: what an automation may write into
// one of a List's own fields, in the shape the List's field cells read.
// Pure, so the action and the tests agree. A value that does not fit the
// field is refused with a sentence, never written as junk.
//
//   NUMBER, MONEY, PERCENT, RATING   a number ("12", "4.5")
//   CHECKBOX                         yes / no, true / false, 1 / 0
//   DATE                             YYYY-MM-DD, "today", or "+N" / "-N" days
//   DROPDOWN, TSHIRT_SIZE            one of the field's choices (value or label)
//   TEXT, LONG_TEXT, URL, EMAIL, PHONE   the text, trimmed
//   an empty value clears the field (null)

/** The field types an automation may write (the Set a field picker offers only these). */
export const SETTABLE_FIELD_TYPES: ReadonlySet<string> = new Set(["TEXT", "LONG_TEXT", "NUMBER", "MONEY", "PERCENT", "RATING", "DATE", "CHECKBOX", "DROPDOWN", "URL", "EMAIL", "PHONE", "TSHIRT_SIZE"]);

export interface SettableField {
  key: string;
  type: string;
  choices?: Array<{ value: string; label: string }>;
}

export type Coerced = { ok: true; value: unknown } | { ok: false; error: string };

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function coerceSetFieldValue(field: SettableField, raw: unknown, now: Date = new Date()): Coerced {
  // Checked at run time too: the field may have become People, a Formula or
  // a Relationship after the automation was published, and those hold shapes
  // a typed value cannot fill.
  if (!SETTABLE_FIELD_TYPES.has(field.type)) return { ok: false, error: "An automation cannot set this kind of field. Pick another field" };
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (text === "") return { ok: true, value: null };
  switch (field.type) {
    case "NUMBER":
    case "MONEY":
    case "PERCENT":
    case "RATING": {
      const n = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { ok: false, error: `"${text}" is not a number` };
      return { ok: true, value: n };
    }
    case "CHECKBOX": {
      const t = text.toLowerCase();
      if (["true", "yes", "1", "on", "checked"].includes(t)) return { ok: true, value: true };
      if (["false", "no", "0", "off", "unchecked"].includes(t)) return { ok: true, value: false };
      return { ok: false, error: `"${text}" is not yes or no` };
    }
    case "DATE": {
      const t = text.toLowerCase();
      if (t === "today") return { ok: true, value: isoDay(now) };
      const rel = /^([+-])(\d{1,3})$/.exec(t);
      if (rel) {
        const days = Number(rel[2]) * (rel[1] === "-" ? -1 : 1);
        return { ok: true, value: isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)) };
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) return { ok: true, value: text };
      }
      return { ok: false, error: `"${text}" is not a date (use YYYY-MM-DD, today, or +3)` };
    }
    case "DROPDOWN":
    case "TSHIRT_SIZE": {
      const choices = field.choices ?? [];
      const hit = choices.find((c) => c.value === text) ?? choices.find((c) => c.label.toLowerCase() === text.toLowerCase());
      if (!hit) return { ok: false, error: `"${text}" is not one of this field's options` };
      return { ok: true, value: hit.value };
    }
    default:
      // TEXT, LONG_TEXT, URL, EMAIL, PHONE (the allow-list above).
      return { ok: true, value: text.slice(0, 5000) };
  }
}
