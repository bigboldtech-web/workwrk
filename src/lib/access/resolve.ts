// decide() — the pure resolver. Given AccessFacts, answer one action.
//
// This file is the whole algorithm of spec section 4: fourteen rules, in the
// spec's order, each commented with its number and one sentence. No database,
// no Prisma, no async, no clock (facts.now carries the time). That is what
// lets the golden suite hammer it in vitest's node environment with no mocks
// (spec 5.1 "why the split", graft G12).
//
// Pure: imports ./types, ./settings, ./enforcement only.

import {
  ROLE_RANK,
  meetsRole,
  minRole,
  type AccessFacts,
  type Action,
  type AppKey,
  type ChainLink,
  type Decision,
  type DecisionVia,
  type GrantFact,
  type ObjectRole,
  type Viewer,
} from "./types";
import { APP_RULES, SETTINGS_PAGE_GATES, type AppRule, type PageGate } from "./settings";
import { ENFORCED_AT, enforcedAtFor, type EnforcementKey } from "./enforcement";

/** Max hops the rule-10 walk takes up the chain (spec rule 10). */
const MAX_CHAIN_HOPS = 8;

interface Source {
  role: ObjectRole;
  via: DecisionVia;
  viaObject?: { type: string; id: string; name: string };
  reason: string;
}

type Best = {
  role: ObjectRole | "none";
  via: DecisionVia;
  viaObject?: Source["viaObject"];
  reason: string;
};

// ── Small viewer predicates ───────────────────────────────────────

function isOrgAdmin(viewer: Viewer): boolean {
  return viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
}

function isGuest(viewer: Viewer): boolean {
  return viewer.orgRole === "GUEST";
}

/** "Manager" is a fact about the org chart, never a rung (spec 2.2). */
export function hasReports(viewer: Viewer): boolean {
  return !!viewer.reportTree && viewer.reportTree.size > 0;
}

function isPeopleTeam(facts: AccessFacts): boolean {
  return (
    facts.relationships.peopleTeam ||
    facts.viewer.peopleTeam === true ||
    facts.org.peopleTeamIds.includes(facts.viewer.userId)
  );
}

// ── Grants (rules 6, 7, 8) ────────────────────────────────────────

/** Invariant 20: an expired row contributes nothing, with no cleanup job. */
function live(grant: GrantFact, now: number): boolean {
  return grant.expiresAt === null || grant.expiresAt > now;
}

/** Which of the viewer's principals this grant reaches, or null. */
function grantVia(grant: GrantFact, viewer: Viewer): DecisionVia | null {
  switch (grant.subjectType) {
    case "USER":
      return grant.subjectId === viewer.userId ? "shared" : null;
    case "TEAM":
      return grant.subjectId && viewer.teamIds?.includes(grant.subjectId) ? "team" : null;
    case "DEPARTMENT":
      return grant.subjectId && viewer.departmentId === grant.subjectId ? "department" : null;
    case "OFFICE":
      return grant.subjectId && viewer.officeId === grant.subjectId ? "office" : null;
    case "ROLE":
      return grant.subjectId && viewer.roleId === grant.subjectId ? "role" : null;
    case "TAG":
      return grant.subjectId && viewer.tagIds?.includes(grant.subjectId) ? "tag" : null;
    case "EVERYONE":
      // Rule 8: Members only, never Guests (invariant 3).
      return isGuest(viewer) ? null : "everyone";
    default:
      return null;
  }
}

function viaReason(via: DecisionVia): string {
  switch (via) {
    case "shared":
      return "Shared with you.";
    case "team":
      return "Shared with a team you are in.";
    case "department":
      return "Shared with your department.";
    case "office":
      return "Shared with your office.";
    case "role":
      return "Shared with your job title.";
    case "tag":
      return "Shared with a tag you carry.";
    case "everyone":
      return "Open to everyone in the workspace.";
    default:
      return "You have access.";
  }
}

function grantSources(facts: AccessFacts, objectId: string, inherited: ChainLink | null): Source[] {
  const out: Source[] = [];
  for (const grant of facts.grants) {
    if (grant.objectId !== objectId) continue;
    if (!live(grant, facts.now)) continue;
    const via = grantVia(grant, facts.viewer);
    if (!via) continue;
    out.push({
      role: grant.role,
      via: inherited ? "inherited" : via,
      viaObject: inherited ? { type: inherited.type, id: inherited.id, name: inherited.name } : undefined,
      reason: inherited ? `Inherited from ${inherited.name}.` : viaReason(via),
    });
  }
  return out;
}

// ── Rule 9: relationship rules, by object type ────────────────────

/**
 * Rule 9. Relationships are computed at read time and never stored (principle
 * 4), so each one is a boolean on facts.relationships. A type with no case
 * here gets nothing from rule 9.
 */
