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
}

export interface CopyDiff {
  insert: MemberRow[];
  update: { id: string; role: CopyRole; from: CopyRole }[];
  remove: CopyRow[];
  equal: number;
}

const key = (t: string, o: string, u: string) => `${t}:${o}:${u}`;

export function diffContainerCopies(members: readonly MemberRow[], copies: readonly CopyRow[]): CopyDiff {
  const byKey = new Map(copies.map((c) => [key(c.objectType, c.objectId, c.subjectId), c]));
  const seen = new Set<string>();
  const out: CopyDiff = { insert: [], update: [], remove: [], equal: 0 };
  for (const m of members) {
    const k = key(m.objectType, m.objectId, m.userId);
    if (seen.has(k)) continue;
    seen.add(k);
    const c = byKey.get(k);
    if (!c) out.insert.push(m);
    else if (c.role !== m.role) out.update.push({ id: c.id, role: m.role, from: c.role });
    else out.equal++;
  }
  for (const [k, c] of byKey) if (!seen.has(k)) out.remove.push(c);
  return out;
}

/** The row-count assertion after a write: copies equal member rows, per type. */
export function copyAssertions(memberCounts: Record<CopyObjectType, number>, copyCounts: Record<CopyObjectType, number>): string[] {
  const out: string[] = [];
  for (const t of ["SPACE", "FOLDER", "LIST", "GOAL"] as const) {
    if ((memberCounts[t] ?? 0) !== (copyCounts[t] ?? 0)) out.push(`${t}: ${copyCounts[t] ?? 0} copies for ${memberCounts[t] ?? 0} member rows`);
  }
  return out;
}

/** A goal audience row copies as Can view: the audience sees the goal and checks in (spec 9 okrs.view, okrs.checkIn). */
export const GOAL_COPY_ROLE: CopyRole = "GUEST";
