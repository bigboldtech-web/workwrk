import { describe, expect, it } from "vitest";
import { sequenceToScene } from "./sequence";

describe("sequenceToScene", () => {
  it("lays out participants, lifelines, and ordered messages", () => {
    const scene = sequenceToScene({
      title: "Login",
      participants: ["Client", "API", "Auth"],
      messages: [
        { from: "Client", to: "API", label: "login" },
        { from: "API", to: "Auth", label: "verify" },
        { from: "Auth", to: "API", label: "token", dashed: true },
        { from: "API", to: "Client", label: "200", dashed: true },
      ],
    });
    const boxes = scene.elements.filter((e) => e.type === "roundRect");
    const lifelines = scene.elements.filter((e) => e.type === "line");
    const msgs = scene.elements.filter((e) => e.type === "arrow");
    expect(boxes).toHaveLength(3);
    expect(lifelines).toHaveLength(3);
    expect(msgs).toHaveLength(4);
    // messages are ordered top-to-bottom
    const ys = msgs.map((m) => m.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    // a return message renders dashed
    const token = msgs.find((m) => (m as { text?: string }).text === "token") as { dash?: string };
    expect(token.dash).toBe("dashed");
    // activation bars (rects on the lifelines) make "who is active" legible
    const bars = scene.elements.filter((e) => e.type === "rect");
    expect(bars.length).toBeGreaterThan(0);
    // every bar sits centred on some participant's lifeline
    const lifelineXs = scene.elements.filter((e) => e.type === "line").map((e) => e.x);
    expect(bars.every((b) => lifelineXs.some((lx) => Math.abs((b.x + b.w / 2) - lx) < 0.5))).toBe(true);
  });

  it("draws a self-message as a loop and ignores unknown participants", () => {
    const scene = sequenceToScene({
      participants: ["A", "B"],
      messages: [
        { from: "A", to: "A", label: "think" },     // self-loop
        { from: "A", to: "Ghost", label: "nope" },  // unknown target → dropped
      ],
    });
    const msgs = scene.elements.filter((e) => e.type === "arrow");
    expect(msgs).toHaveLength(1);
    const self = msgs[0] as { points: [number, number][] };
    expect(self.points.length).toBe(4); // out-and-back loop
  });

  it("returns an empty scene with no participants", () => {
    expect(sequenceToScene({ participants: [], messages: [] }).elements).toHaveLength(0);
  });
});
