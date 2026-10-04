// The words the one dialog's objects send a person (batch 7). Pure, so they
// are tested without a database.

import { ACCESS_NODE_NOUN, shareRoleLabel, type ObjectShareKind, type PanelRole } from "../access-panel";

/** The words of the "you were given access" line, per kind: a goal and a team are joined, not shared. */
export function grantedNoticeText(
  kind: ObjectShareKind,
  actorName: string,
  objectName: string,
  role: PanelRole,
  how: "shared" | "upgraded",
): { title: string; message: string } {
  const label = shareRoleLabel(kind, role);
  if (kind === "goal") {
    return { title: `${actorName} added you as a contributor on ${objectName}`, message: "You can see the goal and check in on its targets." };
  }
  if (kind === "team") {
    if (how === "upgraded" || role === "FULL") return { title: `${actorName} made you a lead of ${objectName}`, message: "You are on this team as its Lead." };
    return { title: `${actorName} added you to ${objectName}`, message: "You are on this team." };
  }
  return {
    title: how === "shared" ? `${actorName} shared ${objectName} with you` : `${actorName} gave you ${label} on ${objectName}`,
    message: `${label} on this ${ACCESS_NODE_NOUN[kind]}.`,
  };
}
