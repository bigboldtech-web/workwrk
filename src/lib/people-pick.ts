// The pure half of every people picker that needs the whole company (the
// hook is src/components/people/use-people-picker.ts).
//
// Those pickers used to read GET /api/users?scope=all, which answers anybody
// below an org-wide level with their own report tree: an Employee with no
// reports opened a picker that could only pick them. They read GET
// /api/people/pick now, the narrow org-scoped read made for pickers (active
// people by default, everyone who can sign in with reach=signin, a Guest only
// the people they share a conversation with, ids= for names already shown).

export interface PickPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  email: string | null;
  role?: { title: string | null } | null;
}

export type PickReach = "active" | "signin" | "all";

export interface PickQuery {
  /**
   * "active" (default): who a notification, an assignment or a run can reach.
   * "signin": everyone who can sign in (on leave, probation, notice).
   * "all": a filter's picker; the directory's privileged readers also find
   * deactivated people, everyone else gets "signin".
   */
  reach?: PickReach;
  /** Offer the person picking too (default true). */
  includeSelf?: boolean;
  /** Only people who can be someone's manager (never an Agent). */
  managersOnly?: boolean;
}

/** The query string for one read of GET /api/people/pick. */
export function pickUrl(o: PickQuery & { q?: string; limit?: number; ids?: readonly string[] }): string {
  const sp = new URLSearchParams();
  if (o.ids && o.ids.length) {
    sp.set("ids", o.ids.join(","));
    // reach "all": a deactivated person is named too, for a caller who may see them.
    if (o.reach === "all") sp.set("reach", "all");
    return `/api/people/pick?${sp}`;
  }
  if (o.includeSelf !== false) sp.set("includeSelf", "1");
  if (o.reach === "signin" || o.reach === "all") sp.set("reach", o.reach);
  if (o.managersOnly) sp.set("managers", "1");
  sp.set("limit", String(o.limit ?? 50));
  const q = o.q?.trim();
  if (q) sp.set("q", q);
  return `/api/people/pick?${sp}`;
}

export function pickPersonName(p: Pick<PickPerson, "firstName" | "lastName" | "email">): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";
}

/** The people merged by id, the newest copy of each kept. */
export function mergePeople(prev: ReadonlyMap<string, PickPerson>, got: readonly PickPerson[]): Map<string, PickPerson> {
  const next = new Map(prev);
  for (const p of got) next.set(p.id, p);
  return next;
}

/**
 * The people a typed search shows from what has been read so far, in name
 * order: every word must match the first name, the last name or the email
 * (the server's own rule, so "Lea Alpha", "alpha lea" and an email all find
 * the same person, and a person shows the moment they are already known).
 */
export function matchPeople(people: Iterable<PickPerson>, query: string): PickPerson[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const out: PickPerson[] = [];
  for (const p of people) {
    const fields = [p.firstName ?? "", p.lastName ?? "", p.email ?? ""].map((f) => f.toLowerCase());
    if (words.every((w) => fields.some((f) => f.includes(w)))) out.push(p);
  }
  return out.sort((a, b) => pickPersonName(a).localeCompare(pickPersonName(b)));
}

/** Ids in chunks the ids= lookup takes (50 each). */
export function chunkIds(ids: readonly string[], size = 50): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
