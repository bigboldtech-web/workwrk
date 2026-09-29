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

// ── Who a session may ask ─────────────────────────────────────────────
// The scope rule, pure, so the server (candor.server.ts candorScopesFor
// builds the scopes) and every page that offers Launch, Reopen or New
// session read the same words and never offer what the server refuses.

/** The scopes a person may ask. `departmentIds: null` means any department. */
export type CandorScopes = { everyone: boolean; departmentIds: string[] | null };

export function candorScopeAllowed(scopes: CandorScopes, departmentId: string | null): boolean {
  if (departmentId === null) return scopes.everyone;
  return scopes.departmentIds === null || scopes.departmentIds.includes(departmentId);
}

/** Pure: may this person run any session at all (a scope to ask exists). */
export function candorHasAnyScope(scopes: CandorScopes): boolean {
  return scopes.everyone || scopes.departmentIds === null || scopes.departmentIds.length > 0;
}

const CANDOR_CHAIN_WHICH = "a department you head, or one where everyone in it reports to you";

/**
 * The one line a person who runs sessions only through their reports reads
 * when no scope fits them yet: who can run one instead.
 */
export const CANDOR_NO_SCOPE_NOTE = `The People team and Admins run Candor sessions. You can run one for ${CANDOR_CHAIN_WHICH}; none fits yet.`;

/** Pure: why this scope is refused (null when allowed), in words the organiser can act on. */
export function candorScopeRefusal(scopes: CandorScopes, departmentId: string | null): string | null {
  if (candorScopeAllowed(scopes, departmentId)) return null;
  if (!candorHasAnyScope(scopes)) {
    return `You can run a Candor session for ${CANDOR_CHAIN_WHICH}. None fits yet, so ask the People team to run this one.`;
  }
  return departmentId === null
    ? `Only the People team and Admins can ask everyone. Pick ${CANDOR_CHAIN_WHICH}.`
    : `You can only ask ${CANDOR_CHAIN_WHICH}.`;
}

/**
 * Who a session asks, in the words the Launch and Reopen confirms use: the
 * department, or the whole company by name (never "Everyone in everyone").
 */
export function candorAudienceOf(departmentName: string | null | undefined, orgName: string | null | undefined): string {
  if (departmentName) return `Everyone in ${departmentName}`;
  const org = orgName?.trim();
  return org ? `Everyone at ${org}` : "Everyone in the company";
}
