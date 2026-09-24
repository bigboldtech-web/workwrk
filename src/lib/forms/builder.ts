// The form builder's pure half (spec-tables-forms section 2 /forms/[id], the
// Build tab): which field types exist and in what order the "+ Add a field"
// Picker lists them, what a new field looks like, what changing a field's type
// keeps and what it loses, moving and duplicating a field, and which question
// type best fits an existing List field or Table column (Phase 5 decided
// addition c: "map-to-existing-field").
//
// Pure: no React, no prisma. The page, the field card and the tests read it.

import { isQuestion, type FormField, type FormFieldType } from "./fields";

export interface FieldTypeDef {
  type: FormFieldType;
  label: string;
  /** Carries an options list (Single choice, Dropdown, Multiple choice). */
  choices?: boolean;
}

/** The "+ Add a field" order. The spec's nine first, then the parity types. */
export const FORM_FIELD_TYPES: readonly FieldTypeDef[] = [
  { type: "short_text", label: "Short text" },
  { type: "long_text", label: "Long text" },
  { type: "number", label: "Number" },
  { type: "email", label: "Email" },
  { type: "url", label: "Link" },
  { type: "date", label: "Date" },
  { type: "select", label: "Single choice", choices: true },
  { type: "dropdown", label: "Dropdown", choices: true },
  { type: "multi_select", label: "Multiple choice", choices: true },
  { type: "checkbox", label: "Checkbox" },
  { type: "rating", label: "Rating" },
  { type: "people", label: "People" },
  { type: "file", label: "File upload" },
  { type: "section", label: "Section" },
] as const;

const DEF_BY_TYPE = new Map<string, FieldTypeDef>(FORM_FIELD_TYPES.map((d) => [d.type, d]));

export function fieldTypeLabel(type: string): string {
  return DEF_BY_TYPE.get(type)?.label ?? "Short text";
}

export function isChoiceType(type: string): boolean {
  return !!DEF_BY_TYPE.get(type)?.choices;
}

/** A short random id, the same shape the builder has always written. */
export function newFieldId(rand: () => number = Math.random): string {
  return rand().toString(36).slice(2, 10).padEnd(8, "0");
}

/** A new field of this type. The label starts empty (placeholder "Question"),
 *  except a section, which reads "Section" so the heading is never blank. */
export function newField(type: FormFieldType, id: string = newFieldId()): FormField {
  const f: FormField = { id, type, label: type === "section" ? "Section" : "", required: false };
  if (isChoiceType(type)) f.options = ["Option 1", "Option 2"];
  if (type === "rating") f.max = 5;
  return f;
}

export interface TypeChange {
  field: FormField;
  /** What the change throws away, for the confirm; null when nothing is lost. */
  loses: string | null;
}

/** Change a field's type, keeping everything the new type can hold. */
export function changeFieldType(field: FormField, to: FormFieldType): TypeChange {
  if (field.type === to) return { field, loses: null };
  const next: FormField = { id: field.id, type: to, label: field.label, required: to === "section" ? false : field.required, placeholder: field.placeholder };
  let loses: string | null = null;
  if (isChoiceType(to)) {
    next.options = field.options && field.options.length ? [...field.options] : ["Option 1", "Option 2"];
    if (field.allowOther) next.allowOther = true;
  } else if (field.options && field.options.length) {
    loses = `its ${field.options.length} option${field.options.length === 1 ? "" : "s"}`;
  }
  if (to === "rating") next.max = field.max ?? 5;
  return { field: next, loses };
}

/** Move the field at `from` to `to` (both clamped). A no-op returns the same array. */
export function moveFieldTo(fields: FormField[], from: number, to: number): FormField[] {
  if (from < 0 || from >= fields.length) return fields;
  const t = Math.max(0, Math.min(fields.length - 1, to));
  if (t === from) return fields;
  const arr = [...fields];
  const [f] = arr.splice(from, 1);
  arr.splice(t, 0, f);
  return arr;
}

/** A copy of one field directly under it, with a fresh id. */
export function duplicateFieldAt(fields: FormField[], index: number, id: string = newFieldId()): FormField[] {
  const src = fields[index];
  if (!src) return fields;
  const copy: FormField = { ...src, id, options: src.options ? [...src.options] : undefined, label: src.label ? `${src.label} (copy)` : "" };
  const arr = [...fields];
  arr.splice(index + 1, 0, copy);
  return arr;
}

