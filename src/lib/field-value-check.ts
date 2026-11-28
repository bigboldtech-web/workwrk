// A List field's value is checked against its type before it is stored (pen
// test 2026-11-28, V-54): NUMBER "abc", a DROPDOWN value no choice has and
// DATE "not-a-date" were stored as sent, and every view then showed garbage
// or nothing. Clearing a value (null, undefined, "") is always allowed; a
// dropdown value is matched by a choice's value, or its label for older
// rows that stored the label.
//
// Pure module.

import type { FieldDef } from "@/lib/field-catalog";

const NUMERIC = new Set(["NUMBER", "MONEY", "PERCENT", "RATING", "PROGRESS_MANUAL"]);
const DATES = new Set(["DATE", "DATETIME"]);
const SINGLE_CHOICE = new Set(["DROPDOWN", "TSHIRT_SIZE"]);
const MULTI_CHOICE = new Set(["MULTI_SELECT", "LABELS"]);

function isNumberLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));
}

function isDateLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && !Number.isNaN(new Date(v).getTime());
}

function matchesChoice(field: FieldDef, v: unknown): boolean {
  const choices = field.options?.choices ?? [];
  if (choices.length === 0) return true; // a field with no choices yet decides nothing
  return typeof v === "string" && choices.some((c) => c.value === v || c.label === v);
}

/** Why this value does not fit the field, or null when it does (or clears it). */
export function fieldValueRefusal(field: FieldDef, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (NUMERIC.has(field.type) && !isNumberLike(value)) return `${field.label} takes a number.`;
  if (DATES.has(field.type) && !isDateLike(value)) return `${field.label} takes a date.`;
  if (SINGLE_CHOICE.has(field.type) && !matchesChoice(field, value)) return `${field.label} takes one of its options.`;
  if (MULTI_CHOICE.has(field.type)) {
    if (!Array.isArray(value)) return `${field.label} takes a list of its options.`;
    if (!value.every((v) => matchesChoice(field, v))) return `${field.label} takes only its own options.`;
  }
  return null;
}

/** The first refusal among these values for the fields they name, with its key; fields not named are not judged. */
export function fieldValuesRefusal(fields: readonly FieldDef[], values: Record<string, unknown>): { key: string; message: string } | null {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) continue;
    const message = fieldValueRefusal(field, value);
    if (message) return { key, message };
  }
  return null;
}
