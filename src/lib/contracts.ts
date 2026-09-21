// Contracts (spec-process section 2 `/agreements`, `/agreements/[id]`,
// `/sign/[token]`): the pure half of the list views, the statuses, the party
// vocabulary, the Send checks and the signing page's field maths. No
// imports, so the API routes, the pages and the public signing page share
// one set of words and vitest proves the rules in node.

export type ContractStatus = "DRAFT" | "SENT" | "PARTIALLY_SIGNED" | "COMPLETED" | "VOIDED";
export const CONTRACT_STATUSES: readonly ContractStatus[] = ["DRAFT", "SENT", "PARTIALLY_SIGNED", "COMPLETED", "VOIDED"];

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_SIGNED: "Partially signed",
  COMPLETED: "Completed",
  VOIDED: "Voided",
};
/** Draft neutral, Sent info, Partially signed warning, Completed success, Voided neutral. */
export const CONTRACT_STATUS_COLOR: Record<ContractStatus, string> = {
  DRAFT: "#6B7280",
  SENT: "#0073EA",
  PARTIALLY_SIGNED: "#B45309",
  COMPLETED: "#1F8F4E",
  VOIDED: "#6B7280",
};
export function parseContractStatus(raw: string | null | undefined): ContractStatus {
  return CONTRACT_STATUSES.includes(raw as ContractStatus) ? (raw as ContractStatus) : "DRAFT";
}

export type ContractsView = "all" | "drafts" | "out" | "completed" | "voided" | "templates";
export const CONTRACTS_VIEWS: readonly ContractsView[] = ["all", "drafts", "out", "completed", "voided", "templates"];
export const CONTRACTS_VIEW_LABEL: Record<ContractsView, string> = {
  all: "All",
  drafts: "Drafts",
  out: "Out for signature",
  completed: "Completed",
  voided: "Voided",
  templates: "Templates",
};
/** `?view=live` is the retired spelling of the default. */
export function parseContractsView(raw: string | null | undefined): ContractsView {
  if (raw === "live" || !raw) return "all";
  return CONTRACTS_VIEWS.includes(raw as ContractsView) ? (raw as ContractsView) : "all";
}
export function statusesForContractsView(view: ContractsView): ContractStatus[] | null {
  switch (view) {
    case "drafts": return ["DRAFT"];
    case "out": return ["SENT", "PARTIALLY_SIGNED"];
    case "completed": return ["COMPLETED"];
    case "voided": return ["VOIDED"];
    default: return null;
  }
}
export function contractsViewHref(view: ContractsView): string {
  return view === "all" ? "/agreements" : `/agreements?view=${view}`;
}

export type ContractsSort = "updated" | "name" | "status";
export const CONTRACTS_SORTS: ReadonlyArray<{ key: ContractsSort; label: string }> = [
  { key: "updated", label: "Updated" },
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
];
export function parseContractsSort(raw: string | null | undefined): ContractsSort {
  return CONTRACTS_SORTS.some((s) => s.key === raw) ? (raw as ContractsSort) : "updated";
}

/* ── Parties ───────────────────────────────────────────────────────── */

export type PartyRole = "SIGNER" | "CLIENT" | "THIRD_PARTY" | "INTERNAL" | "COMPANY";
export const PARTY_ROLES: readonly PartyRole[] = ["SIGNER", "CLIENT", "THIRD_PARTY", "INTERNAL", "COMPANY"];
export const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
  SIGNER: "Signer",
  CLIENT: "Client",
  THIRD_PARTY: "Third party",
  INTERNAL: "Internal",
  COMPANY: "Company",
};
export function partyRoleLabel(role: string | null | undefined): string {
  return PARTY_ROLE_LABEL[(role ?? "") as PartyRole] ?? "Signer";
}

export type PartyStatus = "PENDING" | "VIEWED" | "SIGNED" | "DECLINED";
export const PARTY_STATUS_LABEL: Record<PartyStatus, string> = {
  PENDING: "Pending",
  VIEWED: "Viewed",
  SIGNED: "Signed",
  DECLINED: "Declined",
};
/** Pending neutral, Viewed info, Signed success, Declined danger. */
export const PARTY_STATUS_COLOR: Record<PartyStatus, string> = {
  PENDING: "#6B7280",
  VIEWED: "#0073EA",
  SIGNED: "#1F8F4E",
  DECLINED: "#B42318",
};
export function parsePartyStatus(raw: string | null | undefined): PartyStatus {
  return raw === "VIEWED" || raw === "SIGNED" || raw === "DECLINED" ? raw : "PENDING";
}

/** The eight muted hues, indexed by party order (design-system 1.7). */
export const PARTY_HUES: readonly string[] = ["#E07A5F", "#D9A441", "#8FBF6A", "#4FA3A5", "#5C8AD6", "#8C7AD1", "#C86BA2", "#7B8794"];
export function partyHue(index: number): string {
  return PARTY_HUES[((index % PARTY_HUES.length) + PARTY_HUES.length) % PARTY_HUES.length];
}

