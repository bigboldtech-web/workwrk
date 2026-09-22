// Who may read, edit and delete a meeting.
//
// One pure function, so the page gate, the three /api/meetings/[id] verbs
// and the action-item routes cannot drift apart. It takes the facts and
// returns a role; it opens no database and reads no session.
//
// The ladder is access-model-spec.md's, applied to a meeting exactly as
// spec-planner.md section 1 Access states it:
//
//   creator          Full access   (rule 5)
//   Owner or Admin   Full access   (rule 4, org-wide read-around)
//   attendee         Can edit      (rule 9, relationship = assignee)
//   everyone else    none, and NOT DISCOVERABLE, so the route answers 404
//                    rather than 403 (rule 14). A meeting you are not in
//                    should not confirm that it exists.
//
// There is deliberately no "Can view" rung. spec-planner section 1: "there
// is no Can view level on meetings (you are in it or you are not)."
//
// HISTORICAL ROWS. `createdById` is nullable and arrived in Phase 4, so
// every meeting made before then reports createdById = null. Those rows
// resolve on attendance and the admin read-around alone, which is the only
// thing they record. Nobody is locked out of a meeting they attend, and
// scripts/backfill-meeting-created-by.mjs fills the creator in where there
// is a RECORD of one: the meeting_created ActivityLog row, or a meeting with
// exactly one attendee. A meeting with several attendees and no log row is
// left NULL and reported, because MeetingAttendee has no createdAt and the
// order inside one createMany batch says nothing about who scheduled it.
// A row that records nobody at all resolves to "none" for everyone but an
// org admin: see the note inside meetingRole for why the alternative was
// rejected.

export type MeetingRole = "full" | "edit" | "none";

export interface MeetingFacts {
  viewerId: string;
  /** Owner or Admin of the organization (legacy admin level). */
  isOrgAdmin: boolean;
  /** Meeting.createdById; null for rows written before Phase 4. */
  createdById: string | null | undefined;
  /** User ids of MeetingAttendee rows. */
  attendeeIds: readonly string[];
}

export function meetingRole(facts: MeetingFacts): MeetingRole {
  const { viewerId, isOrgAdmin, createdById, attendeeIds } = facts;
  if (!viewerId) return "none";
  if (createdById && createdById === viewerId) return "full";
  if (isOrgAdmin) return "full";
  if (attendeeIds.includes(viewerId)) return "edit";
  // A ROW THAT RECORDS NOBODY gets nothing, like every other row nobody can
  // tie the viewer to. An earlier draft of this file granted "edit" on those
  // rows so the person who made a pre Phase 4 meeting would not lose it, but
  // that rule hands Can edit on the row, its agenda and its notes to every
  // member of the organization, which is a wider read than the ladder gives
  // anybody anywhere else. The reachability problem it was solving is a data
  // problem and is solved with data: scripts/backfill-meeting-created-by.mjs
  // gives a historical row its creator wherever one was actually RECORDED
  // (the meeting_created ActivityLog row, or a sole attendee), so that row
  // resolves through rule 5 rather than through a hole in the gate. It
  // deliberately invents nobody: a row it cannot resolve stays NULL and is
  // reported. An org admin reaches an unresolved row under rule 4 and can
  // hand it back.
  return "none";
}

/** Can open the meeting at all. */
export function canReadMeeting(facts: MeetingFacts): boolean {
  return meetingRole(facts) !== "none";
}

/** Can change the title, time, agenda, notes, decisions and attendees. */
export function canEditMeeting(facts: MeetingFacts): boolean {
  const role = meetingRole(facts);
  return role === "full" || role === "edit";
}

/**
 * Can delete the meeting. Full access only: an attendee leaving should not
 * take the meeting away from everyone else. Before Phase 4 any Member in
 * the organization could hard-delete any meeting in it.
 */
export function canDeleteMeeting(facts: MeetingFacts): boolean {
  return meetingRole(facts) === "full";
}