function relationshipSources(facts: AccessFacts): Source[] {
  const rel = facts.relationships;
  const obj = facts.object;
  const out: Source[] = [];
  const peopleTeam = isPeopleTeam(facts);
  const guest = isGuest(facts.viewer);
  const add = (role: ObjectRole, via: DecisionVia, reason: string) => out.push({ role, via, reason });

  switch (obj.type) {
    case "item":
      // Item assignee or creator = EDIT on the Item (this is what preserves
      // api/items/[id]/route.ts:27-31). The List stays locked: invariant 5,
      // handled by rule 14's VIEW-for-context, not here.
      if (rel.isAssignee) add("EDIT", "assigned", "Assigned to you.");
      if (rel.isCreator) add("EDIT", "assigned", "You created this task.");
      break;

    case "person":
      if (rel.isSelfSubject) add("EDIT", "assigned", "Your own record.");
      if (rel.managesSubject) add("EDIT", "manager-chain", "You manage them.");
      if (peopleTeam) add("EDIT", "people-team", "You are on the People team.");
      break;

    case "person_card":
      // Invariant 3: every Member sees every directory card; a Guest sees only
      // people they already share an object with.
      if (rel.isSelfSubject) add("VIEW", "assigned", "Your own card.");
      if (guest) {
        if (rel.sharesObjectWithSubject) add("VIEW", "shared", "You share work with them.");
      } else {
        add("VIEW", "everyone", "Everyone in the workspace sees the directory.");
      }
      break;

    case "timesheet":
      // Spec 3.3: a timesheet is the people data of its owner.
      if (rel.isSelfSubject) add("EDIT", "assigned", "Your timesheet.");
      if (rel.managesSubject) add("EDIT", "manager-chain", "You manage them.");
      if (peopleTeam) add("EDIT", "people-team", "You are on the People team.");
      break;

    case "goal":
      if (rel.isGoalAudience) add("EDIT", "assigned", "You are in this goal's audience.");
      if (rel.managesSubject) add("EDIT", "manager-chain", "You manage the goal's owner.");
      if (peopleTeam) add("EDIT", "people-team", "You are on the People team.");
      break;

    case "kra":
      // KRA and KPI definitions are VIEW for every Member (needed for tagging).
      if (!guest) add("VIEW", "everyone", "KRA definitions are open to the workspace.");
      if (rel.managesSubject) add("EDIT", "manager-chain", "You manage the people this is assigned to.");
      if (peopleTeam) add("EDIT", "people-team", "You are on the People team.");
      break;

    case "sop":
      if (rel.isSopAuthor && !obj.published) add("EDIT", "assigned", "Your draft.");
      if (rel.isSopAssignee) add(obj.published ? "COMMENT" : "VIEW", "assigned", "Assigned to you.");
      break;

    case "policy":
      if (rel.isPolicyAssignee) add("COMMENT", "assigned", "Assigned to you to acknowledge.");
      if (obj.orgWide && obj.published && !guest) add("VIEW", "everyone", "Published to the whole workspace.");
      if (peopleTeam) add("FULL", "people-team", "You are on the People team.");
      break;

    case "contract":
      if (rel.isContractParty) add("VIEW", "assigned", "You are a party to this contract.");
      if (peopleTeam) add("FULL", "people-team", "You are on the People team.");
      break;

    case "channel":
      if (rel.isConversationMember) add("EDIT", "assigned", "You are in this channel.");
      break;

    case "team":
      if (rel.isTeamLead) add("FULL", "assigned", "You lead this team.");
      if (rel.isTeamMember) add("VIEW", "assigned", "You are on this team.");
      break;

    case "asset":
      if (rel.isAssetAssignee) add("VIEW", "assigned", "Assigned to you.");
      if (rel.managesSubject) add("VIEW", "manager-chain", "You manage the person it is assigned to.");
      if (peopleTeam) add("FULL", "people-team", "You are on the People team.");
      break;

    case "survey":
      if (rel.isSurveyTarget) add("COMMENT", "assigned", "You were asked to respond.");
      if (peopleTeam) add("FULL", "people-team", "You are on the People team.");
      break;

    case "announcement":
      // Spec 3.3: org-wide = EVERYONE VIEW (never Guests); a targeted
      // announcement reaches only the people its audience resolves to, which
      // is what viewerInAnnouncementAudience already answers for the feed.
      if (obj.orgWide && !guest) add("VIEW", "everyone", "Announced to the workspace.");
      else if (rel.isAnnouncementAudience && !guest) add("VIEW", "assigned", "Announced to you.");
      if (peopleTeam) add("FULL", "people-team", "You are on the People team.");
      break;

    case "review_cycle":
      if (rel.isReviewSubject) add("VIEW", "assigned", "Your review.");
      if (rel.managesSubject) add("EDIT", "manager-chain", "You manage the people under review.");
      if (peopleTeam) add("FULL", "people-team", "You are on the People team.");
      break;

    case "candor":
      if (rel.isCandorParticipant) add("COMMENT", "assigned", "You were invited to respond.");
      if (rel.managesSubject) add("FULL", "manager-chain", "The session covers your chain.");
      if (peopleTeam) add("FULL", "people-team", "You are on the People team.");
      break;

    case "automation":
      if (!guest) add("VIEW", "everyone", "Workflows are listed for the workspace.");
      break;

    case "template":
      if (!guest) add("VIEW", "everyone", "Templates are open to the workspace.");
      break;

    case "kudos":
      if (!guest) add("EDIT", "everyone", "Kudos are open to the workspace.");
      break;

    default:
      break;
  }
  return out;
}

