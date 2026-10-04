// The browser half of Fill with AI (Batch 8): one call to
// POST /api/items/[id]/ai-fill, its answer read into words a person can act
// on. Pure apart from fetch, so the Fields panel, a cell, the task detail and
// the column's Fill empty rows all say the same thing for the same refusal.

import type { AiFieldValue } from "@/lib/ai-fields";
import { accessMessage } from "@/lib/access-message";

/** Refusals a retry of the same row cannot change until someone edits the task. */
export const PERMANENT_FILL_FAILURES: ReadonlySet<string> = new Set(["nothing_to_translate", "too_long"]);

export type AiFillResult =
  | { ok: true; value: AiFieldValue }
  | { ok: true; skipped: true }
  | { ok: false; code: string; message: string; stop: boolean };

/** What a refusal says, and whether a batch should stop at it (it would refuse every row). */
export function aiFillMessage(status: number, body: unknown): { code: string; message: string; stop: boolean } {
  const b = (body ?? {}) as { error?: unknown; reason?: unknown; from?: unknown };
  const code = typeof b.error === "string" ? b.error : `http_${status}`;
  switch (code) {
    case "ai_fields_off":
      return { code, message: "AI fields are turned off for this workspace.", stop: true };
    case "app_off":
      return { code, message: "AI isn't available in this workspace right now.", stop: true };
    case "ai_daily_limit":
      return { code, message: "This workspace has used today's AI fills. More are available after midnight UTC.", stop: true };
    case "ai_not_configured":
      return { code, message: "AI isn't set up for this workspace yet.", stop: true };
    case "not_ready":
      return { code, message: "AI fields aren't ready on this server yet. Try again later.", stop: true };
    case "needs_setup":
      return {
        code,
        message: b.reason === "needs_language" ? "Pick a language for this field first." : "Add at least two categories to this field first.",
        stop: true,
      };
    case "nothing_to_translate":
      return { code, message: b.from === "title" ? "This task has no title to translate." : "This task has no description to translate yet.", stop: false };
    case "ai_failed":
      return { code, message: "The AI service didn't answer. Try again.", stop: false };
    case "ai_unusable":
      return { code, message: "The AI answer didn't fit this field. Try again.", stop: false };
    case "too_long":
      return { code, message: "This text is too long to translate in one go. Shorten the description, or translate the title.", stop: false };
    case "changed":
      return { code, message: "This field changed since you opened it. Check the new value, then try again.", stop: false };
    case "unknown_field":
      return { code, message: "This field is no longer on the List.", stop: true };
    default:
      if (status === 404) return { code, message: "This task is no longer here.", stop: false };
      return { code, message: accessMessage(body, "Couldn't fill this field."), stop: false };
  }
}

export async function requestAiFill(args: {
  itemId: string;
  fieldKey: string;
  /** The List whose field it is: the home, or a List the task is linked into. */
  contextBoardId: string | null;
  onlyIfEmpty?: boolean;
  /** The value the person is looking at (null for an empty cell): replaced exactly, or not at all. */
  expect: unknown;
}): Promise<AiFillResult> {
  try {
    const res = await fetch(`/api/items/${encodeURIComponent(args.itemId)}/ai-fill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fieldKey: args.fieldKey,
        ...(args.contextBoardId ? { contextBoardId: args.contextBoardId } : {}),
        ...(args.onlyIfEmpty ? { onlyIfEmpty: true } : {}),
        expect: args.expect === undefined ? null : args.expect,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, ...aiFillMessage(res.status, body) };
    if (body && typeof body === "object" && "skipped" in body) return { ok: true, skipped: true };
    const value = (body as { value?: AiFieldValue } | null)?.value;
    if (!value) return { ok: false, code: "bad_answer", message: "Couldn't fill this field.", stop: false };
    return { ok: true, value };
  } catch {
    return { ok: false, code: "network", message: "Couldn't reach the server. Check your connection and try again.", stop: false };
  }
}
