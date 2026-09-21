import { describe, expect, it } from "vitest";
import { describeTaskLoadFailure, missingReasonFrom } from "./task-load-failure";

// Every sentence a failed task load can show, pinned. The point of the file
// is that "Couldn't load this task" never comes back as the whole answer.

describe("describeTaskLoadFailure", () => {
  it("never says only 'could not load'", () => {
    for (const status of [0, 400, 401, 410, 429, 500, 502, 503]) {
      const f = describeTaskLoadFailure(status, null);
      expect(f.message.toLowerCase()).not.toMatch(/^couldn't load this task$/);
      expect(f.message.length).toBeGreaterThan(10);
      expect(f.status).toBe(status);
    }
  });

  it("names a lapsed session on 401", () => {
    expect(describeTaskLoadFailure(401, { error: "Unauthorized" }).message).toMatch(/session has expired/i);
  });

  it("carries the status and the server's detail on a 500", () => {
    const f = describeTaskLoadFailure(500, {
      error: "server_error",
      detail: "The column `Item.archivedById` does not exist in the current database.",
      hint: "The database is behind the code: a file in prisma/sql has not been applied to this environment.",
    });
    expect(f.message).toContain("HTTP 500");
    expect(f.detail).toContain("Item.archivedById");
    expect(f.detail).toContain("prisma/sql");
  });

  it("a bare 500 with no body still says where to look", () => {
    const f = describeTaskLoadFailure(500, null);
    expect(f.message).toContain("HTTP 500");
    expect(f.detail).toMatch(/pm2/);
  });

  it("does not repeat the 'server_error' code as if it were a sentence", () => {
    expect(describeTaskLoadFailure(502, { error: "server_error" }).detail).not.toBe("server_error");
  });

  it("keeps a route's own error string when that is all it said", () => {
    expect(describeTaskLoadFailure(400, { error: "Invalid body" }).detail).toBe("Invalid body");
  });

  it("status 0 is the request that never arrived", () => {
    expect(describeTaskLoadFailure(0, null).message).toMatch(/never reached the server/i);
  });
});

describe("missingReasonFrom", () => {
  it("names the legacy task the gate names", () => {
    expect(missingReasonFrom({ error: "Not found", reason: "legacy_task_not_migrated" })).toBe("legacy_task_not_migrated");
  });
  it("is null for a plain 404, an unknown reason, or no body", () => {
    expect(missingReasonFrom({ error: "Not found" })).toBeNull();
    expect(missingReasonFrom({ reason: "something_else" })).toBeNull();
    expect(missingReasonFrom(null)).toBeNull();
  });
});