// ── Rules 1 to 4: the short-circuits ──────────────────────────────

function refEnforcedAt(facts: AccessFacts, action: Action): string {
  if (facts.app) return ENFORCED_AT[`app.${facts.app}` as EnforcementKey];
  if (facts.settingsPage) {
    return ENFORCED_AT[`settings.${facts.settingsPage}` as EnforcementKey] ?? ENFORCED_AT["rule.4.org-admin"];
  }
  if (facts.orgAction) {
    return ENFORCED_AT[`org.${facts.orgAction}` as EnforcementKey] ?? ENFORCED_AT["rule.4.org-admin"];
  }
  return enforcedAtFor(action, facts.object.type);
}

function notFound(facts: AccessFacts, action: Action, reason: string): Decision {
  return {
    allowed: false,
    role: "none",
    via: "none",
    reason,
    discoverable: false,
    enforcedAt: refEnforcedAt(facts, action),
  };
}

/**
 * The statuses rule 1 refuses.
 *
 * Spec rule 1 words this as "status not ACTIVE or PROBATION". Taken literally
 * that 404s an ON_LEAVE, PIP or NOTICE_PERIOD employee out of the whole
 * product, which contradicts the codebase's own decided position: auth.ts
 * :151-156 signs all five of those statuses in and says in as many words that
 * "ON_LEAVE / PROBATION / PIP / NOTICE_PERIOD are still employed and keep
 * their access", refusing only deletedAt and INACTIVE. No gate in the codebase
 * checks status at all today, so the literal reading would be an unrecorded
 * NARROWING that locks real people out on flip day, which the step's parity
 * rule forbids.
 *
 * So rule 1 denies exactly the set that cannot hold a session: INACTIVE (plus
 * `deleted`, checked separately). The deviation from the spec's wording is
 * recorded in parity.ts UNMODELLED_DIFFERENCES under
 * "rule-1-status-follows-auth-not-the-literal-spec", and LegacyInputs carries
 * `status` so the step-2 job can surface it rather than hard-coding ACTIVE.
 */
export const RULE_1_DENIED_STATUSES: ReadonlySet<string> = new Set(["INACTIVE"]);

/**
 * Rule 1, viewer half. Not signed in, soft-deleted, or a status that cannot
 * hold a session. Short-circuit: none, not discoverable, and the body is
 * identical to a real 404 (invariant 1).
 */
function rule1Viewer(facts: AccessFacts, action: Action): Decision | null {
  const v = facts.viewer;
  if (!v.userId || !v.organizationId) return notFound(facts, action, "Not signed in.");
  if (v.deleted) return notFound(facts, action, "Not found.");
  if (v.status && RULE_1_DENIED_STATUSES.has(v.status)) {
    return notFound(facts, action, "Not found.");
  }
  return null;
}

/**
 * Rule 1, object half: the object is not in the viewer's org. It runs after
 * rule 2 on purpose, because rule 2 answers before the object row is loaded:
 * with a module off there IS no row to scope, and example K requires the
 * module-off body to be identical for an id that does not exist. Everywhere
 * else this is still the first thing that touches the object.
 */
function rule1Object(facts: AccessFacts, action: Action): Decision | null {
  if (facts.app || facts.settingsPage || facts.orgAction) return null;
  if (facts.object.organizationId !== facts.viewer.organizationId) {
    return notFound(facts, action, "Not found.");
  }
  return null;
}

/** The legacy Apps-config tier vocabulary, as a predicate over the viewer. */
function clearsAppFloor(tier: string, facts: AccessFacts): boolean {
  if (isOrgAdmin(facts.viewer)) return true;
  if (tier === "org-admin") return false;
  if (tier === "hr-admin") return isPeopleTeam(facts);
  if (tier === "manager") return isPeopleTeam(facts) || hasReports(facts.viewer);
  // An unknown tier reads as the narrowest, which is why parseOrgAppsConfig
  // drops unknown tiers rather than letting them fall through the ladder.
  return false;
}

/**
 * Rule 2. The object's module is off for the org, or its app is hidden or
 * floored by the Apps config. Short-circuit, and it beats the Admin rule
 * (invariant 8) so a disabled module cannot leak through search, embeds or
 * bookmarks. It reads only the module and app key, never the object row, so it
 * confirms nothing about any id (invariant 14, example K).
 */
