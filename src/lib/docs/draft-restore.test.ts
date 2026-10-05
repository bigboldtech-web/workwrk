import { describe, expect, it } from "vitest";
import { draftRestorePlan } from "./draft-restore";

// A draft restore never writes an empty body the draft did not mean, and
// never drops the title or page settings a draft holds.
describe("draftRestorePlan", () => {
  const blocks = [{ id: "a", kind: "paragraph", text: "kept" }];

  it("restores a draft that holds blocks, whatever the format now", () => {
    expect(draftRestorePlan({ blocks, bnDoc: null }, true, false)).toBe("body");
    expect(draftRestorePlan({ blocks, bnDoc: [{}] }, false, true)).toBe("body");
  });

  it("restores a block doc someone emptied on purpose", () => {
    expect(draftRestorePlan({ blocks: [], bnDoc: [] }, false, true)).toBe("body");
  });

  it("restores the title and page settings over the live body for a doc nobody has typed in", () => {
    // A new doc's icon or cover save: blocks [] and no BlockNote doc yet.
    expect(draftRestorePlan({ blocks: [], bnDoc: null }, false, true)).toBe("settings-only");
    // A title-only draft from an old-format doc that was converted since.
    expect(draftRestorePlan({ blocks: null, bnDoc: null }, false, true)).toBe("settings-only");
  });

  it("restores the title only while the old format is on screen, or nothing is loaded", () => {
    expect(draftRestorePlan({ blocks: [], bnDoc: null }, true, false)).toBe("title-only");
    expect(draftRestorePlan({ blocks: null, bnDoc: null }, true, false)).toBe("title-only");
    expect(draftRestorePlan({ blocks: [], bnDoc: null }, false, false)).toBe("title-only");
  });
});
