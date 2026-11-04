// An in-memory stand-in for the parts of Prisma that sign-in, the session
// check, the switcher and the invitations read and write, for the vitest
// suites of docs/plans/workspace-status.md step 2 (never imported by the
// app). Each model is an array of rows. Unlike oauth-test-db.ts, a relation
// (a User's or a membership's organization, a membership's user, an
// invitation's organization) is resolved from its table by its key on every
// read, so a move between workspaces is seen by the next read, and a filter
// on a relation (usableSeatWhere's workspace status, alreadyInOrg's address)
// really filters. A `where` shape this file does not know throws, so a test
// never passes on a condition the fake ignored.
//
// `where`: equality, null, not (a value or null), in, notIn, equals and
// contains (each with mode "insensitive"), gt/gte/lt/lte, OR, AND, compound
// keys (userId_organizationId), relation filters. A comparison with a NULL
// column is false, as in SQL (`not` and `notIn` included). `select` (nested
// for relations) and `include`. `orderBy` one key or a list, each "asc",
// "desc" or { sort, nulls }, nulls last for asc and first for desc, as
// Postgres. `skip` and `take`. `data` with { increment }. createMany, and a
// groupBy by one column with `_max` (step 3's Members list). A User's list
// relations (KPI records, reviews, kudos, certifications, skills, dotted
// lines, direct reports, KRA assignments) and `_count` of them, each with its
// own `where` (the step 3 review fixes: a read scoped to a workspace is
// really scoped). The User's department, job role and office foreign keys
// are held on every write (P2003), as Postgres holds them. The unique keys Postgres holds are held here
// too (an account's email and workspace, spelled exactly as the index
// compares them; a membership's person and workspace; an invitation's
// token): a write that breaks one throws P2002.
//
// THE TRANSACTION IS ITS OWN CLIENT. $transaction hands its callback a
// different object from `prisma` over the same store (with no $transaction
// of its own, as Prisma's), rolled back on a throw. Every call is logged in
// `log`, reads too, as "<model>.<op>" from `prisma` and "tx.<model>.<op>"
// from a transaction, so a test can prove an order (the person's lock before
// the first read) and that a read inside a transaction went through it, not
// around it. Raw statements: the person's row lock logs "lock:<id>"
// ("tx.lock:<id>" in a transaction), and the row locks of many people in one
// statement (workspace-anchor.ts lockPeople) log "lock:<id>" for each, in the
// order Postgres takes them (the ids sorted COLLATE "C", byte order, as
// JavaScript sorts them); set_config and pg_advisory locks are
// logged; any other $executeRaw throws (not modelled), and so does every
// $queryRaw unless the test answers it (`onQueryRaw`, given the statement as
// Postgres receives it, nested fragments inline, with its values).
//
// Step 4 (the counts): a list relation's `some`, `none` and `every` (a User's
// memberships, a workspace's people and memberships), `NOT`, deleteMany, a
// groupBy by several columns with `_count`, and a kudos' receiver.
//
// The final review (integrity M2): `onCall`, when set, runs after each call
// is logged and before it acts, given its log entry ("tx.lock:<id>",
// "tx.user.findUnique"), so a test can land another transaction's commit at
// a chosen moment (a move committed while this one waited for the person's
// lock, or just after it read them). It may be async for a raw statement;
// for a read or a write it runs synchronously.
//
// The fixes review (L2): `delete` of one row by its unique key, P2025 when
// there is none, as Prisma answers.
//
// docs/plans/workspace-status-2.md step 6 (the pickers): `orderBy` on a
// to-one relation's column (`{ user: { firstName: "asc" } }`), read from the
// related row, as the membership half of a people list sorts by name; a
// conversation's members as a list relation (and a member's conversation, a
// List or Space member's person), a meeting's attendees, and a list relation
// created with its row (`members: { create: [...] }`).
//
// docs/plans/workspace-status-2.md step 1 (the line per workspace): a
// membership's own `managerId` (null by default) and its `manager`, and
// User's own `managerId` (the step 1 review L7), each a key to User held on
// every write (P2003) and SET NULL when that account is
// deleted, as Postgres does; a dotted line's `organizationId`, required on
// every write (NOT NULL, P2011) and a key to Organization, its unique key
// (person, manager, workspace: P2002) and its `organization`; a User's
// `membershipReports` and `dottedLineFromReports`. A delete of an account
// does what Postgres's keys do: its memberships and dotted lines go
// (CASCADE), and every line naming it becomes null (SET NULL); a delete of
// a workspace takes its accounts, memberships and dotted lines with it.
// `updateManyAndReturn`, the rows it wrote, projected by its select.
//
// docs/plans/workspace-status-2.md step 3 (the surfaces): a review's
// `subject`, so a read that selects the subject's line is answered as
// Postgres answers it.
//
// docs/plans/workspace-status-2.md step 5 (a membership person's profile
// edited here): a department's createdAt and updatedAt, filled on a create
// as Postgres and Prisma fill them (a SCIM Group answers both); and, for the
// step 5 review, a department's, an office's and a job title's people (and
// a department's sub-departments, a job title's KRAs) as list relations, so
// the Settings deletes' `_count` is answered as Postgres answers it (in an
// `include` too), and the batch form of $transaction (each call already ran
// in order; no rollback is modelled for it).
//
// docs/plans/workspace-status-2.md step 7 (SCIM's manager attribute): an
// Audit log row's createdAt, filled on a create as Prisma fills it
// (`@default(now())`), so a read of a person's newest row by createdAt is
// answered as Postgres answers it; and a User's updatedAt on a create
// (`@updatedAt`; never on a seed, whose rows say what they hold), so the
// resource SCIM's POST answers carries its stamp.
//
// docs/plans/workspace-status-2.md step 8 (audiences and counts by
// placement): a goal's audience rows (`assignees`), a policy's assignments
// and acknowledgements, a KRA's KPIs, a survey's responses and a
// department's job titles as list
// relations, and an ownership area's owning job title and an SOP
// assignment's SOP and person, so a goal's visibility, a policy's panel,
// the Settings lists, a boundary request and SOP compliance are answered as
// Postgres answers them; and (the step 8 review) a tag assignment's tag, a
// policy's workspace and an assignment's policy, for the tag audiences and
// the policy reminder doors.
//
// docs/plans/workspace-status-2.md, the final review (security M1): a week
// row's and a timesheet's unique keys (person, workspace and week: P2002),
// their defaults, their person, manager and approver, and a timesheet's
// entries as a list relation, so a week is found, made and read per
// workspace as Postgres answers it.

