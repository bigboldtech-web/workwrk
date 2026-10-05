// The company's records that are deleted before the company itself when it is
// deleted for good (/api/cron/org-hard-delete).
//
// WHY. The hard delete is one DELETE of the Organization row, and the
// database cascades the rest. A few required links restrict instead of
// cascading: a review's subject and reviewer, peer feedback's giver and
// receiver, a meeting's attendee and action item assignee, an announcement's
// acknowledgment, a legacy task comment's author, and in the old finance
// tables a journal line's accounts. PostgreSQL runs the checks a cascade
// queues level by level, after the level that queued them: the company's
// accounts go one level below it, and their restricting links are checked
// before the cascades two or three levels down have removed the records that
// name them. So the delete failed, and was retried and failed every day, for
// any company that had run a review cycle, a meeting or an acknowledged
// announcement, and its data outlived the promised 30 days.
//
// Deleting these parents first, each in its own statement in the same
// transaction, lets their cascades finish before any account goes. The test
// (hard-delete-order.test.ts) reads prisma/schema.prisma so that a new
// restricting link deeper than one level cannot be added without a parent
// here.

/** Deleted by organizationId, in this order, before the company row. */
export const HARD_DELETE_FIRST = ["ReviewCycle", "Meeting", "Announcement", "Task", "JournalEntry"] as const;

export type HardDeleteFirst = (typeof HARD_DELETE_FIRST)[number];

/** The models with a restricting link deeper than one level, and the parent above that takes them. */
export const DEEP_RESTRICTED: Readonly<Record<string, HardDeleteFirst>> = {
  Review: "ReviewCycle",
  PeerFeedback: "ReviewCycle",
  MeetingAttendee: "Meeting",
  ActionItem: "Meeting",
  AnnouncementAcknowledgment: "Announcement",
  TaskComment: "Task",
  JournalLine: "JournalEntry",
};

export function isHardDeleteFirst(name: string): name is HardDeleteFirst {
  return (HARD_DELETE_FIRST as readonly string[]).includes(name);
}
