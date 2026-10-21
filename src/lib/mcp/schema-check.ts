// A tool's arguments checked against its own input schema before anything
// reads them (docs/plans/mcp-server.md 2.5 step 2).
//
// WHY. An MCP client is not bound to validate what its model writes, and a
// model steered by a planted line can send an object where a string belongs
// (the teammates' review round 1: such an object reached a Prisma where
// clause as a filter). So every call is checked here, after plainData has
// made every string plain: each field must have its declared type, within
// its bounds, and a field the schema does not declare is refused (the
// schemas say additionalProperties false). Null counts as absent.
//
// The schema language is the small subset the tools use: type (string,
// integer, number, boolean, array, object, or a list of them), properties,
// required, additionalProperties, minLength, maxLength, pattern, enum,
// minimum, maximum, items and maxItems. The problems name the field and what
// is wrong, in our words, never the value sent.
//
// Pure.

import { plainData } from "@/lib/agents/plain-data";
import { MCP_SCHEMA_COPY as C } from "./mcp-copy";

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  maxItems?: number;
}

export interface SchemaProblem {
  field: string;
  problem: string;
}

export type SchemaCheck = { ok: true; value: Record<string, unknown> } | { ok: false; problems: SchemaProblem[] };

/** Every string in the arguments through plainData, the order 2.5 names. */
export function plainArguments(value: unknown): unknown {
  if (typeof value === "string") return plainData(value);
  if (Array.isArray(value)) return value.map(plainArguments);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = plainArguments(v);
    return out;
  }
  return value;
}

/** The arguments object checked against the tool's schema; nulls dropped. */
export function schemaCheck(schema: JsonSchema, args: Record<string, unknown>): SchemaCheck {
  const problems: SchemaProblem[] = [];
  const value = checkObject(schema, args, "", problems);
  return problems.length ? { ok: false, problems: problems.slice(0, 20) } : { ok: true, value };
}

function name(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function checkObject(schema: JsonSchema, obj: Record<string, unknown>, path: string, problems: SchemaProblem[]): Record<string, unknown> {
  const props = schema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj)) {
    if (raw === null || raw === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(props, key)) {
      if (schema.additionalProperties === false) problems.push({ field: name(path, key), problem: C.notAllowed });
      continue;
    }
    const v = checkValue(props[key], raw, name(path, key), problems);
    if (v !== undefined) out[key] = v;
  }
  for (const key of schema.required ?? []) {
    if (obj[key] === null || obj[key] === undefined) problems.push({ field: name(path, key), problem: C.required });
  }
  return out;
}

function typesOf(s: JsonSchema): string[] {
  return Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
}

function checkValue(s: JsonSchema, v: unknown, field: string, problems: SchemaProblem[]): unknown {
  const types = typesOf(s);
  const fits = (t: string): boolean => {
    switch (t) {
      case "string":
        return typeof v === "string";
      case "integer":
        return typeof v === "number" && Number.isInteger(v);
      case "number":
        return typeof v === "number" && Number.isFinite(v);
      case "boolean":
        return typeof v === "boolean";
      case "array":
        return Array.isArray(v);
      case "object":
        return typeof v === "object" && v !== null && !Array.isArray(v);
      case "null":
        return v === null;
      default:
        return false;
    }
  };
  const t = types.find(fits) ?? (types.length === 0 && (typeof v === "string" || typeof v === "number" || typeof v === "boolean") ? typeof v : null);
  if (!t) {
    const want = types[0];
    problems.push({
      field,
      problem:
        want === "string"
          ? C.notText
          : want === "integer"
            ? C.notWhole
            : want === "number"
              ? C.notNumber
              : want === "boolean"
                ? C.notFlag
                : want === "array"
                  ? C.notList
                  : C.notObject,
    });
    return undefined;
  }
  if (s.enum && !s.enum.includes(v as string | number | boolean)) {
    problems.push({ field, problem: C.oneOf(s.enum.map((e) => String(e)).join(", ")) });
    return undefined;
  }
  if (typeof v === "string") {
    if (typeof s.minLength === "number" && v.length < s.minLength) problems.push({ field, problem: C.tooShort(s.minLength) });
    else if (typeof s.maxLength === "number" && v.length > s.maxLength) problems.push({ field, problem: C.tooLong(s.maxLength) });
    else if (s.pattern && !new RegExp(s.pattern, "u").test(v)) problems.push({ field, problem: C.pattern });
    return v;
  }
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) problems.push({ field, problem: C.below(s.minimum) });
    else if (typeof s.maximum === "number" && v > s.maximum) problems.push({ field, problem: C.above(s.maximum) });
    return v;
  }
  if (Array.isArray(v)) {
    if (typeof s.maxItems === "number" && v.length > s.maxItems) {
      problems.push({ field, problem: C.tooMany(s.maxItems) });
      return undefined;
    }
    if (!s.items) return v;
    const out: unknown[] = [];
    v.forEach((x, i) => {
      if (x === null || x === undefined) {
        problems.push({ field: `${field}[${i}]`, problem: C.required });
        return;
      }
      const checked = checkValue(s.items!, x, `${field}[${i}]`, problems);
      if (checked !== undefined) out.push(checked);
    });
    return out;
  }
  if (t === "object") return checkObject(s, v as Record<string, unknown>, field, problems);
  return v;
}
