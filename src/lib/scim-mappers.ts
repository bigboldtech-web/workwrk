// Shape converters between WorkWrk's User/Department records and
// SCIM 2.0 resource representations. RFC 7643 / 7644 compliant.
// Kept small and dependency-free.

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
/** The enterprise User extension (RFC 7643 4.3), which carries the manager (docs/plans/workspace-status-2.md E9 i). */
export const ENTERPRISE_USER_SCHEMA = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

/** The manager as a resource answers it: a reference to the manager's SCIM id here, with their name. */
export type ScimManagerRef = { value: string; displayName: string };

export type ScimUser = {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  active: boolean;
  name: { givenName: string; familyName: string; formatted: string };
  emails: Array<{ value: string; type?: string; primary?: boolean }>;
  meta: { resourceType: "User"; created?: string; lastModified?: string };
  /** Present only when the person has a manager here to name (see userToScim). */
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"?: { manager: ScimManagerRef };
};

export type WorkwrkUserForScim = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  externalId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether their seat in the asking workspace is live
   * (docs/plans/workspace-status.md D14: SCIM speaks for that workspace's
   * seat only, and an HR label is live). The routes always pass it; absent,
   * the account's own status is read.
   */
  active?: boolean;
  /**
   * Their manager in the asking workspace (workspace-status-2.md E9 i, step
   * 7): that workspace's line, named only while the manager holds a seat
   * there (src/lib/scim-manager.ts scimUserHere). Absent or null: no
   * manager to name, and the extension is left out.
   */
  manager?: { id: string; displayName: string } | null;
};

export function userToScim(u: WorkwrkUserForScim): ScimUser {
  const out: ScimUser = {
    schemas: u.manager ? [SCIM_USER_SCHEMA, ENTERPRISE_USER_SCHEMA] : [SCIM_USER_SCHEMA],
    id: u.id,
    externalId: u.externalId ?? undefined,
    userName: u.email,
    active: u.active ?? u.status === "ACTIVE",
    name: {
      givenName: u.firstName,
      familyName: u.lastName,
      formatted: `${u.firstName} ${u.lastName}`.trim(),
    },
    emails: [{ value: u.email, type: "work", primary: true }],
    meta: {
      resourceType: "User",
      created: u.createdAt.toISOString(),
      lastModified: u.updatedAt.toISOString(),
    },
  };
  // The manager's SCIM id here is their WorkwrK id, as every resource's `id` is.
  if (u.manager) out[ENTERPRISE_USER_SCHEMA] = { manager: { value: u.manager.id, displayName: u.manager.displayName } };
  return out;
}

/**
 * What a request asks of the person's manager in this workspace (E9 i): set
 * it to the manager this value names (their SCIM id here, which is their
 * WorkwrK id, or as a fallback their address: src/lib/scim-manager.ts), or
 * clear it. A request that says nothing of the manager asks nothing
 * (undefined), so the line stays as it is.
 */
export type ScimManagerAsk = { kind: "set"; value: string } | { kind: "clear" };

