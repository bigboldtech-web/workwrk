// The sentence for every refusal the dashboard and report routes answer.
//
// The routes answer machine codes on purpose (`{ error: "conflict" }`,
// `{ error: "no_access", reason: "space_manage_only" }`), so the server never
// guesses a client's wording. This is the transcription for the dashboard
// canvas, the Space Overview widgets and the Schedule report dialog: the
// reason first, then the code, then the item routes' own table
// (accessMessage), then the caller's sentence. A raw code never reaches the
// screen, because anything unrecognised falls through to a sentence.
//
// Pure: accessMessage is pure too.

import { accessMessage } from "@/lib/access-message";

const MESSAGES: Record<string, string> = {
  not_dashboard_owner: "Only the person who made this dashboard, or an admin, can change it.",
  space_read_only: "You can read this Space but can't pin a dashboard to it.",
  space_manage_only: "Only this Space's owners and admins can change its Overview widgets.",
  version_required: "This page is out of date. Reload it and try again.",
  conflict: "Someone else saved this at the same time. Reload to see their version.",
  widget_missing: "This dashboard changed while you were editing. Reload it and try again.",
  unknown_widget: "One of these widgets no longer exists. Reload and try again.",
  duplicate_widget: "Two widgets ended up with the same id. Reload and try again.",
  widget_locked: "A widget that isn't shared with you can only be kept or removed.",
  source_locked: "Some of this widget's Lists aren't shared with you, so its data source can't change.",
  too_many_lists: "A widget can use up to 50 Lists, counting the ones that aren't shared with you.",
  too_many_rules: "A widget can have up to 20 filters, counting the ones that aren't shared with you.",
  overview_exists: "This Space already has Overview widgets. Reload to see them.",
  overview_pinned: "A Space's Overview widgets always stay with that Space.",
  overview_not_archivable: "A Space's Overview widgets can't be deleted all at once. Remove the widgets instead.",
  overview_source: "Widgets on a Space's Overview can only use that Space or Lists inside it.",
  invalid_schedule: "Check the schedule's timing and try again.",
  invalid_recipients: "Someone on this list can no longer receive reports. Remove them and try again.",
  private_view_recipients: "This view is private, so only its owner can receive it.",
  target_immutable: "A schedule always stays with its dashboard or view. Make a new schedule instead.",
  needs_database_update: "This needs a database update before it can be used here.",
  "Not found": "You can no longer see this.",
  "Invalid body": "Something in that change wasn't valid. Check it and try again.",
};

function code(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The sentence for a dashboard or report route's refusal body. */
export function dashboardMessage(payload: unknown, fallback: string): string {
  const p = payload && typeof payload === "object" ? (payload as { error?: unknown; reason?: unknown }) : {};
  const reason = code(p.reason);
  if (reason && MESSAGES[reason]) return MESSAGES[reason];
  const error = code(p.error);
  if (error && MESSAGES[error]) return MESSAGES[error];
  // accessMessage keeps a route's own sentence (err.message) and knows the
  // item routes' reasons; a bare code it does not know comes back as ours.
  return accessMessage(payload, fallback);
}
