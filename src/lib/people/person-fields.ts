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
//   chain        a manager-tier viewer whose SOLID report tree holds the
//                subject (any depth): yesterday's write door
//                (canTouchUserAlignment), unchanged
//   chain-view   the subject sits in the viewer's chain some other way (a
//                dotted line, or a solid report of a viewer below manager
//                tier): reads people data, writes nothing here. Yesterday
//                this viewer had no write at all, so a matrix manager can
//                never deactivate, move or re-line a person.
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

export type PersonRelation = "self" | "admin" | "people-team" | "org-wide" | "chain" | "chain-view" | "none";

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
  // The four-role write (Members drawer): Owner, Admin or Member, and the
  // member tier; src/lib/access/membership.ts applies every guard.
  orgRole: "access",
  memberTier: "access",
};

/**
 * The fields of someone who works here through a membership that THIS
 * workspace writes (docs/plans/workspace-status.md D11, D18;
 * docs/plans/workspace-status-2.md E7, step 5): their role and status, and
 * since step 5 their job title, department, office, weekly hours, working
 * week, profile fields and Reports to, each on their membership here
 * (seat-writes.ts), through the same doors as for anyone. Everything but
 * their shared identity: their name, phone, photo and birthday are the
 * account's, read by every workspace they belong to, so PATCH refuses them
 * here with SHARED_IDENTITY_REFUSAL (src/lib/access/shared-identity.ts).
 * Before step 5 only the role and the status were here, and every other
 * field was refused with "their details here are read-only".
 */
export const SEAT_FIELDS: ReadonlySet<string> = new Set(
  Object.entries(PERSON_FIELD_GROUP)
    .filter(([, group]) => group !== "personal" && group !== "dob")
    .map(([field]) => field),
);

/**
 * What every KRA or SOP assignment door says for someone here through a
 * membership (docs/plans/workspace-status-2.md, the step 5 review M1): a KRA
 * or SOP assignment names no workspace, and B's record of Pat, who works in
 * B from A's account, reads none of hers (her KPIs, reviews and alignment
 * here are a known limit), so Dana would never see a KRA B gave her. So
 * none is made for them here: their job title, department and office are
 * saved, and this sentence says why nothing else was. Since the final
 * review (M5) every reader of a person's KRAs and SOPs (My KRAs, the KPI
 * recorder, self-reports, review self-assessments, the weight total, the
 * open SOP count, the AI teammates' tools) reads the workspace it is read in
 * only, so rows another workspace made (after Pat joined it by invitation,
 * her account there) never show or count here.
 */
export const ALIGNMENT_NOT_HERE = "KRAs and SOPs are not assigned to people who work here from another workspace's account.";

/**
 * The Members drawer's and Edit details' note (the answer's alignmentNote)
 * when a job title that carries KRAs is saved for someone here through a
 * membership: said once, plainly, and never for a job title with nothing to
 * assign (the final review of workspace-status-2, product L8).
 */
export const JOB_TITLE_SAVED_NOT_ASSIGNED = `Job title saved. ${ALIGNMENT_NOT_HERE}`;

