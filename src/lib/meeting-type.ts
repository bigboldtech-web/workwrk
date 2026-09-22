// enum MeetingType, spelled once outside the schema.
//
// WHY IT EXISTS. `type` used to go straight from the request body into
// prisma.meeting.create / .update, so a body naming a word that is not in the
// enum (a stale client, a typo, a script) answered a bare 500 from Postgres
// instead of a 400 naming the six words the API accepts. Both POST
// /api/meetings and PUT /api/meetings/[id] read this list, so they cannot
// drift apart, and the New meeting modal's Type picker reads the labels.
//
// Pure: no prisma import, so a route, a client component and a unit test can
// all read it.

export const MEETING_TYPES = [
  "DAILY_STANDUP",
  "WEEKLY_REVIEW",
  "ONE_ON_ONE",
  "QUARTERLY_REVIEW",
  "ANNUAL_PLANNING",
  "ADHOC",
] as const;

export type MeetingTypeWord = typeof MEETING_TYPES[number];

/** The canon labels (naming-canon section 1). Never hue-keyed anywhere. */
export const MEETING_TYPE_LABELS: Readonly<Record<MeetingTypeWord, string>> = {
  DAILY_STANDUP: "Daily standup",
  WEEKLY_REVIEW: "Weekly review",
  ONE_ON_ONE: "1:1",
  QUARTERLY_REVIEW: "Quarterly review",
  ANNUAL_PLANNING: "Annual planning",
  ADHOC: "Ad hoc",
};

export function isMeetingType(v: unknown): v is MeetingTypeWord {
  return typeof v === "string" && (MEETING_TYPES as readonly string[]).includes(v);
}