/** A key of a SCIM object, in any case (RFC 7643 2.1: attribute names and schema URIs are case-insensitive). */
function keyOf(obj: Record<string, unknown>, name: string): string | undefined {
  const want = name.toLowerCase();
  return Object.keys(obj).find((k) => k.toLowerCase() === want);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The manager a value names, in the shapes identity providers send: the
 * complex attribute `{ value }` (RFC 7643, Okta), a bare id string (Azure's
 * PATCH), a list of one `{ value }` (older Azure), a bare number (an
 * employee number). Null, an empty string or an empty list clear the line.
 * An object with no `value` (a displayName alone) says nothing of who the
 * manager is, so it asks nothing: never read as a clear, or every push of a
 * provider that maps the manager's name but not their id would take the
 * line off.
 */
export function managerValueOf(v: unknown): ScimManagerAsk | undefined {
  if (v === null) return { kind: "clear" };
  if (typeof v === "string") return v.trim() ? { kind: "set", value: v.trim() } : { kind: "clear" };
  if (typeof v === "number" && Number.isFinite(v)) return { kind: "set", value: String(v) };
  if (Array.isArray(v)) return v.length === 0 ? { kind: "clear" } : managerValueOf(v[0]);
  if (isObject(v)) {
    const k = keyOf(v, "value");
    return k === undefined ? undefined : managerValueOf(v[k]);
  }
  return undefined;
}

const MANAGER_PATHS = [`${ENTERPRISE_USER_SCHEMA}:manager`, `${ENTERPRISE_USER_SCHEMA}:manager.value`, "manager", "manager.value"].map((p) => p.toLowerCase());

/**
 * The manager a resource names (POST, PUT, and a PATCH operation's value
 * with no path): the enterprise extension's `manager`, or the same written
 * flat (`urn:...:User:manager`, `urn:...:User:manager.value`, and the bare
 * `manager`, which no core attribute is named). Undefined when it names
 * none, so the line stays as it is: a full PUT that leaves the manager out
 * never clears it (a provider that does not map the manager would otherwise
 * take every line off at every push).
 */
export function managerAskOfResource(body: unknown): ScimManagerAsk | undefined {
  if (!isObject(body)) return undefined;
  const ext = keyOf(body, ENTERPRISE_USER_SCHEMA);
  if (ext !== undefined && isObject(body[ext])) {
    const inner = body[ext] as Record<string, unknown>;
    const m = keyOf(inner, "manager");
    if (m !== undefined) return managerValueOf(inner[m]);
  }
  for (const path of MANAGER_PATHS) {
    const k = keyOf(body, path);
    if (k !== undefined) return managerValueOf(body[k]);
  }
  return undefined;
}

/**
 * What one PATCH operation asks of the manager (RFC 7644 3.5.2), or
 * undefined when it does not touch it. `add` and `replace` set it (null or
 * empty clear it; no value at all asks nothing); `remove` clears it,
 * whatever value it carries (a
 * single-valued attribute is removed whole, 3.5.2.2). The paths: the
 * extension's `urn:...:User:manager` and `urn:...:User:manager.value`, the
 * bare `manager` and `manager.value`, and the extension itself; with no
 * path, the value is read as a resource (managerAskOfResource).
 */
export function managerAskOfOperation(op: { op?: unknown; path?: unknown; value?: unknown }): ScimManagerAsk | undefined {
  const verb = String(op.op ?? "").toLowerCase();
  if (verb !== "add" && verb !== "replace" && verb !== "remove") return undefined;
  const path = typeof op.path === "string" ? op.path.trim().toLowerCase() : "";
  if (!path) return verb === "remove" ? undefined : managerAskOfResource(op.value);
  if (path === ENTERPRISE_USER_SCHEMA.toLowerCase()) {
    if (verb === "remove") return { kind: "clear" };
    return isObject(op.value) ? managerAskOfResource({ [ENTERPRISE_USER_SCHEMA]: op.value }) : undefined;
  }
  if (!MANAGER_PATHS.includes(path)) return undefined;
  if (verb === "remove") return { kind: "clear" };
  // An add or replace with no value at all is malformed: it asks nothing, never a clear.
  return op.value === undefined ? undefined : managerValueOf(op.value);
}

export type ScimGroup = {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string; type?: "User" }>;
  meta: { resourceType: "Group"; created?: string; lastModified?: string };
};

export type WorkwrkGroupForScim = {
  id: string;
  name: string;
  members: Array<{ id: string; display: string }>;
  createdAt: Date;
  updatedAt: Date;
};

export function groupToScim(g: WorkwrkGroupForScim): ScimGroup {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: g.id,
    displayName: g.name,
    members: g.members.map((m) => ({ value: m.id, display: m.display, type: "User" })),
    meta: {
      resourceType: "Group",
      created: g.createdAt.toISOString(),
      lastModified: g.updatedAt.toISOString(),
    },
  };
}

export function scimList<T>(resources: T[], totalResults: number, startIndex = 1): {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
} {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

// Tiny SCIM filter parser. Supports the subset that Okta + Azure AD
// actually send: `userName eq "x"`, `externalId eq "x"`, `displayName
// eq "x"`. Returns null if the filter isn't recognized — caller falls
// back to "no filter" which is correct (slower, never wrong).
export function parseScimFilter(filter: string | null): { field: string; value: string } | null {
  if (!filter) return null;
  // very permissive — match `field eq "value"`
  const m = filter.match(/^\s*(\w+)\s+eq\s+"([^"]+)"\s*$/);
  if (!m) return null;
  const [, field, value] = m;
  if (!field || value === undefined) return null;
  return { field, value };
}
