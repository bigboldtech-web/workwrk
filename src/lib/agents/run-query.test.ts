import { describe, expect, it } from "vitest";
import { agentRunsOrder, agentRunsWhere, parseRunQuery } from "./run-query";

const p = (qs: string) => new URLSearchParams(qs);
const admin = { organizationId: "org1", userId: "u1", admin: true };
const member = { organizationId: "org1", userId: "u2", admin: false };

describe("parseRunQuery", () => {
  it("reads every filter", () => {
    const q = parseRunQuery(p("agentSlug=priya-hr&status=failed,running&trigger=scheduled&from=2026-09-01&to=2026-09-24&sort=oldest&take=25&cursor=abc123"));
    expect(q.agentSlug).toBe("priya-hr");
    expect(q.statuses).toEqual(["failed", "running"]);
    expect(q.trigger).toBe("SCHEDULED");
    expect(q.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(q.to?.toISOString()).toBe("2026-09-24T23:59:59.999Z");
    expect(q.sort).toBe("oldest");
    expect(q.take).toBe(25);
    expect(q.cursor).toBe("abc123");
  });
  it("keeps the old ?agent= and ?limit= names", () => {
    const q = parseRunQuery(p("agent=priya-hr&limit=6"));
    expect(q.agentSlug).toBe("priya-hr");
    expect(q.take).toBe(6);
  });
  it("drops unknown values and clamps the page size", () => {
    const q = parseRunQuery(p("status=bogus&trigger=CHAT&from=yesterday&take=5000&cursor=a%20b&agentSlug=%3Cx%3E"));
    expect(q.statuses).toEqual([]);
    expect(q.trigger).toBeNull();
    expect(q.from).toBeNull();
    expect(q.take).toBe(100);
    expect(q.cursor).toBeNull();
    expect(q.agentSlug).toBeNull();
  });
  it("defaults to 50 newest first", () => {
    const q = parseRunQuery(p(""));
    expect(q.take).toBe(50);
    expect(q.sort).toBe("newest");
  });
});

describe("agentRunsWhere", () => {
  it("scopes every query to the org", () => {
    const w = agentRunsWhere(parseRunQuery(p("")), admin);
    expect(w.AND).toContainEqual({ agent: { organizationId: "org1" } });
  });
  it("never gives an Admin another person's chat rows", () => {
    const w = agentRunsWhere(parseRunQuery(p("")), admin);
    expect(w.AND).toContainEqual({
      OR: [
        { input: { path: ["trigger"], equals: "SCHEDULED" } },
        { input: { path: ["trigger"], equals: "MANUAL" } },
        { triggeredBy: "u1" },
      ],
    });
  });
  it("gives a Member the autonomous runs and their own, with positive matches only", () => {
    const w = agentRunsWhere(parseRunQuery(p("")), member);
    expect(w.AND).toContainEqual({
      OR: [
        { input: { path: ["trigger"], equals: "SCHEDULED" } },
        { input: { path: ["trigger"], equals: "MANUAL" } },
        { triggeredBy: "u2" },
      ],
    });
    expect(JSON.stringify(w)).not.toContain("\"not\"");
  });
  it("maps the status words to the stored values", () => {
    const w = agentRunsWhere(parseRunQuery(p("status=succeeded,running")), admin);
    expect(w.AND).toContainEqual({ status: { in: ["SUCCEEDED", "SUCCESS", "COMPLETED", "PENDING", "RUNNING"] } });
  });
  it("filters by agent, trigger and date range", () => {
    const w = agentRunsWhere(parseRunQuery(p("agentSlug=priya-hr&trigger=MANUAL&from=2026-09-01")), admin);
    expect(w.AND).toContainEqual({ agent: { organizationId: "org1", slug: "priya-hr" } });
    expect(w.AND).toContainEqual({ input: { path: ["trigger"], equals: "MANUAL" } });
    expect(w.AND).toContainEqual({ startedAt: { gte: new Date("2026-09-01T00:00:00.000Z") } });
  });
});

describe("agentRunsOrder", () => {
  it("orders by start then id, so the cursor is stable", () => {
    expect(agentRunsOrder("newest")).toEqual([{ startedAt: "desc" }, { id: "desc" }]);
    expect(agentRunsOrder("oldest")).toEqual([{ startedAt: "asc" }, { id: "asc" }]);
  });
});
