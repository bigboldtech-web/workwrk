// The ONE copy of role labels and blurbs, for every dialog, chip, list and
// API response (spec 1.1 principle 1, spec 3.1). No UI may re-type these.
//
// Pure: imports only ./types.

import type { ObjectRole, OrgRole } from "./types";

export const OBJECT_ROLE_LABEL: Record<ObjectRole, string> = {
  FULL: "Full access",
  EDIT: "Can edit",
  COMMENT: "Can comment",
  VIEW: "Can view",
};

/** Verbatim from spec 3.1. */
export const OBJECT_ROLE_BLURB: Record<ObjectRole, string> = {
  FULL: "Change settings, sharing, delete and transfer.",
  EDIT: "Add and change tasks, docs and rows.",
  COMMENT: "Read and discuss, never change.",
  VIEW: "Read only.",
};

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
};

/** Spec 2.1, one line each. */
export const ORG_ROLE_BLURB: Record<OrgRole, string> = {
  OWNER: "Runs the company account: billing, ownership and security.",
  ADMIN: "Runs the workspace day to day.",
  MEMBER: "An employee: works in the Spaces they are added to and sees what is open to the workspace.",
  GUEST: "Outside the company, sees only what is shared.",
};

/**
 * The List ladder's rung between Can comment and Can edit (founder decision 3,
 * docs/plans/competitor-gap-2026-09.md section 7): the role a List share
 * calls "ASSIGNED". It exists on Lists only.
 */
export const ASSIGNED_ROLE_LABEL = "Can edit assigned tasks";
export const ASSIGNED_ROLE_BLURB = "Read and discuss every task, change only the tasks assigned to them.";

/**
 * The three lower rungs on a List, where assignment matters: rule 9 lets an
 * assignee change their task at Can view and at Can edit assigned tasks,
 * never at Can comment (src/lib/item-role.ts assigneeLift).
 */
export const LIST_ROLE_BLURB = {
  COMMENT: "Read and discuss every task, never change one, even one assigned to them.",
  VIEW: "Read only, except a task assigned to them, which they can change.",
} as const;

/** The order every role picker renders, widest first. */
export const OBJECT_ROLE_ORDER: readonly ObjectRole[] = ["FULL", "EDIT", "COMMENT", "VIEW"];
export const ORG_ROLE_ORDER: readonly OrgRole[] = ["OWNER", "ADMIN", "MEMBER", "GUEST"];
