// For tests only (review round 1 of Phase 4): a workspace's activity rows,
// one of every kind personal-activity.ts sorts, and a matcher that answers
// which of them a Prisma where clause finds, so the route tests read as
// "who would see this row" rather than as snapshots of a query's shape.
// The matcher knows exactly the operators the activity routes use and throws
// on any other, so a new operator fails loudly instead of matching.

export interface Row {
  id: string;
  organizationId: string;
  type: string;
  description: string;
  actorId: string | null;
  actingForId: string | null;
  actorType: string | null;
  actorLabel: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  severity: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
}

const AT = Date.parse("2026-10-11T09:00:00Z");

function row(n: number, o: Partial<Row> & Pick<Row, "id" | "type" | "description">): Row {
  return {
    organizationId: "org",
    actorId: null,
    actingForId: null,
    actorType: null,
    actorLabel: null,
    targetType: null,
    targetId: null,
    metadata: null,
    ipAddress: "10.1.2.3",
    userAgent: "Mozilla/5.0 (secret agent)",
    severity: "info",
    oldValue: null,
    newValue: null,
    createdAt: new Date(AT - n * 60_000),
    ...o,
  };
}

/**
 * The people: Max and Ann report to Mia; Pia is on the People team; Ada is
 * an Admin. Max's teammate clicked, mailed, and he took over; his browser
 * ended by itself and once when Mia removed him; Ada disconnected his Google.
 */
export const ROWS: Row[] = [
  row(1, { id: "task-max", type: "task.created", description: 'Created task "Call Acme"', actorId: "max", targetType: "task", targetId: "t1", metadata: { title: "Call Acme", internal: "kept out" } }),
  row(2, {
    id: "click-max",
    type: "agent.click",
    description: "Chief of Staff (for Max Smith): Clicked on bank.example.com",
    actorId: "max",
    actingForId: "max",
    actorType: "agent",
    metadata: { agentId: "a1", browser: { site: "bank.example.com", kind: "click" } },
    severity: "warning",
  }),
  row(3, { id: "takeover-max", type: "teammate_browser.take_over", description: "Took over the browser on clinic.example.org", actorId: "max", targetType: "agent", targetId: "a1", metadata: { site: "clinic.example.org", phase: "start" } }),
  row(4, {
    id: "ended-max",
    type: "teammate_browser.session_ended",
    description: "Chief of Staff (for Max Smith): Closed a browser after 4 minutes",
    actorId: null,
    actingForId: "max",
    actorType: "system",
    actorLabel: "WorkwrK",
    targetType: "agent",
    targetId: "a1",
    metadata: { reason: "idle", minutes: 4, sites: [{ site: "bank.example.com", reads: 3, acts: 1 }, { site: "clinic.example.org", reads: 2, acts: 0 }] },
  }),
  row(5, {
    id: "ended-max-by-mia",
    type: "teammate_browser.session_ended",
    description: "Chief of Staff (for Max Smith): Closed a browser after 1 minute",
    actorId: "mia",
    actingForId: "max",
    targetType: "agent",
    targetId: "a1",
    metadata: { reason: "left", minutes: 1, sites: [{ site: "jobs.competitor.example", reads: 1, acts: 0 }] },
  }),
  row(6, { id: "mail-max", type: "agent.send_email", description: "Chief of Staff (for Max Smith): Sent email", actorId: "max", actingForId: "max", actorType: "agent", metadata: { connector: { provider: "google", googleId: "g-123", recipients: 2 } } }),
  row(7, { id: "google-off-max", type: "teammate_connection.disconnected", description: "Disconnected Google", actorId: "ada", targetType: "user", targetId: "max", metadata: { provider: "google", reason: "admin" } }),
  row(8, { id: "google-on-max", type: "teammate_connection.connected", description: "Connected Google", actorId: "max", targetType: "user", targetId: "max", metadata: { provider: "google" } }),
  row(9, { id: "switch-ada", type: "teammate_browser.changed", description: "Turned on the computer for AI teammates", actorId: "ada", metadata: { enabled: true } }),
  row(10, { id: "click-ann", type: "agent.click", description: "Shopper (for Ann Lee): Clicked on shop.example.com", actorId: "ann", actingForId: "ann", actorType: "agent", metadata: { browser: { site: "shop.example.com" } } }),
  row(11, { id: "task-mia", type: "task.created", description: 'Created task "Plan"', actorId: "mia", targetType: "task", targetId: "t2", metadata: { title: "Plan" } }),
  row(12, { id: "other-org", type: "task.created", description: "Elsewhere", actorId: "max", organizationId: "org-2" }),
];

