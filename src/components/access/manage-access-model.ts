// The Manage access dialog's words and rules, with nothing to render.
//
// Everything the dialog SAYS is decided here, from the AccessPanel the server
// sends (src/lib/access/access-panel.ts), so the sentences can be read and
// tested in one place and no component re-types a role word: role names come
// only from panelRoleLabel, and error sentences only from GRANT_ERROR_MESSAGE
// plus the two kind-aware exceptions below.
//
// Pure: imports the access-panel types and its pure helpers only, so vitest
// loads it in node.

import {
  GRANT_ERROR_MESSAGE, MANAGE_BAR, PANEL_ROLE_RANK, panelAtLeast, panelRoleLabel,
  type AccessDirectEntry, type AccessInheritedEntry, type AccessNodeKind, type AccessPanel, type AccessPerson,
  type AccessVia, type GrantChange, type GrantErrorCode, type PanelRole,
} from "@/lib/access/access-panel";

// ── Nouns ───────────────────────────────────────────────────────────

/**
 * The noun inside a sentence. The three containers are product names and keep
 * their capital ("this Space", "this Folder", "this List"), as the rest of the
 * Work surfaces write them; the objects read as plain words ("this doc").
 */
export function sentenceNoun(kind: AccessNodeKind): string {
  switch (kind) {
    case "space": return "Space";
    case "folder": return "Folder";
    case "list": return "List";
    case "doc": return "doc";
    case "table": return "table";
    case "canvas": return "canvas";
    case "form": return "form";
  }
}

export function dialogTitle(panel: AccessPanel | null, readOnly: boolean): string {
  return panel && panel.viewer.canManage && !readOnly && !panel.node.notepadOwner ? "Manage access" : "Who has access";
}

export function dialogSubtitle(panel: AccessPanel): string {
  return `${panel.node.noun} · ${panel.node.name}`;
}

/** The write controls render: the viewer manages this node and the host did not open it read-only. */
export function canManageHere(panel: AccessPanel | null, readOnly: boolean): boolean {
  return !!panel && panel.viewer.canManage && !readOnly && !panel.node.notepadOwner;
}

// ── Roles ───────────────────────────────────────────────────────────

const rank = (r: PanelRole | "none") => PANEL_ROLE_RANK[r];

/** The roles this viewer may hand out here: the kind's roles at or below maxGrant, in the server's order. */
export function roleOptions(panel: Pick<AccessPanel, "roles" | "viewer">): PanelRole[] {
  const max = panel.viewer.maxGrant;
  if (!max) return [];
  return panel.roles.filter((r) => rank(r) <= rank(max));
}

/**
 * The options one row's select renders. A row the server lets the viewer
 * change always shows its CURRENT role, even when that role is above what the
 * viewer may grant, so the select never pretends the person holds less.
 */
export function entryRoleOptions(panel: Pick<AccessPanel, "roles" | "viewer">, entry: Pick<AccessDirectEntry, "role">): PanelRole[] {
  const offered = roleOptions(panel);
  if (offered.includes(entry.role)) return offered;
  return panel.roles.filter((r) => r === entry.role || offered.includes(r));
}

/** What an Add starts at: Can edit when it is offered, else the lowest offered role. */
export function defaultRole(roles: readonly PanelRole[]): PanelRole | null {
  if (roles.length === 0) return null;
  if (roles.includes("EDIT")) return "EDIT";
  return roles.reduce((low, r) => (rank(r) < rank(low) ? r : low), roles[0]);
}

/** The owner, the last Full holder and a read-only dialog never offer a role select. */
export function canEditEntry(entry: AccessDirectEntry, readOnly: boolean): boolean {
  return !readOnly && !entry.owner && !entry.lastFull && entry.editable;
}

/** The owner, the last Full holder and a read-only dialog never offer Remove. */
export function canRemoveEntry(entry: AccessDirectEntry, readOnly: boolean): boolean {
  return !readOnly && !entry.owner && !entry.lastFull && entry.removable;
}

