/**
 * GET /api/v1/openapi.json
 * Returns the OpenAPI 3.1 spec for the WorkwrK public API so devs can
 * drop it into Postman, Insomnia, Stoplight, Redoc, etc.
 *
 * Every enum here is read from the list the routes themselves use, never
 * typed again: the Prisma enums for the columns that are enums, and
 * src/lib/board-items-shared.ts for a task's priority. A task's status has
 * no fixed list at all (each List keeps its own, Board.statuses), so it is a
 * string with the default set as examples, not an enum. The docs site shows
 * these strings, so none holds an em dash or a double hyphen
 * (route.test.ts holds both rules).
 *
 * A value that may be null says so the OpenAPI 3.1 way (orNull below): "null"
 * joins its type, and an enum lists null. 3.1 is JSON Schema, which has no
 * `nullable` keyword, so the 3.0 form this used to carry was ignored and every
 * one of those fields read as never null. The webhook events are the one list
 * POST /api/webhooks accepts (src/lib/webhook-events.ts).
 */

import { Frequency, SOPStatus, SOPType, TaskSource, UserStatus } from "@/generated/prisma";
import { DEFAULT_STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";

const USER_STATUSES = Object.values(UserStatus);
const KPI_FREQUENCIES = Object.values(Frequency);
const SOP_TYPES = Object.values(SOPType);
const SOP_STATUSES = Object.values(SOPStatus);
const TASK_SOURCES = Object.values(TaskSource);
const TASK_PRIORITIES = PRIORITY_OPTIONS.map((p) => p.value);
const DEFAULT_TASK_STATUSES = DEFAULT_STATUS_OPTIONS.map((s) => s.value);

/**
 * A schema that may also be null, in OpenAPI 3.1's own form: "null" joins the
 * type, and an enum that may be null lists null among its values.
 */
function orNull<S extends { type: string; enum?: readonly unknown[] }>(schema: S) {
  const { type, enum: values, ...rest } = schema;
  return { ...rest, type: [type, "null"], ...(values ? { enum: [...values, null] } : {}) };
}

/** The page every list endpoint answers: `{ data, nextCursor }`. */
function listOf(ref: string) {
  return {
    type: "object",
    properties: {
      data: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
      nextCursor: orNull({ type: "string", description: "Pass as `cursor` for the next page. Null on the last page." }),
    },
  };
}

const ok = (ref: string) => ({
  description: "OK",
  content: { "application/json": { schema: listOf(ref) } },
});

/** The two paging parameters every list endpoint reads. */
const PAGING = [
  { name: "limit", in: "query", schema: { type: "integer", default: 50, minimum: 1, maximum: 200 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "The `nextCursor` of the page before." },
];

const person = orNull({
  type: "object",
  properties: { id: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" } },
});

export async function GET(req: Request) {
  // Public base URL. `new URL(req.url).origin` is ALWAYS truthy, so it can
  // never fall through — and behind nginx it is the internal origin
  // (http://localhost:3002), which would publish a "Production" server URL
  // pointing at the reader's own machine. Trust the proxy's forwarded host
  // first, then the configured public URL, and only then the raw origin.
  const h = req.headers;
  const fwdHost = h.get("x-forwarded-host") || h.get("host");
  const configured = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  const rawOrigin = new URL(req.url).origin.replace(/\/$/, "");
  const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(host);

  let base: string;
  if (fwdHost && !isLocalHost(fwdHost)) {
    // A public host is always served over TLS here; the proxy's own hop
    // reports x-forwarded-proto: http, which would publish an http:// URL.
    base = `https://${fwdHost}`;
  } else if (configured && !isLocalHost(new URL(configured).host)) {
    base = configured;
  } else {
    base = rawOrigin; // genuine local dev — keep localhost so dev tooling works
  }

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "WorkwrK API",
      version: "v1",
      description:
        "WorkwrK public REST API: programmatic access to the operating-system spine. " +
        "Authenticate with `Authorization: Bearer wk_live_...`. Rate limits are enforced per key. " +
        "A signed-in session also works, for the workspace's Owner and Admins only.",
      contact: { name: "WorkwrK Developers", email: "developers@workwrk.com" },
    },
    servers: [{ url: `${base}/api/v1`, description: "Production" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
          description:
            "Create an API key at /settings/api. Format: `wk_live_<token>`. " +
            "Scopes: READ, WRITE, ADMIN. Rate-limited per minute and per day.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"],
        },
        Person: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string", format: "email" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            status: { type: "string", enum: USER_STATUSES },
            accessLevel: { type: "string" },
            avatar: orNull({ type: "string" }),
            joinDate: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            role: orNull({
              type: "object",
              properties: { id: { type: "string" }, title: { type: "string" } },
            }),
            department: orNull({
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" } },
            }),
            manager: { ...person, description: "The person they report to, or null." },
          },
        },
        PersonList: listOf("Person"),
        KRA: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: orNull({ type: "string" }),
            category: orNull({ type: "string" }),
            roleId: orNull({ type: "string" }),
            role: orNull({
              type: "object",
              description: "In the list only.",
              properties: { id: { type: "string" }, title: { type: "string" } },
            }),
            createdAt: { type: "string", format: "date-time" },
            _count: {
              type: "object",
              description: "In the list only.",
              properties: { kpis: { type: "integer" }, assignments: { type: "integer" } },
            },
          },
        },
        KPI: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: orNull({ type: "string" }),
            targetValue: orNull({ type: "number" }),
            unit: orNull({ type: "string" }),
            frequency: { type: "string", enum: KPI_FREQUENCIES },
            kraId: orNull({ type: "string" }),
            kra: orNull({
              type: "object",
              description: "In the list only.",
              properties: { id: { type: "string" }, name: { type: "string" } },
            }),
            createdAt: { type: "string", format: "date-time" },
            _count: {
              type: "object",
              description: "In the list only.",
              properties: { records: { type: "integer" } },
            },
          },
        },
        KPIRecord: {
          type: "object",
          properties: {
            id: { type: "string" },
            kpiId: { type: "string" },
            userId: { type: "string" },
            period: { type: "string", example: "2026-Q1" },
            targetValue: { type: "number" },
            actualValue: orNull({ type: "number" }),
            score: orNull({ type: "number" }),
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Kudos: {
          type: "object",
          properties: {
            id: { type: "string" },
            message: { type: "string" },
            companyValue: orNull({ type: "string" }),
            giverId: { type: "string" },
            receiverId: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            giver: { ...person, description: "In the list only." },
            receiver: { ...person, description: "In the list only." },
          },
        },
        Task: {
          type: "object",
          properties: {
            id: { type: "string", description: "Opens at /item/<id> in the app." },
            title: { type: "string" },
            description: orNull({ type: "string", description: "In the list only." }),
            date: orNull({ type: "string", format: "date-time", description: "The due date, or null when the task has none." }),
            status: orNull({
              type: "string",
              description:
                "The task's status as its List stores it. Each List keeps its own set of statuses, so there is no fixed list; " +
                "a List nobody has changed uses the three in `examples`. Null when the task has no status.",
              examples: DEFAULT_TASK_STATUSES,
            }),
            priority: orNull({ type: "string", enum: TASK_PRIORITIES, description: "Null when the task has no priority." }),
            slaHours: orNull({ type: "integer", description: "As it was given. Nothing escalates a task when it passes." }),
            source: { type: "string", enum: TASK_SOURCES },
            sourceRef: orNull({ type: "string" }),
            assigneeId: orNull({ type: "string", description: "The task's main assignee, or null when nobody is assigned." }),
            escalatedAt: orNull({
              type: "string",
              format: "date-time",
              description: "In the list only. Set on tasks carried over from the old task system; nothing sets it now.",
            }),
            createdAt: { type: "string", format: "date-time" },
          },
        },
        SOP: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: orNull({ type: "string" }),
            category: orNull({ type: "string" }),
            subcategory: orNull({ type: "string" }),
            sopType: { type: "string", enum: SOP_TYPES },
            version: { type: "integer" },
            status: { type: "string", enum: SOP_STATUSES },
            kraId: orNull({ type: "string" }),
            publishedAt: orNull({ type: "string", format: "date-time" }),
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            _count: {
              type: "object",
              description: "How many compliance records and assignments the SOP has.",
              properties: { compliance: { type: "integer" }, assignments: { type: "integer" } },
            },
          },
        },
        Invitation: {
          type: "object",
          properties: {
            invitation: {
              type: "object",
              properties: {
                id: { type: "string" },
                email: { type: "string", format: "email" },
                token: { type: "string", description: "The secret in the join link. Treat it as a password." },
                expiresAt: { type: "string", format: "date-time" },
                acceptUrl: { type: "string", format: "uri", description: "The join link to send the person." },
              },
            },
          },
        },
      },
    },
    paths: {
      "/people": {
        get: {
          summary: "List people",
          parameters: [
            ...PAGING,
            { name: "status", in: "query", schema: { type: "string", enum: USER_STATUSES } },
            { name: "departmentId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/PersonList" } },
              },
            },
          },
        },
        post: {
          summary: "Invite a person into the org",
          description:
            "Creates a pending invitation and returns its join link (`acceptUrl`) for you to send. " +
            "Answers 409 when the email is already in the workspace or already invited. " +
            "The email must use one of the workspace's invite domains, when it has any.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email" },
                    firstName: { type: "string", description: "Kept on the invitation, so the join form starts filled in. The person can change it when they accept." },
                    lastName: { type: "string", description: "Kept on the invitation, so the join form starts filled in. The person can change it when they accept." },
                    accessLevel: {
                      type: "string",
                      description:
                        "Read only from a signed-in Owner's or Admin's session, and never above their own level. " +
                        "With an API key the person is invited as an Employee and this field is ignored.",
                    },
                    roleId: { type: "string" },
                    departmentId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Invitation created", content: { "application/json": { schema: { $ref: "#/components/schemas/Invitation" } } } },
            "400": { description: "email is missing, uses a domain the workspace does not invite from, or roleId or departmentId is not this workspace's" },
            "409": { description: "The email is already in the workspace, or an invitation to it is pending" },
          },
        },
      },
      "/kras": {
        get: {
          summary: "List KRAs",
          parameters: [...PAGING, { name: "roleId", in: "query", schema: { type: "string" } }],
          responses: { "200": ok("KRA") },
        },
        post: {
          summary: "Create a KRA",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    category: { type: "string" },
                    roleId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/KRA" } } } } },
        },
      },
      "/kpis": {
        get: {
          summary: "List KPIs",
          parameters: [...PAGING, { name: "kraId", in: "query", schema: { type: "string" } }],
          responses: { "200": ok("KPI") },
        },
        post: {
          summary: "Create a KPI",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["kraId", "name", "targetValue"],
                  properties: {
                    kraId: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string" },
                    targetValue: { type: "number" },
                    unit: { type: "string", description: "Left empty when not given." },
                    frequency: { type: "string", enum: KPI_FREQUENCIES, default: "MONTHLY" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/KPI" } } } },
            "400": { description: "kraId, name or targetValue is missing" },
            "404": { description: "The KRA is not in this workspace" },
          },
        },
      },
      "/kpi-records": {
        get: {
          summary: "List KPI readings",
          parameters: [
            ...PAGING,
            { name: "userId", in: "query", schema: { type: "string" } },
            { name: "kpiId", in: "query", schema: { type: "string" } },
            { name: "period", in: "query", schema: { type: "string", example: "2026-Q1" } },
          ],
          responses: { "200": ok("KPIRecord") },
        },
        post: {
          summary: "Log a KPI reading (integration sweet-spot)",
          description:
            "Post a KPI value from a connected tool. Fires `kpi.recorded` webhook + recomputes composite score.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["kpiId", "userId", "period", "actualValue"],
                  properties: {
                    kpiId: { type: "string" },
                    userId: { type: "string" },
                    period: { type: "string", example: "2026-Q1" },
                    actualValue: { type: "number" },
                    targetValue: { type: "number" },
                    notes: { type: "string" },
                    evidence: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Recorded", content: { "application/json": { schema: { $ref: "#/components/schemas/KPIRecord" } } } },
            "400": { description: "kpiId, userId, period or actualValue is missing" },
            "404": { description: "The KPI, or the person, is not in this workspace" },
          },
        },
      },
      "/kudos": {
        get: {
          summary: "Feed",
          parameters: [
            ...PAGING,
            { name: "receiverId", in: "query", schema: { type: "string" } },
            { name: "giverId", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": ok("Kudos") },
        },
        post: {
          summary: "Send kudos",
          description: "Thanks the receiver (an inbox notification and an email, by their own settings, unless they are a Guest or deactivated), logs it, posts to Slack and fires the `kudos.created` webhook. Both people must be in the workspace and not removed from it.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["giverId", "receiverId", "message"],
                  properties: {
                    giverId: { type: "string" },
                    receiverId: { type: "string" },
                    message: { type: "string" },
                    companyValue: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Kudos" } } } },
            "400": { description: "A field is missing, or the giver and the receiver are the same person" },
            "404": { description: "The giver or the receiver is not in this workspace, or was removed from it" },
          },
        },
      },
      "/tasks": {
        get: {
          summary: "List tasks",
          parameters: [
            ...PAGING,
            { name: "assigneeId", in: "query", schema: { type: "string" }, description: "Tasks this person is assigned to, as the main assignee or one of several." },
            {
              name: "status",
              in: "query",
              schema: { type: "string", examples: DEFAULT_TASK_STATUSES },
              description: "A status as the task's List stores it, matched exactly but in any case.",
            },
            { name: "from", in: "query", schema: { type: "string", format: "date-time" }, description: "Due on or after." },
            { name: "to", in: "query", schema: { type: "string", format: "date-time" }, description: "Due on or before." },
          ],
          responses: { "200": ok("Task") },
        },
        post: {
          summary: "Create a task",
          description: "The task lands on the assignee's Personal list, in that List's first open status.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "assigneeId"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    date: { type: "string", format: "date-time", description: "The due date. The time of the call when left out." },
                    assigneeId: { type: "string" },
                    kraId: { type: "string" },
                    category: { type: "string" },
                    slaHours: { type: "integer", description: "Kept with the task and returned as given. Nothing escalates a task when it passes." },
                    priority: { type: "string", enum: TASK_PRIORITIES, default: "NORMAL", description: "Any case is accepted and stored in capitals." },
                    source: { type: "string", enum: TASK_SOURCES, default: "MANUAL", description: "Any case is accepted and stored in capitals." },
                    sourceRef: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } },
            "400": { description: "title or assigneeId is missing, or priority or source is not one of the listed values" },
            "404": { description: "The assignee is not in this workspace" },
          },
        },
      },
      "/sops": {
        get: {
          summary: "List SOPs",
          description: "Published SOPs, unless you ask for another status.",
          parameters: [
            ...PAGING,
            { name: "status", in: "query", schema: { type: "string", enum: SOP_STATUSES, default: "PUBLISHED" } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "sopType", in: "query", schema: { type: "string", enum: SOP_TYPES } },
          ],
          responses: { "200": ok("SOP") },
        },
      },
    },
    // Exactly the events something sends, and exactly the names a webhook
    // subscription may name (POST /api/webhooks): one list.
    "x-events": WEBHOOK_EVENTS.map((e) => ({ name: e.name, description: e.description })),
  };

  // ── Post-process: group endpoints and document the failures every one of
  // them can return. Done here rather than on each operation so endpoints
  // added later inherit it automatically and can never drift.
  const TAG_OF: Record<string, string> = {
    "/people": "People",
    "/kras": "Alignment",
    "/kpis": "Alignment",
    "/kpi-records": "Alignment",
    "/tasks": "Work",
    "/kudos": "Culture",
    "/sops": "Knowledge",
  };
  const SCOPE_OF: Record<string, "READ" | "WRITE"> = {
    get: "READ", post: "WRITE", put: "WRITE", patch: "WRITE", delete: "WRITE",
  };
  // Endpoints that need more than their method's scope.
  const SCOPE_OVERRIDE: Record<string, "ADMIN"> = { "post /people": "ADMIN" };
  const errRef = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  });

  (spec.components as Record<string, unknown>).responses = {
    Unauthorized: errRef("Missing, malformed, revoked or unknown API key."),
    Forbidden: errRef("The key lacks the scope this endpoint requires, or the signed-in person is not the workspace's Owner or an Admin."),
    RateLimited: errRef("Per-minute or per-day rate limit for this key exceeded."),
  };

  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  for (const [path, ops] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!SCOPE_OF[method] || typeof op !== "object" || op === null) continue;
      op.tags = [TAG_OF[path] ?? "General"];
      op.operationId ??= `${method}${path.replace(/[^a-zA-Z]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))}`;
      op.responses = {
        ...(op.responses as Record<string, unknown>),
        "401": { $ref: "#/components/responses/Unauthorized" },
        "403": { $ref: "#/components/responses/Forbidden" },
        "429": { $ref: "#/components/responses/RateLimited" },
      };
      // Surface the scope a key needs, so a reader never has to guess.
      const scope = SCOPE_OVERRIDE[`${method} ${path}`] ?? SCOPE_OF[method];
      op.description = `${(op.description as string) ?? ""}\n\nRequires a key with the **${scope}** scope${scope === "ADMIN" ? "" : " (ADMIN satisfies every scope)"}.`.trim();
    }
  }

  (spec as Record<string, unknown>).tags = [
    { name: "People", description: "Directory of everyone in the organization." },
    { name: "Alignment", description: "KRAs, KPIs and the readings recorded against them." },
    { name: "Work", description: "Tasks. A task made here lands on its assignee's Personal list." },
    { name: "Culture", description: "Recognition and the kudos feed." },
    { name: "Knowledge", description: "SOPs." },
  ];

  return Response.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "Content-Type": "application/json",
    },
  });
}
