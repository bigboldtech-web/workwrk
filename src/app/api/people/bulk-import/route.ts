// Import people (spec-teams-people section 3, PeopleImport; T7).
//
// POST { rows, dryRun } turns each CSV row into an INVITATION, never a user
// with a known password: the shared "Welcome@123" hash is gone, and so is
// any access level from the file (every row joins as a Member; an Admin
// promotes in Members afterwards). Job title, department and office are
// matched by name; "Reports to" is an email resolved to a current person
// (their managerId is set when the invitation is accepted); the workspace's
// domain lock applies. The dry run returns the staging report the modal
// shows: ready rows, rows with errors, and people who are already members or
// already invited, so nothing is created twice. Owner and Admin only.
//
// GET serves the CSV template.

import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { invitationTemplate } from "@/lib/email-templates";
import { peopleCtx } from "@/lib/people/person-access.server";
import { IMPORT_TEMPLATE_CSV } from "@/lib/people/people-csv";

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

type InRow = Record<string, unknown>;
type Outcome = { row: number; email: string; status: "ready" | "error" | "member" | "invited"; message?: string; field?: string };

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (!ctx.isAdmin) return err(403, "Only an Admin can import people.");
  const body = (await req.json().catch(() => null)) as { rows?: unknown; dryRun?: unknown } | null;
  const rows = Array.isArray(body?.rows) ? (body!.rows as InRow[]) : [];
  const dryRun = body?.dryRun !== false;
  if (rows.length === 0) return err(400, "No rows provided");
  if (rows.length > 1000) return err(400, "Up to 1,000 people per import");

  const orgId = ctx.organizationId;
  const [org, members, pending, departments, roles, offices] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, domain: true } }),
    prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, email: true, deletedAt: true, accessLevel: true } }),
    // Only LIVE invitations block a row: a person whose invite expired can be
    // imported again (the expired row stays, untouched).
    prisma.invitation.findMany({ where: { organizationId: orgId, accepted: false, expiresAt: { gt: new Date() } }, select: { email: true } }),
    prisma.department.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    prisma.role.findMany({ where: { organizationId: orgId }, select: { id: true, title: true } }),
    prisma.office.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, city: true } }),
  ]);
  const me = members.find((m) => m.id === ctx.userId);
  const domain = (org?.domain?.trim() || me?.email.split("@")[1] || "").toLowerCase();
  const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m]));
  const invited = new Set(pending.map((p) => p.email.toLowerCase()));
  const dept = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const role = new Map(roles.map((r) => [(r.title || "").trim().toLowerCase(), r.id]));
  const office = new Map<string, string>();
  for (const o of offices) {
    office.set(o.name.trim().toLowerCase(), o.id);
    if (o.city) office.set(o.city.trim().toLowerCase(), o.id);
  }

  const outcomes: Outcome[] = [];
  const ready: Array<{ email: string; firstName: string; lastName: string; phone: string | null; departmentId: string | null; roleId: string | null; officeId: string | null; managerId: string | null }> = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const rowNum = i + 1;
    const email = s(r.email).toLowerCase();
    const fail = (field: string, message: string) => outcomes.push({ row: rowNum, email, status: "error", field, message });
    if (!s(r.firstName)) return fail("firstName", "First name is missing");
    if (!s(r.lastName)) return fail("lastName", "Last name is missing");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("email", "Not an email address");
    if (seen.has(email)) return fail("email", "This email is in the file twice");
    seen.add(email);
    if (domain && email.split("@")[1] !== domain) return fail("email", `Only @${domain} addresses can join`);
    const existing = memberByEmail.get(email);
    if (existing) {
      outcomes.push({ row: rowNum, email, status: "member", message: existing.deletedAt ? "Removed member: restore them from the Directory" : "Already a member" });
      return;
    }
    if (invited.has(email)) { outcomes.push({ row: rowNum, email, status: "invited", message: "Already invited" }); return; }
    const deptName = s(r.department).toLowerCase();
    const titleName = s(r.jobTitle ?? r.role).toLowerCase();
    const officeName = s(r.office).toLowerCase();
    const departmentId = deptName ? dept.get(deptName) ?? null : null;
    const roleId = titleName ? role.get(titleName) ?? null : null;
    const officeId = officeName ? office.get(officeName) ?? null : null;
    if (deptName && !departmentId) return fail("department", `No department named "${s(r.department)}"`);
    if (titleName && !roleId) return fail("jobTitle", `No job title named "${s(r.jobTitle ?? r.role)}"`);
    if (officeName && !officeId) return fail("office", `No office named "${s(r.office)}"`);
    let managerId: string | null = null;
    const reportsTo = s(r.reportsTo).toLowerCase();
    if (reportsTo) {
      const m = memberByEmail.get(reportsTo);
      if (!m || m.deletedAt) return fail("reportsTo", `Nobody here has the email ${reportsTo}`);
      if (m.accessLevel === "AGENT") return fail("reportsTo", "An Agent can't be anyone's manager");
      managerId = m.id;
    }
    outcomes.push({ row: rowNum, email, status: "ready" });
    const phone = s(r.phone).slice(0, 40) || null;
    ready.push({ email, firstName: s(r.firstName).slice(0, 80), lastName: s(r.lastName).slice(0, 80), phone, departmentId, roleId, officeId, managerId });
  });

  const summary = {
    total: rows.length,
    ready: ready.length,
    errors: outcomes.filter((o) => o.status === "error").length,
    members: outcomes.filter((o) => o.status === "member").length,
    invited: outcomes.filter((o) => o.status === "invited").length,
  };
  if (dryRun) return NextResponse.json({ dryRun: true, summary, rows: outcomes });
  if (ready.length === 0) return err(400, "No rows are ready to import");

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const created = await prisma.$transaction(
    ready.map((r) =>
      prisma.invitation.create({
        data: {
          email: r.email,
          // Kept on the invitation so the invitee's form starts filled and the
          // imported phone lands on their record when they join.
          firstName: r.firstName || null,
          lastName: r.lastName || null,
          phone: r.phone,
          accessLevel: "EMPLOYEE",
          token: crypto.randomBytes(32).toString("hex"),
          expiresAt,
          organizationId: orgId,
          departmentId: r.departmentId,
          roleId: r.roleId,
          officeId: r.officeId,
          managerId: r.managerId,
        },
        select: { id: true, email: true, token: true },
      }),
    ),
  );

  // Emails go out after the rows exist; a failed send leaves a pending
  // invitation the Members page can resend, never a lost person.
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  void (async () => {
    for (const inv of created) {
      try {
        const { subject, html } = invitationTemplate({ companyName: org?.name || "Your team", inviteLink: `${baseUrl}/join?token=${inv.token}`, accessLevel: "EMPLOYEE" });
        await sendEmail({ to: inv.email, subject, html, template: "invitation", variables: { companyName: org?.name }, organizationId: orgId, category: "invitation" });
      } catch (e) {
        console.error("[bulk-import] invitation email failed", e);
      }
    }
  })();

  void logActivity({
    type: "bulk_import",
    actorId: ctx.userId,
    organizationId: orgId,
    description: `Invited ${created.length} people from a file`,
    severity: "warning",
    metadata: { ...summary },
  });

  return NextResponse.json({ dryRun: false, summary: { ...summary, created: created.length }, rows: outcomes });
}

export async function GET() {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (!ctx.isAdmin) return err(403, "Only an Admin can import people.");
  return new Response(IMPORT_TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=import-people-template.csv",
    },
  });
}
