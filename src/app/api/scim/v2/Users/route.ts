// SCIM 2.0 Users — list + create. Bearer-authed via ScimToken.
// Backed by the existing User table — no parallel directory.
//
// The IdP (Okta / Azure AD / OneLogin / Google Workspace) calls this
// when an employee is added to the WorkWrk-linked group / app on
// their side. We accept the create, generate a User row in this org,
// and return the canonical record.
//
// Pagination follows RFC 7644 §3.4.2: `startIndex` (1-based) and
// `count`. Filter supports `userName eq "..."` and `externalId eq
// "..."` — the only filters Okta/Azure actually send.

import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateScim, scimError, scimResponse } from "@/lib/scim-auth";
import { parseScimFilter, scimList, userToScim } from "@/lib/scim-mappers";

// Sentinel passwordHash for SCIM-provisioned users. Not a valid
// bcrypt shape, so any bcrypt.compare() against it returns false —
// local-password login can never succeed for these accounts. They
// sign in via SAML / OIDC.
function unmatchablePasswordHash(): string {
  return `!scim!${crypto.randomBytes(32).toString("hex")}`;
}

export async function GET(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const startIndex = Math.max(1, Number(sp.get("startIndex") ?? 1));
  const count = Math.min(Math.max(1, Number(sp.get("count") ?? 100)), 200);
  const filter = parseScimFilter(sp.get("filter"));

  const where: Record<string, unknown> = { organizationId: auth.organizationId };
  if (filter) {
    if (filter.field === "userName") where.email = filter.value.toLowerCase();
    else if (filter.field === "externalId") {
      // We don't have a dedicated externalId column on User yet — for
      // now match against email as a fallback so the IdP can reconcile
      // by either field. v2: add User.externalId for true SCIM IDs.
      where.email = filter.value.toLowerCase();
    }
    // Unknown filter fields silently fall through to "no extra filter".
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: startIndex - 1,
      take: count,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return scimResponse(
    scimList(users.map((u) => userToScim({ ...u, externalId: null })), total, startIndex),
  );
}

export async function POST(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return scimError(400, "Invalid JSON body");

  const userName = typeof body.userName === "string" ? body.userName.trim().toLowerCase() : "";
  const givenName = typeof body.name?.givenName === "string" ? body.name.givenName.trim() : "";
  const familyName = typeof body.name?.familyName === "string" ? body.name.familyName.trim() : "";
  const active = body.active !== false; // default true per SCIM spec

  // Email — prefer the primary email if a list was sent, else
  // userName. SCIM clients are inconsistent.
  let email: string = userName;
  if (Array.isArray(body.emails)) {
    const primary = body.emails.find((e: { primary?: boolean; value?: string }) => e.primary && e.value);
    const fallback = body.emails.find((e: { value?: string }) => e.value);
    email = (primary?.value ?? fallback?.value ?? userName).toString().toLowerCase();
  }

  if (!email || !email.includes("@")) return scimError(400, "Valid email required", "invalidValue");
  if (!givenName || !familyName) return scimError(400, "name.givenName and name.familyName required", "invalidValue");

  // Conflict if email already exists in the org. SCIM 2.0 requires a
  // 409 response with scimType=uniqueness.
  const existing = await prisma.user.findFirst({
    where: { organizationId: auth.organizationId, email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (existing) {
    return scimError(409, "User already exists", "uniqueness");
  }

  // We deliberately don't set a password here — SCIM-provisioned
  // users sign in via SAML, not local auth. NextAuth's Credentials
  // path refuses login when password is null, so the only working
  // entry path is the SAML / OIDC flow.
  const created = await prisma.user.create({
    data: {
      organizationId: auth.organizationId,
      email,
      firstName: givenName,
      lastName: familyName,
      status: active ? "ACTIVE" : "INACTIVE",
      passwordHash: unmatchablePasswordHash(),
      // Schema defaults take care of accessLevel; SCIM doesn't carry
      // role/access info in the core User schema. Group push handles
      // that separately.
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return scimResponse(userToScim({ ...created, externalId: null }), 201);
}
