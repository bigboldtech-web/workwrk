// The review routes and the manager-review writer rule (docs-found fixes
// batch 4). A review's reviewer is stamped at launch; for someone listed
// under an Agent before rule 6, the stamp names the Agent. Batch 3 read the
// writer through reviewerFacts in the cycle GET, the manager review GET
// ?subjectId= and PATCH only. Every other route still keyed on the stamp:
//   GET manager-review with no subjectId     listed the Agent's stamped reviews
//   GET peer-feedback?reviewId=, GET peers   let the Agent read peer answers
//   POST reminders                           told the Agent "You owe 1 manager
//                                            review" and never the manager who
//                                            writes it, and let the Agent send
//                                            reminders through the stamp
// And PATCH let a person with no manager write their own manager review when
// the stamp named them. Now each reads the writer (review-cycle.server.ts
// writerFrom): never an Agent, never the subject, the manager above an Agent.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; status: string; deletedAt: Date | null; firstName: string; lastName: string };
type R = { id: string; cycleId: string; subjectId: string; reviewerId: string; status: string };
const st = vi.hoisted(() => ({
  users: new Map<string, unknown>(),
  reviews: [] as unknown[],
  caller: { id: "admin", admin: true, agent: false, chain: [] as string[] },
  notified: [] as Array<{ userId: string; type: string; title: string }>,
  updated: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: st.caller.id, organizationId: "org" } }) }));
vi.mock("@/lib/access/viewer", () => ({
  viewerFromSession: async () => ({
    userId: st.caller.id, organizationId: "org", orgRole: st.caller.admin ? "ADMIN" : "MEMBER",
    isAgent: st.caller.agent, peopleTeam: false, adminScopes: [],
  }),
}));
vi.mock("@/lib/reporting-line", () => ({
  getEffectiveReportTree: async (id: string) => [id, ...st.caller.chain],
  isInReportTree: async (_m: string, c: string) => st.caller.chain.includes(c),
}));

vi.mock("@/lib/prisma", () => {
  const users = () => [...st.users.values()] as U[];
  type W = Record<string, unknown>;
  const val = (v: unknown, x: unknown): boolean => {
    if (v === undefined) return true;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as { in?: unknown[]; not?: unknown };
      if (o.in) return o.in.includes(x);
      if ("not" in o) return x !== o.not;
      return true; // a relation filter (cycle, subject): the mock's rows all pass
    }
    return v === null ? x == null : v === x;
  };
  const userOk = (u: U, w: W) =>
    val(w.id, u.id) && val(w.organizationId, u.organizationId) && val(w.managerId, u.managerId) && (!("deletedAt" in w) || !u.deletedAt);
  const reviewOk = (r: R, w: W): boolean => {
    if (Array.isArray(w.AND) && !(w.AND as W[]).every((x) => reviewOk(r, x))) return false;
    if (Array.isArray(w.OR) && !(w.OR as W[]).some((x) => reviewOk(r, x))) return false;
    return val(w.id, r.id) && val(w.cycleId, r.cycleId) && val(w.subjectId, r.subjectId) && val(w.reviewerId, r.reviewerId) && val(w.status, r.status);
  };
  const shaped = (r: R) => ({
    ...r,
    cycle: { id: r.cycleId, name: "Q3", status: "ACTIVE", startDate: new Date("2026-07-01"), endDate: new Date("2026-10-30") },
    subject: { id: r.subjectId, firstName: r.subjectId, lastName: "", email: `${r.subjectId}@x`, managerId: (st.users.get(r.subjectId) as U | undefined)?.managerId ?? null, departmentId: null, officeId: null, department: null, role: null },
    reviewer: { id: r.reviewerId, firstName: r.reviewerId, lastName: "" },
    peerFeedback: [],
    managerAssessment: null,
  });
  return {
    prisma: {
      user: {
        findMany: async (a: { where: W }) => users().filter((u) => userOk(u, a.where)),
        findFirst: async (a: { where: W }) => users().find((u) => userOk(u, a.where)) ?? null,
        findUnique: async (a: { where: { id: string } }) => st.users.get(a.where.id) ?? null,
        count: async () => 0,
      },
      organizationMembership: { findMany: async () => [], findUnique: async () => null },
      organization: { findUnique: async () => ({ settings: {} }) },
      reviewCycle: { findFirst: async () => ({ id: "c1", name: "Q3", status: "ACTIVE", createdById: "admin", organizationId: "org", endDate: new Date("2026-10-30") }) },
      review: {
        findMany: async (a: { where: W }) => (st.reviews as R[]).filter((r) => reviewOk(r, a.where)).map(shaped),
        findFirst: async (a: { where: W }) => {
          const r = (st.reviews as R[]).find((x) => reviewOk(x, a.where));
          return r ? shaped(r) : null;
        },
        update: async (a: unknown) => { st.updated.push(a); return {}; },
      },
      peerFeedback: { findMany: async () => [{ id: "pf1", giverId: "gus", anonymous: false, strengths: "Kind", giver: { id: "gus", firstName: "Gus", lastName: "" } }] },
      notification: {
        findMany: async () => [],
        createMany: async (a: { data: Array<{ userId: string; type: string; title: string }> }) => { st.notified.push(...a.data); return { count: a.data.length }; },
        create: async () => ({}),
      },
      kRAAssignment: { findMany: async () => [] },
      kPIRecord: { findMany: async () => [] },
      sOPCompliance: { findMany: async () => [] },
      oKR: { findMany: async () => [] },
    },
  };
});

