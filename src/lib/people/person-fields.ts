// Who may write which field of a person's record (spec-teams-people
// section 1 Access, settings 9.2a), as one pure table the PATCH route, the
// Edit details modal and the org chart's edit mode all read, so a control
// never renders for a field the route would refuse and the route never
// silently drops one it received.
//
// The relationship is the viewer's to the SUBJECT of the write:
//   self         the viewer's own record
//   admin        Owner or Admin
//   people-team  the People team (seeded as the HR level)
//   org-wide     the legacy org-wide levels (C-level, VP, Director), who
//                edited every record yesterday and keep doing so
//   chain        the subject sits in the viewer's reporting chain (solid or
//                dotted, any depth)
//   none         anyone else in the org
//
// ALIGNMENT, NOT A RESTRICTION: the table keeps every write a person could
// make yesterday (PATCH /api/users/[id] let the chain and the org-wide
// levels write placement, status and Reports to, and let a manager-tier
// viewer edit their own placement). The spec narrows two of these (Reports to
// and status to the People team and Admin); that narrowing is reported to the
// founder rather than shipped, because it would take a working path away.
//
// Pure: no imports. Client safe.

export type PersonRelation = "self" | "admin" | "people-team" | "org-wide" | "chain" | "none";

export type PersonFieldGroup = "personal" | "dob" | "placement" | "reports-to" | "status" | "access";

export const PERSON_FIELD_GROUP: Record<string, PersonFieldGroup> = {
  firstName: "personal",
  lastName: "personal",
  phone: "personal",
  avatar: "personal",
  dateOfBirth: "dob",
  roleId: "placement",
  departmentId: "placement",
  officeId: "placement",
  weeklyCapacityHours: "placement",
  workSchedule: "placement",
  customFields: "placement",
  managerId: "reports-to",
  status: "status",
  "accessLevel": "access",
};

/** Every key PATCH /api/users/[id] accepts. Anything else is a 400. */
export const PATCHABLE_PERSON_FIELDS: ReadonlySet<string> = new Set(Object.keys(PERSON_FIELD_GROUP));

/**
 * May this relationship write this group? `managerTierSelf` is the legacy
 * rule that a manager-tier viewer edits their own placement (kept).
 */
export function canWritePersonGroup(
  group: PersonFieldGroup,
  relation: PersonRelation,
  opts: { managerTierSelf?: boolean } = {},
): boolean {
  switch (group) {
    case "personal":
      // Names and phone: the person and the people who run the org's records.
      return relation === "self" || relation === "admin" || relation === "people-team" || relation === "org-wide";
    case "dob":
      // The old manager dialog edited the date of birth, so the chain keeps it.
      return relation !== "none";
    case "placement":
    case "reports-to":
    case "status":
      if (relation === "self") return opts.managerTierSelf === true;
      return relation !== "none";
    case "access":
      // Membership fields are the Members drawer's (Owner and Admin only).
      return relation === "admin";
  }
}

export function canWritePersonField(
  field: string,
  relation: PersonRelation,
  opts: { managerTierSelf?: boolean } = {},
): boolean {
  const group = PERSON_FIELD_GROUP[field];
  if (!group) return false;
  return canWritePersonGroup(group, relation, opts);
}

/** Split a PATCH body into unknown keys and keys the caller may not write. */
export function checkPersonPatch(
  body: Record<string, unknown>,
  relation: PersonRelation,
  opts: { managerTierSelf?: boolean } = {},
): { unknown: string[]; forbidden: string[] } {
  const unknown: string[] = [];
  const forbidden: string[] = [];
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) continue;
    if (!PATCHABLE_PERSON_FIELDS.has(key)) unknown.push(key);
    else if (!canWritePersonField(key, relation, opts)) forbidden.push(key);
  }
  return { unknown, forbidden };
}

/** Does this relationship read people data (phone, birthday, capacity, KRAs, reviews)? */
export function readsPeopleData(relation: PersonRelation): boolean {
  return relation !== "none";
}

/** Plain words for a field, for the per-field 403 message. */
export const PERSON_FIELD_LABEL: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  phone: "phone",
  avatar: "photo",
  dateOfBirth: "date of birth",
  roleId: "job title",
  departmentId: "department",
  officeId: "office",
  weeklyCapacityHours: "weekly capacity",
  workSchedule: "work schedule",
  customFields: "profile fields",
  managerId: "reports to",
  status: "status",
  "accessLevel": "access level",
};
