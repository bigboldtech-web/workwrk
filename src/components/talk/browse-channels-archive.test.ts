// Who gets an Archive button in Browse channels -> "All channels".
//
// WHY THIS TEST EXISTS. The tab drew Archive on every row, and on a private
// channel an Owner did not create the click answered "Conversation not found"
// (access rule 3, no admin read-around). The server now answers that one
// write through canAdminArchive() in src/lib/talk-access.ts (spec-talk
// section 1, org.archive_channel, audited, never a read), so the button is
// drawn on every row but #general, and the reason is shown there.

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

  it("offers Archive on a private channel too: the one write an Owner or Admin makes without reading it", () => {
    // spec-talk section 1: Owners and Admins "may Archive it
    // (org.archive_channel, audited), never read it". The server answers a
    // PATCH { archived } alone through canAdminArchive(), whatever their role
    // in the channel: not in it, in it without having created it, or a
    // channel whose creator has left.
    expect(archiveRight(row({ restricted: true })).can).toBe(true);
    expect(archiveRight(row({ restricted: true, joined: true })).can).toBe(true);
    expect(archiveRight(row({ restricted: true, isOwner: true })).can).toBe(true);
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