import { POST as remind } from "./reminders/route";
import { GET as managerReviews, PATCH as writeManagerReview } from "./manager-review/route";
import { GET as peerFeedback } from "./peer-feedback/route";
import { GET as peers } from "./peers/route";

const add = (id: string, managerId: string | null, level = "EMPLOYEE") =>
  st.users.set(id, { id, organizationId: "org", managerId, ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null, firstName: id, lastName: "" });
const as = (id: string, opts: { admin?: boolean; agent?: boolean; chain?: string[] } = {}) => {
  st.caller = { id, admin: !!opts.admin, agent: !!opts.agent, chain: opts.chain ?? [] };
};
const params = { params: Promise.resolve({ id: "c1" }) };
const req = (url: string, init?: RequestInit) => new Request(`http://x${url}`, init) as never;

beforeEach(() => {
  st.users.clear();
  st.notified = [];
  st.updated = [];
  // mona > sam (Agent, made before rule 6) > ida; rex (Agent, nobody above) > tia; solo has no manager.
  add("admin", null, "COMPANY_ADMIN");
  add("mona", null, "MANAGER");
  add("sam", "mona", "AGENT");
  add("ida", "sam");
  add("rex", null, "AGENT");
  add("tia", "rex");
  add("solo", null);
  st.reviews = [
    { id: "r-ida", cycleId: "c1", subjectId: "ida", reviewerId: "sam", status: "PENDING" },
    { id: "r-tia", cycleId: "c1", subjectId: "tia", reviewerId: "rex", status: "SELF_ASSESSMENT" },
    { id: "r-solo", cycleId: "c1", subjectId: "solo", reviewerId: "solo", status: "PENDING" },
  ];
});

describe("POST reminders keys each manager review by who writes it", () => {
  it("tells the manager above the Agent, and never the Agent or anyone for a review nobody writes yet", async () => {
    as("admin", { admin: true });
    const res = await remind(req("/api/reviews/c1/reminders", { method: "POST", body: "{}" }), params);
    expect(res.status).toBe(200);
    const owed = st.notified.filter((n) => n.type === "manager_reviews_due");
    expect(owed.map((n) => n.userId)).toEqual(["mona"]);
    expect(owed[0].title).toBe("You owe 1 manager review for Q3");
  });

  it("gives an Agent no reach through the stamp", async () => {
    as("sam", { agent: true });
    const res = await remind(req("/api/reviews/c1/reminders", { method: "POST", body: "{}" }), params);
    expect(res.status).toBe(404);
    expect(st.notified).toEqual([]);
  });
});

describe("GET manager-review with no subjectId lists the reviews the caller writes", () => {
  it("lists nothing for the Agent the reviews were stamped to", async () => {
    as("sam", { agent: true });
    const body = (await (await managerReviews(req("/api/reviews/c1/manager-review"), params)).json()) as Array<{ id: string }>;
    expect(body).toEqual([]);
  });

  it("lists, for the manager above the Agent, the reviews of the people listed under them", async () => {
    as("mona", { chain: ["sam", "ida"] });
    const body = (await (await managerReviews(req("/api/reviews/c1/manager-review"), params)).json()) as Array<{ id: string }>;
    expect(body.map((r) => r.id)).toEqual(["r-ida"]);
  });
});

