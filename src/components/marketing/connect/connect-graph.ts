// The connection map (marketing-concept.md section 5, "/how-it-connects").
//
// "The spine as an explorable map: one full-width stage with the eight
// blocks as a graph and blue wires as edges. Click any node (Role, KRA, KPI,
// SOP, Policy, Task, Doc, Channel, Table row, Goal, Review, Kudos) and the
// right pane shows what it is, what it connects to, and the real surface
// where the connection is made."
//
// This module is the map itself: twelve record nodes, their coordinates, and
// the edges between them. It is pure, so the layout and every claim on it
// are unit testable, and so the page component renders it and adds nothing.
//
// THE RULE THAT MATTERS MOST. An edge on this page is a claim that two
// records are connected in the product, and it is the single most checkable
// claim the site makes: a buyer can open the app and look. So every edge
// carries a `label` that is true TODAY, describing a relation this repo has
// (a foreign key, a link writer, a field), and a mechanism that is still in
// build is a SECOND sentence on the same edge, behind the storyboard's own
// truth gate, introduced as being in build.
//
// That is why there is one edge per pair rather than two. The first version
// drew the shipped relation and the unbuilt mechanism as separate wires
// between the same two nodes, which reads as "these are connected twice"
// and hides which half a visitor can go and use.

import { stopByNumber, stopShipped, tuesday, type DotColor } from "../data/tuesday";
import { moduleHref } from "../product/module-page";

/* ═══════════════════════════════════════════════════════════════════
 * Nodes.
 * ═══════════════════════════════════════════════════════════════════ */

export interface ConnectNode {
  id: string;
  label: string;
  /** The block it lives in. The dot colour and the module link come from it. */
  block: string;
  /** One sentence: what this record is. Nothing here is a mechanism. */
  what: string;
  /**
   * The marketing-lite surface where the connection is made, or null.
   *
   * Null is not a gap: Kudos has no surface of its own in the shell package,
   * and a node pointing at somebody else's screen would be worse than a node
   * that says where it lives in words.
   */
  surface: string | null;
  /** Where the surface sits, for the caption. */
  surfaceName: string;
  /** Position in the stage's 1000 by 540 coordinate space. */
  x: number;
  y: number;
}

export const CONNECT_NODES: ConnectNode[] = [
  // People.
  {
    id: "role",
    label: "Role",
    block: "teams",
    what: "A job title with a level and a department. People hold it, and it carries the KRA that role owns.",
    surface: "role-page",
    surfaceName: "the Role page",
    x: 110,
    y: 140,
  },
  {
    id: "kudos",
    label: "Kudos",
    block: "teams",
    what: "Recognition given to a person, against one of the company's own values rather than a generic list.",
    surface: null,
    surfaceName: "the Kudos wall in Teams",
    x: 110,
    y: 400,
  },
  // Process.
  {
    id: "sop",
    label: "SOP",
    block: "docs",
    what: "A published process in one of four kinds, with an acknowledgement trail showing who has read it.",
    surface: "sop-doc",
    surfaceName: "the SOP",
    x: 370,
    y: 80,
  },
  {
    id: "policy",
    label: "Policy",
    block: "docs",
    what: "A document people have to read, with the acknowledgement recorded against each name.",
    surface: "sop-doc",
    surfaceName: "the policy document",
    x: 370,
    y: 250,
  },
  {
    id: "doc",
    label: "Doc",
    block: "docs",
    what: "A page, a wiki entry, a contract or a canvas. Anything a task can point at and anyone can be given.",
    surface: "contract-doc",
    surfaceName: "the document",
    x: 370,
    y: 420,
  },
  // Work.
  {
    id: "channel",
    label: "Channel",
    block: "talk",
    what: "A channel, a thread or a call, with reactions, mentions and attachments on it.",
    surface: "talk-thread",
    surfaceName: "the thread",
    x: 630,
    y: 80,
  },
  {
    id: "task",
    label: "Task",
    block: "work",
    what: "One row with a status, an owner, dates and custom fields, plus links out to whatever it came from.",
    surface: "board-list-drawer",
    surfaceName: "the task drawer",
    x: 630,
    y: 250,
  },
  {
    id: "table-row",
    label: "Table row",
    block: "tables",
    what: "A row in a table, written by hand or by a form, with formulas, lookups and rollups over it.",
    surface: "table",
    surfaceName: "the table",
    x: 630,
    y: 420,
  },
  // Outcome.
  {
    id: "kra",
    label: "KRA",
    block: "goals",
    what: "What a role owns. It holds the KPIs underneath it, and it is the thing a review scores.",
    surface: "role-page",
    surfaceName: "the Role page",
    x: 890,
    y: 70,
  },
  {
    id: "kpi",
    label: "KPI",
    block: "goals",
    what: "A target, its readings over time, and the weight it carries in the score it feeds.",
    surface: "goal-detail",
    surfaceName: "the goal",
    x: 890,
    y: 200,
  },
  {
    id: "goal",
    label: "Goal",
    block: "goals",
    what: "An objective with its key results, the KPIs underneath them, and a rollup to the level above.",
    surface: "goal-detail",
    surfaceName: "the goal",
    x: 890,
    y: 330,
  },
  {
    id: "review",
    label: "Review",
    block: "teams",
    what: "A cycle with the KPI records and the KRA result already on the timeline, because the work is in the same system.",
    surface: "review-timeline",
    surfaceName: "the review timeline",
    x: 890,
    y: 460,
  },
];

