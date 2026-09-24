// A form's fields and answers, as the ONE responder (FormRenderer) and the one
// submit route (POST /api/forms/[id]/responses) both understand them.
//
// There used to be two copies of the field renderer (the (dashboard) responder
// and the embed), each with its own idea of an empty answer: the number field
// stored "" when cleared and the required check had to special-case it. The
// rule lives here once, so the client's inline validation and the server's
// refusal can never disagree about what "answered" means.
//
// Pure: no imports (the draft fragment helpers use the platform TextEncoder,
// btoa and crypto, present in browsers and in Node 20).

export type FormFieldType =
  | "short_text" | "long_text" | "number" | "email" | "url" | "date"
  | "select" | "multi_select" | "checkbox"
  // Form builder parity (Phase 5 decided addition c):
  | "dropdown" | "rating" | "people" | "file" | "section";

export interface FormField {
  id: string;
  type: FormFieldType | string;
  label: string;
  required?: boolean;
  options?: string[];
  /** Help text, shown under the label. For a section, its description. */
  placeholder?: string;
  /** Choice fields: an "Other" row with its own text box. */
  allowOther?: boolean;
  /** Rating: the top of the scale (3 to 10, default 5). */
  max?: number;
}

/** A section is a heading block, not a question: it has no answer, is never
 *  required and never maps to a column. */
export function isQuestion(field: FormField): boolean {
  return field.type !== "section";
}

export const RATING_DEFAULT_MAX = 5;
export function ratingMax(field: FormField): number {
  const m = Math.round(Number(field.max));
  return Number.isFinite(m) && m >= 3 && m <= 10 ? m : RATING_DEFAULT_MAX;
}

/** One uploaded file, as a File upload answer stores it. */
export interface FileAnswer {
  name: string;
  url: string;
  s3Key?: string | null;
  size?: number | null;
  mimeType?: string | null;
}
export const MAX_FILES_PER_ANSWER = 10;
export const MAX_PEOPLE_PER_ANSWER = 20;

/** A file answer entry, or null when it is not one this app wrote: only the
 *  upload route's own URLs (local /api/uploads/ or an https object store). */
export function readFileAnswer(v: unknown): FileAnswer | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.name !== "string" || !r.name.trim() || typeof r.url !== "string") return null;
  const url = r.url.slice(0, 4000);
  if (!url.startsWith("/api/uploads/") && !url.startsWith("https://")) return null;
  return {
    name: r.name.slice(0, 255),
    url,
    s3Key: typeof r.s3Key === "string" && r.s3Key ? r.s3Key.slice(0, 1024) : null,
    size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : null,
    mimeType: typeof r.mimeType === "string" ? r.mimeType.slice(0, 200) : null,
  };
}

/** Whether a file answer points at this org's own upload store, as the
 *  upload route writes it: an object-store key under `orgs/{orgId}/` (the
 *  link is re-presigned from the key on every read), or a local
 *  `/api/uploads/` link with no key. A key from another org, or an outside
 *  https link dressed up as an upload, is not a file this form received. */
export function fileAnswerInOrg(file: FileAnswer, orgId: string): boolean {
  if (!orgId) return false;
  if (file.s3Key) return file.s3Key.startsWith(`orgs/${orgId}/`) && !file.s3Key.includes("..");
  return file.url.startsWith("/api/uploads/") && !file.url.includes("..");
}

/** Drop every file answer entry that is not this org's own upload (the
 *  submit route runs it after pickKnownAnswers, so a hostile body cannot
 *  name another tenant's object and have the Responses read presign it). */
export function keepOrgFiles(fields: FormField[], answers: FormAnswers, orgId: string): FormAnswers {
  const out: FormAnswers = { ...answers };
  for (const f of fields) {
    if (f.type !== "file" || !Array.isArray(out[f.id])) continue;
    out[f.id] = (out[f.id] as unknown[]).map(readFileAnswer).filter((x): x is FileAnswer => !!x && fileAnswerInOrg(x, orgId));
  }
  return out;
}

export type FormAnswers = Record<string, unknown>;

/** Fields out of the stored Json, defensively: anything without an id and a
 *  string type is dropped rather than crashing the public page. */
export function readFormFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || typeof r.type !== "string") continue;
    out.push({
      id: r.id,
      type: r.type,
      label: typeof r.label === "string" ? r.label : "",
      required: r.required === true,
      options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string" && o.trim() !== "") : undefined,
      placeholder: typeof r.placeholder === "string" && r.placeholder.trim() ? r.placeholder : undefined,
      ...(r.allowOther === true ? { allowOther: true } : {}),
      ...(typeof r.max === "number" ? { max: r.max } : {}),
    });
  }
  return out;
}