/**
 * Lowering your OWN row below the kind's manage bar would take this dialog's
 * controls away from you, so it asks first. Nothing is lost when another
 * source keeps you at or above the bar.
 */
export function lowersOwnManage(panel: AccessPanel, entry: AccessDirectEntry, next: PanelRole | null, meId: string | null): boolean {
  if (!meId || entry.person.id !== meId) return false;
  const bar = MANAGE_BAR[panel.node.kind];
  if (!panelAtLeast(entry.role, bar)) return false;
  if (next && panelAtLeast(next, bar)) return false;
  if (entry.alsoVia && panelAtLeast(entry.alsoVia.role, bar)) return false;
  return true;
}

// ── Where access comes from ─────────────────────────────────────────

/** The phrase after a role that says where it comes from. A container the viewer cannot open is never named. */
export function viaText(via: AccessVia): string {
  switch (via.type) {
    case "node": return `from ${via.name}`;
    case "hidden": return "from a place you cannot open";
    case "everyone": return `as everyone at ${via.orgName}`;
    case "org_admin": return "as an admin";
    case "owner": return "as the person who made it";
    case "older_rule": return "under the older rule for Private items";
  }
}

/** The second line of a direct row that also reaches the node another way. */
export function alsoViaText(also: { role: PanelRole; via: AccessVia }): string {
  // An admin's reach is always Full access, whatever role rode along with it.
  const role = also.via.type === "org_admin" || also.via.type === "owner" ? "FULL" : also.role;
  return `Also ${panelRoleLabel(role)} ${viaText(also.via)}`;
}

/** The header of one inherited group. */
export function inheritedHeader(via: AccessVia): string {
  switch (via.type) {
    case "node": return `Access from ${via.name}`;
    case "hidden": return "Access from a place you cannot open";
    case "everyone": return `Everyone at ${via.orgName}`;
    case "org_admin": return `Admins at ${via.orgName}`;
    case "owner": return "The person who made it";
    case "older_rule": return via.from ? `From ${via.from.name}, under the older rule for Private items` : "Under the older rule for Private items";
  }
}

function viaKey(via: AccessVia): string {
  switch (via.type) {
    case "node": return `node:${via.kind}:${via.id}`;
    case "everyone": return `everyone:${via.from?.kind ?? ""}:${via.from?.name ?? ""}`;
    case "older_rule": return `older:${via.from?.kind ?? ""}:${via.from?.name ?? ""}`;
    default: return via.type;
  }
}

export interface InheritedGroup {
  key: string;
  via: AccessVia;
  entries: AccessInheritedEntry[];
  /** People the server counted but did not list ("and 12 more"). */
  more: number;
}

/**
 * The inherited people grouped by where their access comes from, in the order
 * the server sent them (nearest ancestor first). A count with no listed names
 * still gets its group, so "and 12 more" is never dropped.
 */
export function groupInherited(panel: Pick<AccessPanel, "inherited" | "inheritedMore">): InheritedGroup[] {
  const groups: InheritedGroup[] = [];
  const byKey = new Map<string, InheritedGroup>();
  const groupFor = (via: AccessVia) => {
    const key = viaKey(via);
    let g = byKey.get(key);
    if (!g) {
      g = { key, via, entries: [], more: 0 };
      byKey.set(key, g);
      groups.push(g);
    }
    return g;
  };
  for (const e of panel.inherited) groupFor(e.via).entries.push(e);
  for (const m of panel.inheritedMore) groupFor(m.via).more += m.more;
  return groups;
}

function allVias(panel: AccessPanel): AccessVia[] {
  return [
    ...panel.direct.flatMap((d) => (d.alsoVia ? [d.alsoVia.via] : [])),
    ...panel.inherited.map((e) => e.via),
    ...panel.inheritedMore.map((m) => m.via),
    ...(panel.everyone ? [panel.everyone.via] : []),
  ];
}

/** Any reach that exists only under the older rule for Private items: the panel shows one footnote. */
export function hasOlderRule(panel: AccessPanel): boolean {
  return allVias(panel).some((v) => v.type === "older_rule");
}