export function connectNode(id: string): ConnectNode | undefined {
  return CONNECT_NODES.find((n) => n.id === id);
}

/** The dot colour of a node, through its block. One palette, one source. */
export function nodeDot(node: ConnectNode): DotColor {
  return tuesday.hubs.find((h) => h.id === node.block)?.dot ?? "blue";
}

export function nodeBlockLabel(node: ConnectNode): string {
  return tuesday.hubs.find((h) => h.id === node.block)?.label ?? node.block;
}

export function nodeModuleHref(node: ConnectNode): string {
  return moduleHref(node.block);
}

/* ═══════════════════════════════════════════════════════════════════
 * Edges.
 * ═══════════════════════════════════════════════════════════════════ */

export interface ConnectEdge {
  a: string;
  b: string;
  /** True today. A foreign key, a link writer or a field in this repo. */
  label: string;
  /** The stop whose mechanism would make the edge do more. Optional. */
  stop?: number;
  /** What the edge becomes when that stop ships. Read only through `edgeUpcoming`. */
  stopLabel?: string;
}

export const CONNECT_EDGES: ConnectEdge[] = [
  { a: "role", b: "kra", label: "A role carries the KRA it owns, and templates it for whoever holds the role." },
  {
    a: "role",
    b: "sop",
    label: "The SOP names its owner, and the Role page carries the KRA that process serves.",
    stop: 1,
    stopLabel: "the role itself owns the process, so the owner resolves from whoever holds it",
  },
  { a: "kra", b: "sop", label: "An SOP can name the KRA it serves, so a process is attached to what it is for." },
  { a: "kra", b: "kpi", label: "A KRA carries its KPIs and the weight each one has in the result." },
  { a: "kra", b: "review", label: "A review scores the KRA result, not a memory of the quarter." },
  { a: "kpi", b: "goal", label: "A goal reads the KPIs underneath it, and rolls up to the level above." },
  { a: "kpi", b: "review", label: "KPI readings are already on the review timeline when the cycle opens." },
  { a: "sop", b: "doc", label: "An SOP is a document, published in one of four kinds." },
  { a: "policy", b: "doc", label: "A policy is a document with an acknowledgement attached to it." },
  {
    a: "sop",
    b: "task",
    label: "A task links the SOP that governs it, as required reading, and the link is visible from both ends.",
    stop: 2,
    stopLabel: "a step of the SOP creates the task, with the owner resolved from the role",
  },
  { a: "task", b: "doc", label: "A task links a doc, a file, a canvas or a table, and the doc shows the task back." },
  {
    a: "task",
    b: "channel",
    label: "The task carries its own thread, and a conversation can be linked beside it.",
    stop: 3,
    stopLabel: "a decision taken in a channel lands on the task by itself",
  },
  { a: "task", b: "table-row", label: "A table row and a task link both ways, so a record and its work stay together." },
  {
    a: "task",
    b: "goal",
    label: "A task is linked to a goal from the goal, and shows on its Effort card.",
    stop: 5,
    stopLabel: "finishing the task writes the KPI reading that moves the goal",
  },
  {
    a: "kudos",
    b: "review",
    label: "Kudos names one of the company's own values, and the values are the org's own list.",
    stop: 6,
    stopLabel: "a kudos files as evidence on the review it belongs to",
  },
  { a: "kudos", b: "role", label: "Kudos is given to a person, and a person holds a role." },
];

