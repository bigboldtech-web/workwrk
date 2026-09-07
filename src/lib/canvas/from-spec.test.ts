import { describe, expect, it } from "vitest";
import { specToScene } from "./from-spec";
import type { PathElement, ShapeElement } from "./scene";

describe("specToScene", () => {
  it("maps kinds to shapes, layers left-to-right, and binds edges", () => {
    const scene = specToScene({
      title: "URL Shortener",
      nodes: [
        { id: "client", label: "Client", kind: "actor" },
        { id: "api", label: "API", kind: "service" },
        { id: "db", label: "Postgres", kind: "database" },
      ],
      edges: [
        { from: "client", to: "api", label: "GET" },
        { from: "api", to: "db", label: "read" },
      ],
    });
    const shapes = scene.elements.filter((e) => e.type !== "arrow" && e.type !== "frame") as ShapeElement[];
    const arrows = scene.elements.filter((e) => e.type === "arrow") as PathElement[];
    expect(shapes).toHaveLength(3);
    expect(arrows).toHaveLength(2);
    // database → cylinder, actor → ellipse
    expect(shapes.find((s) => s.text === "Postgres")?.type).toBe("cylinder");
    expect(shapes.find((s) => s.text === "Client")?.type).toBe("ellipse");
    // layered: client (layer 0) is left of api (layer 1) is left of db (layer 2)
    const x = (label: string) => shapes.find((s) => s.text === label)!.x;
    expect(x("Client")).toBeLessThan(x("API"));
    expect(x("API")).toBeLessThan(x("Postgres"));
    // edges are bound connectors with labels
    expect(arrows.every((a) => a.fromId && a.toId)).toBe(true);
    expect(arrows.map((a) => a.text).sort()).toEqual(["GET", "read"]);
  });

  it("wraps grouped nodes in a frame and tolerates a cycle", () => {
    const scene = specToScene({
      nodes: [
        { id: "a", label: "A", group: "svc" },
        { id: "b", label: "B", group: "svc" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }], // cycle: must not hang
      groups: [{ id: "svc", label: "Services" }],
    });
    const frame = scene.elements.find((e) => e.type === "frame");
    expect(frame).toBeTruthy();
    expect((frame as { title?: string }).title).toBe("Services");
  });

  it("returns an empty scene for no nodes", () => {
    expect(specToScene({ nodes: [] }).elements).toHaveLength(0);
  });
});