export const OLDER_RULE_FOOTNOTE = "Private items in this workspace keep today's reach until an admin applies the new rule.";

/**
 * The Space an object's access comes from, when the viewer can manage it:
 * the explicit door on a canvas whose own grants are not on this server yet.
 * Never automatic: the person clicks "Manage access to <Space>".
 */
export function manageableSpaceVia(panel: AccessPanel): Extract<AccessVia, { type: "node" }> | null {
  for (const v of allVias(panel)) {
    if (v.type === "node" && v.kind === "space" && v.canManage) return v;
  }
  return null;
}

/**
 * Whether the panel already says if the viewer manages that node: true or
 * false from any node via naming it, null when no via names it (then only
 * that node's own panel can say).
 */
export function managesViaNode(panel: AccessPanel, kind: AccessNodeKind, id: string): boolean | null {
  let seen: boolean | null = null;
  for (const v of allVias(panel)) {
    if (v.type === "node" && v.kind === kind && v.id === id) {
      if (v.canManage) return true;
      seen = false;
    }
  }
  return seen;
}

// ── Lines ───────────────────────────────────────────────────────────

const EVERYONE_VERB: Record<PanelRole, string> = {
  VIEW: "can view", COMMENT: "can comment", ASSIGNED: "can edit their assigned tasks", EDIT: "can edit", FULL: "has Full access", OWNER: "has Full access",
};
const HINT_VERB: Record<PanelRole, string> = {
  VIEW: "view", COMMENT: "comment on", ASSIGNED: "edit their assigned tasks in", EDIT: "edit", FULL: "manage", OWNER: "manage",
};

function everyoneOrg(panel: AccessPanel): { org: string; from: { name: string } | null } | null {
  const e = panel.everyone;
  if (!e) return null;
  return e.via.type === "everyone" ? { org: e.via.orgName, from: e.via.from } : { org: panel.orgName, from: null };
}

/**
 * "Everyone at Acme can view, from Design Team". The source is named only
 * when it is somewhere above: on the org-wide Space's own dialog, "from" that
 * same Space says nothing.
 */
export function everyoneLine(panel: AccessPanel): string | null {
  const who = everyoneOrg(panel);
  if (!who || !panel.everyone) return null;
  const via = panel.everyone.via;
  const fromSelf = via.type === "everyone" && !!via.from && via.from.kind === panel.node.kind && via.from.name === panel.node.name;
  const from = who.from && !fromSelf ? `, from ${who.from.name}` : "";
  return `Everyone at ${who.org} ${EVERYONE_VERB[panel.everyone.role]}${from}`;
}

/** Under the Add role: a role everyone already holds adds nothing for Members. */
export function everyoneHint(panel: AccessPanel, role: PanelRole | null): string | null {
  const who = everyoneOrg(panel);
  if (!who || !panel.everyone || !role) return null;
  if (rank(role) > rank(panel.everyone.role)) return null;
  return `Everyone at ${who.org} can already ${HINT_VERB[panel.everyone.role]} this, so this role adds nothing for Members.`;
}

/** Inside an org-wide Space a share adds rights and cannot hide the rest of the Space (problem 16). */
export function orgWideLine(panel: AccessPanel): string | null {
  const s = panel.general.orgWideSpace;
  if (!s || panel.node.kind === "space") return null;
  const noun = sentenceNoun(panel.node.kind);
  return `Everyone at ${panel.orgName} can already open everything in ${s.name}. Sharing this ${noun} adds rights here; it cannot hide the rest of ${s.name}. To keep people to this ${noun}, set ${s.name} to Space members.`;
}

export function spaceOrgLine(orgName: string): string {
  return `Everyone at ${orgName} can open everything in this Space, including Folders shared with only some people.`;
}

/**
 * A Restricted Folder above the node cuts what the containers nearer to it
 * pass down: said once under General access, so "Inherits from" never reads
 * as a promise to people that Folder shuts out. Null when the node is itself
 * Restricted (its own setting already says who) or nothing above it is.
 */
