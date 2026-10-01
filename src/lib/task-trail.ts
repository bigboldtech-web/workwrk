// The task connection trail: a read-only list of what a task is really
// connected to, built from data the product already writes, never invented.
//
//   SOP step   Item.metadata.sopStep (a task an SOP run created,
//              src/lib/sop-spawn.ts) with the job title it was routed by
//   SOP        EntityLink between the task and an SOP, either direction
//   KRA, KPI   Item.metadata.kraId / kpiId (the drawer's Alignment row)
//   Goal       an OKR linked (EntityLink sourceType OKR) to the task, its
//              List, its Space or its KRA, or whose key result tracks its KPI:
//              the same links the goal's Effort card reads
//   Doc, canvas, table, file, List
//              EntityLink between the task and that node, either direction
//   Contract   EntityLink to a CONTRACT (an Agreement)
//   Kudos      EntityLink to a KUDOS
//   Timer      TimerSession rows on the task (entityType BOARD_ITEM)
//
// Talk has no link type in EntityLinkType yet, so a Talk thread appears only
// once one exists; the trail never shows a placeholder for it.
//
// ONLY WHAT THE VIEWER MAY OPEN. The task itself is gated first (the route
// calls gateItem). Then every entry is checked by its own read rule: a node
// through the one node resolver (node access), an SOP through
// sopVisibilityWhere, a goal through goalVisibilityOr, a file through
// readableFileIds, a contract through the Agreement rule (the manager tier or
// a party), and KRA, KPI, job title and kudos definitions for every Member
// (never a Guest). An entry the viewer cannot open is left out without a
// trace: no count, no "hidden" row.
//
// The pure half (assembleTrail) is tested in task-trail.test.ts; the loader
// below gathers the candidates and the access facts.

export type TrailKind =
  | "sop-step" | "sop" | "job-title" | "kra" | "kpi" | "goal"
  | "doc" | "canvas" | "table" | "file" | "list" | "contract" | "kudos" | "timer";

export interface TrailCandidate {
  kind: TrailKind;
  /** The id the access check is made on (the SOP id for an SOP step). */
  id: string;
  title: string;
  href: string | null;
  detail?: string | null;
}

export interface TrailEntry extends TrailCandidate {
  label: string;
}

const KIND_ORDER: Readonly<Record<TrailKind, number>> = {
  "sop-step": 0, sop: 1, "job-title": 2, kra: 3, kpi: 4, goal: 5,
  doc: 6, canvas: 7, table: 8, file: 9, list: 10, contract: 11, kudos: 12, timer: 13,
};

const KIND_LABEL: Readonly<Record<TrailKind, string>> = {
  "sop-step": "SOP step", sop: "SOP", "job-title": "Owner by job title", kra: "KRA", kpi: "KPI", goal: "Goal",
  doc: "Doc", canvas: "Canvas", table: "Table", file: "File", list: "List", contract: "Contract", kudos: "Kudos", timer: "Time logged",
};

/** The kind the access check is made under (an SOP step is read as its SOP). */
export function accessKindOf(kind: TrailKind): TrailKind {
  return kind === "sop-step" ? "sop" : kind;
}

/**
 * Keep only what the viewer may open, one entry per kind and id, in the
 * trail's fixed order. An SOP that is also the task's SOP step shows once,
 * as the step. Pure.
 */
export function assembleTrail(candidates: readonly TrailCandidate[], allowed: (kind: TrailKind, id: string) => boolean): TrailEntry[] {
  const seen = new Set<string>();
  const stepSops = new Set(candidates.filter((c) => c.kind === "sop-step").map((c) => c.id));
  const out: TrailEntry[] = [];
  for (const c of candidates) {
    if (!c.id || !c.title) continue;
    if (!allowed(accessKindOf(c.kind), c.id)) continue;
    if (c.kind === "sop" && stepSops.has(c.id)) continue;
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, label: KIND_LABEL[c.kind] });
  }
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title));
}

/** "2h 10m", "45m", "under a minute". Pure. */
export function formatLogged(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}