export function isValidEmail(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export interface PartyLike {
  id: string;
  name: string;
  email: string;
  status?: string | null;
  order?: number | null;
}

/** The Send modal's inline errors: every party needs a name and a valid email. */
export function partySendErrors(parties: PartyLike[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (parties.length === 0) return errors;
  const seen = new Set<string>();
  for (const p of parties) {
    if (!p.name.trim()) { errors[p.id] = "Name is required"; continue; }
    if (!isValidEmail(p.email)) { errors[p.id] = "Enter a valid email"; continue; }
    const key = p.email.trim().toLowerCase();
    if (seen.has(key)) { errors[p.id] = "Two parties share this email"; continue; }
    seen.add(key);
  }
  return errors;
}

export function sortByOrder<T extends PartyLike>(parties: T[]): T[] {
  return [...parties].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Sequential signing: the party whose turn it is, or null when everyone is
 * done. A declined party stops the sequence (the envelope needs attention).
 */
export function nextPartyInOrder<T extends PartyLike>(parties: T[]): T | null {
  for (const p of sortByOrder(parties)) {
    if (p.status === "SIGNED") continue;
    if (p.status === "DECLINED") return null;
    return p;
  }
  return null;
}

/** Which parties get an email on Send: everyone, or only the first when the order is on. */
export function partiesToNotify<T extends PartyLike>(parties: T[], signingOrder: boolean): T[] {
  const pending = sortByOrder(parties).filter((p) => p.status !== "SIGNED");
  if (!signingOrder) return pending;
  const next = nextPartyInOrder(parties);
  return next ? [next] : [];
}

/** The envelope status after a party signs or declines. */
export function envelopeStatusAfter(parties: { status: string }[]): ContractStatus {
  if (parties.length > 0 && parties.every((p) => p.status === "SIGNED")) return "COMPLETED";
  if (parties.some((p) => p.status === "SIGNED")) return "PARTIALLY_SIGNED";
  return "SENT";
}

/* ── The signing page ─────────────────────────────────────────────── */

export type FieldType = "signature" | "initials" | "text" | "email" | "date" | "checkbox" | "dropdown";
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  text: "Text",
  email: "Email",
  date: "Date",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
};

export interface SignFieldLike {
  id: string;
  type: string;
  required?: boolean;
}

/** Signature and Initials are always required; the rest follow their switch. */
export function isRequiredField(f: SignFieldLike): boolean {
  return f.type === "signature" || f.type === "initials" || !!f.required;
}

export function isFilled(value: string | undefined | null): boolean {
  return !!value && value.trim().length > 0;
}

/** "3 of 5 required fields left". */
export function remainingRequired(fields: SignFieldLike[], values: Record<string, string>): { left: number; total: number } {
  const required = fields.filter(isRequiredField);
  const left = required.filter((f) => !isFilled(values[f.id])).length;
  return { left, total: required.length };
}

export function signingBarLabel(fields: SignFieldLike[], values: Record<string, string>): string {
  const { left, total } = remainingRequired(fields, values);
  if (fields.length === 0) return "Nothing for you to fill in";
  if (left === 0) return "All fields complete";
  return `${left} of ${total} required field${total === 1 ? "" : "s"} left`;
}

/** Which of the four signing steps is done: Review › Fill › Sign › Done. */
export function signingProgress(opts: { viewed: boolean; fields: SignFieldLike[]; values: Record<string, string>; signed: boolean }): 0 | 1 | 2 | 3 | 4 {
  if (opts.signed) return 4;
  const { left, total } = remainingRequired(opts.fields, opts.values);
  const sigLeft = opts.fields.filter((f) => (f.type === "signature" || f.type === "initials") && !isFilled(opts.values[f.id])).length;
  if (total > 0 && left === 0) return 3;
  if (sigLeft === 0 && opts.fields.some((f) => f.type === "signature" || f.type === "initials")) return 3;
  if (Object.keys(opts.values).some((k) => isFilled(opts.values[k]))) return 2;
  return opts.viewed ? 1 : 0;
}

/**
 * What a signer may write (PATCH /api/public/sign/[token] { action: "sign",
 * values }): only their OWN field ids, only strings, each capped. Anything
 * else (another party's field, a nested object, an unknown key) is dropped
 * rather than stored, because the party row is the signed evidence record
 * and every key of it is echoed to the other parties as `otherValues`.
 *
 * Signature and initials values are data URLs of the drawn or typed image,
 * so they get a larger cap than a text field.
 */
export const SIGN_TEXT_MAX = 2000;
export const SIGN_IMAGE_MAX = 400_000;
export function sanitizeSignValues(myFields: SignFieldLike[], raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const f of myFields) {
    const v = src[f.id];
    if (typeof v !== "string") continue;
    const image = f.type === "signature" || f.type === "initials";
    if (image && !v.startsWith("data:image/")) continue;
    const capped = v.slice(0, image ? SIGN_IMAGE_MAX : SIGN_TEXT_MAX);
    if (capped.length === 0) continue;
    out[f.id] = capped;
  }
  return out;
}
