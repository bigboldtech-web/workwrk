/**
 * GET /api/v1/openapi.json
 * Returns the OpenAPI 3.1 spec for the WorkwrK public API so devs can
 * drop it into Postman, Insomnia, Stoplight, Redoc, etc.
 */

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
        "WorkwrK public REST API — programmatic access to the operating-system spine. " +
        "Authenticate with `Authorization: Bearer wk_live_...`. Rate limits are enforced per key.",
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
            status: {
              type: "string",
              enum: ["ACTIVE", "INACTIVE", "ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"],
            },
            accessLevel: { type: "string" },
            avatar: { type: "string", nullable: true },
            joinDate: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            role: {
              type: "object",
              nullable: true,
              properties: { id: { type: "string" }, title: { type: "string" } },
            },
            department: {
              type: "object",
              nullable: true,
              properties: { id: { type: "string" }, name: { type: "string" } },
            },
          },
        },
        PersonList: {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: "#/components/schemas/Person" } },
            nextCursor: { type: "string", nullable: true },
          },
        },
        KRA: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string", nullable: true },
            category: { type: "string", nullable: true },
            roleId: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        KPI: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string", nullable: true },
            targetValue: { type: "number" },
            unit: { type: "string" },
            frequency: { type: "string" },
            weight: { type: "number" },
            kraId: { type: "string" },
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
            actualValue: { type: "number" },
            score: { type: "number" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Kudos: {
          type: "object",
          properties: {
            id: { type: "string" },
            message: { type: "string" },
            companyValue: { type: "string", nullable: true },
            giverId: { type: "string" },
            receiverId: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Task: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            date: { type: "string", format: "date-time" },
            status: { type: "string", enum: ["PLANNED", "IN_PROGRESS", "COMPLETED"] },
            priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
            slaHours: { type: "integer", nullable: true },
            source: { type: "string", enum: ["MANUAL", "SOP", "REVIEW", "OKR", "AI"] },
            sourceRef: { type: "string", nullable: true },
            assigneeId: { type: "string" },
            escalatedAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        SOP: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            category: { type: "string", nullable: true },
            sopType: { type: "string", enum: ["WRITTEN", "RECORDED", "CHECKLIST"] },
            version: { type: "integer" },
            status: { type: "string" },
            publishedAt: { type: "string", format: "date-time", nullable: true },
          },
        },
      },
    },
    paths: {
      "/people": {
        get: {
          summary: "List people",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email" },
                    firstName: { type: "string" },
                    lastName: { type: "string" },
                    accessLevel: { type: "string" },
                    roleId: { type: "string" },
                    departmentId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Invitation created" } },
        },
      },
      "/kras": {
        get: { summary: "List KRAs", responses: { "200": { description: "OK" } } },
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
          responses: { "201": { description: "Created" } },
        },
      },
      "/kpis": {
        get: { summary: "List KPIs", responses: { "200": { description: "OK" } } },
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
                    unit: { type: "string", default: "#" },
                    frequency: { type: "string", default: "monthly" },
                    weight: { type: "number", default: 1 },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
      "/kpi-records": {
        get: { summary: "List KPI readings", responses: { "200": { description: "OK" } } },
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
          responses: { "201": { description: "Recorded" } },
        },
      },
      "/kudos": {
        get: { summary: "Feed", responses: { "200": { description: "OK" } } },
        post: {
          summary: "Send kudos",
          description: "Fires Slack notification + `kudos.created` webhook.",
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
          responses: { "201": { description: "Created" } },
        },
      },
      "/tasks": {
        get: { summary: "List tasks", responses: { "200": { description: "OK" } } },
        post: {
          summary: "Create a task (optionally SLA-tracked)",
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
                    date: { type: "string", format: "date-time" },
                    assigneeId: { type: "string" },
                    kraId: { type: "string" },
                    slaHours: { type: "integer", description: "If set, task auto-escalates when breached" },
                    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
                    source: { type: "string", enum: ["MANUAL", "SOP", "REVIEW", "OKR", "AI"] },
                    sourceRef: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
      "/sops": {
        get: { summary: "List published SOPs", responses: { "200": { description: "OK" } } },
      },
    },
    "x-events": [
      { name: "kudos.created", description: "Fired on every new kudos posted." },
      { name: "kpi.recorded", description: "Fired when a KPI reading is logged." },
      { name: "task.created", description: "Fired on every task creation." },
      { name: "task.escalated", description: "Fired when an SLA-tracked task breaches and escalates." },
      { name: "review.created" },
      { name: "review.completed" },
      { name: "sop.published" },
      { name: "sop.updated" },
      { name: "okr.created" },
      { name: "okr.updated" },
    ],
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
  const errRef = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  });

  (spec.components as Record<string, unknown>).responses = {
    Unauthorized: errRef("Missing, malformed, revoked or unknown API key."),
    Forbidden: errRef("The key is valid but lacks the scope this endpoint requires."),
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
      op.description = `${(op.description as string) ?? ""}\n\nRequires a key with the **${SCOPE_OF[method]}** scope (ADMIN satisfies every scope).`.trim();
    }
  }

  (spec as Record<string, unknown>).tags = [
    { name: "People", description: "Directory of everyone in the organization." },
    { name: "Alignment", description: "KRAs, KPIs and the readings recorded against them." },
    { name: "Work", description: "Tasks, including SLA-tracked work." },
    { name: "Culture", description: "Recognition and the kudos feed." },
    { name: "Knowledge", description: "Published SOPs." },
  ];

  return Response.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "Content-Type": "application/json",
    },
  });
}