export function edgesFor(nodeId: string): ConnectEdge[] {
  return CONNECT_EDGES.filter((e) => e.a === nodeId || e.b === nodeId);
}

/** The node at the other end of an edge, seen from `nodeId`. */
export function edgeOther(edge: ConnectEdge, nodeId: string): string {
  return edge.a === nodeId ? edge.b : edge.a;
}

/**
 * The second sentence, or null.
 *
 * It returns null once the stop ships, because at that point the mechanism
 * is not upcoming: it is the edge, and `label` is rewritten in the same
 * change that flips the flag.
 */
export function edgeUpcoming(edge: ConnectEdge): string | null {
  if (edge.stop === undefined || !edge.stopLabel) return null;
  return stopShipped(edge.stop) ? null : edge.stopLabel;
}

/** A stable key, so React and a test agree on the identity of an edge. */
export function edgeKey(edge: ConnectEdge): string {
  return `${edge.a}-${edge.b}`;
}

/* ═══════════════════════════════════════════════════════════════════
 * Follow Tuesday: the six stops, on the map.
 * ═══════════════════════════════════════════════════════════════════ */

export interface TourStep {
  n: number;
  clock: string;
  title: string;
  /** Gated: the fallback prints while the stop's mechanism is unbuilt. */
  narration: string;
  /** Gated: the wire label the story is allowed to print today. */
  wire: string;
  shipped: boolean;
  /** The nodes this stop lights. */
  nodes: string[];
  /** The edges this stop lights, by key. */
  edges: string[];
}

/**
 * Which record nodes each stop is about.
 *
 * Stop 4 lights one node, and that is not an omission: the blocked to
 * unblocked stop is a Work and Planner moment, and Planner has no record on
 * this map. A huddle and a logged duration are surfaces, not nodes in the
 * graph the concept names, so the stop lights the task and says the rest in
 * its narration rather than inventing a thirteenth node to have something
 * to point at.
 */
const STOP_NODES: Record<number, string[]> = {
  1: ["role", "kra", "sop"],
  2: ["sop", "task"],
  3: ["task", "channel", "doc"],
  4: ["task"],
  5: ["task", "kpi", "goal"],
  6: ["task", "goal", "review", "kudos"],
};

/** Every edge whose two ends are both lit by this stop. */
export function edgesForStop(n: number): string[] {
  const nodes = STOP_NODES[n] ?? [];
  return CONNECT_EDGES.filter((e) => nodes.includes(e.a) && nodes.includes(e.b)).map(edgeKey);
}

export function tourSteps(): TourStep[] {
  return tuesday.stops.map((stop) => {
    const shipped = stop.truthGate.shipped;
    return {
      n: stop.n,
      clock: stop.clock,
      title: stop.title,
      narration: shipped ? stop.narration : stop.truthGate.fallbackNarration,
      wire: !stop.wireLabelFallback ? stop.wireLabel : shipped ? stop.wireLabel : stop.wireLabelFallback,
      shipped,
      nodes: STOP_NODES[stop.n] ?? [],
      edges: edgesForStop(stop.n),
    };
  });
}

/** The clock a stop reads at, for the step nav. Kept out of the component. */
export function tourStepClock(n: number): string {
  return stopByNumber(n)?.clock ?? "";
}

/* ═══════════════════════════════════════════════════════════════════
 * Geometry.
 * ═══════════════════════════════════════════════════════════════════ */

export const STAGE_WIDTH = 1000;
export const STAGE_HEIGHT = 540;

/** A node's position as a percentage, which is what the CSS layer wants. */
export function nodePercent(node: ConnectNode): { left: number; top: number } {
  return {
    left: (node.x / STAGE_WIDTH) * 100,
    top: (node.y / STAGE_HEIGHT) * 100,
  };
}

/** The two endpoints of an edge in stage coordinates, for the SVG line. */
export function edgeLine(edge: ConnectEdge): { x1: number; y1: number; x2: number; y2: number } | null {
  const a = connectNode(edge.a);
  const b = connectNode(edge.b);
  if (!a || !b) return null;
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** Every surface the map's right pane can show. Pre-rendered once each. */
export function mapSurfaceKeys(): string[] {
  const out: string[] = [];
  for (const node of CONNECT_NODES) {
    if (node.surface && !out.includes(node.surface)) out.push(node.surface);
  }
  return out;
}