function rule2(facts: AccessFacts): Decision | null {
  const appKey: AppKey | null = facts.app ?? facts.object.appKey ?? null;
  const moduleKey = facts.object.moduleKey ?? (appKey ? APP_RULES[appKey]?.moduleKey ?? null : null);
  const guest = isGuest(facts.viewer);

  if (moduleKey && !facts.org.activeModules.has(moduleKey)) {
    return {
      allowed: false,
      role: "none",
      via: "module-off",
      reason: "This module is turned off for your workspace.",
      // Owners, Admins and Members may ask about a module; Guests may not.
      discoverable: !guest,
      context: { module: moduleKey },
      enforcedAt: ENFORCED_AT["rule.2.module-off"],
    };
  }

  if (appKey) {
    const rule: AppRule | undefined = APP_RULES[appKey];
    const pinned = rule?.alwaysPinned === true;
    const hidden = !pinned && (facts.org.apps.hidden ?? []).includes(appKey);
    const floor = pinned ? undefined : facts.org.apps.minAccess?.[appKey];
    if (hidden || (floor && !clearsAppFloor(floor, facts))) {
      return {
        allowed: false,
        role: "none",
        via: "app-off",
        reason: "This app is switched off for your workspace.",
        discoverable: !guest,
        context: { app: appKey },
        enforcedAt: ENFORCED_AT["rule.2.module-off"],
      };
    }
  }
  return null;
}

/**
 * Rule 3. The owner-only hard rule: Notepad docs, DMs and private channels the
 * viewer is not in. Short-circuit, and it precedes rule 4, so Owners and
 * Admins get no read-around (invariant 7).
 */
function rule3(facts: AccessFacts, action: Action): Decision | null {
  const kind = facts.object.ownerOnly ?? null;
  if (!kind) return null;

  if (kind === "notepad") {
    if (facts.object.ownerOnlySubjectId === facts.viewer.userId) {
      return finish(facts, action, { role: "FULL", via: "owner", reason: "Your notepad." });
    }
    return {
      allowed: false,
      role: "none",
      via: "none",
      reason: "Personal notepads are private to their owner.",
      discoverable: false,
      enforcedAt: ENFORCED_AT["rule.3.owner-only"],
    };
  }

  // Spec 3.6: "ConversationMember rows are the grant at EDIT; creator FULL."
  // The creator check comes first so a private channel's owner can rename,
  // archive and manage the channel they made.
  if (facts.object.ownerId && facts.object.ownerId === facts.viewer.userId) {
    return finish(facts, action, { role: "FULL", via: "owner", reason: "You created this conversation." });
  }
  if (facts.relationships.isConversationMember) {
    return finish(facts, action, { role: "EDIT", via: "assigned", reason: "You are in this conversation." });
  }
  return {
    allowed: false,
    role: "none",
    via: "none",
    reason:
      kind === "dm"
        ? "Direct messages are private to the people in them."
        : "This is a private channel you are not in.",
    discoverable: false,
    enforcedAt: ENFORCED_AT["rule.3.owner-only"],
  };
}

// ── Rules 5 to 10: gather every source ────────────────────────────

function ownSources(facts: AccessFacts): Source[] {
  const out: Source[] = [];
  const obj = facts.object;

  // Rule 5: the viewer is the object's ownerId / createdById. One carve-out:
  // a SOP author holds their SOP only while it is a draft (spec 3.3).
  const ownerCounts = obj.type !== "sop" || !obj.published;
  if (ownerCounts && obj.ownerId && obj.ownerId === facts.viewer.userId) {
    out.push({ role: "FULL", via: "owner", reason: "You own this." });
  }

  // Rules 6, 7 and 8: direct, group and EVERYONE grants on this object.
  out.push(...grantSources(facts, obj.id, null));

  // Rule 9: the relationship rules for this type.
  out.push(...relationshipSources(facts));

  return out;
}

/**
 * Rule 10. Unless the object is Restricted, apply rules 5 to 8 to each
 * ancestor in turn, up to the Space (max 8 hops). A Restricted ancestor is
 * itself evaluated and then stops the walk: Restricted means "do not inherit
 * from MY parent" and never cancels a grant held on the restricted object
 * itself (spec 3.3, add-never-subtract). Rule 9's relationships are
 * type-specific and belong to the object, so they are not re-run per ancestor.
 */
function inheritedSources(facts: AccessFacts): Source[] {
  const out: Source[] = [];
  if (facts.object.restricted) return out;

  const hops = Math.min(facts.chain.length, MAX_CHAIN_HOPS);
  for (let i = 0; i < hops; i++) {
    const link = facts.chain[i];
    if (link.ownerId && link.ownerId === facts.viewer.userId) {
      out.push({
        role: "FULL",
        via: "inherited",
        viaObject: { type: link.type, id: link.id, name: link.name },
        reason: `You own ${link.name}.`,
      });
    }
    out.push(...grantSources(facts, link.id, link));
    if (link.restricted) break;
  }
  return out;
}

// ── Rules 11 to 14 ────────────────────────────────────────────────

function isArchived(facts: AccessFacts): boolean {
  return facts.object.archived || facts.chain.some((link) => link.archived);
}

/**
 * Rule 14, computed only when the role is none.
 *
 * The "(never a Guest)" clause of rule 14 attaches to the FINDABLE branch, not
 * to the descendant branch. Worked example A spells both halves out for the
 * same Guest: "/spaces/marketing is a 404 for him even though Marketing is
 * findable (Guests never discover)", and, two lines earlier, "can(Ravi, 'view',
 * Folder Q4) ... rule 14: descendant role, discoverable as a container label
 * ... Folder page renders LockedPage". Spec 2.3's Guest sidebar says the same
 * thing ("exactly the objects they can read, inside their containers as bare
 * labels"), which is unreachable if a Guest discovers nothing. So: a Guest
 * never discovers by findability, and always sees the containers of what they
 * hold.
 */
