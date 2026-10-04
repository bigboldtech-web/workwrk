// Fill with AI, for one AI field on one task (Batch 8, competitor-gap 18).
// The rules are in src/lib/ai-fields.ts; this is the order they run in, and
// the order is the safety argument:
//
//   1. WHO. The caller can edit the task (gateItem "edit"). In a List the
//      task is linked into, the value is that List's, so the caller must also
//      be able to write that List (canContributeBoard), as every link-side
//      write does. The route has already answered the `ai` app (Guests, a
//      hidden app, AI turned off) and the workspace's opt-in.
//   2. WHAT. The key is an AI field of THAT List, and set up (Categorize has
//      its categories, Translation its language).
//   3. REACH. The facts are only what every reader of the stored value sees,
//      read from that List's own place on the task (factsForFill).
//   4. COST. One use claimed against the workspace's daily cap; a provider
//      failure gives it back.
//   5. The model call, outside any transaction and any metadata function
//      (updateBoardItem re-runs that function on a conflict).
//   6. ONE write of that one key, as the caller, through updateBoardItem's
//      compare-and-swap, so nothing anyone wrote in the meantime is lost; the
//      activity row says the value came from AI.
//
// Server-only.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateBoardItem } from "@/lib/board-items";
import { getBoardStatuses, makeStatusLookup, PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import { parseBoardSchema } from "@/lib/field-catalog";
import { gateItem, type ItemCtx } from "@/lib/item-gate";
import { linkedContextFor } from "@/lib/item-context";
import { canContributeFor } from "@/lib/list-links-server";
import { BOARD_ITEM_ENTITY_TYPE } from "@/lib/item-thread";
import { htmlToText } from "@/lib/html-text";
import { applyMetadataPatch, readNamespace, type Json } from "@/lib/list-metadata";
import { publishItemChanged } from "@/lib/notify-realtime";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { fieldChanges } from "@/lib/automation/field-changes";
import { createMessageWithFallback, getAnthropicForOrg, isAiConfigured, modelFor } from "@/lib/ai-client";
import { aiFieldsOn } from "@/lib/ai/ai-features";
import { claimAiUse, releaseAiUse } from "@/lib/ai-usage";
import {
  aiFieldConfig,
  aiFieldNotReady,
  aiFillsPerDay,
  buildFillRequest,
  factsForFill,
  isAiFieldType,
  parseFillAnswer,
  translationSourceText,
  type AiFieldValue,
} from "@/lib/ai-fields";

/** The model a fill asks, unless the workspace's own key names another. */
export const FILL_MODEL = "claude-haiku-4-5";
/** A fill that has not answered in this long is given up. */
const FILL_TIMEOUT_MS = 45_000;

function asObject(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

/** JSON with object keys sorted, so two reads of one value compare equal. */
function stable(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
    }
    return x ?? null;
  };
  return JSON.stringify(norm(v));
}

/** Nothing stored at all: the only value a fill may take the place of unasked. */
function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** Thrown inside the write when the stored value is not the one the fill was for: nothing is written. */
class KeptValue extends Error {
  constructor(readonly why: "has_value" | "changed") {
    super(why);
  }
}

function refuse(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Whether the workspace has turned AI fields on (and AI is on). */
export async function orgAiFieldsState(organizationId: string): Promise<{ on: boolean; plan: string | null }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true, plan: true } });
  return { on: aiFieldsOn(org?.settings), plan: org ? String(org.plan) : null };
}

