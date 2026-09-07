// sequence — lay out a UML-style sequence diagram: participants across the top,
// dashed lifelines dropping down, and messages as time-ordered horizontal
// arrows between lifelines. Pure + dependency-free, so it's unit-tested and
// safe on the client. Emits the same CanvasScene elements as everything else,
// so the messages/boxes select, move, and edit like any other shapes.

import {
  type CanvasScene,
  type CanvasElement,
  type ShapeElement,
  type PathElement,
  emptyScene,
  genId,
  syncPathBounds,
} from "./scene";

export interface SequenceMessage {
  from: string;
  to: string;
  label?: string;
  /** A response / return message renders dashed (UML convention). */
  dashed?: boolean;
}
export interface SequenceSpec {
  title?: string;
  participants: string[];
  messages: SequenceMessage[];
}

const PART_W = 150;   // participant box
const PART_H = 44;
const PART_GAP = 96;  // gap between participant boxes
const TOP = 60;       // y of the participant row
const MSG_TOP = TOP + PART_H + 46; // first message y
const MSG_GAP = 48;   // vertical gap between messages
const SELF_DROP = 22; // vertical drop of a self-message loop
const ACT_W = 10;     // width of an activation bar on a lifeline
const MARGIN = 60;

export function sequenceToScene(spec: SequenceSpec): CanvasScene {
  const scene = emptyScene();
  const participants = (spec.participants ?? []).filter((p) => typeof p === "string" && p.trim());
  if (participants.length === 0) return scene;
  const messages = (spec.messages ?? []).filter((m) => m && participants.includes(m.from) && participants.includes(m.to));

  // centre-x of each participant's lifeline
  const cx = new Map<string, number>();
  participants.forEach((p, i) => cx.set(p, MARGIN + i * (PART_W + PART_GAP) + PART_W / 2));

  const yOf = (i: number) => MSG_TOP + i * MSG_GAP;
  // How far the lifelines (and any self-loops) reach.
  const bottomY = MSG_TOP + Math.max(1, messages.length) * MSG_GAP + 20;

  // Activation bars — the thin rectangles that show WHEN a participant is busy,
  // which is what makes a sequence diagram read at a glance (who is doing work,
  // and which arrows connect to whom). A participant activates when it receives
  // a call (solid incoming) and deactivates when it sends the matching return
  // (dashed outgoing); a self-message gets a short bar; anything still open runs
  // to the bottom.
  type Span = { p: string; y0: number; y1: number };
  const spans: Span[] = [];
  const openAt = new Map<string, number>();
  messages.forEach((m, i) => {
    const y = yOf(i);
    if (m.from === m.to) { spans.push({ p: m.to, y0: y, y1: y + SELF_DROP + 8 }); return; }
    if (!m.dashed) { if (!openAt.has(m.to)) openAt.set(m.to, y); }
    else if (openAt.has(m.from)) { spans.push({ p: m.from, y0: openAt.get(m.from)!, y1: y }); openAt.delete(m.from); }
  });
  for (const [p, y0] of openAt) spans.push({ p, y0, y1: bottomY - 12 });
  const activeAt = (p: string, y: number) => spans.some((s) => s.p === p && y >= s.y0 - 1 && y <= s.y1 + 1);

  const elements: CanvasElement[] = [];

  // 1) Lifelines (behind everything).
  for (const p of participants) {
    const x = cx.get(p)!;
    const line: PathElement = {
      id: genId(), type: "line", x, y: TOP + PART_H, w: 1, h: 1,
      stroke: "#94A3B8", fill: "transparent", strokeWidth: 1.5, opacity: 1,
      points: [[x, TOP + PART_H], [x, bottomY]], arrowType: "straight", startHead: "none", endHead: "none", dash: "dashed",
    };
    syncPathBounds(line);
    elements.push(line);
  }

  // 2) Activation bars (on the lifelines, under the boxes + arrows).
  for (const s of spans) {
    elements.push({
      id: genId(), type: "rect", x: cx.get(s.p)! - ACT_W / 2, y: s.y0, w: ACT_W, h: Math.max(14, s.y1 - s.y0),
      stroke: "#64748B", fill: "#E2E8F0", strokeWidth: 1, opacity: 1,
    } as ShapeElement);
  }

  // 3) Participant boxes.
  for (const p of participants) {
    const x = cx.get(p)! - PART_W / 2;
    elements.push({
      id: genId(), type: "roundRect", x, y: TOP, w: PART_W, h: PART_H,
      stroke: "#1E293B", fill: "#EEF2FF", strokeWidth: 2, opacity: 1,
      text: p, fontSize: 14, align: "center",
    } as ShapeElement);
  }

  // 4) Messages (front), top-to-bottom; endpoints sit on the activation-bar
  // edge (not floating on the bare lifeline) so each arrow visibly connects.
  messages.forEach((m, i) => {
    const y = yOf(i);
    const fromC = cx.get(m.from)!;
    const toC = cx.get(m.to)!;
    const dash = m.dashed ? "dashed" : "solid";
    let points: [number, number][];
    if (m.from === m.to) {
      const x0 = fromC + (activeAt(m.from, y) ? ACT_W / 2 : 0);
      points = [[x0, y], [x0 + 54, y], [x0 + 54, y + SELF_DROP], [x0, y + SELF_DROP]];
    } else {
      const dir = toC > fromC ? 1 : -1;
      const x0 = fromC + (activeAt(m.from, y) ? dir * ACT_W / 2 : 0);
      const x1 = toC - (activeAt(m.to, y) ? dir * ACT_W / 2 : 0);
      points = [[x0, y], [x1, y]];
    }
    const arrow: PathElement = {
      id: genId(), type: "arrow", x: points[0][0], y, w: 1, h: 1,
      stroke: "#334155", fill: "transparent", strokeWidth: 1.75, opacity: 1,
      points, arrowType: "straight", endHead: "arrow", dash,
      ...(m.label ? { text: m.label, fontSize: 12 } : {}),
    };
    syncPathBounds(arrow);
    elements.push(arrow);
  });

  scene.elements = elements;
  return scene;
}
