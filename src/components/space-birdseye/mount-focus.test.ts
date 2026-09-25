// Browser Back to a Bird's eye entry reached in the app remounts the page
// with the tree the router last rendered, so the focus prop can disagree
// with the URL. The focus it opens with must follow the URL.

import { describe, expect, it } from "vitest";
import { mountFocusId } from "./space-birdseye";

const base = "/spaces/design-team";

describe("mountFocusId", () => {
  it("follows a URL focus the server tree did not render (Back to a focus pushed from the overview)", () => {
    expect(mountFocusId(base, base, "list-a", null)).toBe("list-a");
  });

  it("follows the URL's List over the tree's (Back to a List switched with a chip)", () => {
    expect(mountFocusId(base, base, "list-ideas", "list-dashboard")).toBe("list-ideas");
  });

  it("shows the overview when this Space's own URL has no focus, whatever the tree says", () => {
    expect(mountFocusId(base, base, null, "list-a")).toBeNull();
    expect(mountFocusId(base, base, null, null)).toBeNull();
  });

  it("keeps the prop under the task drawer, where the URL is the drawer's", () => {
    expect(mountFocusId("/item/abc", base, null, "list-a")).toBe("list-a");
    expect(mountFocusId("/item/abc", base, "other", null)).toBeNull();
    expect(mountFocusId(null, base, "other", "list-a")).toBe("list-a");
  });

  it("agrees with the prop on a cold load, where both come from the same URL", () => {
    expect(mountFocusId(base, base, "list-a", "list-a")).toBe("list-a");
  });
});