export async function fillAiField(args: {
  itemId: string;
  c: ItemCtx;
  fieldKey: string;
  contextBoardId: string | null;
  /** Fill empty rows: never replace a value that is there (or lands meanwhile). */
  onlyIfEmpty: boolean;
  /**
   * The value the person is looking at (null for an empty cell). A fill
   * replaces exactly that value: if the stored one is different, before the
   * model is asked or when the answer is written, nothing is written. Absent
   * (an API caller): no such check.
   */
  expect: { value: unknown } | null;
  plan: string | null;
}): Promise<NextResponse> {
  const { c } = args;

  // ── 1. Who ───────────────────────────────────────────────────────
  const gate = await gateItem(args.itemId, c, "edit");
  if ("error" in gate) return gate.error;
  const asked = await linkedContextFor(gate, args.contextBoardId, c);
  if (asked === "invalid") return refuse(400, { error: "invalid_context" });
  const linked = typeof asked === "object" ? asked : null;
  if (linked && !(await canContributeFor(c, linked.list.id))) {
    return refuse(403, { error: "no_access", reason: "list_read_only", requestAccess: true });
  }

  // ── 2. What ──────────────────────────────────────────────────────
  const fields = parseBoardSchema(linked ? linked.list.schema : gate.item.board.schema).fields;
  const field = fields.find((f) => f.key === args.fieldKey);
  if (!field || !isAiFieldType(field.type)) return refuse(404, { error: "unknown_field" });
  const config = aiFieldConfig(field)!;
  const notReady = aiFieldNotReady(config);
  if (notReady) return refuse(409, { error: "needs_setup", reason: notReady });

  const stored = asObject(gate.item.metadata);
  const listId = linked ? linked.list.id : null;
  const placeOf = (blob: Json): Json => (listId ? readNamespace(blob, listId) : blob);
  // Any stored value counts, an older non-AI one included: Fill empty rows
  // takes only the place of nothing.
  const holds = (blob: Json): unknown => placeOf(blob)[field.key];
  if (args.onlyIfEmpty && !isEmptyValue(holds(stored))) {
    return NextResponse.json({ skipped: "has_value" }, { headers: { "Cache-Control": "no-store" } });
  }
  const unexpected = (blob: Json): boolean => !!args.expect && stable(holds(blob) ?? null) !== stable(args.expect.value ?? null);
  if (unexpected(stored)) return refuse(409, { error: "changed" });

  // ── 3. Reach: what every reader of this List's value already sees ──
  const description = htmlToText(stored.description);
  let sourceText = "";
  if (config.type === "TRANSLATION") {
    sourceText = translationSourceText(config, { title: gate.item.title, description });
    if (!sourceText) return refuse(422, { error: "nothing_to_translate", from: config.translateFrom });
  }
  const comments = config.type !== "TRANSLATION" && config.inputs.comments
    ? await prisma.itemUpdate.findMany({
        where: { organizationId: c.organizationId, entityType: BOARD_ITEM_ENTITY_TYPE, entityId: gate.item.id, archivedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: { body: true },
      })
    : [];
  const status = gate.item.status ? makeStatusLookup(getBoardStatuses(gate.item.board))[gate.item.status]?.label ?? gate.item.status : null;
  const priority = gate.item.priority ? PRIORITY_OPTIONS.find((p) => p.value === gate.item.priority)?.label ?? null : null;
  const place = placeOf(stored);
  const facts = factsForFill(config, {
    title: gate.item.title,
    status,
    priority,
    dueAt: gate.item.dueAt,
    description,
    commentsNewestFirst: comments.map((u) => htmlToText(u.body)),
    fields: fields.map((f) => ({ field: f, value: place[f.key] })),
    selfKey: field.key,
  });

  // ── 4. Cost ──────────────────────────────────────────────────────
  if (!(await isAiConfigured(c.organizationId))) return refuse(503, { error: "ai_not_configured" });
  const cap = aiFillsPerDay(args.plan);
  const claim = await claimAiUse(c.organizationId, "field_fill", cap);
  if (claim === "limit") return refuse(429, { error: "ai_daily_limit", limit: cap });
  if (claim === "not_ready") return refuse(503, { error: "not_ready" });

  // ── 5. The model ─────────────────────────────────────────────────
  const request = buildFillRequest(config, facts, sourceText);
  let answer = "";
  try {
    const ai = await getAnthropicForOrg(c.organizationId);
    const msg = await createMessageWithFallback(
      ai.client,
      {
        model: modelFor(ai, FILL_MODEL),
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
      },
      { timeout: FILL_TIMEOUT_MS, maxRetries: 1 },
    );
    answer = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    // An answer cut off at the token limit is never stored as if whole.
    if (msg.stop_reason === "max_tokens") return refuse(502, { error: config.type === "TRANSLATION" ? "too_long" : "ai_unusable" });
  } catch (err) {
    await releaseAiUse(c.organizationId, "field_fill");
    console.error(`[ai-fill] ${gate.item.id}/${field.key}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    return refuse(502, { error: "ai_failed" });
  }
  const parsed = parseFillAnswer(config, answer);
  if (!parsed) return refuse(502, { error: "ai_unusable" });

  // ── 6. One write of one key ──────────────────────────────────────
  const value: AiFieldValue = { ...parsed, source: "ai", at: new Date().toISOString(), by: c.userId };
  let updated: Awaited<ReturnType<typeof updateBoardItem>>;
  try {
    updated = await updateBoardItem(gate.item.id, {}, c.userId, {
      metadataFn: (now) => {
        // Re-checked on the row as it is now (and on every re-run): a value
        // somebody wrote while the model was answering is never replaced,
        // and nothing at all is written then.
        const current = asObject(now);
        if (args.onlyIfEmpty && !isEmptyValue(holds(current))) throw new KeptValue("has_value");
        if (unexpected(current)) throw new KeptValue("changed");
        return listId
          ? applyMetadataPatch(current, { ns: { [field.key]: value }, listId })
          : applyMetadataPatch(current, { top: { [field.key]: value } });
      },
      activityMeta: { via: "ai" },
    });
  } catch (err) {
    if (err instanceof KeptValue) {
      return err.why === "has_value"
        ? NextResponse.json({ skipped: "has_value" }, { headers: { "Cache-Control": "no-store" } })
        : refuse(409, { error: "changed" });
    }
    throw err;
  }

  // "When a task field changes", for the home List's fields, exactly as an
  // edit fires it (PATCH /api/items/[id]). Never throws.
  if (!listId) {
    try {
      const changes = fieldChanges({ metadata: gate.item.metadata }, { metadata: updated.metadata }, [field.key]);
      for (const ch of changes) {
        dispatchEvent({
          organizationId: c.organizationId,
          event: "task.field_changed",
          payload: {
            id: updated.id,
            boardId: gate.item.boardId,
            title: updated.title,
            status: updated.status,
            ownerId: updated.ownerId,
            assigneeId: updated.ownerId,
            priority: updated.priority,
            dueAt: updated.dueAt,
            startAt: updated.startAt,
            field: ch.field,
            value: ch.value,
            previousValue: ch.previousValue,
            actorId: c.userId,
            updatedAt: updated.updatedAt,
          },
        }).catch(() => {});
      }
    } catch {
      /* the value is saved; an event pipe never fails it */
    }
  }
  void publishItemChanged({ itemId: gate.item.id, boardId: gate.item.boardId, organizationId: c.organizationId, actorId: c.userId });
  return NextResponse.json({ value }, { headers: { "Cache-Control": "no-store" } });
}
