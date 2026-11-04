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
//
// A filter by address also finds someone who works here through a
// membership, anchored in another workspace (docs-found fixes batch 7), the
// lookup an identity provider links a person by. POST answers 409 for them
// (batch 6), so without this it could never find, and so never deprovision,
// them ([id]/route.ts acts on their seat here only). The unfiltered list
// stays the people anchored here.
//
// THIS WORKSPACE'S SEAT (docs/plans/workspace-status.md D14). Every resource
// answers `active` from the seat here (live or not, an HR label live), never
// the account's status, which is the anchored workspace's; a membership this
// workspace ended is found, inactive, as a deactivated person anchored here
// is. POST for an address whose seat here was DEACTIVATED brings that seat
// back exactly as PUT or PATCH active:true would (the SCIM token is an
// Admin-level actor), rather than make a second account for the same
// person: src/lib/scim-reactivate.ts scimReactivateSeat, the one path both
// doors take (the same checks, the level kept, the lines and reviews
// handled after the seat is back), which moves an account ended where it is
// anchored here (D6). A seat this workspace REMOVED is a 409 with nothing
// written (the step 4 review M1: a removal is a decision no push from the
// identity provider undoes, POST included). A live seat here is still the
// 409.
//
// THE ADDRESS IN ANY CASE (the final review, integrity L3), as sign-in and
// the password reset match it: an account stored as "Pat@x.test" is the
// account for "pat@x.test". Before, POST compared the spelling exactly, so
// it made a second account beside an ended seat instead of the revive, and
// one beside a live one past the 409 (the database's own unique index
// compares the spelling exactly). The filter matches the same way, so an
// identity provider that met the 409 can find the account it names.
//
// THE MANAGER (docs/plans/workspace-status-2.md E9 i, step 7;
// src/lib/scim-manager.ts). POST's enterprise extension `manager` sets the
// new person's line here: in the create's own transaction, under the
// workspace's role lock taken first (then the seat lock, bounded, so the
// role lock is never held through an unbounded wait), through seat-writes.ts
// writeLineHere, under the rules of every line here (a live seat here, not
// an Agent, no loop). A refused manager writes nothing of the line, the
// account is still made, and one Audit log row says why; a busy lock or a
// deadlock makes nothing (503, retried). A revive of an ended seat takes it
// in the reactivation's transaction. Every resource listed names the line
// the seat here holds (the account's for someone anchored here, the
// membership's for someone here through one), as a reference to the
// manager's SCIM id, while that manager holds a seat here.

