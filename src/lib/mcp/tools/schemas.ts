// The shared schema pieces (docs/plans/mcp-server.md 4.2). Inlined into
// every schema that uses them: no $ref, which several clients do not
// follow. Each builder returns a fresh object. Pure.

import { MCP_FIELD_COPY as F } from "../mcp-copy";
import type { JsonSchema } from "../schema-check";

export const ID = (description?: string): JsonSchema => ({ type: "string", minLength: 1, maxLength: 64, ...(description ? { description } : {}) });
export const DAY = (): JsonSchema => ({ type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", description: F.day });
export const DAY_OR_NONE = (): JsonSchema => ({ type: "string", pattern: "^([0-9]{4}-[0-9]{2}-[0-9]{2}|none)$", description: F.dayOrNone });
export const EMAIL = (): JsonSchema => ({ type: "string", minLength: 3, maxLength: 254, description: F.email });
export const CURSOR = (): JsonSchema => ({ type: "string", minLength: 1, maxLength: 500, description: F.cursor });
export const PRIORITY = (): JsonSchema => ({ type: "string", enum: ["URGENT", "HIGH", "NORMAL", "LOW"] });
export const LIMIT = (max: number, def: number): JsonSchema => ({ type: "integer", minimum: 1, maximum: max, description: F.limit(def) });
export const TEXT = (max: number, description?: string): JsonSchema => ({ type: "string", maxLength: max, ...(description ? { description } : {}) });

export const STR = (): JsonSchema => ({ type: "string" });
export const STR_OR_NULL = (): JsonSchema => ({ type: ["string", "null"] });
export const BOOL = (): JsonSchema => ({ type: "boolean" });
export const INT = (): JsonSchema => ({ type: "integer" });

export const PERSON = (): JsonSchema => ({
  type: "object",
  properties: { id: STR(), name: STR() },
  required: ["id", "name"],
});

export const PERSON_OR_NULL = (): JsonSchema => ({
  type: ["object", "null"],
  properties: { id: STR(), name: STR() },
  required: ["id", "name"],
});

export const NAMED_OR_NULL = (): JsonSchema => ({
  type: ["object", "null"],
  properties: { id: STR(), name: STR() },
  required: ["id", "name"],
});

/** The task row every task tool answers with (4.2 TASK). */
export const TASK = (): JsonSchema => ({
  type: "object",
  properties: {
    id: STR(),
    title: STR(),
    status: STR_OR_NULL(),
    done: BOOL(),
    priority: STR_OR_NULL(),
    dueDate: STR_OR_NULL(),
    startDate: STR_OR_NULL(),
    list: { type: "object", properties: { id: STR(), name: STR(), personal: BOOL() }, required: ["id", "name", "personal"] },
    owner: PERSON_OR_NULL(),
    assignees: { type: "array", items: PERSON() },
    parentTaskId: STR_OR_NULL(),
    url: STR(),
  },
  required: ["id", "title", "status", "done", "priority", "dueDate", "startDate", "list", "owner", "assignees", "parentTaskId", "url"],
});

/** An input schema: an object of these fields and no others. */
export function input(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema & { type: "object" } {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** An output schema: an object whose fields are all required. */
export function output(properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema & { type: "object" } {
  return { type: "object", properties, required: Object.keys(properties).filter((k) => !optional.includes(k)) };
}
