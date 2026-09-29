/* eslint-disable no-restricted-syntax --
   The Staff console reads OTHER people's stored org role in a customer
   company (who holds Owner access, who may be promoted). The access engine
   answers what one viewer may do; it has no "who holds this role in company
   X" query, so this reads AccessLevel and maps it with the same rule as
   lib/access/org-role.ts (ownerIdsOf). No permission decision is made here:
   every route is gated on requirePlatformAdminApi. */
// Set workspace Owner (spec-admin-backoffice 2.3 card 5; access-model-spec
// 2.6: the one new back-office action).
//
// It ADDS an Owner. It never removes one and never demotes anyone, so the
// last-Owner guard can never be tripped by it and it can never be the thing
// that leaves a company with nobody. The picker's reach (decided): any live
// Member or Admin of that workspace; not a deactivated or deleted account,
// not someone who is already an Owner.
//
// What changes for the promoted person: their org role here becomes Owner
// (today that is AccessLevel SUPER_ADMIN, lib/access/org-role.ts), on their
// User row when this is the company they work in and on their membership row
// for this company. Nothing else about them changes: object roles, Space and
// List membership and Team membership are untouched. Admin scopes have no
// column yet (org-role.ts adminScopesOf), so there is nothing to clear.
//
// Their tokenVersion is NOT bumped: a bump revokes every session they have
// (auth.ts versionMismatch), which signed the new Owner out on every device,
// and out of their home workspace too for someone who only holds a
// membership here. The session check already copies the stored role at most
// five minutes on, so the role lands without throwing anyone out.
//
// "Never removes an Owner" includes the earliest-admin rule: a COMPANY_ADMIN
// is an Owner only while they are the earliest-created admin (org-role.ts).
// Promoting someone whose account is OLDER would quietly take that Owner
// status away, so that COMPANY_ADMIN is written as Owner (SUPER_ADMIN) in the
// same transaction. Their effective role does not change; the audit row
// names them.

import { prisma } from "@/lib/prisma";
import { logStaffAction, writeTenantRow, type LoggedStaffAction, type StaffActor } from "@/lib/staff-audit";
import { confirmMatches } from "@/lib/admin/company-patch-rules";
import { LIVE_PERSON } from "@/lib/admin/companies-list";
import { ownerIdsFor } from "@/lib/admin/company-detail";

export { OWNER_REASON_MIN, OWNER_REASON_MAX, validateOwnerBody, type OwnerBody } from "@/lib/admin/company-patch-rules";

export type SetOwnerResult =
  | { ok: true; person: { id: string; name: string; email: string }; company: { id: string; name: string } }
  | { ok: false; status: 400 | 404 | 409; error: string };

function nameOf(u: { firstName: string | null; lastName: string | null; email: string }): string {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
}

export async function setWorkspaceOwner(input: {
  companyId: string;
  userId: string;
  reason: string;
  confirm: string;
  actor: StaffActor;
  ip: string | null;
}): Promise<SetOwnerResult> {
  const { companyId, userId, reason, confirm, actor, ip } = input;
  let logged: LoggedStaffAction | null = null;

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${companyId} FOR UPDATE`;
      const org = await tx.organization.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
      if (!org) return { status: 404 as const, error: "Company not found" };
      if (!confirmMatches(confirm, org.name)) {
        return { status: 400 as const, error: `Type the company name (${org.name}) to confirm.` };
      }

      const person = await tx.user.findFirst({
        where: {
          id: userId,
          ...LIVE_PERSON,
          OR: [{ organizationId: companyId }, { organizationMemberships: { some: { organizationId: companyId } } }],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
          organizationId: true,
          accessLevel: true,
          organizationMemberships: { where: { organizationId: companyId }, select: { id: true, role: true } },
        },
      });
      // One answer for "not here", "deleted" and "deactivated": the picker
      // never offers them, so reaching this is a stale list or a crafted call.
      if (!person) {
        return { status: 404 as const, error: "That person is not an active member of this workspace" };
      }
      const anchored = person.organizationId === companyId;
      const membership = person.organizationMemberships[0] ?? null;
      const roleHere = anchored ? person.accessLevel : membership?.role ?? "EMPLOYEE";
      const owners = await ownerIdsFor(companyId);
      if (owners.includes(person.id)) {
        return { status: 409 as const, error: `${nameOf(person)} already has Owner access here` };
      }

      // The Owner who holds it only as the earliest-created COMPANY_ADMIN,
      // and would lose it to an older account becoming an admin.
      const current = owners.length
        ? await tx.user.findMany({
            where: { id: { in: owners } },
            select: {
              id: true,
              email: true,
              createdAt: true,
              organizationId: true,
              accessLevel: true,
              organizationMemberships: { where: { organizationId: companyId }, select: { id: true, role: true } },
            },
          })
        : [];
      const keptOwners: string[] = [];
      for (const o of current) {
        const oAnchored = o.organizationId === companyId;
        const oMembership = o.organizationMemberships[0] ?? null;
        const levelHere = oAnchored ? o.accessLevel : oMembership?.role;
        if (levelHere !== "COMPANY_ADMIN") continue;
        const displaced =
          person.createdAt.getTime() < o.createdAt.getTime() ||
          (person.createdAt.getTime() === o.createdAt.getTime() && person.id.localeCompare(o.id) < 0);
        if (!displaced) continue;
        if (oAnchored) await tx.user.update({ where: { id: o.id }, data: { accessLevel: "SUPER_ADMIN" } });
        if (oMembership) await tx.organizationMembership.update({ where: { id: oMembership.id }, data: { role: "SUPER_ADMIN" } });
        keptOwners.push(o.email);
      }

      if (anchored) {
        await tx.user.update({ where: { id: person.id }, data: { accessLevel: "SUPER_ADMIN" } });
      }
      if (membership) {
        await tx.organizationMembership.update({ where: { id: membership.id }, data: { role: "SUPER_ADMIN" } });
      }

      const name = nameOf(person);
      logged = await logStaffAction({
        db: tx,
        action: "admin.org.owner_set",
        actor,
        ip,
        targetCompanyId: companyId,
        targetLabel: org.name,
        reason,
        summary: `Gave ${name} (${person.email}) Owner access at ${org.name}`,
        before: { userId: person.id, name, email: person.email, role: roleHere, owners: owners.length },
        after: {
          userId: person.id,
          name,
          email: person.email,
          role: "SUPER_ADMIN",
          owners: owners.length + 1,
          ...(keptOwners.length ? { keptOwnerAccess: keptOwners.join(", ") } : {}),
        },
      });
      return { status: 200 as const, person: { id: person.id, name, email: person.email }, company: org };
    },
    { timeout: 20_000 },
  );

  if (result.status !== 200) return { ok: false, status: result.status, error: result.error };
  void writeTenantRow(logged);
  return { ok: true, person: result.person, company: result.company };
}
