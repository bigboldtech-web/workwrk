// Access step 7's copy plan (Phase 8 stage E): the member rows (SpaceMember,
// FolderMember, BoardMember, and the USER rows of GoalAssignee) as
// "AccessGrant" copies, diffed against the copies already there. Pure; the
// script scripts/access-migrate-container-rows.ts loads both sides and
// applies the diff.
//
// The copies are a SNAPSHOT. Nothing reads them in this release: the
// loader keeps reading the member tables, because a copy that outlived its
// member row would hand a removed person their access back the day a reader
// switched to the copies, and a dozen code paths write the member tables. So
// the diff is exact in both directions (insert the missing, re-role the
// changed, delete the orphaned), and the script's --verify mode reports the
// drift. The founder's step before any reader moves to the copies is to keep
// them equal at write time (scripts/MIGRATIONS.md, stage E, step 7).

export type CopyObjectType = "SPACE" | "FOLDER" | "LIST" | "GOAL";
export type CopyRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

export interface MemberRow {
  objectType: CopyObjectType;
  objectId: string;
  userId: string;
  role: CopyRole;
  createdAt: Date;
}

export interface CopyRow {
  id: string;
  objectType: CopyObjectType;
  objectId: string;
  subjectId: string;
  role: CopyRole;
  /** AccessGrant.source: 'copy.step7' for this script's rows, null for rows written before the column. */
  source?: string | null;
  objectRole?: string | null;
}

/** The provenance this script writes on every copy. */
export const COPY_SOURCE = "copy.step7";
/** The provenance the step-4 backfill writes on its reach-preservation rows (G5). */
export const G5_SOURCE = "backfill.g5";

/**
 * Is this container USER row one of the step-7 copies (and so the diff's to
 * re-role or delete)? A tagged copy, or an untagged row written before the
 * source column that is not G5-shaped. EVERY other row is protected: a G5
 * reach-preservation row (tagged, or untagged with objectRole FULL, which no
 * copy ever writes) has no member twin by design, and reading it as an
 * orphaned copy would take the Space owner's Full access on a Private List
 * away (spec D7). Unknown provenance is protected, the safe direction.
 */
export function isStep7Copy(r: Pick<CopyRow, "source" | "objectRole" | "objectType">): boolean {
  if (r.source === COPY_SOURCE) return true;
  if (r.source != null) return false;
  if (r.objectType === "GOAL") return r.objectRole === "VIEW" || r.objectRole == null;
  return r.objectRole == null;
}

export interface CopyDiff {
  insert: MemberRow[];
  update: { id: string; role: CopyRole; from: CopyRole }[];
  remove: CopyRow[];
  equal: number;
  /** Member rows whose key a protected (non-copy) row already holds: never copied over it. */
  heldByProtected: number;
  /** Protected rows seen (G5 and anything else not written by this script), never touched. */
  protectedKept: number;
}

const key = (t: string, o: string, u: string) => `${t}:${o}:${u}`;

/**
 * The diff over the step-7 copies only. `rows` is every container USER row in
 * AccessGrant; the protected ones (isStep7Copy false) are never updated or
 * removed, and a member row whose key a protected row holds is not inserted
 * (the unique key allows one row, and the protected one is at least the reach
 * it preserves).
 */
export function diffContainerCopies(members: readonly MemberRow[], rows: readonly CopyRow[]): CopyDiff {
  const copies = rows.filter((r) => isStep7Copy(r));
  const protectedKeys = new Set(rows.filter((r) => !isStep7Copy(r)).map((c) => key(c.objectType, c.objectId, c.subjectId)));
  const byKey = new Map(copies.map((c) => [key(c.objectType, c.objectId, c.subjectId), c]));
  const seen = new Set<string>();
  const out: CopyDiff = { insert: [], update: [], remove: [], equal: 0, heldByProtected: 0, protectedKept: protectedKeys.size };
  for (const m of members) {
    const k = key(m.objectType, m.objectId, m.userId);
    if (seen.has(k)) continue;
    seen.add(k);
    if (protectedKeys.has(k)) {
      out.heldByProtected++;
      continue;
    }
    const c = byKey.get(k);
    if (!c) out.insert.push(m);
    else if (c.role !== m.role) out.update.push({ id: c.id, role: m.role, from: c.role });
    else out.equal++;
  }
  for (const [k, c] of byKey) if (!seen.has(k)) out.remove.push(c);
  return out;
}

/**
 * The row-count assertion after a write: copies equal member rows, per type,
 * less the member rows a protected row holds; and the protected rows are all
 * still there (the count before equals the count after).
 */
export function copyAssertions(
  memberCounts: Record<CopyObjectType, number>,
  copyCounts: Record<CopyObjectType, number>,
  held: Partial<Record<CopyObjectType, number>> = {},
  protectedBefore?: number,
  protectedAfter?: number,
): string[] {
  const out: string[] = [];
  for (const t of ["SPACE", "FOLDER", "LIST", "GOAL"] as const) {
    const want = (memberCounts[t] ?? 0) - (held[t] ?? 0);
    if (want !== (copyCounts[t] ?? 0)) out.push(`${t}: ${copyCounts[t] ?? 0} copies for ${want} member rows`);
  }
  if (protectedBefore !== undefined && protectedAfter !== undefined && protectedBefore !== protectedAfter) {
    out.push(`protected rows: ${protectedAfter} after the write, ${protectedBefore} before`);
  }
  return out;
}

/** A goal audience row copies as Can view: the audience sees the goal and checks in (spec 9 okrs.view, okrs.checkIn). */
export const GOAL_COPY_ROLE: CopyRole = "GUEST";
