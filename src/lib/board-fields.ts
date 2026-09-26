// Board-fields helpers — CRUD against Board.schema.fields. The
// catalog vocabulary and types live in src/lib/field-catalog.ts; this
// file just persists and validates.
//
// Phase 5b: every schema WRITE runs through mutateBoardSchema, which reads
// the schema with SELECT ... FOR UPDATE and writes it in the same
// transaction. Two field edits used to read, change and write the whole
// schema independently, so the second silently erased the first; and a mirror
// column depends on a connect column on the same List, so "delete the
// connect field" and "add a mirror that reads it" must never interleave.

import { prisma } from "@/lib/prisma";
import {
  defaultOptionsFor,
  parseBoardSchema,
  slugifyFieldKey,
  type BoardSchema,
  type FieldDef,
  type FieldOptions,
  type FieldType,
} from "@/lib/field-catalog";

/** A refusal decided on the locked schema; the route answers it. */
export class SchemaRefusal extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error ?? "refused"));
  }
}

export async function getBoardFields(boardId: string): Promise<FieldDef[]> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { schema: true },
  });
  if (!board) return [];
  return parseBoardSchema(board.schema).fields;
}

/**
 * Change one List's schema on the locked row. `fn` receives a private copy
 * and answers the schema to write (or null to write nothing) and a result;
 * throwing a SchemaRefusal inside it rolls the transaction back.
 */
export async function mutateBoardSchema<T>(
  boardId: string,
  fn: (schema: BoardSchema) => Promise<{ schema: BoardSchema | null; result: T }> | { schema: BoardSchema | null; result: T },
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ schema: unknown }>>`SELECT schema FROM "Board" WHERE id = ${boardId} FOR UPDATE`;
      if (rows.length === 0) throw new Error("Board not found");
      const current = parseBoardSchema(rows[0].schema);
      const copy: BoardSchema = { ...current, fields: current.fields.map((f) => ({ ...f })) };
      const { schema, result } = await fn(copy);
      if (schema) await tx.board.update({ where: { id: boardId }, data: { schema: schema as object } });
      return result;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export async function addBoardField(args: {
  boardId: string;
  label: string;
  type: FieldType;
  options?: FieldOptions;
  /** Checks that need THIS List's locked schema (a mirror's connect field). */
  check?: (schema: BoardSchema) => void | Promise<void>;
  /** Options computed from the locked schema, replacing `options`. */
  optionsFor?: (schema: BoardSchema) => FieldOptions | undefined | Promise<FieldOptions | undefined>;
}): Promise<FieldDef> {
  const trimmed = args.label.trim();
  if (!trimmed) throw new Error("Field label is required");
  return mutateBoardSchema(args.boardId, async (schema) => {
    if (args.check) await args.check(schema);
    const existingKeys = schema.fields.map((f) => f.key);
    // Never a built-in's key either ("Owner" is owner_2, not the Assignee
    // column's "owner"): field-keys.ts. A rename keeps the key it was given.
    const key = slugifyFieldKey(trimmed, existingKeys);
    const options = args.optionsFor ? await args.optionsFor(schema) : args.options;
    const def: FieldDef = {
      key,
      label: trimmed,
      type: args.type,
      position: schema.fields.length,
      options: options ?? defaultOptionsFor(args.type),
    };
    schema.fields.push(def);
    return { schema, result: def };
  });
}

export async function updateBoardField(
  boardId: string,
  key: string,
  patch: { label?: string; options?: FieldOptions; position?: number },
  hooks: {
    /** Options computed from the stored field and the locked schema. */
    optionsFor?: (current: FieldDef, schema: BoardSchema) => FieldOptions | undefined | Promise<FieldOptions | undefined>;
  } = {},
): Promise<FieldDef> {
  return mutateBoardSchema(boardId, async (schema) => {
    const idx = schema.fields.findIndex((f) => f.key === key);
    if (idx < 0) throw new Error("Field not found");
    const current = schema.fields[idx];
    const options = hooks.optionsFor ? await hooks.optionsFor(current, schema) : patch.options;
    const next: FieldDef = {
      ...current,
      label: patch.label !== undefined ? patch.label.trim() || current.label : current.label,
      options: options !== undefined ? options : current.options,
      position: patch.position !== undefined ? patch.position : current.position,
    };
    schema.fields[idx] = next;
    return { schema, result: next };
  });
}

export async function removeBoardField(
  boardId: string,
  key: string,
  hooks: { check?: (schema: BoardSchema) => void | Promise<void> } = {},
): Promise<void> {
  await mutateBoardSchema(boardId, async (schema) => {
    if (hooks.check) await hooks.check(schema);
    schema.fields = schema.fields.filter((f) => f.key !== key);
    // Re-sequence positions so the field shelf doesn't end up with gaps.
    schema.fields.forEach((f, i) => (f.position = i));
    return { schema, result: undefined };
  });
}