function discoverabilityFor(facts: AccessFacts): boolean {
  const rel = facts.relationships;
  // A role on any descendant makes the ancestor a container label, and an
  // assigned Item inside a List makes the List discoverable with context.
  if (rel.holdsDescendant) return true;
  if (rel.hasAssignedItemInside) return true;

  // Findability is for Members only (invariant 3) and is a Space and
  // public-channel property: Folders and Lists are never findable on their own.
  if (isGuest(facts.viewer)) return false;
  const type = facts.object.type;
  if (type !== "space" && type !== "channel") return false;
  if (!facts.org.access.findableSpaces) return false;
  if (!facts.object.findable) return false;
  // Inherited as a ceiling: every ancestor must be findable too.
  return facts.chain.every((link) => link.findable);
}

/**
 * Rule 13. The action check, with the toggles rule 13 names and the rule-12
 * hard denials that survive any role.
 * Returns null when allowed, or the denial sentence.
 */
function actionDenial(
  facts: AccessFacts,
  action: Action,
  role: ObjectRole | "none",
  /**
   * The role after every rule-12 cap EXCEPT the archived one. The archive
   * action's escape hatch (a FULL holder may restore an archived object) is
   * measured against this, never against the uncapped role: measuring against
   * the uncapped role would let an Agent, a Guest or an EDIT-capped API key
   * archive and restore anything whose pre-cap role happened to be FULL, which
   * is exactly what rule 12 exists to stop.
   */
  preArchive: ObjectRole | "none",
): string | null {
  const v = facts.viewer;
  const access = facts.org.access;
  const admin = isOrgAdmin(v);

  // Rule-12 hard denials.
  if (action === "share" && isGuest(v)) return "Guests never share.";
  // Spec 2.3: a Guest "cannot invite anyone". decideOrg blocks the org verb;
  // this blocks the object-level one the share dialog calls, which a Guest can
  // otherwise reach through the FULL rule 12 preserves on their own creations.
  if (action === "invite_guest" && isGuest(v)) return "Guests never invite anyone.";
  if (v.isAgent && action === "delete") return "Agents never delete.";
  if (v.isAgent && action === "export") return "Agents never export.";
  if (v.actingAs && action === "export") return "Keys, agents and crons never export.";
  // Spec 2.5: "Agents never share, never export, never read people data beyond
  // the acting user."
  if (v.actingAs?.type === "agent" && action === "share") return "Agent runs never share.";
  if (
    v.actingAs?.type === "agent" &&
    (facts.object.type === "person" || facts.object.type === "timesheet") &&
    !facts.relationships.isSelfSubject
  ) {
    return "Agent runs never read people data beyond the acting user.";
  }
  if (action === "export" && isGuest(v)) return "Guests never export.";

  switch (action) {
    case "view":
      return meetsRole(role, "VIEW") ? null : "You need Can view for that.";
    case "comment":
      return meetsRole(role, "COMMENT") ? null : "You need Can comment for that.";
    case "edit":
    case "create_child":
      // create_child is content, not management (decision D15).
      return meetsRole(role, "EDIT") ? null : "You need Can edit for that.";
    case "export":
      return meetsRole(role, "EDIT") ? null : "You need Can edit to export.";
    case "share":
      if (meetsRole(role, "FULL")) return null;
      if (access.editorsCanShare && meetsRole(role, "EDIT")) return null;
      return "You need Full access to share.";
    case "invite_guest":
      if (access.whoCanInviteGuests === "nobody") return "Guest invitations are turned off.";
      if (access.whoCanInviteGuests === "admins" && !admin) return "Only admins invite guests here.";
      return meetsRole(role, "FULL") ? null : "You need Full access to invite a guest.";
    case "publish":
      if (access.whoCanPublish === "admins_people_team") {
        // Toggle 7 is a RESTRICTION, not a grant: it narrows who may publish,
        // it does not hand publish rights on an object the viewer cannot even
        // see. Without the role check finish() would emit the incoherent
        // { allowed: true, role: "none" } for any People-team member against
        // every SOP in the org.
        if (!admin && !isPeopleTeam(facts)) return "Only admins and the People team publish here.";
        return role === "none" ? "You do not have access to this." : null;
      }
      return meetsRole(role, "EDIT") ? null : "You need Can edit to publish.";
    case "delete":
      if (access.whoCanDelete === "admins" && !admin) return "Only admins delete here.";
      return meetsRole(role, "FULL") ? null : "You need Full access to delete.";
    case "archive":
      // Rule 12's archived cap keeps a FULL holder's Restore working, and only
      // that cap: `preArchive` has already had the Guest, Agent and acting-as
      // caps applied.
      if (meetsRole(role, "FULL") || preArchive === "FULL") return null;
      return "You need Full access for that.";
    case "manage":
    case "restrict":
    case "findable":
    case "move":
    case "transfer":
      return meetsRole(role, "FULL") ? null : "You need Full access for that.";
    default:
      return "Not allowed.";
  }
}

