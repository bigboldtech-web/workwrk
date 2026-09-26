// The bulk move pickers (Tables, Canvases, Docs) offer exactly the places
// every selected node's own move accepts (the placement rule's P5): the
// intersection of each one's GET /api/move/destinations.

import { describe, expect, it } from "vitest";
import { intersectDestinations, type DestinationReply } from "./bulk-destinations";

const space = (id: string, pickable: boolean) => ({ id, name: id, icon: null, color: null, pickable });

describe("intersectDestinations", () => {
  it("keeps only the Spaces every node may go to, and the org root only when every node may", () => {
    const a: DestinationReply = { root: { pickable: true }, spaces: [space("S1", true), space("S2", true), space("S3", false)] };
    const b: DestinationReply = { root: { pickable: false }, spaces: [space("S2", true), space("S1", false), space("S3", true)] };
    expect(intersectDestinations([a, b])).toEqual({ root: false, spaces: [{ id: "S2", name: "S2", icon: null, color: null }] });
    expect(intersectDestinations([a])).toEqual({
      root: true,
      spaces: [{ id: "S1", name: "S1", icon: null, color: null }, { id: "S2", name: "S2", icon: null, color: null }],
    });
  });

  it("a Space listed only as a header (not pickable) is never offered", () => {
    expect(intersectDestinations([{ root: null, spaces: [space("S1", false)] }]).spaces).toEqual([]);
  });

  it("a node whose places could not be read offers nothing for the whole selection, so no pick is refused for part of it", () => {
    expect(intersectDestinations([{ root: { pickable: true }, spaces: [space("S1", true)] }, null])).toEqual({ root: false, spaces: [] });
    expect(intersectDestinations([])).toEqual({ root: false, spaces: [] });
  });
});