import { Prisma } from "@/generated/prisma";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Relation name to [table, key on this row]. */
const RELATIONS: Record<string, Record<string, [string, string]>> = {
  user: { organization: ["organization", "organizationId"], role: ["role", "roleId"], department: ["department", "departmentId"], office: ["office", "officeId"], manager: ["user", "managerId"] },
  organizationMembership: { organization: ["organization", "organizationId"], user: ["user", "userId"], manager: ["user", "managerId"] },
  invitation: { organization: ["organization", "organizationId"] },
  apiKey: { organization: ["organization", "organizationId"] },
  kRAAssignment: { kra: ["kRA", "kraId"] },
  kPIRecord: { kpi: ["kPI", "kpiId"], user: ["user", "userId"] },
  review: { cycle: ["reviewCycle", "cycleId"], subject: ["user", "subjectId"] },
  userDottedLine: { manager: ["user", "managerId"], user: ["user", "userId"], organization: ["organization", "organizationId"] },
  kudos: { giver: ["user", "giverId"], receiver: ["user", "receiverId"] },
  kudosReaction: { kudos: ["kudos", "kudosId"] },
  conversationMember: { user: ["user", "userId"], conversation: ["conversation", "conversationId"] },
  boardMember: { user: ["user", "userId"] },
  meetingAttendee: { user: ["user", "userId"] },
  spaceMember: { user: ["user", "userId"] },
  userSkill: { user: ["user", "userId"] },
  idea: { submitter: ["user", "submitterId"], reviewer: ["user", "reviewerId"] },
  // Step 8: an ownership area's owning job title (a boundary request reaches
  // its holders), and an SOP assignment's SOP and person (the compliance page).
  ownershipArea: { ownerRole: ["role", "ownerRoleId"] },
  sOPAssignment: { sop: ["sOP", "sopId"], user: ["user", "userId"] },
  // The step 8 review: a tag assignment's tag (a tag audience reads only
  // tags not archived), a policy's workspace and an assignment's policy (the
  // reminder doors filter by them).
  tagAssignment: { tag: ["tag", "tagId"] },
  policy: { organization: ["organization", "organizationId"] },
  policyAssignment: { policy: ["policy", "policyId"] },
  // The final review (security M1): a week row's person and manager, a
  // timesheet's person and approver, an entry's timesheet.
  weeklyReview: { user: ["user", "userId"], manager: ["user", "managerId"] },
  timesheet: { user: ["user", "userId"], approver: ["user", "approverId"] },
  timeEntry: { timesheet: ["timesheet", "timesheetId"] },
};