/** The field list a builder save may store: every entry an object with a
 *  string id and a string type (the same test readFormFields reads with), or
 *  null when any entry is not, so junk is refused rather than stored. */
export function validFieldsInput(raw: unknown): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  for (const f of raw) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return null;
    const r = f as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || r.id.length > 64 || typeof r.type !== "string" || !r.type || r.type.length > 40) return null;
    if ("label" in r && r.label !== undefined && typeof r.label !== "string") return null;
    if ("options" in r && r.options !== undefined && !Array.isArray(r.options)) return null;
  }
  return raw;
}

/** A form's field mapping as a save may store it: { board?: {fieldId:
 *  key}, table?: {fieldId: columnId} }, every value a short string; null
 *  when the shape is anything else (an array, a number, nested junk). */
export function validFieldMappingsInput(raw: unknown): { board?: Record<string, string>; table?: Record<string, string> } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: { board?: Record<string, string>; table?: Record<string, string> } = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k !== "board" && k !== "table") return null;
    if (v === undefined || v === null) continue;
    if (typeof v !== "object" || Array.isArray(v)) return null;
    const m: Record<string, string> = {};
    for (const [fid, target] of Object.entries(v as Record<string, unknown>)) {
      if (typeof target !== "string" || target.length > 200 || fid.length > 64) return null;
      if (target) m[fid] = target;
    }
    out[k] = m;
  }
  return out;
}

/** An answer that does not count as answering. A checkbox left unticked is
 *  "no", which IS an answer, except when the field is required: a required
 *  checkbox is a consent box and only a tick satisfies it. */
export function isEmptyAnswer(field: FormField, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (field.type === "checkbox") return value !== true;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}

/** The ids of required fields with no answer, in field order. */
export function missingRequired(fields: FormField[], answers: FormAnswers): string[] {
  return fields.filter((f) => isQuestion(f) && f.required && isEmptyAnswer(f, answers[f.id])).map((f) => f.id);
}

/** What a number input's text becomes: null when cleared, never "". */
export function numberAnswer(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** "2 questions need an answer" / "1 question needs an answer". */
export function missingSummary(count: number): string {
  return count === 1 ? "1 question needs an answer" : `${count} questions need an answer`;
}

/** The longest text one answer may carry (a long answer, not a file). */
export const MAX_ANSWER_TEXT = 20_000;

/** One answer coerced to the shape its field type stores, or undefined when
 *  the value cannot be that type. Only primitives and string lists survive:
 *  an object (a formula cell `{ "=": ... }`, a nested blob) never reaches the
 *  response, the destination Table row or the List task. */
export function coerceAnswer(field: FormField, value: unknown): unknown {
  if (value === null) return null;
  const text = (v: unknown): string | undefined =>
    typeof v === "string" ? v.slice(0, MAX_ANSWER_TEXT)
      : typeof v === "number" && Number.isFinite(v) ? String(v)
        : undefined;
  switch (field.type) {
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      if (typeof value === "string") return value.trim() === "" ? null : numberAnswer(value) ?? undefined;
      return undefined;
    }
    case "checkbox":
      return typeof value === "boolean" ? value : undefined;
    case "multi_select":
      // Choices are trimmed and blanks dropped: an "Other" row ticked but
      // left empty is not an answer.
      return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, MAX_ANSWER_TEXT)).filter((v) => v !== "")
        : undefined;
    case "select": case "dropdown": {
      const t = text(value);
      return t === undefined ? undefined : t.trim() === "" ? null : t.trim();
    }
    case "short_text": case "long_text": case "email": case "url": case "date":
      return text(value);
    case "rating": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
      if (!Number.isFinite(n)) return undefined;
      const r = Math.round(n);
      return r >= 1 && r <= ratingMax(field) ? r : undefined;
    }
    case "people":
      return Array.isArray(value)
        ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))].slice(0, MAX_PEOPLE_PER_ANSWER)
        : undefined;
    case "file":
      return Array.isArray(value)
        ? value.map(readFileAnswer).filter((f): f is FileAnswer => !!f).slice(0, MAX_FILES_PER_ANSWER)
        : undefined;
    case "section":
      return undefined;
    default:
      // A type this build does not know yet: keep primitives only.
      if (typeof value === "boolean") return value;
      return text(value);
  }
}

/** Keep only answers to fields the form has, each coerced to its field's
 *  type, so a stale or hostile client cannot write arbitrary keys or shapes
 *  into a response or through it into a Table or a List. */
