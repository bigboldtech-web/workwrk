import { describe, expect, it } from "vitest";
import { draftBodyToRestore } from "./draft-restore";

// A draft restore never writes an empty body over a doc unless the draft is an
// emptied block doc; an old-format doc's saves left drafts with no body.
describe("draftBodyToRestore", () => {
  const blocks = [{ id: "a", kind: "paragraph", text: "kept" }];

  it("restores a draft that holds blocks, old format shown or not", () => {
    expect(draftBodyToRestore({ blocks, bnDoc: null }, true)).toBe(blocks);
    expect(draftBodyToRestore({ blocks, bnDoc: [{}] }, false)).toBe(blocks);
  });

  it("restores the title only for an old-format save's empty draft, even after the doc was converted", () => {
    // Still old format on screen.
    expect(draftBodyToRestore({ blocks: [], bnDoc: null }, true)).toBeNull();
    // Converted since (the old format is no longer shown): still title only.
    expect(draftBodyToRestore({ blocks: [], bnDoc: null }, false)).toBeNull();
    // A draft written by a title-only save.
    expect(draftBodyToRestore({ blocks: null, bnDoc: null }, false)).toBeNull();
  });

  it("restores a block doc someone emptied on purpose", () => {
    expect(draftBodyToRestore({ blocks: [], bnDoc: [] }, false)).toEqual([]);
  });
});
