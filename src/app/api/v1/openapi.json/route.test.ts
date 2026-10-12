// The public API's OpenAPI document, held to the routes it describes. The
// docs site renders it, so every enum is the routes' own list and no served
// string carries an em dash or a double hyphen. It is OpenAPI 3.1, so a value
// that may be null says so in 3.1's form (a type array with "null"; an enum
// lists null), never with 3.0's `nullable`, which 3.1 ignores.

import { describe, expect, it } from "vitest";
import { Frequency, SOPStatus, SOPType, TaskSource, UserStatus } from "@/generated/prisma";
import { DEFAULT_STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import { WEBHOOK_EVENT_NAMES } from "@/lib/webhook-events";
import { GET } from "./route";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function served(): Promise<Json> {
  const res = await GET(new Request("https://app.workwrk.com/api/v1/openapi.json"));
  return (await res.json()) as Json;
}

/** Every string in the served document, keys included, with where it sits. */
function strings(v: unknown, at = "$", out: Array<{ at: string; s: string }> = []): Array<{ at: string; s: string }> {
  if (typeof v === "string") out.push({ at, s: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${at}[${i}]`, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push({ at: `${at}.${k} (key)`, s: k });
      strings(x, `${at}.${k}`, out);
    }
  }
  return out;
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("the OpenAPI document's task status", () => {
  it("is a List's own status, not the retired Task table's enum", async () => {
    const doc = await served();
    const status = doc.components.schemas.Task.properties.status;
    // Item.status is a per-List value (Board.statuses), so no fixed enum is true.
    expect(status.enum).toBeUndefined();
    expect(status.type).toEqual(["string", "null"]);
    expect(status.examples).toEqual(DEFAULT_STATUS_OPTIONS.map((s) => s.value));
    expect(JSON.stringify(doc)).not.toMatch(/"PLANNED"|"COMPLETED"/);
  });

  it("filters on the same values the list returns", async () => {
    const doc = await served();
    const param = doc.paths["/tasks"].get.parameters.find((p: Json) => p.name === "status");
    expect(param.schema.enum).toBeUndefined();
    expect(param.schema.examples).toEqual(DEFAULT_STATUS_OPTIONS.map((s) => s.value));
  });
});

describe("every other enum is the routes' own list", () => {
  it("task priority is the List priority set, and may be null", async () => {
    const doc = await served();
    const values = PRIORITY_OPTIONS.map((p) => p.value);
    // May be null, so null is one of its values (3.1).
    expect(doc.components.schemas.Task.properties.priority.enum).toEqual([...values, null]);
    expect(doc.components.schemas.Task.properties.priority.type).toEqual(["string", "null"]);
    expect(sorted(doc.paths["/tasks"].post.requestBody.content["application/json"].schema.properties.priority.enum)).toEqual(sorted(values));
  });

  it("task source, person status, KPI frequency, SOP type and SOP status are the Prisma enums", async () => {
    const doc = await served();
    const s = doc.components.schemas;
    expect(s.Task.properties.source.enum).toEqual(Object.values(TaskSource));
    expect(s.Person.properties.status.enum).toEqual(Object.values(UserStatus));
    expect(s.KPI.properties.frequency.enum).toEqual(Object.values(Frequency));
    expect(s.SOP.properties.sopType.enum).toEqual(Object.values(SOPType));
    expect(s.SOP.properties.status.enum).toEqual(Object.values(SOPStatus));
  });

  it("documents a KPI as the route stores it: no weight, no unit default, frequency in capitals", async () => {
    const doc = await served();
    const body = doc.paths["/kpis"].post.requestBody.content["application/json"].schema.properties;
    expect(doc.components.schemas.KPI.properties.weight).toBeUndefined();
    expect(body.weight).toBeUndefined();
    expect(body.unit.default).toBeUndefined();
    expect(body.frequency.default).toBe("MONTHLY");
    expect(doc.components.schemas.KPI.properties.unit.type).toEqual(["string", "null"]);
    expect(doc.components.schemas.KPI.properties.targetValue.type).toEqual(["number", "null"]);
  });

  it("marks the task fields the list can return empty", async () => {
    const t = (await served()).components.schemas.Task.properties;
    expect(t.date.type).toEqual(["string", "null"]);
    expect(t.assigneeId.type).toEqual(["string", "null"]);
    expect(t.createdAt).toBeDefined();
  });

  it("promises no SLA escalation, which nothing runs any more", async () => {
    const doc = await served();
    expect(doc.paths["/tasks"].post.summary).not.toMatch(/SLA/);
    expect(doc.paths["/tasks"].post.requestBody.content["application/json"].schema.properties.slaHours.description).not.toMatch(/auto-escalat/i);
    expect(doc["x-events"].map((e: Json) => e.name)).toEqual([...WEBHOOK_EVENT_NAMES]);
  });

  it("lists every field the list routes return", async () => {
    const s = (await served()).components.schemas;
    expect(s.Person.properties.manager).toBeDefined();
    expect(s.Kudos.properties.giver).toBeDefined();
    expect(s.Kudos.properties.receiver).toBeDefined();
    expect(Object.keys(s.SOP.properties)).toEqual(expect.arrayContaining(["description", "subcategory", "kraId", "createdAt", "updatedAt"]));
  });
});

// Docs-found fixes batch 2.
describe("OpenAPI 3.1's null, and the gaps round 1 left", () => {
  /** Every object in the document, with where it sits. */
  function objects(v: unknown, at = "$", out: Array<{ at: string; o: Json }> = []): Array<{ at: string; o: Json }> {
    if (Array.isArray(v)) v.forEach((x, i) => objects(x, `${at}[${i}]`, out));
    else if (v && typeof v === "object") {
      out.push({ at, o: v as Json });
      for (const [k, x] of Object.entries(v)) objects(x, `${at}.${k}`, out);
    }
    return out;
  }

  it("never uses nullable, and every value that may be null puts null in its type", async () => {
    const doc = await served();
    expect(objects(doc).filter(({ o }) => "nullable" in o).map(({ at }) => at)).toEqual([]);
    // An enum that may be null lists null; one that may not, never does.
    for (const { at, o } of objects(doc)) {
      if (!Array.isArray(o.enum)) continue;
      const mayBeNull = Array.isArray(o.type) && o.type.includes("null");
      expect(o.enum.includes(null), at).toBe(mayBeNull);
    }
    const s = doc.components.schemas;
    expect(s.Person.properties.manager.type).toEqual(["object", "null"]);
    expect(s.Task.properties.status.type).toEqual(["string", "null"]);
    expect(s.SOP.properties.publishedAt).toMatchObject({ type: ["string", "null"], format: "date-time" });
    expect(s.PersonList.properties.nextCursor.type).toEqual(["string", "null"]);
  });

  it("documents the SOP list's counts", async () => {
    const sop = (await served()).components.schemas.SOP.properties;
    expect(sop._count.properties).toEqual({ compliance: { type: "integer" }, assignments: { type: "integer" } });
  });

  it("documents what POST /people answers, and that it keeps the names", async () => {
    const doc = await served();
    const post = doc.paths["/people"].post;
    expect(post.responses["201"].content["application/json"].schema).toEqual({ $ref: "#/components/schemas/Invitation" });
    expect(Object.keys(doc.components.schemas.Invitation.properties.invitation.properties)).toEqual(["id", "email", "token", "expiresAt", "acceptUrl"]);
    expect(post.responses["409"]).toBeDefined();
    const body = post.requestBody.content["application/json"].schema.properties;
    expect(body.firstName.description).toMatch(/^Kept on the invitation/);
    expect(body.lastName.description).not.toMatch(/not stored/);
  });

  it("documents the 404s of POST /kpis and POST /kpi-records, and the 400 of POST /tasks", async () => {
    const p = (await served()).paths;
    expect(p["/kpis"].post.responses["404"].description).toBe("The KRA is not in this workspace");
    expect(p["/kpi-records"].post.responses["404"].description).toBe("The KPI, or the person, is not in this workspace");
    expect(p["/tasks"].post.responses["400"].description).toMatch(/priority or source is not one of the listed values/);
  });

  it("says exactly which task creations fire task.created", async () => {
    const created = (await served())["x-events"].find((e: Json) => e.name === "task.created");
    expect(created.description).toMatch(/added to a List in the app/);
    expect(created.description).toMatch(/Not fired for .*template.*repeating task.*SOP/);
    expect(created.description).not.toMatch(/every task/i);
  });
});

describe("served strings", () => {
  it("hold no em dash and no double hyphen", async () => {
    const bad = strings(await served()).filter(({ s }) => /\u2014|-{2}/.test(s));
    expect(bad).toEqual([]);
  });
});

// Docs-found fixes batch 3.
describe("KPI readings", () => {
  it("gives a month, YYYY-MM, as the period everywhere, and says what other keys do", async () => {
    const doc = await served();
    const periods = [
      doc.components.schemas.KPIRecord.properties.period,
      doc.paths["/kpi-records"].get.parameters.find((p: Json) => p.name === "period").schema,
      doc.paths["/kpi-records"].post.requestBody.content["application/json"].schema.properties.period,
    ];
    for (const p of periods) expect(p.example).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    expect(JSON.stringify(doc)).not.toContain('"example":"2026-Q1"');
    const body = doc.paths["/kpi-records"].post.requestBody.content["application/json"].schema.properties.period;
    expect(body.pattern).toBe("^\\d{4}-(0[1-9]|1[0-2])$");
    expect(body.description).toMatch(/Goals read only month keys, so any other key is refused with a 400/);
    expect(doc.paths["/kpi-records"].get.parameters.find((p: Json) => p.name === "period").description).toMatch(/drive no goal/);
  });

  it("documents a second reading: 200 the same or replaced, 409 with the id for a closed month", async () => {
    const post = (await served()).paths["/kpi-records"].post;
    expect(Object.keys(post.responses)).toEqual(expect.arrayContaining(["200", "201", "400", "404", "409"]));
    expect(post.description).toMatch(/one reading per KPI, person and month/);
    expect(post.description).toMatch(/goes back to Pending/);
    expect(post.responses["409"].content["application/json"].schema.properties.code.enum).toEqual(["kpi_month_closed"]);
    expect(post.responses["400"].description).toMatch(/not a month written YYYY-MM/);
  });

  // Docs-found fixes batch 4: a resend compares only what the caller sent,
  // and an empty reading is filled in any month.
  it("says what a resend is compared with, and that an empty reading is filled in any month", async () => {
    const post = (await served()).paths["/kpi-records"].post;
    expect(post.description).toMatch(/only what you send is compared, the number and, when you send one, targetValue/);
    expect(post.description).toMatch(/no number yet .* is filled in any month/);
    expect(post.responses["409"].description).toMatch(/a different target from the targetValue you sent/);
  });
});

describe("the 400s, 403s and their bodies", () => {
  it("documents the new 400s", async () => {
    const p = (await served()).paths;
    expect(p["/tasks"].post.responses["400"].description).toMatch(/date is not a date and time, or slaHours is not a number/);
    expect(p["/tasks"].get.responses["400"].description).toMatch(/from or to/);
    expect(p["/kpis"].post.responses["400"].description).toMatch(/frequency is not one of the listed values/);
    expect(p["/sops"].get.responses["400"].description).toMatch(/status or sopType/);
    expect(p["/tasks"].post.requestBody.content["application/json"].schema.properties.slaHours.type).toBe("number");
  });

  it("lists seat_limit on POST /people's 403, and the suspended workspace on every other", async () => {
    const doc = await served();
    const people = doc.paths["/people"].post.responses["403"];
    expect(people.description).toMatch(/`code` is `seat_limit`/);
    expect(people.content["application/json"].schema.properties.code.enum).toEqual(["seat_limit"]);
    expect(doc.paths["/kudos"].post.responses["403"]).toEqual({ $ref: "#/components/responses/Forbidden" });
    expect(doc.components.responses.Forbidden.description).toMatch(/suspended or cancelled/);
  });

  it("gives every 4xx answer the Error body", async () => {
    const doc = await served();
    for (const [path, ops] of Object.entries(doc.paths as Json)) {
      for (const [method, op] of Object.entries(ops as Json)) {
        for (const [code, res] of Object.entries((op as Json).responses as Json)) {
          if (!/^4/.test(code)) continue;
          const r = res as Json;
          expect(r.$ref ?? r.content?.["application/json"]?.schema, `${method} ${path} ${code}`).toBeDefined();
        }
      }
    }
  });
});

describe("webhooks", () => {
  it("says the field and status events fire from AI teammate edits too, and the field cap", async () => {
    const events = (await served())["x-events"] as Json[];
    for (const name of ["task.status_changed", "task.assignee_changed", "task.field_changed"]) {
      expect(events.find((e) => e.name === name)!.description).toMatch(/by an AI teammate/);
    }
    expect(events.find((e) => e.name === "task.field_changed")!.description).toMatch(/at most 20 fields/);
  });

  it("says exactly how to verify a delivery, and what an older subscription signs with", async () => {
    const doc = await served();
    expect(doc.info.description).toMatch(/HMAC-SHA256 with the subscription's secret .* as the key over <timestamp>\.<raw request body>/);
    expect(doc["x-webhook-signature"]).toMatchObject({ header: "X-Workwrk-Signature", format: "t=<timestamp>,v1=<signature>", signedPayload: "<timestamp>.<raw request body>" });
    expect(doc["x-webhook-signature"].olderSubscriptions).toMatch(/legacy_hash.*SHA-256 of its secret.*Rotating its secret/);
  });

  // Docs-found fixes batch 4: a delivery whose secret can't be opened is held, never failed for it.
  it("says what an unreadable subscription's deliveries do", async () => {
    const doc = await served();
    expect(doc["x-webhook-signature"].unreadableSubscriptions).toMatch(/`signing` is unreadable .* held, not lost, and tried again every 15 minutes/);
  });
});
