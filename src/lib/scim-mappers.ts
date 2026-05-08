// Shape converters between WorkWrk's User/Department records and
// SCIM 2.0 resource representations. RFC 7643 / 7644 compliant.
// Kept small and dependency-free.

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

export type ScimUser = {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  active: boolean;
  name: { givenName: string; familyName: string; formatted: string };
  emails: Array<{ value: string; type?: string; primary?: boolean }>;
  meta: { resourceType: "User"; created?: string; lastModified?: string };
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
};

export function userToScim(u: WorkwrkUserForScim): ScimUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    externalId: u.externalId ?? undefined,
    userName: u.email,
    active: u.status === "ACTIVE",
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