/** A model's list relations (one to many): name to [table, the key on the other table that names this row]. */
const LISTS: Record<string, Record<string, [string, string]>> = {
  user: {
    kpiRecords: ["kPIRecord", "userId"],
    reviewsAsSubject: ["review", "subjectId"],
    kudosReceived: ["kudos", "receiverId"],
    certifications: ["certification", "userId"],
    skills: ["userSkill", "userId"],
    dottedLineToManagers: ["userDottedLine", "userId"],
    dottedLineFromReports: ["userDottedLine", "managerId"],
    directReports: ["user", "managerId"],
    membershipReports: ["organizationMembership", "managerId"],
    kraAssignments: ["kRAAssignment", "userId"],
    organizationMemberships: ["organizationMembership", "userId"],
  },
  organization: {
    users: ["user", "organizationId"],
    memberships: ["organizationMembership", "organizationId"],
    dottedLines: ["userDottedLine", "organizationId"],
  },
  kudos: { reactions: ["kudosReaction", "kudosId"] },
  idea: { votes: ["ideaVote", "ideaId"], comments: ["ideaComment", "ideaId"] },
  conversation: { members: ["conversationMember", "conversationId"] },
  meeting: { attendees: ["meetingAttendee", "meetingId"] },
  // A department's, an office's and a job title's people and parts, for the
  // Settings deletes' counts (workspace-status-2.md, the step 5 review M2),
  // and (step 8) a department's job titles, as the Settings list counts them.
  department: { members: ["user", "departmentId"], subDepartments: ["department", "parentId"], roles: ["role", "departmentId"] },
  office: { members: ["user", "officeId"] },
  role: { users: ["user", "roleId"], kraTemplates: ["kRA", "roleId"], instances: ["roleInstance", "roleId"] },
  // workspace-status-2.md step 8 (audiences by placement): a goal's audience
  // rows, a policy's assignments and acknowledgements, a KRA's KPIs, a
  // survey's responses (and above, a job title's instances).
  oKR: { assignees: ["goalAssignee", "okrId"] },
  policy: { assignments: ["policyAssignment", "policyId"], acknowledgments: ["policyAcknowledgment", "policyId"] },
  kRA: { kpis: ["kPI", "kraId"] },
  pulseSurvey: { responses: ["surveyResponse", "surveyId"] },
  // The step 8 review: a review cycle's reviews (its launch refuses a cycle that has them).
  reviewCycle: { reviews: ["review", "cycleId"] },
  // The final review (security M1): a timesheet's entries.
  timesheet: { entries: ["timeEntry", "timesheetId"] },
};

/** The filters a list relation takes in a `where`. */
const LIST_FILTERS = new Set(["some", "none", "every"]);

/**
 * The foreign keys Postgres holds that a write must keep: column to the
 * table its id must exist in. A write that names a missing row throws P2003,
 * as Postgres does (User.departmentId, roleId and officeId; a membership's
 * copies have no key, D18). Seeds are not checked.
 */
const FOREIGN: Record<string, Record<string, string>> = {
  // User's line is a key to User too (the step 1 review L7): a swap carrying a dangling id onto the account fails here as in Postgres.
  user: { departmentId: "department", roleId: "role", officeId: "office", managerId: "user" },
  // workspace-status-2.md E1, E2: a membership's line and a dotted line's workspace.
  organizationMembership: { managerId: "user" },
  userDottedLine: { organizationId: "organization" },
};

/** The columns Postgres holds NOT NULL that a write must give (P2011 otherwise). */
const REQUIRED: Record<string, string[]> = {
  userDottedLine: ["userId", "managerId", "organizationId"],
};

/**
 * What a delete does to the rows that name the deleted row, as Postgres's
 * keys do: table, column, and "cascade" (those rows go too) or "setNull".
 */
const ON_DELETE: Record<string, Array<[string, string, "cascade" | "setNull"]>> = {
  user: [
    ["organizationMembership", "userId", "cascade"],
    ["userDottedLine", "userId", "cascade"],
    ["userDottedLine", "managerId", "cascade"],
    ["organizationMembership", "managerId", "setNull"],
    ["user", "managerId", "setNull"],
  ],
  organization: [
    ["user", "organizationId", "cascade"],
    ["organizationMembership", "organizationId", "cascade"],
    ["userDottedLine", "organizationId", "cascade"],
  ],
};

/** Each model's unique keys (Postgres' unique indexes), as column lists. */
const UNIQUE: Record<string, string[][]> = {
  user: [["email", "organizationId"]],
  organizationMembership: [["userId", "organizationId"]],
  invitation: [["token"]],
  userDottedLine: [["userId", "managerId", "organizationId"]],
  // One week row per person, workspace and week (the final review, security M1).
  weeklyReview: [["userId", "organizationId", "periodStart"]],
  timesheet: [["userId", "organizationId", "weekStartDate"]],
};

