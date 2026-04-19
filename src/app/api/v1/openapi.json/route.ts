/**
 * GET /api/v1/openapi.json
 * Returns the OpenAPI 3.1 spec for the WorkwrK public API so devs can
 * drop it into Postman, Insomnia, Stoplight, Redoc, etc.
 */

export async function GET(req: Request) {
  const base =
    new URL(req.url).origin.replace(/\/$/, "") ||
    process.env.NEXTAUTH_URL ||
    "https://workwrk.com";

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

  return Response.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "Content-Type": "application/json",
    },
  });
}
