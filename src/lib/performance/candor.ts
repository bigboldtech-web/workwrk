// Candor sessions: prompts, answers and the three moves (spec-teams-performance
// /candor and /candor/[id]). Pure.
//
// Worst cases decided here:
//   - Every prompt has a STABLE id, assigned when it is written. The old page
//     gave string prompts a new random id on every read, so answers to a
//     session launched from the list card were keyed to ids the results
//     could never find, and dropped. Ids are now "p1", "p2"... by position
//     for any prompt that has none, the same answer on every read, and a
//     prompt keeps its id when it is reordered.
//   - Prompts freeze the moment the session opens (a live session's answers
//     are keyed to them).
//   - An answer to a prompt the session does not have is dropped, and each
//     value is bounded (a rating is 1 to 5, a text 5,000 characters).

export type CandorPromptType = "text" | "rating" | "start_stop_continue";
export type CandorPrompt = { id: string; text: string; type: CandorPromptType };

export const CANDOR_PROMPT_TYPES: Array<{ value: CandorPromptType; label: string }> = [
  { value: "text", label: "Open text" },
  { value: "rating", label: "Rating 1 to 5" },
  { value: "start_stop_continue", label: "Start, stop, continue" },
];

const TYPES = new Set<string>(["text", "rating", "start_stop_continue"]);

export function normalizeCandorPrompts(raw: unknown): CandorPrompt[] {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
  const out: CandorPrompt[] = [];
  list.forEach((p, i) => {
    let id = "";
    let text = "";
    let type: CandorPromptType = "text";
    if (typeof p === "string") text = p;
    else if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      id = typeof o.id === "string" ? o.id : "";
      text = typeof o.text === "string" ? o.text : "";
      type = typeof o.type === "string" && TYPES.has(o.type) ? (o.type as CandorPromptType) : "text";
    }
    if (!id || used.has(id)) {
      let n = i + 1;
      id = `p${n}`;
      while (used.has(id)) { n += 1; id = `p${n}`; }
    }
    used.add(id);
    out.push({ id, text: text.slice(0, 1000), type });
  });
  return out;
}

/** Answers kept only for real prompts, each value bounded; null when nothing usable. */
export function cleanCandorAnswers(raw: unknown, prompts: readonly CandorPrompt[]): Array<{ promptId: string; value: unknown }> | null {
  if (!Array.isArray(raw)) return null;
  const byId = new Map(prompts.map((p) => [p.id, p] as const));
  const seen = new Set<string>();
  const out: Array<{ promptId: string; value: unknown }> = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const promptId = (a as { promptId?: unknown }).promptId;
    const value = (a as { value?: unknown }).value;
    if (typeof promptId !== "string" || seen.has(promptId)) continue;
    const p = byId.get(promptId);
    if (!p) continue;
    let v: unknown = null;
    if (p.type === "rating") {
      const n = Number(value);
      v = Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
    } else if (p.type === "start_stop_continue") {
      const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      const t = (k: string) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 5000) : "");
      const s = { start: t("start"), stop: t("stop"), continue: t("continue") };
      v = s.start || s.stop || s.continue ? s : null;
    } else {
      v = typeof value === "string" && value.trim() ? value.slice(0, 5000) : null;
    }
    if (v == null) continue;
    seen.add(promptId);
    out.push({ promptId, value: v });
  }
  return out.length ? out : null;
}

/** Null when a session may move from `from` to `to`; else why not. */
export function candorTransitionBlocked(from: string, to: string): string | null {
  if (from === to) return null;
  if (to === "ACTIVE") return from === "DRAFT" || from === "CLOSED" ? null : "Unknown status";
  if (to === "CLOSED") return from === "ACTIVE" ? null : "Only an open session can close";
  if (to === "DRAFT") return "A session cannot go back to draft";
  return "Unknown status";
}

export function candorStatusOf(s: string): { label: string; tone: "neutral" | "info" } {
  if (s === "ACTIVE") return { label: "Open", tone: "info" };
  if (s === "CLOSED") return { label: "Closed", tone: "neutral" };
  return { label: "Draft", tone: "neutral" };
}