export const PERSONAL_ROW_IDS = ["click-max", "takeover-max", "ended-max", "ended-max-by-mia", "mail-max", "google-off-max", "google-on-max", "click-ann"];

type Where = Record<string, unknown>;

function cmp(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) return value === cond || (value instanceof Date && cond instanceof Date && value.getTime() === cond.getTime());
  const c = cond as Record<string, unknown>;
  return Object.entries(c).every(([op, arg]) => {
    switch (op) {
      case "in":
        return (arg as unknown[]).includes(value);
      case "notIn":
        // Prisma's notIn, like SQL's NOT IN, never matches a null column.
        return value !== null && !(arg as unknown[]).includes(value);
      case "gte":
        return value instanceof Date && value.getTime() >= (arg as Date).getTime();
      case "lte":
        return value instanceof Date && value.getTime() <= (arg as Date).getTime();
      case "contains":
        return typeof value === "string" && (c.mode === "insensitive" ? value.toLowerCase().includes(String(arg).toLowerCase()) : value.includes(String(arg)));
      case "mode":
        return true;
      default:
        throw new Error(`the matcher does not know ${op}`);
    }
  });
}

/** Whether a row matches a Prisma ActivityLog where clause. */
export function matches(r: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "AND") return (Array.isArray(cond) ? cond : [cond]).every((w) => matches(r, w as Where));
    if (key === "OR") return (cond as Where[]).some((w) => matches(r, w));
    if (key === "NOT") return !(Array.isArray(cond) ? cond : [cond]).some((w) => matches(r, w as Where));
    if (!(key in r)) throw new Error(`the matcher does not know the column ${key}`);
    return cmp((r as unknown as Record<string, unknown>)[key], cond);
  });
}

const PEOPLE: Record<string, { id: string; firstName: string; lastName: string; avatar: null; email: string }> = {
  max: { id: "max", firstName: "Max", lastName: "Smith", avatar: null, email: "max@acme.test" },
  mia: { id: "mia", firstName: "Mia", lastName: "Stone", avatar: null, email: "mia@acme.test" },
  ada: { id: "ada", firstName: "Ada", lastName: "Admin", avatar: null, email: "ada@acme.test" },
  ann: { id: "ann", firstName: "Ann", lastName: "Lee", avatar: null, email: "ann@acme.test" },
  pia: { id: "pia", firstName: "Pia", lastName: "People", avatar: null, email: "pia@acme.test" },
};

/** A row as Prisma's select or include gives it: the selected columns, the actor's selected fields. */
export function project(r: Row, args: { select?: Record<string, unknown>; include?: Record<string, unknown> }): Record<string, unknown> {
  const actorOf = (spec: unknown) => {
    const p = r.actorId ? PEOPLE[r.actorId] : null;
    if (!p) return null;
    const fields = (spec as { select?: Record<string, boolean> })?.select;
    if (!fields) return { ...p };
    return Object.fromEntries(Object.keys(fields).filter((k) => fields[k]).map((k) => [k, (p as Record<string, unknown>)[k]]));
  };
  if (args.select) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args.select)) {
      if (!v) continue;
      out[k] = k === "actor" ? actorOf(v) : (r as unknown as Record<string, unknown>)[k];
    }
    return out;
  }
  return { ...r, ...(args.include?.actor ? { actor: actorOf(args.include.actor) } : {}) };
}

/** A mocked prisma.activityLog.findMany over ROWS: where, orderBy createdAt desc, skip and take. */
export function findRows(args: { where?: Where; select?: Record<string, unknown>; include?: Record<string, unknown>; skip?: number; take?: number }): Array<Record<string, unknown>> {
  const found = ROWS.filter((r) => matches(r, args.where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const from = args.skip ?? 0;
  return found.slice(from, args.take === undefined ? undefined : from + args.take).map((r) => project(r, args));
}