export function restrictedAboveLine(panel: Pick<AccessPanel, "node" | "general">): string | null {
  const above = panel.general.restrictedAbove;
  if (!above || panel.node.kind === "space") return null;
  if ((panel.node.kind === "folder" || panel.node.kind === "list") && panel.general.visibility === "PRIVATE") return null;
  if (panel.node.kind === "doc" && panel.general.restricted) return null;
  return `${above.name} is Restricted, so only people who can open it inherit access to this ${sentenceNoun(panel.node.kind)}.`;
}

type RestrictPanel = Pick<AccessPanel, "general" | "direct" | "inherited" | "inheritedMore" | "everyone" | "orgName">;
type RestrictConfirmText = { title: string; description: string; confirmLabel: string };

/**
 * The people on the panel who reach the node only through where it lives:
 * inherited, not listed on the node itself, not the viewer. What the doc
 * confirm counts, and the Folder and List fallback for a panel that carries
 * no restrictLoses.
 */
function inheritedOnlyCount(panel: RestrictPanel, meId: string | null): number {
  const listed = new Set(panel.direct.map((d) => d.person.id));
  return new Set(panel.inherited.map((e) => e.person.id).filter((id) => !listed.has(id) && id !== meId)).size
    + panel.inheritedMore.reduce((n, m) => n + m.more, 0);
}

/**
 * The confirm before a doc is made Restricted, when that locks anyone out: the
 * viewer themselves (they reach it only through its place) and everyone else
 * who reaches it through its place or the whole org. Restricted keeps only
 * the people listed on the doc, the person who made it and Admins. Null when
 * nobody on the panel loses it.
 */
export function restrictDocConfirm(panel: RestrictPanel, meId: string | null): RestrictConfirmText | null {
  if (panel.general.restricted) return null;
  const self = panel.general.viewerKeepsIfRestricted === false;
  const others = inheritedOnlyCount(panel, meId);
  const everyone = !!panel.everyone;
  if (!self && others === 0 && !everyone) return null;
  const lose: string[] = [];
  if (everyone) lose.push(`Everyone at ${panel.orgName} who is not listed here will lose access.`);
  else if (others > 0) lose.push(`${others} ${others === 1 ? "person who reaches" : "people who reach"} it through where it lives will lose access.`);
  if (self) lose.push(`You reach it only through where it lives, so you will lose access${lose.length ? " too" : ""}, and only its owner or an Admin can turn this back.`);
  return {
    title: self ? "Restrict this doc and lose your access?" : "Restrict this doc?",
    description: `${lose.join(" ")} Only the people listed here, the person who made it and Admins keep it.`,
    confirmLabel: self ? "Restrict and lose access" : "Restrict",
  };
}

/**
 * What the server worked out restricting a Folder or List would cut
 * (restrictPreview in src/lib/access/node-access.ts): the people other than
 * the viewer who lose it, and whether everyone at the org does. Read
 * defensively because access-panel.ts does not declare it yet; null when the
 * panel does not carry it.
 */
export function restrictLosesOf(general: AccessPanel["general"]): { others: number; everyone: boolean } | null {
  const v = (general as { restrictLoses?: unknown }).restrictLoses;
  if (!v || typeof v !== "object") return null;
  const { others, everyone } = v as { others?: unknown; everyone?: unknown };
  return typeof others === "number" && typeof everyone === "boolean" ? { others, everyone } : null;
}

/**
 * The confirm before Restricted goes on, for every kind that has the switch:
 * a doc (restrictDocConfirm, word for word), a Folder or a List. Restricting
 * a Folder or List cuts everyone who reaches it through its parent, and what
 * is inside it with it, so the same dialog asks first, and says so plainly
 * when the viewer is about to lock themselves out: after that only someone
 * who keeps it can switch it back. Null when nobody loses it, when it is
 * already Restricted, and for the kinds with no switch.
 */