/** People's names in a sentence: "Pat Lee", "Pat Lee and Max Chen", "Pat Lee, Max Chen and 2 others". Pure; tested. */
export function namesInWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${names.slice(0, 2).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/**
 * POST /api/sop-assignments' refusal when the people named include someone
 * who works here from another workspace's account (the final review,
 * product M2): who they are, and what to do, since nothing was assigned.
 */
export function sopNotAssignedNamedWords(names: readonly string[]): string {
  return `${namesInWords(names)} ${names.length === 1 ? "works" : "work"} here from another workspace's account, and SOPs are not assigned to people who do. Nothing was assigned: take them off the list and assign again.`;
}

/** An SOP by department or to everyone: how many it left out, and why, in one sentence (the final review, product L8). */
export function sopLeftOutWords(count: number): string {
  return `${count} ${count === 1 ? "person who works" : "people who work"} here from another workspace's account ${count === 1 ? "was" : "were"} not assigned, since KRAs and SOPs are not assigned to people who do.`;
}

/** Members' tooltip on "·" in Last logged in for someone here through a membership (the final review, product M4). */
export const SIGN_IN_ELSEWHERE = "Not shown while they are working in another workspace.";

/**
 * The words a bulk change's toast adds for the people it skipped
 * (docs/plans/workspace-status.md, the final review, product L5): how many,
 * after the count changed. Empty when nobody was skipped. Since
 * workspace-status-2 step 5 a bulk placement change reaches the people here
 * through a membership too, so nobody is skipped for working in another
 * workspace (the answer's `skippedElsewhere` is 0, kept for one release).
 */
export function bulkSkippedWords(skipped: number): string {
  if (skipped <= 0) return "";
  return ` · ${skipped} skipped (not yours to change)`;
}

/** Every key PATCH /api/users/[id] accepts. Anything else is a 400. */
export const PATCHABLE_PERSON_FIELDS: ReadonlySet<string> = new Set(Object.keys(PERSON_FIELD_GROUP));

/**
 * May this relationship write this group? `managerTierSelf` is the legacy
 * rule that a manager-tier viewer edits their own placement (kept).
 */
export interface PersonWriteOpts {
  managerTierSelf?: boolean;
  /**
   * The manager chain writes the membership fields (placement, reports-to,
   * status). True today; the server passes false once ACCESS_V2_RESOLVER is
   * on (access-model-spec 3.5 and 10 step 2: "Membership (P) fields no
   * longer writable by the manager chain"), when the Owner, Admin and the
   * People team keep them. Server callers pass it from the flag; the client
   * reads the server's editable list, never this table with a flag.
   */
  chainWritesMembership?: boolean;
}

export function canWritePersonGroup(
  group: PersonFieldGroup,
  relation: PersonRelation,
  opts: PersonWriteOpts = {},
): boolean {
  switch (group) {
    case "personal":
      // Names and phone: the person and the people who run the org's records.
      return relation === "self" || relation === "admin" || relation === "people-team" || relation === "org-wide";
    case "dob":
      // The old manager dialog edited the date of birth, so the chain keeps
      // it. The route adds one more rule (see dobOverwriteAllowed): a viewer
      // shown only the day and month may set a missing date, never replace one.
      return relation !== "none" && relation !== "chain-view";
    case "placement":
    case "reports-to":
    case "status":
      if (relation === "self") return opts.managerTierSelf === true;
      if (relation === "chain" && opts.chainWritesMembership === false) return false;
      return relation !== "none" && relation !== "chain-view";
    case "access":
      // Membership fields are the Members drawer's (Owner and Admin only).
      return relation === "admin";
  }
}

export function canWritePersonField(
  field: string,
  relation: PersonRelation,
  opts: PersonWriteOpts = {},
): boolean {
  const group = PERSON_FIELD_GROUP[field];
  if (!group) return false;
  return canWritePersonGroup(group, relation, opts);
}

/** Split a PATCH body into unknown keys and keys the caller may not write. */
export function checkPersonPatch(
  body: Record<string, unknown>,
  relation: PersonRelation,
  opts: PersonWriteOpts = {},
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

/** Does this relationship see the full date of birth (the year too)? */
export function seesFullBirthday(relation: PersonRelation): boolean {
  return relation === "self" || relation === "admin" || relation === "people-team";
}

/**
 * A viewer who sees only the day and month cannot see what they would
 * overwrite, so they may fill a missing date of birth but never replace one.
 */
export function dobOverwriteAllowed(relation: PersonRelation, subjectHasDob: boolean): boolean {
  if (!canWritePersonGroup("dob", relation)) return false;
  return seesFullBirthday(relation) || !subjectHasDob;
}

/**
 * Employment status as a viewer may see it. The raw value (PIP, notice
 * period, probation, leave) is people data; everyone else learns only
 * whether the account is deactivated.
 */
export function visibleStatus(status: string, peopleData: boolean): string {
  if (peopleData) return status;
  return status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
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
