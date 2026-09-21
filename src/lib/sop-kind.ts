// The four SOP kinds, decoded once (spec-process section 1 naming canon and
// section 2 `/sops/[id]`).
//
// The database knows three `sopType` values (WRITTEN, RECORDED, CHECKLIST) and
// the WRITTEN row carries several content shapes ("blocks", "WRITTEN",
// "richtext" for a written document; "steps" and "process_flow" for a
// step-by-step SOP). Every surface used to re-derive the kind from those two
// axes with its own if-chain and its own label ("Click-capture", "Screen
// recording", "Recording" for the same thing). This module is the one place
// the decoding and the words live. Pure: no imports, so vitest runs it in
// node and the server list route can call it too.

export type SopKind = "written" | "steps" | "checklist" | "recording";
export type SopType = "WRITTEN" | "RECORDED" | "CHECKLIST";
export type SopStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED";
export type SopLayout = "list" | "flow";

export const SOP_KINDS: readonly SopKind[] = ["written", "steps", "checklist", "recording"];

export const SOP_KIND_LABEL: Record<SopKind, string> = {
  written: "Written",
  steps: "Step-by-step",
  checklist: "Checklist",
  recording: "Recording",
};

export const SOP_STATUS_LABEL: Record<SopStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/** StatusChip colours: Draft neutral, In review / Approved info, Published success, Archived neutral. */
export const SOP_STATUS_COLOR: Record<SopStatus, string> = {
  DRAFT: "#6B7280",
  IN_REVIEW: "#0073EA",
  APPROVED: "#0073EA",
  PUBLISHED: "#1F8F4E",
  ARCHIVED: "#6B7280",
};

export function isSopStatus(v: unknown): v is SopStatus {
  return v === "DRAFT" || v === "IN_REVIEW" || v === "APPROVED" || v === "PUBLISHED" || v === "ARCHIVED";
}

export function isSopKind(v: unknown): v is SopKind {
  return (SOP_KINDS as readonly string[]).includes(String(v));
}

type ContentLike = { type?: unknown; layout?: unknown } | null | undefined;

/**
 * The one decoder. A CHECKLIST row is a checklist whatever its content says;
 * a RECORDED row (or a "recorded" content tag) is a recording; a written
 * document is "blocks" / "WRITTEN" / "richtext"; everything else on a WRITTEN
 * row ("steps", "process_flow", the oldest bare `{ steps: [] }`) is
 * step-by-step.
 */
export function getSopKind(sopType: string | null | undefined, content: unknown): SopKind {
  if (sopType === "CHECKLIST") return "checklist";
  const ctype = typeof (content as ContentLike)?.type === "string" ? String((content as ContentLike)!.type) : null;
  if (sopType === "RECORDED" || ctype === "recorded" || ctype === "RECORDED") return "recording";
  if (ctype === "blocks" || ctype === "WRITTEN" || ctype === "richtext") return "written";
  return "steps";
}

/** The `sopType` a kind is stored under. Step-by-step is a presentation of WRITTEN. */
export function sopTypeForKind(kind: SopKind): SopType {
  if (kind === "checklist") return "CHECKLIST";
  if (kind === "recording") return "RECORDED";
  return "WRITTEN";
}

/** The empty content shape a kind starts with (spec-process section 2, the create routes). */
export function defaultContentForKind(kind: SopKind): Record<string, unknown> {
  switch (kind) {
    case "checklist":
      return { type: "CHECKLIST", sections: [] };
    case "recording":
      return { type: "recorded", steps: [] };
    case "steps":
      return { type: "steps", layout: "list", steps: [] };
    default:
      return { type: "blocks", blocks: [] };
  }
}

/**
 * How a step-by-step SOP is shown: the flat numbered list or the branching
 * flow. Legacy `process_flow` rows have no `layout` field and read as flow;
 * everything else defaults to the list.
 */
export function getSopLayout(content: unknown): SopLayout {
  const c = content as ContentLike;
  if (c?.layout === "flow" || c?.layout === "list") return c.layout;
  return c?.type === "process_flow" ? "flow" : "list";
}

/** The `kind` query value of /sops mapped from a Prisma-side filter. */
export function kindWhere(kind: SopKind): Record<string, unknown> {
  switch (kind) {
    case "checklist":
      return { sopType: "CHECKLIST" };
    case "recording":
      return { OR: [{ sopType: "RECORDED" }, { content: { path: ["type"], equals: "recorded" } }, { content: { path: ["type"], equals: "RECORDED" } }] };
    case "written":
      return {
        sopType: "WRITTEN",
        OR: [
          { content: { path: ["type"], equals: "blocks" } },
          { content: { path: ["type"], equals: "WRITTEN" } },
          { content: { path: ["type"], equals: "richtext" } },
        ],
      };
    default:
      return {
        sopType: "WRITTEN",
        NOT: {
          OR: [
            { content: { path: ["type"], equals: "blocks" } },
            { content: { path: ["type"], equals: "WRITTEN" } },
            { content: { path: ["type"], equals: "richtext" } },
            { content: { path: ["type"], equals: "recorded" } },
            { content: { path: ["type"], equals: "RECORDED" } },
          ],
        },
      };
  }
}

/* ────────────────── checklist helpers (read mode and runs) ────────────────── */

export const CHECKLIST_INPUT_LABEL: Record<string, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  checkbox: "Yes/No",
  email: "Email",
  website: "Link",
  date: "Date",
  dropdown: "Dropdown",
  multichoice: "Multiple choice",
  file_upload: "File",
};

/** "Asks for: Email, Photo" under a checklist step in read mode; "" when the step asks for nothing. */
export function checklistAsksFor(inputs: ReadonlyArray<{ type?: string; label?: string }> | null | undefined): string {
  if (!inputs || inputs.length === 0) return "";
  const names = inputs.map((i) => (i.label && i.label.trim()) || CHECKLIST_INPUT_LABEL[i.type ?? ""] || "Field");
  return `Asks for: ${names.join(", ")}`;
}

export interface RunSectionLike {
  steps?: ReadonlyArray<{ id: string; inputs?: ReadonlyArray<{ id: string; required?: boolean }> }>;
}

/** Total steps across sections, or 0 for a checklist with no steps. */
export function countSteps(sections: ReadonlyArray<RunSectionLike> | null | undefined): number {
  return (sections ?? []).reduce((n, s) => n + (s.steps?.length ?? 0), 0);
}

/** "5 of 9 steps · 56%" as its parts. */
export function runProgress(sections: ReadonlyArray<RunSectionLike> | null | undefined, completed: ReadonlyArray<string> | null | undefined): { done: number; total: number; pct: number } {
  const total = countSteps(sections);
  const set = new Set(completed ?? []);
  let done = 0;
  for (const s of sections ?? []) for (const st of s.steps ?? []) if (set.has(st.id)) done += 1;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** A required input is missing when its value is undefined, null, "" or an empty list. */
export function missingRequired(step: { inputs?: ReadonlyArray<{ id: string; required?: boolean }> }, values: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  for (const input of step.inputs ?? []) {
    if (!input.required) continue;
    const v = values?.[input.id];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) out.push(input.id);
  }
  return out;
}

/** Every required input on every step is filled: the "Finish run" bar may show. */
export function allRequiredDone(sections: ReadonlyArray<RunSectionLike> | null | undefined, completed: ReadonlyArray<string> | null | undefined): boolean {
  const total = countSteps(sections);
  if (total === 0) return false;
  const set = new Set(completed ?? []);
  for (const s of sections ?? []) for (const st of s.steps ?? []) if (!set.has(st.id)) return false;
  return true;
}