const DEFAULTS: Record<string, () => Row> = {
  user: () => ({ deletedAt: null, status: "ACTIVE", tokenVersion: 0, mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], passwordChangedAt: null, adminScopes: [], avatar: null, orgRole: null, createdAt: new Date() }),
  organization: () => ({ status: "ACTIVE", settings: {}, logo: null, slug: null }),
  organizationMembership: () => ({ role: "EMPLOYEE", isPrimary: false, adminScopes: [], status: "ACTIVE", removedAt: null, endedWithAccount: false, managerId: null, createdAt: new Date() }),
  userDottedLine: () => ({ role: null, weight: null, startDate: null, endDate: null, createdAt: new Date(), updatedAt: new Date() }),
  invitation: () => ({ accepted: false, spaceId: null, spaceRole: null, createdAt: new Date() }),
  // Its two stamps, as Postgres and Prisma fill them (a SCIM Group answers them: step 5).
  department: () => ({ createdAt: new Date(), updatedAt: new Date() }),
  // Its stamp, as Prisma fills it (step 7: the newest refusal of a manager is read by it).
  activityLog: () => ({ createdAt: new Date() }),
  // The final review (security M1): a week row and a timesheet as the schema's defaults fill them.
  weeklyReview: () => ({ kpiSnapshots: [], kraProgress: [], highlights: null, blockers: null, plan: null, status: "DRAFT", submittedAt: null, managerId: null, managerStatus: null, managerNotes: null, reviewedAt: null, createdAt: new Date(), updatedAt: new Date() }),
  timesheet: () => ({ status: "DRAFT", submittedAt: null, approverId: null, decisionAt: null, decisionNote: null, createdAt: new Date(), updatedAt: new Date() }),
  timeEntry: () => ({ description: null, taskId: null, itemId: null, source: "WEB", clockedInAt: null, clockedOutAt: null, billable: false, tags: [], createdAt: new Date(), updatedAt: new Date() }),
};

/** The stamps Prisma fills on a create only (`@updatedAt`), never on a seed. */
const CREATED: Record<string, () => Row> = {
  user: () => ({ updatedAt: new Date() }),
};

const OPS = new Set(["not", "in", "notIn", "equals", "contains", "mode", "gt", "gte", "lt", "lte"]);

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return a === b;
}

function cmp(a: unknown, b: unknown): number | null {
  if (a == null || b == null) return null;
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "string" && typeof y === "string") return x < y ? -1 : x > y ? 1 : 0;
  if (typeof x === "boolean" && typeof y === "boolean") return Number(x) - Number(y);
  return null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

export interface SeatDb {
  tables: Record<string, Row[]>;
  /** Every raw statement, in order; the person's row lock is "lock:<id>". */
  raw: string[];
  /** Every write, in order, as "<model>.<op>", whichever client made it. */
  writes: string[];
  /** Every call, reads and raw statements too, in order; "tx." in front of a transaction's. */
  log: string[];
  /** Model names whose reads and writes throw (a missing table, a blip). */
  failing: Set<string>;
  /** The error a failing model throws (a pool timeout, P2024, unless a test says otherwise). */
  failWith: { code: string; message: string };
  /** Answers a $queryRaw (the statement rendered, `?` for each value); unset, every $queryRaw throws. */
  onQueryRaw: ((sql: string, values: unknown[]) => unknown) | null;
  /** Runs after each call is logged, before it acts (see the header). */
  onCall: ((entry: string) => void | Promise<void>) | null;
  prisma: Record<string, unknown>;
  reset(): void;
  seed(model: string, row: Row): Row;
  row(model: string, id: string): Row;
}