/** "Question 3": the number a question shows when Show field numbers is on.
 *  Sections are not numbered. */
export function questionNumbers(fields: FormField[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const f of fields) if (isQuestion(f)) out.set(f.id, ++n);
  return out;
}

/* ───────────────────── map-to-existing-field ───────────────────── */

/** A List field (Board.schema.fields) as the mapping card and the Add-a-field
 *  Picker see it. */
export interface ListFieldRef {
  key: string;
  label: string;
  type: string;
  choices?: string[];
}

/** A Table column as the mapping card sees it: its name or its letter. */
export interface TableColumnRef {
  id: string;
  label: string;
  type: string;
  options?: string[];
}

/** The question type that best answers a List field of this type, or null
 *  when a form cannot sensibly fill it (a formula, a rollup, a button). */
export function questionTypeForListField(type: string): FormFieldType | null {
  switch (type) {
    case "TEXT": case "PHONE": case "LOCATION": case "CUSTOM_TEXT": return "short_text";
    case "LONG_TEXT": case "SUMMARY": return "long_text";
    case "NUMBER": case "MONEY": case "PERCENT": case "PROGRESS_MANUAL": return "number";
    case "DATE": case "DATETIME": return "date";
    case "DROPDOWN": case "TSHIRT_SIZE": case "CUSTOM_DROPDOWN": return "dropdown";
    case "MULTI_SELECT": case "LABELS": return "multi_select";
    case "CHECKBOX": return "checkbox";
    case "URL": return "url";
    case "EMAIL": return "email";
    case "RATING": return "rating";
    case "USER": case "PEOPLE": return "people";
    case "FILES": return "file";
    default: return null;
  }
}

/** The question type that best answers a Table column of this type. */
export function questionTypeForColumn(type: string): FormFieldType | null {
  switch (type) {
    case "short_text": case "phone": return "short_text";
    case "long_text": return "long_text";
    case "number": case "currency": case "percent": return "number";
    case "date": return "date";
    case "select": return "select";
    case "multi_select": return "multi_select";
    case "checkbox": return "checkbox";
    case "url": return "url";
    case "email": return "email";
    case "rating": return "rating";
    case "person": return "people";
    case "attachment": return "file";
    // Formula, lookup, rollup and link columns are computed or relational:
    // a form answer cannot be written into them.
    default: return null;
  }
}

/** A new question bound to an existing destination field: the type that fits
 *  it, its name as the label and its choices as the options. */
export function fieldFromDestination(
  ref: { label: string; type: FormFieldType; options?: string[] },
  id: string = newFieldId(),
): FormField {
  const f = newField(ref.type, id);
  f.label = ref.label;
  if (isChoiceType(ref.type) && ref.options && ref.options.length) f.options = [...ref.options];
  return f;
}

/** The column name, or its letter when it has none (sheet-born tables). */
export function columnDisplayName(label: string | null | undefined, index: number): string {
  const t = (label ?? "").trim();
  if (t) return t;
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Column ${s}`;
}

/** The sentence under the Goes to picker naming who can edit the form and
 *  read its responses. It describes the rule the API actually enforces
 *  (api/forms/[id] canEditForm, lib/forms/responses-server canReadResponses):
 *  with the access engine inert, every workspace Member can edit any form and
 *  read its responses, and a Guest only a form they made. The destination
 *  does not widen or narrow that, so the sentence is the same with or without
 *  one. The spec's "Editors of {destination} can edit this form" wording waits
 *  for the access engine to scope forms by destination; promising it earlier
 *  would tell an owner their questions are private when the whole workspace
 *  can change them and read the answers. */
export function audienceLine(destination?: { kind: "list" | "table"; name: string } | null): string {
  void destination;
  return "Every member of this workspace can edit this form and read its responses. A guest can only if they made the form.";
}

/** Fields a person has not answered anywhere in the mapping and that the
 *  destination could take, for the "Fields on {destination}" Picker group. */
export function unmappedDestinationFields<T extends { key: string }>(all: T[], mapped: Record<string, string> | undefined): T[] {
  const used = new Set(Object.values(mapped ?? {}).filter(Boolean));
  return all.filter((f) => !used.has(f.key));
}