export function pickKnownAnswers(fields: FormField[], answers: unknown): FormAnswers {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  const src = answers as Record<string, unknown>;
  const out: FormAnswers = {};
  for (const f of fields) {
    if (!isQuestion(f)) continue;
    if (!Object.prototype.hasOwnProperty.call(src, f.id)) continue;
    const v = coerceAnswer(f, src[f.id]);
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}

/** One answer as a single line of text (the Responses table, the CSV, a
 *  notification). People ids become names through `personName` when given. */
export function answerText(field: FormField, value: unknown, personName?: (id: string) => string | null): string {
  if (value === undefined || value === null) return "";
  if (field.type === "checkbox") return value === true ? "Yes" : value === false ? "No" : "";
  if (field.type === "file" && Array.isArray(value)) return value.map(readFileAnswer).filter(Boolean).map((f) => f!.name).join(", ");
  if (field.type === "people" && Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((id) => personName?.(id) ?? id).join(", ");
  }
  if (field.type === "rating" && typeof value === "number") return `${value} of ${ratingMax(field)}`;
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "object") return "";
  return String(value);
}

/** The reserved key a response carries its destinations under ("Went to").
 *  Field ids are random base36, so a "$" key can never collide with one;
 *  pickKnownAnswers never copies it from a client. */
export const WENT_KEY = "$went";

export interface WentTo {
  list?: { boardId: string; itemId: string } | { boardId: string; error: string };
  table?: { tableId: string; rowId: string } | { tableId: string; error: string };
}

export function readWentTo(data: unknown): WentTo {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const w = (data as Record<string, unknown>)[WENT_KEY];
  if (!w || typeof w !== "object" || Array.isArray(w)) return {};
  const r = w as Record<string, unknown>;
  const out: WentTo = {};
  const l = r.list as Record<string, unknown> | undefined;
  if (l && typeof l.boardId === "string") {
    if (typeof l.itemId === "string") out.list = { boardId: l.boardId, itemId: l.itemId };
    else if (typeof l.error === "string") out.list = { boardId: l.boardId, error: l.error };
  }
  const t = r.table as Record<string, unknown> | undefined;
  if (t && typeof t.tableId === "string") {
    if (typeof t.rowId === "string") out.table = { tableId: t.tableId, rowId: t.rowId };
    else if (typeof t.error === "string") out.table = { tableId: t.tableId, error: t.error };
  }
  return out;
}

/** The sessionStorage / localStorage key a draft rides across sign-in on. */
export function formDraftKey(formId: string): string {
  return `workwrk:form-draft:${formId}`;
}

/** A stored draft, if it is recent and well formed. Drafts older than a day
 *  are ignored: nobody remembers a half-filled form from last week. */
export function readFormDraft(raw: string | null, now: number = Date.now()): FormAnswers | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { at?: unknown; answers?: unknown };
    if (typeof d.at !== "number" || now - d.at > 86_400_000) return null;
    if (!d.answers || typeof d.answers !== "object" || Array.isArray(d.answers)) return null;
    return d.answers as FormAnswers;
  } catch {
    return null;
  }
}

export function writeFormDraft(answers: FormAnswers, now: number = Date.now()): string {
  return JSON.stringify({ at: now, answers });
}

/** The URL fragment that carries a draft from an embed to a new first-party
 *  tab. A third-party iframe's storage is partitioned by the host site, so the
 *  new tab cannot read what the embed stored; a fragment is never sent to a
 *  server, and the responder strips it from the address bar on arrival. */
export const DRAFT_HASH_PREFIX = "#draft=";
/** Past this the fragment is left off and the answers stay in the embed. */
export const DRAFT_HASH_MAX = 32_000;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** "#draft=..." for these answers, or "" when there is nothing to carry or it
 *  would not fit. */
export function draftHash(answers: FormAnswers, now: number = Date.now()): string {
  if (Object.keys(answers).length === 0) return "";
  const encoded = toBase64Url(writeFormDraft(answers, now));
  return encoded.length > DRAFT_HASH_MAX ? "" : `${DRAFT_HASH_PREFIX}${encoded}`;
}

/** The answers a "#draft=..." fragment carries, if it is recent and well formed. */
export function readDraftHash(hash: string, now: number = Date.now()): FormAnswers | null {
  if (!hash.startsWith(DRAFT_HASH_PREFIX)) return null;
  try {
    return readFormDraft(fromBase64Url(hash.slice(DRAFT_HASH_PREFIX.length)), now);
  } catch {
    return null;
  }
}

/** A key that makes one Submit idempotent across retries: the server stores
 *  the response under it, so a retry after a lost answer finds the first one
 *  instead of writing a second. 32 hex characters. */
export function newSubmissionKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const SUBMISSION_KEY_RE = /^[0-9a-f]{32}$/;
