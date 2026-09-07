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
const MARGIN = 60;

export function sequenceToScene(spec: SequenceSpec): CanvasScene {
  const scene = emptyScene();
  const participants = (spec.participants ?? []).filter((p) => typeof p === "string" && p.trim());
  if (participants.length === 0) return scene;
  const messages = (spec.messages ?? []).filter((m) => m && participants.includes(m.from) && participants.includes(m.to));

  // centre-x of each participant's lifeline
  const cx = new Map<string, number>();
  participants.forEach((p, i) => cx.set(p, MARGIN + i * (PART_W + PART_GAP) + PART_W / 2));

  // How far the lifelines (and any self-loops) reach.
  const bottomY = MSG_TOP + Math.max(1, messages.length) * MSG_GAP + 20;

  const elements: CanvasElement[] = [];

  // Lifelines first (behind everything).
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

  // Participant boxes.
  for (const p of participants) {
    const x = cx.get(p)! - PART_W / 2;
    elements.push({
      id: genId(), type: "roundRect", x, y: TOP, w: PART_W, h: PART_H,
      stroke: "#1E293B", fill: "#EEF2FF", strokeWidth: 2, opacity: 1,
      text: p, fontSize: 14, align: "center",
    } as ShapeElement);
  }

  // Messages, top-to-bottom in order.
  messages.forEach((m, i) => {
    const y = MSG_TOP + i * MSG_GAP;
    const fromX = cx.get(m.from)!;
    const toX = cx.get(m.to)!;
    const dash = m.dashed ? "dashed" : "solid";
    let points: [number, number][];
    if (m.from === m.to) {
      // self-message: a small loop out to the right and back
      points = [[fromX, y], [fromX + 54, y], [fromX + 54, y + SELF_DROP], [fromX, y + SELF_DROP]];
    } else {
      points = [[fromX, y], [toX, y]];
    }
    const arrow: PathElement = {
      id: genId(), type: "arrow", x: fromX, y, w: 1, h: 1,
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