/**
 * Rules 12, 13 and 14, and the Decision shape. Every path that produces a role
 * ends here, including the rule-3 and rule-4 short-circuits, so the caps and
 * the action check can never be skipped.
 */
/**
 * Rule 12's principal caps, in the spec's order, MINUS the archived cap. Every
 * decision path runs this, object refs and the app / settings / org tables
 * alike: a cap that only applied to object refs would let an EDIT-capped API
 * key open /settings/billing at FULL (spec 2.5, "no cron path holds FULL").
 */
function principalCaps(viewer: Viewer, role: ObjectRole | "none", via: DecisionVia): ObjectRole | "none" {
  let out = role;
  // Guest: at most EDIT; FULL only on their own creations (rule 5).
  if (isGuest(viewer) && out === "FULL" && via !== "owner") out = "EDIT";
  // Agent: at most EDIT (delete, export and create_space are rule-13 denials).
  if (viewer.isAgent) out = minRole(out, "EDIT");
  // Acting-as: at most min(actingFor's live level, cap).
  if (viewer.actingAs) out = minRole(out, viewer.actingAs.cap);
  return out;
}

function finish(facts: AccessFacts, action: Action, best: Best): Decision {
  const v = facts.viewer;

  // ── Rule 12: caps, in this order ──
  const preArchive = principalCaps(v, best.role, best.via);
  let role = preArchive;
  // Archived: at most VIEW unless the (already capped) role is FULL, which is
  // what lets a real Full holder restore.
  if (isArchived(facts) && preArchive !== "FULL") role = minRole(role, "VIEW");

  // ── Rule 13 ──
  const denial = actionDenial(facts, action, role, preArchive);

  // ── Rule 14, only when the role is none ──
  const discoverable = role === "none" ? discoverabilityFor(facts) : true;

  return {
    allowed: denial === null,
    role,
    via: role === "none" ? "none" : best.via,
    viaObject: role === "none" ? undefined : best.viaObject,
    reason: denial ?? best.reason,
    discoverable,
    // VIEW-for-context (invariant 5): the List's name, statuses and fields for
    // a viewer who only holds an Item inside it.
    context: role === "none" ? facts.object.context : undefined,
    enforcedAt: enforcedAtFor(action, facts.object.type),
  };
}

// ── App, settings and org refs ────────────────────────────────────

function appAudienceAllows(rule: AppRule, facts: AccessFacts): boolean {
  const v = facts.viewer;
  switch (rule.audience) {
    case "signed-in":
      return true;
    case "member":
      return !isGuest(v);
    case "reports-people-team-admin":
      return isOrgAdmin(v) || isPeopleTeam(facts) || hasReports(v);
    case "people-team-admin":
      return isOrgAdmin(v) || isPeopleTeam(facts);
    case "owner-admin":
      return isOrgAdmin(v);
    default:
      return false;
  }
}

/** Spec 5.2.1: a key with no row does not render and its route 404s. */
function decideApp(facts: AccessFacts, action: Action): Decision {
  const key = facts.app as AppKey;
  const rule = APP_RULES[key];
  const enforcedAt = ENFORCED_AT[`app.${key}` as EnforcementKey] ?? ENFORCED_AT["rule.2.module-off"];
  const deny = (reason: string): Decision => ({
    allowed: false,
    role: "none",
    via: "none",
    reason,
    discoverable: false,
    enforcedAt,
  });

  if (!rule) return deny("This app does not exist.");
  if (isGuest(facts.viewer)) {
    if (rule.guest === "none") return deny("Guests do not see this app.");
    // "shared" means the row renders only when something of that kind is
    // shared with them (spec 5.2.1). loadFacts answers that for the app keys
    // accessibleIds can count today and leaves it undefined for the rest;
    // undefined keeps today's answer rather than inventing a narrowing (see
    // parity.ts UNMODELLED_DIFFERENCES "app-guest-shared-is-partly-unanswerable").
    if (rule.guest === "shared" && facts.appShared === false) {
      return deny("Nothing of this kind is shared with you.");
    }
  } else if (!appAudienceAllows(rule, facts)) {
    return deny("This app is not part of your workspace role.");
  }

  const uncapped: ObjectRole = isOrgAdmin(facts.viewer) ? "FULL" : "VIEW";
  const via: DecisionVia = isOrgAdmin(facts.viewer) ? "org-admin" : "everyone";
  const role = principalCaps(facts.viewer, uncapped, via);
  const denial = actionDenial(facts, action, role, role);
  return {
    allowed: denial === null && role !== "none",
    role,
    via,
    reason: denial ?? "You can open this app.",
    discoverable: true,
    enforcedAt,
  };
}

/**
 * Spec 6.6 plus rule 14's settings clause: Workspace pages are always
 * discoverable to Owners and Admins (example H), the People team discovers the
 * four peopleTeamRead pages, nobody else discovers anything, and nothing under
 * /settings/* ever 404s for a signed-in person (spec 5.5 item 3).
 */
