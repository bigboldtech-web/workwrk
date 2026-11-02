// What the Deactivate and Remove dialogs say about the rest of a person's
// access (docs/plans/workspace-status.md D15, D17, step 3). Before step 3
// they said "Removing them here ends their access there too, for now", true
// while status was one per account and untrue now; and nothing said their API
// keys would stop working.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { leavingNotes } from "./leaving-notes";

describe("leavingNotes", () => {
  it("says their other workspaces are not affected only when they belong to one", () => {
    expect(leavingNotes({ alsoElsewhere: true })).toEqual({ elsewhere: "Their other workspaces are not affected.", keys: null });
    expect(leavingNotes({ alsoElsewhere: false })).toEqual({ elsewhere: null, keys: null });
    expect(leavingNotes(null)).toEqual({ elsewhere: null, keys: null });
  });

  it("says how many API keys they made will stop working, in plain words", () => {
    expect(leavingNotes({ apiKeys: 1 }).keys).toBe("1 API key they made will stop working.");
    expect(leavingNotes({ apiKeys: 3 }).keys).toBe("3 API keys they made will stop working.");
    expect(leavingNotes({ apiKeys: 0 }).keys).toBeNull();
    for (const n of [0, 1, 2]) {
      const said = Object.values(leavingNotes({ alsoElsewhere: true, apiKeys: n })).join(" ");
      expect(said).not.toMatch(/--|\u2014/);
    }
  });

  it("is what both dialogs say, and neither says their access ends elsewhere any more", () => {
    const ROOT = process.cwd();
    for (const file of ["src/app/(dashboard)/settings/members/members-shared.tsx", "src/components/people/remove-person-dialog.tsx"]) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(src, file).toContain('import { leavingNotes } from "@/lib/people/leaving-notes";');
      expect(src, file).toMatch(/\{leaving\.elsewhere \? <p className="text-sm text-ink-2">\{leaving\.elsewhere\}<\/p> : null\}/);
      expect(src, file).toContain("{leaving.keys}</p>");
      expect(src, file).not.toMatch(/ends their access there too/);
    }
  });
});