export function restrictConfirm(panel: RestrictPanel & Pick<AccessPanel, "node">, meId: string | null): RestrictConfirmText | null {
  const kind = panel.node.kind;
  if (kind === "doc") return restrictDocConfirm(panel, meId);
  if (kind !== "folder" && kind !== "list") return null;
  if (panel.general.visibility === "PRIVATE") return null;
  const noun = sentenceNoun(kind);
  const counted = restrictLosesOf(panel.general);
  const self = panel.general.viewerKeepsIfRestricted === false;
  const others = counted ? counted.others : inheritedOnlyCount(panel, meId);
  const everyone = counted ? counted.everyone : !!panel.everyone;
  if (!self && others === 0 && !everyone) return null;
  const through = panel.general.inheritsFrom?.name ?? "where it lives";
  const lose: string[] = [];
  if (everyone) lose.push(`Everyone at ${panel.orgName} who is not listed here will lose access to it and everything inside it.`);
  else if (others > 0) lose.push(`${others} ${others === 1 ? "person who reaches" : "people who reach"} it through ${through} will lose access to it and everything inside it.`);
  if (self) lose.push(`You reach it only through ${through}, so you will lose access${lose.length ? " too" : ""}, and you will not be able to turn this back.`);
  const keep = kind === "list"
    ? "Only the people listed here, the person who made it, the Space owner and Admins keep it."
    : "Only the people listed here, the person who made it and Admins keep it.";
  return {
    title: self ? `Restrict this ${noun} and lose your access?` : `Restrict this ${noun}?`,
    description: `${lose.join(" ")} ${keep}`,
    confirmLabel: self ? "Restrict and lose access" : "Restrict",
  };
}

export function adminsLine(panel: AccessPanel): string | null {
  return panel.admins ? `Admins at ${panel.orgName} have Full access to everything.` : null;
}

export const FOLDER_RESTRICTED_BLURB = "Only the people listed here can open it, plus Admins.";
export const LAST_FULL_TEXT = "A Space needs at least one person with Full access.";

export function capText(entry: AccessDirectEntry): string {
  return `Set before the new sharing: limits ${entry.person.name} to ${panelRoleLabel(entry.role)} here.`;
}

/** Only its owner can open a private note, so the one reading this is nearly always them: say "your". */
export function notepadText(owner: AccessPerson, meId: string | null = null): string {
  if (meId && owner.id === meId) return "This is your private note. Only you can open it.";
  return `This is ${owner.name}'s private note. Only they can open it.`;
}

export function grantsUnavailableText(kind: AccessNodeKind): string {
  return `Adding people to a ${sentenceNoun(kind)} is not available on this server yet.`;
}

// ── Confirms and notices ────────────────────────────────────────────

export function removeConfirm(name: string, panel: AccessPanel, losesOwnManage: boolean): { title: string; description: string } {
  const noun = sentenceNoun(panel.node.kind);
  return {
    title: `Remove ${name} from ${panel.node.name}?`,
    description: losesOwnManage
      ? `You will not be able to change who can open this ${noun} any more.`
      : `They lose the access this ${noun} gives them.`,
  };
}

export function SELF_LOWER_CONFIRM(kind: AccessNodeKind): { title: string; description: string } {
  return {
    title: "Lower your own access?",
    description: `You will not be able to change who can open this ${sentenceNoun(kind)} any more.`,
  };
}