function decideSettings(facts: AccessFacts, action: Action): Decision {
  const page = facts.settingsPage as keyof typeof SETTINGS_PAGE_GATES;
  const gate: PageGate | undefined = SETTINGS_PAGE_GATES[page];
  const enforcedAt = ENFORCED_AT[`settings.${page}` as EnforcementKey] ?? ENFORCED_AT["rule.4.org-admin"];
  const v = facts.viewer;
  const admin = isOrgAdmin(v);
  const peopleTeam = isPeopleTeam(facts);

  if (!gate) {
    return {
      allowed: false,
      role: "none",
      via: "none",
      reason: "No such settings page.",
      discoverable: false,
      enforcedAt,
    };
  }

  if (gate.gate === "personal") {
    // Rule 12 applies here too: a key or an agent run acting for a person does
    // not get FULL on that person's account pages just because the page is
    // "personal".
    const personal = principalCaps(v, "FULL", "owner");
    const denial = actionDenial(facts, action, personal, personal);
    return {
      allowed: denial === null && personal !== "none",
      role: personal,
      via: "owner",
      reason: denial ?? "Your own settings.",
      discoverable: true,
      enforcedAt,
    };
  }

  let role: ObjectRole | "none" = "none";
  let via: DecisionVia = "none";
  let reason = "Workspace settings are managed by admins.";

  if (v.orgRole === "OWNER") {
    role = "FULL";
    via = "org-admin";
    reason = "You own this workspace.";
  } else if (v.orgRole === "ADMIN") {
    if (gate.gate === "owner-admin") {
      role = "FULL";
      via = "org-admin";
      reason = "You administer this workspace.";
    } else if (gate.scope && v.adminScopes.includes(gate.scope)) {
      role = "FULL";
      via = "org-admin";
      reason = "An owner delegated this to you.";
    } else {
      reason =
        gate.scope === "billing"
          ? "Billing is managed by workspace Owners."
          : "Security and integrations are managed by workspace Owners.";
    }
  } else if (gate.peopleTeamRead && peopleTeam) {
    role = "VIEW";
    via = "people-team";
    reason = "You are on the People team.";
  }

  // Rule 12's caps, before the action check: an API key whose creator is an
  // Owner still only reaches a settings page at min(FULL, its cap), so a
  // READ/WRITE key (cap EDIT) cannot `manage` Billing, Security or API keys.
  const capped = principalCaps(v, role, via);
  const denial = capped === "none" ? reason : actionDenial(facts, action, capped, capped);
  return {
    allowed: capped !== "none" && denial === null,
    role: capped,
    via: capped === "none" ? "none" : via,
    reason: denial ?? reason,
    discoverable: admin || (gate.peopleTeamRead === true && peopleTeam),
    enforcedAt,
  };
}

/** Spec 8 toggles 1 and 5, plus section 2.8. Org verbs carry no object role. */
function decideOrg(facts: AccessFacts): Decision {
  const v = facts.viewer;
  const access = facts.org.access;
  const orgAction = facts.orgAction as string;
  const enforcedAt = ENFORCED_AT[`org.${orgAction}` as EnforcementKey] ?? ENFORCED_AT["rule.4.org-admin"];
  const admin = isOrgAdmin(v);
  const guest = isGuest(v);

  // `via` names WHY the answer is yes, and the answer's explain string is read
  // by the access debugger. An org verb a People-team seat unlocks says so
  // rather than saying "everyone", which would be a different (and wrong)
  // reason with the same outcome.
  const ok = (reason: string, via?: DecisionVia): Decision => {
    const source: DecisionVia = via ?? (admin ? "org-admin" : "everyone");
    return {
      allowed: true,
      role: principalCaps(v, "FULL", source),
      via: source,
      reason,
      discoverable: true,
      enforcedAt,
    };
  };
  const no = (reason: string): Decision => ({
    allowed: false,
    role: "none",
    via: "none",
    reason,
    discoverable: !guest,
    enforcedAt,
  });

  // Rule 12: an acting-as principal never exceeds the acting human, and the
  // admin-shaped org verbs all need the FULL end of the ladder. A key, an
  // agent run or a cron capped below FULL is refused them outright, which is
  // what "no cron path holds FULL" (spec 2.5) means at the org level.
  const ADMIN_ORG_ACTIONS = new Set(["invite_member", "invite_guest", "archive_channel", "export_people"]);
  const WRITE_ORG_ACTIONS = new Set(["create_space", "create_team", "create_automation"]);
  if (v.actingAs && ADMIN_ORG_ACTIONS.has(orgAction) && v.actingAs.cap !== "FULL") {
    return no("Keys, agents and crons never do that.");
  }
  if (v.actingAs && WRITE_ORG_ACTIONS.has(orgAction) && !meetsRole(v.actingAs.cap, "EDIT")) {
    // A read-only cron (cap VIEW, spec 2.5) creates nothing.
    return no("This key, agent or cron is read only.");
  }

  switch (orgAction) {
    case "create_space":
    case "create_team":
      if (guest) return no("Guests never create spaces.");
      if (v.isAgent) return no("Agents never create spaces.");
      if (access.whoCanCreateSpaces === "admins" && !admin) return no("Only admins create spaces here.");
      return ok("You can create spaces.");
    case "invite_member":
      // Spec 2.8: the in-domain alternative lives on the Members page's Invite
      // rules card, not in settings.access, so step 0 keeps the default.
      return admin ? ok("You can invite members.") : no("Only owners and admins invite members.");
    case "invite_guest":
      if (access.whoCanInviteGuests === "nobody") return no("Guest invitations are turned off.");
      if (guest) return no("Guests never invite anyone.");
      if (access.whoCanInviteGuests === "admins" && !admin) return no("Only admins invite guests here.");
      return ok("You can invite a guest to something you have Full access on.");
    case "create_automation":
      if (guest) return no("Guests never create workflows.");
      return ok("You can create workflows.");
    case "archive_channel":
      return admin ? ok("You can archive channels.") : no("Only owners and admins archive channels.");
    case "export_people":
      if (v.actingAs) return no("Keys, agents and crons never export.");
      if (v.isAgent) return no("Agents never export.");
      return admin ? ok("You can export people data.") : no("Only owners and admins export people data.");
    case "manage_process":
      // spec-process section 1: Owner, Admin, People team. An Agent is none
      // of those by definition (it holds no People-team seat), and it is
      // refused here rather than relied upon, so an Agent that is somehow on
      // the People-team list still cannot rewrite the org's taxonomies.
      if (guest) return no("Guests never change process settings.");
      if (v.isAgent) return no("Agents never change process settings.");
      if (admin) return ok("You can manage SOP folders, policy categories and acknowledgement defaults.");
      if (isPeopleTeam(facts)) {
        return ok("You can manage SOP folders, policy categories and acknowledgement defaults.", "people-team");
      }
      return no("Only owners, admins and the People team change process settings.");
    default:
      return no("Not allowed.");
  }
}

