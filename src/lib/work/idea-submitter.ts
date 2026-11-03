// An idea's submitter as the Ideas board shows them: their department only
// when it is this workspace's own (docs/plans/workspace-status.md D18,
// src/lib/access/profile-here.ts), so a person whose account came from
// another company never carries its department onto this workspace's board.

import { ownHere } from "@/lib/access/profile-here";

/** The submitter's fields an idea is read with, the department with its workspace. */
export const SUBMITTER_SELECT = { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true, organizationId: true } } } as const;

/** The idea with its submitter's department kept only when it is this workspace's. */
export function withSubmitterHere<T extends { submitter: { department: { name: string; organizationId: string } | null } | null }>(idea: T, organizationId: string) {
  if (!idea.submitter) return idea;
  const dept = ownHere(idea.submitter.department, organizationId);
  return { ...idea, submitter: { ...idea.submitter, department: dept ? { name: dept.name } : null } };
}