/** The toast after a removal: what actually happened, including what the person keeps. */
export function removalNotice(change: GrantChange, name: string): string {
  if (change.noChange) return "Already removed.";
  const parts: string[] = [];
  parts.push(change.stillReaches
    ? `Removed. ${name} still has ${panelRoleLabel(change.stillReaches.role)} ${viaText(change.stillReaches.via)}.`
    : `Removed ${name}.`);
  const kept = change.keepsInside;
  if (kept.length > 0) {
    parts.push(`They keep access to ${kept.length} ${kept.length === 1 ? "thing" : "things"} shared with them directly: ${kept.map((k) => k.name).join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * A failed change for someone the fresh list no longer shows (another tab
 * removed them meanwhile). The row is gone, so the line says who it was for
 * and, for a role change, what Retry will do: give them that role again.
 */
export function strayFailureText(name: string, message: string, role: PanelRole | null): string {
  return role ? `${name}: ${message} Retry gives them ${panelRoleLabel(role)}.` : `${name}: ${message}`;
}

/**
 * After an Add that raises only: the person already held a higher role (given
 * meanwhile, or through a row this list did not show yet), so nothing was
 * lowered and the line says what they keep. Null when the Add changed their
 * role as asked.
 */
export function keptHigherText(change: GrantChange, name: string, requested: PanelRole): string | null {
  if (!change.noChange || !change.role || change.role === requested) return null;
  if (PANEL_ROLE_RANK[change.role] <= PANEL_ROLE_RANK[requested]) return null;
  return `${name} already has ${panelRoleLabel(change.role)}, so it was kept.`;
}

// ── Errors ──────────────────────────────────────────────────────────

/**
 * A write refused because of the viewer's OWN access (lowered or taken away
 * while the dialog was open): the panel on screen is stale and must be
 * fetched again, or Retry would send the same refused request forever.
 */
export function refusedByOwnAccess(code: GrantErrorCode): boolean {
  return code === "forbidden" || code === "not_found" || code === "above_own_role";
}

/** The sentence for a grant error. Two read the kind: who may share it, and whether grants exist here yet. */
export function errorText(code: GrantErrorCode, kind: AccessNodeKind): string {
  if (code === "forbidden") return `You need ${panelRoleLabel(MANAGE_BAR[kind])} to change who can open this ${sentenceNoun(kind)}.`;
  if (code === "grants_unavailable") return grantsUnavailableText(kind);
  return GRANT_ERROR_MESSAGE[code] ?? GRANT_ERROR_MESSAGE.server_error;
}

/**
 * A general-access write's failure (a Space's, a Folder's or a List's
 * visibility) as a sentence. Those routes answer a refusal with a bare word
 * ("Forbidden", "Not found"), which must never reach the screen: the route's
 * own sentence when it sends one, else the kind's forbidden and not-found
 * wording, else the control's own fallback.
 */
export function generalErrorText(status: number, body: unknown, kind: AccessNodeKind, fallback: string): string {
  const b = body && typeof body === "object" ? (body as { message?: unknown; error?: unknown }) : null;
  if (b && typeof b.message === "string" && b.message.trim()) return b.message.trim();
  if (status === 403) return errorText("forbidden", kind);
  if (status === 404) return errorText("not_found", kind);
  const e = b && typeof b.error === "string" ? b.error.trim() : "";
  if (/\s/.test(e) && /[.!?]$/.test(e)) return e;
  return fallback;
}

const CODES = new Set<string>(Object.keys(GRANT_ERROR_MESSAGE));

/** A failed grant write's code and the fresh panel a conflict carries, whatever the body looked like. */
export function parseGrantError(status: number, body: unknown): { code: GrantErrorCode; panel: AccessPanel | null | undefined } {
  const b = body && typeof body === "object" ? (body as { error?: unknown; panel?: AccessPanel | null }) : null;
  if (b && typeof b.error === "string" && CODES.has(b.error)) return { code: b.error as GrantErrorCode, panel: b.panel };
  const code: GrantErrorCode =
    status === 409 ? "conflict"
      : status === 403 ? "forbidden"
        : status === 404 ? "not_found"
          : status === 400 || status === 422 ? "invalid_body"
            : "server_error";
  return { code, panel: undefined };
}

// ── URLs ────────────────────────────────────────────────────────────

export function panelUrl(kind: AccessNodeKind, id: string): string {
  return `/api/access/${kind}/${encodeURIComponent(id)}`;
}

export function grantsUrl(kind: AccessNodeKind, id: string): string {
  return `${panelUrl(kind, id)}/grants`;
}

/** The people picker's query: everyone who can sign in (on leave, probation, a PIP or notice included), minus those already listed. */
export function pickUrl(q: string, exclude: readonly string[]): string {
  const params = new URLSearchParams({ reach: "signin", q, limit: "20" });
  if (exclude.length > 0) params.set("exclude", exclude.join(","));
  return `/api/people/pick?${params.toString()}`;
}