// ── The entry point ───────────────────────────────────────────────

/** decide(facts, action) — the pure half of can(). Rules 1 to 14, in order. */
export function decide(facts: AccessFacts, action: Action): Decision {
  // Rule 1: the viewer half runs before anything else (invariant 1).
  const r1 = rule1Viewer(facts, action);
  if (r1) return r1;

  // Rule 2: module off / app off, before the Admin rule (invariant 8) and
  // before the object row exists (invariant 14, example K).
  const r2 = rule2(facts);
  if (r2) return r2;

  // Refs that are not objects resolve on their own tables.
  if (facts.app) return decideApp(facts, action);
  if (facts.settingsPage) return decideSettings(facts, action);
  if (facts.orgAction) return decideOrg(facts);

  // Rule 1: the object half, the moment there is an object to scope.
  const r1o = rule1Object(facts, action);
  if (r1o) return r1o;

  // Rule 3: owner-only hard rule, before the Admin rule (invariant 7).
  const r3 = rule3(facts, action);
  if (r3) return r3;

  // Rule 4: org Owner or Admin short-circuits to Full access.
  if (isOrgAdmin(facts.viewer)) {
    return finish(facts, action, {
      role: "FULL",
      via: "org-admin",
      reason: "You administer this workspace.",
    });
  }

  // Rules 5 to 10: every source, on the object and then up the chain.
  const sources = [...ownSources(facts), ...inheritedSources(facts)];

  // Rule 11: the maximum of every source.
  let best: Best = { role: "none", via: "none", reason: "You do not have access to this." };
  for (const source of sources) {
    if (ROLE_RANK[source.role] > ROLE_RANK[best.role]) best = source;
  }
  // Rules 12, 13 and 14.
  return finish(facts, action, best);
}

/**
 * The rules that answer before any source is gathered: rule 1 (both halves),
 * rule 2 and rule 3. Exported so explain() and every other reader of the
 * source list runs them first; skipping them is how a Check-access panel ends
 * up listing "org-admin: FULL" for another tenant's object id. A non-null
 * result is the whole answer, allow or deny.
 */
export function shortCircuit(facts: AccessFacts, action: Action): Decision | null {
  const r1 = rule1Viewer(facts, action);
  if (r1) return r1;
  const r2 = rule2(facts);
  if (r2) return r2;
  if (facts.app || facts.settingsPage || facts.orgAction) return null;
  const r1o = rule1Object(facts, action);
  if (r1o) return r1o;
  return rule3(facts, action);
}

/**
 * explain()'s pure half: every source that produced a role, not just the
 * maximum. Feeds the Check-access panel and the parity report.
 *
 * It answers [] whenever a short-circuit fired, so a cross-org id, a
 * module-off ref or a Notepad never reports a source. A caller that sees []
 * must fall back to decide()'s own answer, which is what users.ts explain()
 * does.
 */
export function explainSources(
  facts: AccessFacts,
): Array<{ role: ObjectRole; via: DecisionVia; reason: string }> {
  if (facts.app || facts.settingsPage || facts.orgAction) return [];
  if (shortCircuit(facts, "view")) return [];
  if (isOrgAdmin(facts.viewer)) {
    return [{ role: "FULL", via: "org-admin", reason: "You administer this workspace." }];
  }
  return [...ownSources(facts), ...inheritedSources(facts)].map((s) => ({
    role: s.role,
    via: s.via,
    reason: s.reason,
  }));
}
