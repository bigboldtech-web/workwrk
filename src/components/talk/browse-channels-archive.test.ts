// Who gets an Archive button in Browse channels -> "All channels".
//
// WHY THIS TEST EXISTS. The tab drew Archive on every row it listed, and the
// one row it exists for was the one row it could not act on: a private channel
// an Owner did not create resolves to "none" on the server (access rule 3, no
// admin read-around), so the click answered "Conversation not found" and
// nothing was archived. This pins the predicate to the server's own ladder in
// src/lib/talk-access.ts, so the button is drawn where it works and the reason
// is shown where it does not.

import { describe, expect, it } from "vitest";
import { archiveRight } from "./browse-channels-dialog";

type Row = Parameters<typeof archiveRight>[0];

const row = (over: Partial<Row> = {}): Row => ({
  name: "sales",
  restricted: false,
  joined: false,
  isOwner: false,
  ...over,
});

describe("archiveRight", () => {
  it("lets an Owner or Admin archive any public channel, joined or not", () => {
    expect(archiveRight(row()).can).toBe(true);
    expect(archiveRight(row({ joined: true })).can).toBe(true);
  });

  it("does NOT offer Archive on a private channel the viewer did not create", () => {
    // The 404 case: an Owner who is not in it at all.
    const away = archiveRight(row({ restricted: true }));
    expect(away.can).toBe(false);
    expect(away.can === false && away.label).toBe("Creator only");
    // The 403 case: an Owner who is in it but did not create it holds "edit".
    expect(archiveRight(row({ restricted: true, joined: true })).can).toBe(false);
    // And the creator who has since left holds nothing either.
    expect(archiveRight(row({ restricted: true, isOwner: true })).can).toBe(false);
  });

  it("offers Archive on a private channel to its creator while they are in it", () => {
    expect(archiveRight(row({ restricted: true, isOwner: true, joined: true })).can).toBe(true);
  });

  it("never offers Archive on #general, which the route refuses for everyone", () => {
    const general = archiveRight(row({ name: "General" }));
    expect(general.can).toBe(false);
    expect(general.can === false && general.label).toBe("Company channel");
    expect(archiveRight(row({ name: " general " })).can).toBe(false);
  });

  it("treats an unnamed row as an ordinary channel rather than as #general", () => {
    expect(archiveRight(row({ name: null })).can).toBe(true);
  });
});
