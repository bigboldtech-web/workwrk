import { describe, expect, it } from "vitest";
import { accessMessage, canRequestAccess } from "./access-message";

// The payloads below are copied verbatim from live responses on :3007, so this
// is a transcription test: if a route's `reason` is renamed and this table is
// not, the test still passes but the user sees the fallback sentence — never
// the code itself, which is the property that matters.
describe("accessMessage", () => {
  it("never shows a machine code to the user", () => {
    const payloads = [
      { error: "no_access", reason: "role_too_low", role: "EDIT", requestAccess: true },
      { error: "no_access", reason: "moderation_needs_full_access" },
      { error: "no_access", reason: "not_comment_author" },
      { error: "no_access", reason: "list_read_only", requestAccess: true },
      { error: "no_access", reason: "source_list_read_only", requestAccess: true },
      { error: "no_access", reason: "target_list_read_only", requestAccess: true },
      { error: "no_access", reason: "personal_list_not_a_move_target", requestAccess: false },
      { error: "no_access", reason: "a_reason_invented_next_year" },
      { error: "no_access" },
      { error: "Forbidden" },
      { error: "Not found" },
      {},
      null,
    ];
    for (const p of payloads) {
      const out = accessMessage(p, "Couldn't do that.");
      expect(out, JSON.stringify(p)).not.toMatch(/^[a-z0-9_]+$/);
      expect(out).not.toContain("no_access");
      expect(out.endsWith(".")).toBe(true);
    }
  });

  it("uses the call site's override before the shared wording", () => {
    const body = { error: "no_access", reason: "role_too_low", role: "EDIT" };
    expect(accessMessage(body, "fallback")).toBe("You don't have permission to do that on this task.");
    expect(
      accessMessage(body, "fallback", { role_too_low: "Only the creator can delete it." }),
    ).toBe("Only the creator can delete it.");
  });

  it("keeps a sentence a route threw rather than replacing it", () => {
    expect(accessMessage({ error: "Status is not on this list" }, "fallback")).toBe(
      "Status is not on this list",
    );
  });

  it("falls back when the body carries nothing usable", () => {
    expect(accessMessage({ issues: [] }, "Couldn't save.")).toBe("Couldn't save.");
    expect(accessMessage("not json at all", "Couldn't save.")).toBe("Couldn't save.");
  });

  it("reports whether a door exists", () => {
    expect(canRequestAccess({ requestAccess: true })).toBe(true);
    expect(canRequestAccess({ requestAccess: false })).toBe(false);
    expect(canRequestAccess(null)).toBe(false);
  });
});