import crypto from "crypto";
import { inviteDomainsOf } from "@/lib/settings/org-policy";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateScim, scimError, scimResponse } from "@/lib/scim-auth";
import { managerAskOfResource, parseScimFilter, scimList, userToScim } from "@/lib/scim-mappers";
import { isReservedStaffAddress, STAFF_ADDRESS_REFUSAL } from "@/lib/platform-admin";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";
import { seatIsLive } from "@/lib/access/workspace-status";
import { SCIM_REMOVED_REFUSAL, scimReactivateSeat } from "@/lib/scim-reactivate";
import { lockOrgRoles } from "@/lib/access/membership";
import { LOCKED_TX } from "@/lib/access/org-roles-busy";
import { personSeatIn } from "@/lib/access/acting-workspace";
import { managersShownHere, scimManagerHere, scimManagerRetry, scimUserHere } from "@/lib/scim-manager";

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

  // The address in any case (see the header).
  let address: { equals: string; mode: "insensitive" } | null = null;
  if (filter) {
    if (filter.field === "userName") address = { equals: filter.value.trim(), mode: "insensitive" };
    else if (filter.field === "externalId") {
      // We don't have a dedicated externalId column on User yet — for
      // now match against email as a fallback so the IdP can reconcile
      // by either field. v2: add User.externalId for true SCIM IDs.
      address = { equals: filter.value.trim(), mode: "insensitive" };
    }
    // Unknown filter fields silently fall through to "no extra filter".
  }
  const where = { organizationId: auth.organizationId, ...(address ? { email: address } : {}) };

  const select = { id: true, email: true, firstName: true, lastName: true, status: true, deletedAt: true, createdAt: true, updatedAt: true } as const;
  /** The managers the listed lines name who hold a seat here (see the header). */
  type Named = Awaited<ReturnType<typeof managersShownHere>>;
  /** Someone anchored here: their account's seat here (D14), and their account's line, this workspace's. */
  const anchoredScim = (u: { id: string; email: string; firstName: string; lastName: string; status: string; deletedAt: Date | null; createdAt: Date; updatedAt: Date; managerId?: string | null }, named: Named) =>
    userToScim({ ...u, externalId: null, active: seatIsLive({ status: u.status, removedAt: u.deletedAt }), manager: u.managerId ? named.get(u.managerId) ?? null : null });
  if (address) {
    // One address: the account anchored here, and an account anchored
    // elsewhere that works here through a membership (batch 7), whatever the
    // account's state where it is anchored (that is the anchored workspace's
    // decision). By "User_email_organizationId_key" (email first), each a
    // few rows. An erased account's address is anonymised, so it never
    // matches.
    const [anchored, members] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: "asc" }, select: { ...select, managerId: true } }),
      prisma.user.findMany({
        where: { email: address, organizationId: { not: auth.organizationId }, organizationMemberships: { some: { organizationId: auth.organizationId } } },
        orderBy: { createdAt: "asc" },
        // The membership's line, this workspace's; never the account's, which is the anchored workspace's (E1).
        select: { ...select, organizationMemberships: { where: { organizationId: auth.organizationId }, select: { status: true, removedAt: true, managerId: true } } },
      }),
    ]);
    const lineOf = (seats: ReadonlyArray<{ managerId?: string | null }> | undefined) => seats?.[0]?.managerId ?? null;
    const named = await managersShownHere(auth.organizationId, [...anchored.map((u) => u.managerId), ...members.map((u) => lineOf(u.organizationMemberships))]);
    const all = [
      ...anchored.map((u) => anchoredScim({ ...u, status: String(u.status) }, named)),
      // Their membership's seat here (D14), never their account's status, and its line.
      ...members.map(({ organizationMemberships: seats, ...u }) => {
        const line = lineOf(seats);
        return userToScim({ ...u, status: String(u.status), externalId: null, active: (seats ?? []).some((m) => seatIsLive(m)), manager: line ? named.get(line) ?? null : null });
      }),
    ];
    return scimResponse(scimList(all.slice(startIndex - 1, startIndex - 1 + count), all.length, startIndex));
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: startIndex - 1,
      take: count,
      select: { ...select, managerId: true },
    }),
  ]);
  const named = await managersShownHere(auth.organizationId, users.map((u) => u.managerId));

  return scimResponse(
    scimList(users.map((u) => anchoredScim({ ...u, status: String(u.status) }, named)), total, startIndex),
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
  // The person's manager here (see the header): for a revive, whatever it
  // asks; for a new account, a manager to set (a clear asks nothing of a
  // person who has no line yet).
  const asked = managerAskOfResource(body);
  const manager = asked?.kind === "set" ? asked : undefined;

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
  // The address in any case (see the header).
  const sameAddress = { equals: email.trim(), mode: "insensitive" as const };
  const existing = await prisma.user.findFirst({
    where: { organizationId: auth.organizationId, email: sameAddress },
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
  // Someone who already works here through a membership, anchored in another
  // workspace since they last switched, is in this workspace too (docs-found
  // fixes batch 6). Before, only the people anchored here were looked at, so
  // a second account was made for the same address: two sign-ins, and their
  // work split between them. Two indexed reads: the address's accounts by
  // "User_email_organizationId_key", then their memberships here by
  // "OrganizationMembership_userId_organizationId_key". Whatever the
  // account's state where it is anchored (D14): the seat here decides. A
  // live one is the 409; an ended one comes back (see the header).
  const accounts = await prisma.user.findMany({ where: { email: sameAddress }, select: { id: true } });
  const seatsHere = accounts.length
    ? await prisma.organizationMembership.findMany({
        where: { organizationId: auth.organizationId, userId: { in: accounts.map((a) => a.id) } },
        select: { userId: true, status: true, removedAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  if (seatsHere.some((m) => seatIsLive(m))) {
    return scimError(409, "User already exists: this address already works in this workspace through a WorkwrK account in another workspace", "uniqueness");
  }
  const ended = seatsHere[0] ?? null;
  // A seat this workspace removed never comes back by a push (M1).
  if (ended?.removedAt) return scimError(409, SCIM_REMOVED_REFUSAL, "uniqueness");
  if (ended && !active) {
    return scimError(409, "User already exists: this address's seat in this workspace is deactivated", "uniqueness");
  }
  // The customer's identity provider vouches for this address, not the
  // mailbox owner, so a WorkwrK staff address is refused (platform-admin.ts).
  if (await isReservedStaffAddress(email)) return scimError(400, STAFF_ADDRESS_REFUSAL, "invalidValue");
  // Domain lock (settings-architecture 5.9): an address outside the allowed
  // domains (Members > Invite rules, else the workspace's own domain) is
  // refused. A workspace with no domain on file keeps today's behaviour.
  const org = await prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { settings: true, domain: true } });
  const allowed = inviteDomainsOf(org?.settings, org?.domain);
  const at = email.slice(email.lastIndexOf("@") + 1);
  if (allowed.length > 0 && !allowed.includes(at)) {
    return scimError(400, `${at} is not one of this workspace's allowed domains`, "invalidValue");
  }
  // Their seat here was deactivated: it comes back as a reactivation does, rather than a second account.
  if (ended) {
    const r = await scimReactivateSeat(auth.organizationId, ended.userId, {}, asked);
    return r.ok
      ? scimResponse(await scimUserHere(auth.organizationId, r.row, r.seat), 201)
      : scimError(r.status, r.error, r.status === 409 ? "uniqueness" : undefined);
  }

  // We deliberately don't set a password here — SCIM-provisioned
  // users sign in via SAML, not local auth. NextAuth's Credentials
  // path refuses login when password is null, so the only working
  // entry path is the SAML / OIDC flow.
  // An active person takes a seat (src/lib/seats.ts), checked and taken
  // under the workspace's lock; one provisioned as inactive takes none.
  // With a manager, the role lock first and the seat lock bounded (see the
  // header); a busy one, or a deadlock, makes nothing and is the 503 the
  // identity provider retries.
  const placed = await prisma
    .$transaction(async (tx) => {
      if (manager) await lockOrgRoles(tx, auth.organizationId);
      if (active) {
        await lockWorkspaceSeats(tx, auth.organizationId, { bounded: !!manager });
        const seats = await seatsFor(auth.organizationId, 1, tx);
        if (!seats.ok) return { refused: seats.message } as const;
      }
      const made = await tx.user.create({
        data: {
          organizationId: auth.organizationId,
          email,
          firstName: givenName,
          lastName: familyName,
          status: active ? "ACTIVE" : "INACTIVE",
          passwordHash: unmatchablePasswordHash(),
          // The org-role mirror, written with the level (spec 10 step 0).
          orgRole: "MEMBER",
          // Every provisioned person arrives as a Member (the schema default
          // level). Owner, Admin and Agent are set in WorkwrK, never by the
          // identity provider (settings-architecture 5.9).
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
      // Their line here, on the account just made (a refused manager is logged, and the account still made).
      if (manager) await scimManagerHere(tx, auth.organizationId, made.id, manager);
      return { created: made } as const;
    }, manager ? LOCKED_TX : undefined)
    .catch((e: unknown) => {
      const retry = scimManagerRetry(e);
      if (retry) return { busy: retry } as const;
      throw e;
    });
  if ("busy" in placed) return scimError(503, placed.busy);
  if (placed.refused !== undefined) return scimError(403, placed.refused);
  const created = placed.created;
  if (manager) return scimResponse(await scimUserHere(auth.organizationId, created, await personSeatIn(auth.organizationId, created.id)), 201);

  return scimResponse(userToScim({ ...created, externalId: null }), 201);
}
