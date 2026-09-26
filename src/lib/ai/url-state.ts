// The /sidekick URL states (spec-ai-automation section 2, /sidekick "URL
// states"), read in one place so the page and its tests agree on what each
// address means. Pure: the page turns the answer into useAiSession() calls.
//
//   /sidekick                     the landing, or the chat this tab already has open
//   /sidekick?new=1               a fresh landing, composer focused
//   /sidekick?session=<id>        that chat
//   /sidekick?q=<text>            a new chat, the text sent at once
//   /sidekick?agent=<slug>        a new chat bound to that agent (&new=1 too)
//   /sidekick?view=all            All chats
//   /sidekick?pinned=1            All chats, pinned (implies view=all)
//   /sidekick?view=all&archived=1 All chats, archived

export type AllChatsTab = "all" | "pinned" | "archived";

export type SidekickIntent =
  | { kind: "all"; tab: AllChatsTab }
  | { kind: "session"; id: string }
  | { kind: "ask"; q: string; agent: string | null }
  | { kind: "new"; agent: string | null }
  | { kind: "landing" };

type ParamsLike = { get(name: string): string | null };

const MAX_Q = 4000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function sidekickIntent(params: ParamsLike | null | undefined): SidekickIntent {
  const get = (k: string) => params?.get(k) ?? null;
  const archived = get("archived") === "1";
  const pinned = get("pinned") === "1";
  if (get("view") === "all" || pinned || archived) {
    return { kind: "all", tab: archived ? "archived" : pinned ? "pinned" : "all" };
  }
  const session = get("session");
  if (session && ID.test(session)) return { kind: "session", id: session };
  const rawAgent = get("agent");
  const agent = rawAgent && SLUG.test(rawAgent) ? rawAgent : null;
  const q = (get("q") ?? "").trim();
  if (q) return { kind: "ask", q: q.slice(0, MAX_Q), agent };
  if (get("new") === "1" || agent) return { kind: "new", agent };
  return { kind: "landing" };
}

/** The address the All chats tabs write. */
export function allChatsHref(tab: AllChatsTab): string {
  if (tab === "pinned") return "/sidekick?view=all&pinned=1";
  if (tab === "archived") return "/sidekick?view=all&archived=1";
  return "/sidekick?view=all";
}

/** The address a new chat bound to an agent lives at before its first send. */
export function agentChatHref(slug: string): string {
  return `/sidekick?agent=${encodeURIComponent(slug)}`;
}