describe("GET manager-review ?subjectId= names who writes it", () => {
  it("the manager above the Agent, never the Agent the review was stamped to", async () => {
    as("admin", { admin: true });
    const body = (await (await managerReviews(req("/api/reviews/c1/manager-review?subjectId=ida"), params)).json()) as { review: { reviewerId: string | null; reviewer: { id: string } | null } };
    expect(body.review.reviewerId).toBe("mona");
    expect(body.review.reviewer?.id).toBe("mona");
  });

  it("nobody while nobody writes it", async () => {
    as("admin", { admin: true });
    const body = (await (await managerReviews(req("/api/reviews/c1/manager-review?subjectId=tia"), params)).json()) as { review: { reviewerId: string | null; reviewer: unknown } };
    expect(body.review.reviewerId).toBeNull();
    expect(body.review.reviewer).toBeNull();
  });
});

describe("PATCH manager-review", () => {
  const write = (reviewId: string) =>
    writeManagerReview(
      req("/api/reviews/c1/manager-review", { method: "PATCH", body: JSON.stringify({ reviewId, managerAssessment: { overallComments: "Great" }, managerComments: "Great" }) }),
      params,
    );

  it("never lets a person write their own manager review through a stamp a loop past an Agent put there", async () => {
    // pia > axe (Agent) > pia, stored before rule 6: the old launch read pia
    // as her own manager and stamped her as her own reviewer.
    add("axe", "pia", "AGENT");
    add("pia", "axe");
    st.reviews.push({ id: "r-pia", cycleId: "c1", subjectId: "pia", reviewerId: "pia", status: "PENDING" });
    as("pia");
    expect((await write("r-pia")).status).toBe(404);
    expect(st.updated).toEqual([]);
  });

  it("still lets someone with no manager at all write their own, the launch rule for them", async () => {
    as("solo");
    expect((await write("r-solo")).status).toBe(200);
  });

  // Docs-found fixes batch 5: with nobody writing it (tia is listed under rex,
  // an Agent with nobody above), the PATCH refused everyone, Admins included,
  // though the drawer said the People team and Admins write it.
  it("lets an Admin write a review nobody writes, leaving the stamp, and still refuses a manager in the chain", async () => {
    as("admin", { admin: true });
    // Before: 404 "Review not found or you are not the reviewer".
    expect((await write("r-tia")).status).toBe(200);
    const data = (st.updated[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("reviewerId");
    expect(data).toMatchObject({ managerComments: "Great" });
    st.updated = [];
    as("mona", { chain: ["tia"] });
    expect((await write("r-tia")).status).toBe(404);
    expect(st.updated).toEqual([]);
  });

  it("never lets the subject write their own unclaimed review, Admin or not", async () => {
    add("ada", "rex", "COMPANY_ADMIN");
    st.reviews.push({ id: "r-ada", cycleId: "c1", subjectId: "ada", reviewerId: "rex", status: "PENDING" });
    as("ada", { admin: true });
    expect((await write("r-ada")).status).toBe(404);
  });

  it("the drawer is told an Admin writes it, and why", async () => {
    as("admin", { admin: true });
    const body = (await (await managerReviews(req("/api/reviews/c1/manager-review?subjectId=tia"), params)).json()) as { canWrite: boolean; writesUnclaimed: boolean };
    // Before: canWrite false for everyone.
    expect(body).toMatchObject({ canWrite: true, writesUnclaimed: true });
    as("mona", { chain: ["tia"] });
    const chain = (await (await managerReviews(req("/api/reviews/c1/manager-review?subjectId=tia"), params)).json()) as { canWrite: boolean; writesUnclaimed: boolean };
    expect(chain).toMatchObject({ canWrite: false, writesUnclaimed: false });
  });
});

describe("peer feedback and the peers picker", () => {
  it("never open to the Agent a review was stamped to", async () => {
    as("sam", { agent: true });
    expect((await peerFeedback(req("/api/reviews/c1/peer-feedback?reviewId=r-ida"), params)).status).toBe(404);
    expect((await peers(req("/api/reviews/c1/peers?subjectId=ida"), params)).status).toBe(404);
  });

  it("open to the manager above them, through the chain", async () => {
    as("mona", { chain: ["sam", "ida"] });
    const res = await peerFeedback(req("/api/reviews/c1/peer-feedback?reviewId=r-ida"), params);
    expect(res.status).toBe(200);
  });
});
