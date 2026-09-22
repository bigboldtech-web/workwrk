// The connection map, held to the one rule it exists under: an edge is a
// claim that two records are connected in the product, and it is the most
// checkable claim the site makes, because a buyer can open the app and look.
//
// So these tests are mostly about what the map is NOT allowed to say: an
// edge to a node that does not exist, the same pair drawn twice, a mechanism
// asserted as shipped while its stop says otherwise, or a stop lighting a
// record the storyboard never puts it near.

import { describe, expect, it } from "vitest";

import {
  CONNECT_EDGES,
  CONNECT_NODES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  connectNode,
  edgeKey,
  edgeLine,
  edgeOther,
  edgeUpcoming,
  edgesFor,
  edgesForStop,
  mapSurfaceKeys,
  nodeBlockLabel,
  nodeDot,
  nodeModuleHref,
  nodePercent,
  tourStepClock,
  tourSteps,
} from "./connect-graph";
import { MODULE_ORDER } from "../product/module-page";
import { stopShipped, tuesday } from "../data/tuesday";

const IDS = CONNECT_NODES.map((n) => n.id);

describe("the nodes", () => {
  it("are the twelve records the concept names", () => {
    expect(IDS.sort()).toEqual(
      ["channel", "doc", "goal", "kpi", "kra", "kudos", "policy", "review", "role", "sop", "table-row", "task"].sort(),
    );
  });

  it("have unique ids", () => {
    expect(new Set(IDS).size).toBe(IDS.length);
  });

  it("each live in a real block", () => {
    for (const node of CONNECT_NODES) {
      expect(MODULE_ORDER).toContain(node.block as (typeof MODULE_ORDER)[number]);
      expect(nodeBlockLabel(node)).toBe(tuesday.hubs.find((h) => h.id === node.block)!.label);
      expect(nodeModuleHref(node)).toBe(`/product/${node.block}`);
    }
  });

  it("take their dot from the block, never from their own palette", () => {
    for (const node of CONNECT_NODES) {
      expect(nodeDot(node)).toBe(tuesday.hubs.find((h) => h.id === node.block)!.dot);
    }
  });

  it("sit inside the stage", () => {
    for (const node of CONNECT_NODES) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(STAGE_WIDTH);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(STAGE_HEIGHT);
      const pct = nodePercent(node);
      expect(pct.left).toBeGreaterThan(0);
      expect(pct.left).toBeLessThan(100);
      expect(pct.top).toBeGreaterThan(0);
      expect(pct.top).toBeLessThan(100);
    }
  });

  it("never sit on top of each other", () => {
    const seen = new Set<string>();
    for (const node of CONNECT_NODES) {
      const key = `${node.x}:${node.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("say what they are without an em dash or a double hyphen", () => {
    for (const node of CONNECT_NODES) {
      expect(node.what).not.toMatch(/[—–―]/);
      expect(node.what).not.toMatch(/--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/);
      expect(node.what.length).toBeGreaterThan(30);
    }
  });

  it("resolve by id, and nothing else does", () => {
    expect(connectNode("task")?.label).toBe("Task");
    expect(connectNode("nope")).toBeUndefined();
  });
});

describe("the edges", () => {
  it("only join nodes that exist", () => {
    for (const edge of CONNECT_EDGES) {
      expect(connectNode(edge.a), `edge source ${edge.a}`).toBeDefined();
      expect(connectNode(edge.b), `edge target ${edge.b}`).toBeDefined();
    }
  });

  it("never join a node to itself", () => {
    for (const edge of CONNECT_EDGES) expect(edge.a).not.toBe(edge.b);
  });

  it("draw each pair exactly once, in either direction", () => {
    const seen = new Set<string>();
    for (const edge of CONNECT_EDGES) {
      const key = [edge.a, edge.b].sort().join("|");
      expect(seen.has(key), `pair ${key} drawn twice`).toBe(false);
      seen.add(key);
    }
  });

  it("every node is connected to something", () => {
    for (const node of CONNECT_NODES) {
      expect(edgesFor(node.id).length, `${node.id} is stranded`).toBeGreaterThan(0);
    }
  });

  it("say something true today in their label", () => {
    for (const edge of CONNECT_EDGES) {
      expect(edge.label.length).toBeGreaterThan(30);
      expect(edge.label).not.toMatch(/[—–―]/);
      expect(edge.label).not.toMatch(/--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/);
    }
  });

  it("gate the second sentence on the stop that would make it true", () => {
    for (const edge of CONNECT_EDGES) {
      const upcoming = edgeUpcoming(edge);
      if (edge.stop === undefined) {
        expect(upcoming).toBeNull();
        continue;
      }
      if (stopShipped(edge.stop)) expect(upcoming).toBeNull();
      else expect(upcoming).toBe(edge.stopLabel);
    }
  });

  it("only cite stops the storyboard has", () => {
    const stops = tuesday.stops.map((s) => s.n);
    for (const edge of CONNECT_EDGES) {
      if (edge.stop === undefined) continue;
      expect(stops).toContain(edge.stop);
      expect(edge.stopLabel, `stop ${edge.stop} has no sentence`).toBeTruthy();
    }
  });

  it("read from either end", () => {
    for (const edge of CONNECT_EDGES) {
      expect(edgeOther(edge, edge.a)).toBe(edge.b);
      expect(edgeOther(edge, edge.b)).toBe(edge.a);
    }
  });

  it("key uniquely, so React and the lit set agree", () => {
    const keys = CONNECT_EDGES.map(edgeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolve to a drawable line", () => {
    for (const edge of CONNECT_EDGES) {
      const line = edgeLine(edge)!;
      expect(line).not.toBeNull();
      expect(line.x1).toBe(connectNode(edge.a)!.x);
      expect(line.y2).toBe(connectNode(edge.b)!.y);
    }
  });
});

describe("Follow Tuesday", () => {
  const steps = tourSteps();

  it("is one step per stop, in order", () => {
    expect(steps.map((s) => s.n)).toEqual(tuesday.stops.map((s) => s.n));
  });

  it("prints the gated narration, never the raw one when the stop is unbuilt", () => {
    for (const step of steps) {
      const stop = tuesday.stops.find((s) => s.n === step.n)!;
      expect(step.shipped).toBe(stop.truthGate.shipped);
      expect(step.narration).toBe(stop.truthGate.shipped ? stop.narration : stop.truthGate.fallbackNarration);
    }
  });

  it("prints the gated wire label", () => {
    for (const step of steps) {
      const stop = tuesday.stops.find((s) => s.n === step.n)!;
      const allowed = !stop.wireLabelFallback
        ? stop.wireLabel
        : stop.truthGate.shipped
          ? stop.wireLabel
          : stop.wireLabelFallback;
      expect(step.wire).toBe(allowed);
    }
  });

  it("lights only nodes on the map", () => {
    for (const step of steps) {
      expect(step.nodes.length).toBeGreaterThan(0);
      for (const id of step.nodes) expect(IDS).toContain(id);
    }
  });

  it("lights only edges whose two ends it has lit", () => {
    for (const step of steps) {
      for (const key of step.edges) {
        const edge = CONNECT_EDGES.find((e) => edgeKey(e) === key)!;
        expect(edge).toBeDefined();
        expect(step.nodes).toContain(edge.a);
        expect(step.nodes).toContain(edge.b);
      }
      expect(step.edges).toEqual(edgesForStop(step.n));
    }
  });

  it("knows each stop's clock", () => {
    for (const step of steps) expect(tourStepClock(step.n)).toBe(step.clock);
    expect(tourStepClock(99)).toBe("");
  });
});

describe("the surfaces behind the map", () => {
  it("are deduplicated, and every one is a real surface key", () => {
    const keys = mapSurfaceKeys();
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(CONNECT_NODES.some((n) => n.surface === key)).toBe(true);
    }
  });

  it("stay a handful, because each one is a whole product frame in the HTML", () => {
    expect(mapSurfaceKeys().length).toBeLessThanOrEqual(8);
  });

  it("a node with no surface still says where it lives", () => {
    for (const node of CONNECT_NODES) {
      if (node.surface !== null) continue;
      expect(node.surfaceName.length).toBeGreaterThan(5);
    }
  });
});

describe("every stop can show a picture", () => {
  it("lights at least one record that has a surface", () => {
    // The tour reveals the first lit node with a surface, so a stop that
    // lights only surfaceless records would step to a blank frame.
    for (const step of tourSteps()) {
      const withSurface = step.nodes.filter((id) => connectNode(id)?.surface);
      expect(withSurface.length, `stop ${step.n} lights nothing with a surface`).toBeGreaterThan(0);
    }
  });
});
