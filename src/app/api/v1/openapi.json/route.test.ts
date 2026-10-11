// The public API's OpenAPI document, held to the routes it describes. The
// docs site renders it, so every enum is the routes' own list and no served
// string carries an em dash or a double hyphen.

import { describe, expect, it } from "vitest";
import { Frequency, SOPStatus, SOPType, TaskSource, UserStatus } from "@/generated/prisma";
import { DEFAULT_STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/lib/board-items-shared";
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
    expect(status.type).toBe("string");
    expect(status.nullable).toBe(true);
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
    expect(sorted(doc.components.schemas.Task.properties.priority.enum)).toEqual(sorted(values));
    expect(doc.components.schemas.Task.properties.priority.nullable).toBe(true);
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
    expect(doc.components.schemas.KPI.properties.unit.nullable).toBe(true);
    expect(doc.components.schemas.KPI.properties.targetValue.nullable).toBe(true);
  });

  it("marks the task fields the list can return empty", async () => {
    const t = (await served()).components.schemas.Task.properties;
    expect(t.date.nullable).toBe(true);
    expect(t.assigneeId.nullable).toBe(true);
    expect(t.createdAt).toBeDefined();
  });

  it("promises no SLA escalation, which nothing runs any more", async () => {
    const doc = await served();
    expect(doc.paths["/tasks"].post.summary).not.toMatch(/SLA/);
    expect(doc.paths["/tasks"].post.requestBody.content["application/json"].schema.properties.slaHours.description).not.toMatch(/auto-escalat/i);
    expect(doc["x-events"].map((e: Json) => e.name)).toEqual(["kudos.created", "kpi.recorded", "task.created"]);
  });

  it("lists every field the list routes return", async () => {
    const s = (await served()).components.schemas;
    expect(s.Person.properties.manager).toBeDefined();
    expect(s.Kudos.properties.giver).toBeDefined();
    expect(s.Kudos.properties.receiver).toBeDefined();
    expect(Object.keys(s.SOP.properties)).toEqual(expect.arrayContaining(["description", "subcategory", "kraId", "createdAt", "updatedAt"]));
  });
});

describe("served strings", () => {
  it("hold no em dash and no double hyphen", async () => {
    const bad = strings(await served()).filter(({ s }) => /\u2014|-{2}/.test(s));
    expect(bad).toEqual([]);
  });
});
