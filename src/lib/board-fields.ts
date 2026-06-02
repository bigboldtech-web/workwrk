// Board-fields helpers — CRUD against Board.schema.fields. The
// catalog vocabulary and types live in src/lib/field-catalog.ts; this
// file just persists and validates.

import { prisma } from "@/lib/prisma";
import {
  defaultOptionsFor,
  parseBoardSchema,
  slugifyFieldKey,
  type FieldDef,
  type FieldOptions,
  type FieldType,
} from "@/lib/field-catalog";

export async function getBoardFields(boardId: string): Promise<FieldDef[]> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { schema: true },
  });
  if (!board) return [];
  return parseBoardSchema(board.schema).fields;
}

export async function addBoardField(args: {
  boardId: string;
  label: string;
  type: FieldType;
  options?: FieldOptions;
}): Promise<FieldDef> {
  const trimmed = args.label.trim();
  if (!trimmed) throw new Error("Field label is required");

  const board = await prisma.board.findUnique({
    where: { id: args.boardId },
    select: { schema: true, organizationId: true },
  });
  if (!board) throw new Error("Board not found");

  const schema = parseBoardSchema(board.schema);
  const existingKeys = schema.fields.map((f) => f.key);
  const key = slugifyFieldKey(trimmed, existingKeys);

  const def: FieldDef = {
    key,
    label: trimmed,
    type: args.type,
    position: schema.fields.length,
    options: args.options ?? defaultOptionsFor(args.type),
  };
  schema.fields.push(def);

  await prisma.board.update({
    where: { id: args.boardId },
    data: { schema: schema as object },
  });
  return def;
}

export async function updateBoardField(
  boardId: string,
  key: string,
  patch: { label?: string; options?: FieldOptions; position?: number },
): Promise<FieldDef> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { schema: true },
  });
  if (!board) throw new Error("Board not found");
  const schema = parseBoardSchema(board.schema);
  const idx = schema.fields.findIndex((f) => f.key === key);
  if (idx < 0) throw new Error("Field not found");
  const current = schema.fields[idx];
  const next: FieldDef = {
    ...current,
    label: patch.label !== undefined ? patch.label.trim() || current.label : current.label,
    options: patch.options !== undefined ? patch.options : current.options,
    position: patch.position !== undefined ? patch.position : current.position,
  };
  schema.fields[idx] = next;
  await prisma.board.update({
    where: { id: boardId },
    data: { schema: schema as object },
  });
  return next;
}

export async function removeBoardField(boardId: string, key: string): Promise<void> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { schema: true },
  });
  if (!board) throw new Error("Board not found");
  const schema = parseBoardSchema(board.schema);
  schema.fields = schema.fields.filter((f) => f.key !== key);
  // Re-sequence positions so the field shelf doesn't end up with gaps.
  schema.fields.forEach((f, i) => (f.position = i));
  await prisma.board.update({
    where: { id: boardId },
    data: { schema: schema as object },
  });
}