export function createSeatDb(): SeatDb {
  const db = { tables: {}, raw: [], writes: [], log: [], failing: new Set<string>(), failWith: { code: "P2024", message: "pool timeout" }, onQueryRaw: null, onCall: null, prisma: {} } as unknown as SeatDb;
  const table = (name: string) => (db.tables[name] ??= []);
  const related = (model: string, row: Row, key: string): Row | null => {
    const rel = RELATIONS[model]?.[key];
    if (!rel) return null;
    return table(rel[0]).find((r) => r.id === row[rel[1]]) ?? null;
  };

  function matches(model: string, row: Row, where: Where | undefined): boolean {
    for (const [k, cond] of Object.entries(where ?? {})) {
      if (cond === undefined) continue;
      if (k === "OR") {
        if (!(cond as Where[]).some((c) => matches(model, row, c))) return false;
        continue;
      }
      if (k === "AND") {
        if (!(cond as Where[]).every((c) => matches(model, row, c))) return false;
        continue;
      }
      if (k === "NOT") {
        if ((Array.isArray(cond) ? (cond as Where[]) : [cond as Where]).some((c) => matches(model, row, c))) return false;
        continue;
      }
      const list = LISTS[model]?.[k];
      if (list) {
        if (!isPlainObject(cond) || !Object.keys(cond).every((op) => LIST_FILTERS.has(op))) throw new Error(`seat-test-db: ${model}.${k} takes some, none or every`);
        const [rel, fk] = list;
        const rows = table(rel).filter((r) => r[fk] === row.id);
        const c = cond as { some?: Where; none?: Where; every?: Where };
        if (c.some !== undefined && !rows.some((r) => matches(rel, r, c.some))) return false;
        if (c.none !== undefined && rows.some((r) => matches(rel, r, c.none))) return false;
        if (c.every !== undefined && !rows.every((r) => matches(rel, r, c.every))) return false;
        continue;
      }
      if (k.includes("_") && isPlainObject(cond)) {
        if (!matches(model, row, cond)) return false;
        continue;
      }
      const rel = RELATIONS[model]?.[k];
      if (rel) {
        const r = related(model, row, k);
        if (!r || !matches(rel[0], r, cond as Where)) return false;
        continue;
      }
      const v = row[k];
      if (cond === null) {
        if (v != null) return false;
        continue;
      }
      if (!isPlainObject(cond)) {
        if (Array.isArray(cond)) throw new Error(`seat-test-db: an array as ${model}.${k} is not modelled`);
        if (!same(v, cond)) return false;
        continue;
      }
      for (const [op, x] of Object.entries(cond)) {
        if (!OPS.has(op)) throw new Error(`seat-test-db: unknown condition ${model}.${k}.${op}`);
        if (op === "mode") {
          if (x !== "insensitive" && x !== "default") throw new Error(`seat-test-db: unknown mode ${String(x)}`);
          continue;
        }
        if (op === "not") {
          if (isPlainObject(x) || Array.isArray(x)) throw new Error(`seat-test-db: a "not" with an operator (${model}.${k}) is not modelled`);
          // SQL: NOT (v = x) is not true for a NULL v.
          if (x === null ? v == null : v == null || same(v, x)) return false;
          continue;
        }
        if (op === "in" || op === "notIn") {
          if (!Array.isArray(x)) throw new Error(`seat-test-db: ${op} needs a list (${model}.${k})`);
          if (v == null) return false;
          const hit = x.some((y) => same(v, y));
          if (op === "in" ? !hit : hit) return false;
          continue;
        }
        if (op === "equals") {
          const ci = (cond as Record<string, unknown>).mode === "insensitive";
          if (!(ci && typeof v === "string" && typeof x === "string" ? v.toLowerCase() === x.toLowerCase() : same(v, x))) return false;
          continue;
        }
        if (op === "contains") {
          if (typeof x !== "string") throw new Error(`seat-test-db: contains needs a string (${model}.${k})`);
          const ci = (cond as Record<string, unknown>).mode === "insensitive";
          if (typeof v !== "string" || !(ci ? v.toLowerCase().includes(x.toLowerCase()) : v.includes(x))) return false;
          continue;
        }
        const order = cmp(v, x);
        if (op === "gt" && !(order !== null && order > 0)) return false;
        if (op === "gte" && !(order !== null && order >= 0)) return false;
        if (op === "lt" && !(order !== null && order < 0)) return false;
        if (op === "lte" && !(order !== null && order <= 0)) return false;
      }
    }
    return true;
  }

  function project(model: string, row: Row, a: { select?: Record<string, unknown>; include?: Record<string, unknown> }): Row {
    const relOf = (k: string, on: unknown): Row | null => {
      const r = related(model, row, k);
      if (!r) return null;
      const rel = RELATIONS[model][k][0];
      return on && typeof on === "object" ? project(rel, r, on as { select?: Record<string, unknown> }) : { ...r };
    };
    // A list relation: the rows of its table that name this row, filtered by
    // its `where`, ordered and cut as asked, each projected by its select.
    type ListArgs = { where?: Where; orderBy?: OrderBy; take?: number; select?: Record<string, unknown>; include?: Record<string, unknown> };
    const listOf = (k: string, on: unknown): Row[] => {
      const [rel, fk] = LISTS[model][k];
      const args = (on && typeof on === "object" ? on : {}) as ListArgs;
      let list = ordered(table(rel).filter((r) => r[fk] === row.id && matches(rel, r, args.where)), args.orderBy, rel);
      if (typeof args.take === "number") list = list.slice(0, args.take);
      return list.map((r) => (args.select || args.include ? project(rel, r, args) : structuredClone(r)));
    };
    // `_count: { select: { list: true | { where } } }`.
    const countOf = (on: unknown): Row => {
      const sel = ((on as { select?: Record<string, unknown> } | undefined)?.select ?? {}) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(sel).filter(([, v]) => v).map(([k, v]) => {
          const pair = LISTS[model]?.[k];
          if (!pair) throw new Error(`seat-test-db: _count of ${model}.${k} is not modelled`);
          const w = typeof v === "object" ? (v as { where?: Where }).where : undefined;
          return [k, table(pair[0]).filter((r) => r[pair[1]] === row.id && matches(pair[0], r, w)).length];
        }),
      );
    };
    if (a.select) {
      const out: Row = {};
      for (const [k, on] of Object.entries(a.select)) {
        if (!on) continue;
        if (k === "_count") out[k] = countOf(on);
        else if (LISTS[model]?.[k]) out[k] = listOf(k, on);
        else out[k] = RELATIONS[model]?.[k] ? relOf(k, on) : Array.isArray(row[k]) ? [...(row[k] as unknown[])] : row[k];
      }
      return out;
    }
    const out: Row = structuredClone(row);
    for (const [k, on] of Object.entries(a.include ?? {})) {
      if (!on) continue;
      // `include: { _count: ... }` counts as a select's does (the step 5 review M2).
      if (k === "_count") out[k] = countOf(on);
      else if (LISTS[model]?.[k]) out[k] = listOf(k, on);
      else if (RELATIONS[model]?.[k]) out[k] = relOf(k, on);
    }
    return out;
  }

  type OrderBy = Record<string, unknown> | Array<Record<string, unknown>>;
  // A key is a column of the row, or (step 6 of workspace-status-2) a to-one
  // relation's column, `{ user: { firstName: "asc" } }`, read from the
  // related row as Postgres joins it (no related row sorts as NULL).
  function ordered(list: Row[], orderBy: OrderBy | undefined, model?: string): Row[] {
    if (!orderBy) return list;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) =>
      Object.entries(o).flatMap(([k, d]): Array<[string[], unknown]> => {
        // Any other nested key (a list relation's _count) reads as before: no value.
        if (isPlainObject(d) && !("sort" in d) && model && RELATIONS[model]?.[k]) return Object.entries(d).map(([c, s]) => [[k, c], s]);
        return [[[k], d]];
      }),
    );
    const valueOf = (row: Row, path: string[]): unknown => (path.length === 1 ? row[path[0]] : related(model!, row, path[0])?.[path[1]]);
    return [...list].sort((x, y) => {
      for (const [k, d] of keys) {
        const spec = typeof d === "string" ? { sort: d } : (d as { sort: string; nulls?: string });
        const xv = valueOf(x, k);
        const yv = valueOf(y, k);
        if (xv == null || yv == null) {
          if (xv == null && yv == null) continue;
          // Postgres: NULLS LAST for ascending, NULLS FIRST for descending, unless said.
          const nullFirst = spec.nulls ? spec.nulls === "first" : spec.sort === "desc";
          return (xv == null) === nullFirst ? -1 : 1;
        }
        const c = cmp(xv, yv) ?? 0;
        if (c !== 0) return spec.sort === "desc" ? -c : c;
      }
      return 0;
    });
  }

  function apply(row: Row, data: Row): void {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (isPlainObject(v) && "increment" in v) row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
      else row[k] = Array.isArray(v) ? [...v] : v;
    }
  }

  /** Throws P2003 when `row` names a row a foreign key needs and its table does not hold. */
  function holdForeign(name: string, row: Row): void {
    for (const [col, target] of Object.entries(FOREIGN[name] ?? {})) {
      const v = row[col];
      if (v == null) continue;
      if (!table(target).some((r) => r.id === v)) throw Object.assign(new Error(`seat-test-db: ${name}.${col} names a missing ${target} ${String(v)}`), { code: "P2003" });
    }
  }

  /** Throws P2011 when `row` leaves a NOT NULL column empty. */
  function holdRequired(name: string, row: Row): void {
    for (const col of REQUIRED[name] ?? []) {
      if (row[col] == null) throw Object.assign(new Error(`seat-test-db: ${name}.${col} is required (NOT NULL)`), { code: "P2011" });
    }
  }

  /** Removes `gone` from its table and does to the rows naming it what ON_DELETE says, as Postgres does. */
  function removeRows(name: string, gone: Row[]): void {
    if (gone.length === 0) return;
    const t = table(name);
    for (const r of gone) {
      const i = t.indexOf(r);
      if (i >= 0) t.splice(i, 1);
    }
    const ids = new Set(gone.map((r) => r.id));
    for (const [other, col, how] of ON_DELETE[name] ?? []) {
      const naming = table(other).filter((r) => ids.has(r[col] as string));
      if (how === "setNull") for (const r of naming) r[col] = null;
      else removeRows(other, naming);
    }
  }

  /**
   * One updateMany: every matching row written, the keys held, and on a
   * broken key none written (a failed statement writes nothing, as in
   * Postgres). Answers the rows written.
   */
  function writeMany(name: string, where: Where | undefined, data: Row): Row[] {
    const hit = table(name).filter((r) => matches(name, r, where));
    const before = hit.map((r) => ({ ...r }));
    try {
      for (const r of hit) {
        apply(r, data);
        holdRequired(name, r);
        holdUnique(name, r);
        holdForeign(name, r);
      }
    } catch (err) {
      hit.forEach((r, i) => {
        for (const k of Object.keys(r)) delete r[k];
        Object.assign(r, before[i]);
      });
      throw err;
    }
    return hit;
  }

  /** Throws P2002 when `row` would share a unique key with another row of the table. */
  function holdUnique(name: string, row: Row): void {
    for (const cols of UNIQUE[name] ?? []) {
      if (cols.some((c) => row[c] == null)) continue;
      const clash = table(name).find((r) => r !== row && cols.every((c) => same(r[c], row[c])));
      if (clash) throw Object.assign(new Error(`seat-test-db: unique ${name}(${cols.join(", ")}) broken`), { code: "P2002" });
    }
  }

  const guard = (name: string) => {
    if (db.failing.has(name)) throw Object.assign(new Error(`seat-test-db: ${name} is failing (${db.failWith.message})`), { code: db.failWith.code });
  };
  let ids = 0;

  const model = (name: string, via: string) => {
    const read = (op: string) => {
      db.log.push(`${via}${name}.${op}`);
      void db.onCall?.(`${via}${name}.${op}`);
      guard(name);
    };
    const wrote = (op: string) => {
      db.log.push(`${via}${name}.${op}`);
      void db.onCall?.(`${via}${name}.${op}`);
      guard(name);
      db.writes.push(`${name}.${op}`);
    };
    return {
      findUnique: async (a: { where: Where; select?: Record<string, unknown>; include?: Record<string, unknown> }) => {
        read("findUnique");
        const r = table(name).find((row) => matches(name, row, a.where));
        return r ? project(name, r, a) : null;
      },
      findFirst: async (a: { where?: Where; select?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: OrderBy } = {}) => {
        read("findFirst");
        const r = ordered(table(name).filter((row) => matches(name, row, a.where)), a.orderBy, name)[0];
        return r ? project(name, r, a) : null;
      },
      findMany: async (a: { where?: Where; select?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: OrderBy; take?: number; skip?: number } = {}) => {
        read("findMany");
        let list = ordered(table(name).filter((row) => matches(name, row, a.where)), a.orderBy, name);
        if (typeof a.skip === "number") list = list.slice(a.skip);
        if (typeof a.take === "number") list = list.slice(0, a.take);
        return list.map((r) => project(name, r, a));
      },
      groupBy: async (a: { by: string[]; where?: Where; _max?: Record<string, boolean>; _count?: { _all?: boolean } }) => {
        read("groupBy");
        if (a.by.length === 0) throw new Error("seat-test-db: groupBy needs a column");
        const groups = new Map<string, Row[]>();
        for (const row of table(name).filter((r) => matches(name, r, a.where))) {
          const key = JSON.stringify(a.by.map((c) => row[c] ?? null));
          groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        return [...groups.values()].map((rows) => ({
          ...Object.fromEntries(a.by.map((c) => [c, rows[0][c] ?? null])),
          ...(a._max ? { _max: Object.fromEntries(Object.keys(a._max).map((c) => [c, rows.map((r) => r[c]).reduce<unknown>((m, v) => (m == null || (cmp(v, m) ?? 0) > 0 ? v : m), null)])) } : {}),
          ...(a._count ? { _count: { _all: rows.length } } : {}),
        }));
      },
      count: async (a: { where?: Where } = {}) => {
        read("count");
        return table(name).filter((row) => matches(name, row, a.where)).length;
      },
      create: async (a: { data: Row; select?: Record<string, unknown> }) => {
        wrote("create");
        const row: Row = { ...(DEFAULTS[name]?.() ?? {}), ...(CREATED[name]?.() ?? {}) };
        // A list relation written with the row (`members: { create: [...] }`)
        // becomes rows of its own table naming this one.
        const nested: Array<[string, string, Row[]]> = [];
        const data: Row = {};
        for (const [k, v] of Object.entries(a.data)) {
          const list = LISTS[name]?.[k];
          if (list && isPlainObject(v) && "create" in v) {
            const c = (v as { create: Row | Row[] }).create;
            nested.push([list[0], list[1], Array.isArray(c) ? c : [c]]);
          } else data[k] = v;
        }
        apply(row, data);
        if (row.id === undefined) row.id = `${name}-${(ids += 1)}`;
        holdRequired(name, row);
        holdUnique(name, row);
        holdForeign(name, row);
        table(name).push(row);
        for (const [rel, fk, rows] of nested) {
          for (const d of rows) {
            const child: Row = { ...(DEFAULTS[rel]?.() ?? {}), ...d, [fk]: row.id };
            if (child.id === undefined) child.id = `${rel}-${(ids += 1)}`;
            holdUnique(rel, child);
            table(rel).push(child);
          }
        }
        return project(name, row, a);
      },
      createMany: async (a: { data: Row[] }) => {
        wrote("createMany");
        for (const d of a.data) {
          const row: Row = { ...(DEFAULTS[name]?.() ?? {}) };
          apply(row, d);
          if (row.id === undefined) row.id = `${name}-${(ids += 1)}`;
          holdRequired(name, row);
          holdUnique(name, row);
          holdForeign(name, row);
          table(name).push(row);
        }
        return { count: a.data.length };
      },
      update: async (a: { where: Where; data: Row; select?: Record<string, unknown> }) => {
        wrote("update");
        const row = table(name).find((r) => matches(name, r, a.where));
        if (!row) throw Object.assign(new Error(`seat-test-db: ${name}.update found no row`), { code: "P2025" });
        const next = { ...row };
        apply(next, a.data);
        const before = { ...row };
        Object.assign(row, next);
        try {
          holdRequired(name, row);
          holdUnique(name, row);
          holdForeign(name, row);
        } catch (err) {
          Object.assign(row, before);
          throw err;
        }
        return project(name, row, a);
      },
      updateMany: async (a: { where?: Where; data: Row }) => {
        wrote("updateMany");
        return { count: writeMany(name, a.where, a.data).length };
      },
      updateManyAndReturn: async (a: { where?: Where; data: Row; select?: Record<string, unknown> }) => {
        wrote("updateManyAndReturn");
        return writeMany(name, a.where, a.data).map((r) => project(name, r, a));
      },
      delete: async (a: { where: Where; select?: Record<string, unknown> }) => {
        wrote("delete");
        const t = table(name);
        const row = t.find((r) => matches(name, r, a.where));
        if (!row) throw Object.assign(new Error(`seat-test-db: ${name}.delete found no row`), { code: "P2025" });
        const out = project(name, row, a);
        removeRows(name, [row]);
        return out;
      },
      deleteMany: async (a: { where?: Where } = {}) => {
        wrote("deleteMany");
        const gone = table(name).filter((r) => matches(name, r, a.where));
        removeRows(name, gone);
        return { count: gone.length };
      },
      upsert: async (a: { where: Where; create: Row; update: Row }) => {
        wrote("upsert");
        const row = table(name).find((r) => matches(name, r, a.where));
        if (row) {
          apply(row, a.update);
          holdRequired(name, row);
          holdUnique(name, row);
          holdForeign(name, row);
          return { ...row };
        }
        const fresh: Row = { ...(DEFAULTS[name]?.() ?? {}) };
        apply(fresh, a.create);
        if (fresh.id === undefined) fresh.id = `${name}-${(ids += 1)}`;
        holdRequired(name, fresh);
        holdUnique(name, fresh);
        holdForeign(name, fresh);
        table(name).push(fresh);
        return { ...fresh };
      },
    };
  };

  const raw = (via: string) => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    if (/^SELECT 1 FROM "User" WHERE "id" = ANY\(\?::text\[\]\) ORDER BY "id" COLLATE "C" FOR NO KEY UPDATE$/.test(text)) {
      if (!Array.isArray(values[0])) throw new Error("seat-test-db: the people's row locks need a list of ids");
      const ids = [...new Set(values[0] as string[])].sort();
      for (const id of ids) {
        db.raw.push(`lock:${id}`);
        db.log.push(`${via}lock:${id}`);
        await db.onCall?.(`${via}lock:${id}`);
      }
      return ids.length;
    }
    let entry: string;
    if (/^SELECT 1 FROM "User" WHERE "id" = \? FOR NO KEY UPDATE$/.test(text)) entry = `lock:${String(values[0])}`;
    else if (/^SELECT (set_config|pg_advisory_xact_lock)\(/.test(text) || /^SET LOCAL /.test(text)) entry = text;
    else throw new Error(`seat-test-db: raw statement not modelled: ${text}`);
    db.raw.push(entry);
    db.log.push(`${via}${entry}`);
    await db.onCall?.(`${via}${entry}`);
    return 1;
  };
  const queryRaw = (via: string) => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = Prisma.sql(strings, ...values);
    const text = q.sql.replace(/\s+/g, " ").trim();
    if (!db.onQueryRaw) throw new Error(`seat-test-db: $queryRaw is not modelled: ${text}`);
    db.log.push(`${via}queryRaw`);
    return db.onQueryRaw(text, q.values);
  };

  const client = (via: string, inTx: boolean): Record<string, unknown> => {
    const models = new Map<string, ReturnType<typeof model>>();
    return new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === "$transaction") {
            // A transaction's client has no $transaction of its own, as Prisma's.
            if (inTx) return undefined;
            return async (fn: ((tx: unknown) => Promise<unknown>) | Array<Promise<unknown>>) => {
              // The batch form (`$transaction([a, b])`): here each call already
              // ran when it was made, in order, so its answers are awaited as
              // given (no rollback is modelled for it).
              if (Array.isArray(fn)) return Promise.all(fn);
              const before = structuredClone(db.tables);
              try {
                return await fn(txClient);
              } catch (err) {
                for (const k of Object.keys(db.tables)) delete db.tables[k];
                Object.assign(db.tables, before);
                throw err;
              }
            };
          }
          if (key === "$executeRaw") return raw(via);
          if (key === "$queryRaw") return queryRaw(via);
          if (typeof key !== "string" || key.startsWith("$") || key === "then") return undefined;
          if (!models.has(key)) models.set(key, model(key, via));
          return models.get(key);
        },
      },
    );
  };
  const txClient = client("tx.", true);
  db.prisma = client("", false);

  db.reset = () => {
    for (const k of Object.keys(db.tables)) delete db.tables[k];
    db.raw.length = 0;
    db.writes.length = 0;
    db.log.length = 0;
    db.failing.clear();
    db.failWith = { code: "P2024", message: "pool timeout" };
    db.onQueryRaw = null;
    db.onCall = null;
    ids = 0;
  };
  db.seed = (name: string, row: Row) => {
    const full: Row = { ...(DEFAULTS[name]?.() ?? {}), ...row };
    holdUnique(name, full);
    table(name).push(full);
    return full;
  };
  db.row = (name: string, id: string) => {
    const r = table(name).find((x) => x.id === id);
    if (!r) throw new Error(`seat-test-db: no ${name} ${id}`);
    return r;
  };
  return db;
}

/** The one store the step 2 suites mock @/lib/prisma with. */
export const seatDb = createSeatDb();
