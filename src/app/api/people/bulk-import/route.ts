import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const actorId = getUserId(session);
  const body = await req.json();
  const { rows, dryRun } = body;

  if (!Array.isArray(rows) || rows.length === 0) return jsonError("No rows provided");
  if (rows.length > 1000) return jsonError("Maximum 1000 rows per import");

  // Get existing data for validation
  const [existingUsers, departments, roles] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: orgId }, select: { email: true } }),
    prisma.department.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    prisma.role.findMany({ where: { organizationId: orgId }, select: { id: true, title: true } }),
  ]);

  const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
  const deptMap = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const roleMap = new Map(roles.map((r) => [(r.title || "").toLowerCase(), r.id]));

  const errors: { row: number; field: string; message: string }[] = [];
  const validRows: any[] = [];
  const seenEmails = new Set<string>();
  const passwordHash = await bcrypt.hash("Welcome@123", 12);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    if (!row.firstName?.trim()) { errors.push({ row: rowNum, field: "firstName", message: "First name required" }); continue; }
    if (!row.lastName?.trim()) { errors.push({ row: rowNum, field: "lastName", message: "Last name required" }); continue; }
    if (!row.email?.trim() || !row.email.includes("@")) { errors.push({ row: rowNum, field: "email", message: "Valid email required" }); continue; }

    const email = row.email.trim().toLowerCase();
    if (existingEmails.has(email)) { errors.push({ row: rowNum, field: "email", message: "Email already exists" }); continue; }
    if (seenEmails.has(email)) { errors.push({ row: rowNum, field: "email", message: "Duplicate email in import" }); continue; }
    seenEmails.add(email);

    const deptId = row.department ? deptMap.get(row.department.trim().toLowerCase()) : undefined;
    const roleId = row.role ? roleMap.get(row.role.trim().toLowerCase()) : undefined;

    validRows.push({
      firstName: row.firstName.trim(),
      lastName: row.lastName.trim(),
      email,
      phone: row.phone?.trim() || null,
      passwordHash,
      departmentId: deptId || null,
      roleId: roleId || null,
      accessLevel: row.accessLevel || "EMPLOYEE",
      organizationId: orgId,
    });
  }

  if (dryRun) {
    return jsonSuccess({
      valid: validRows.length,
      errors: errors.length,
      errorDetails: errors,
      total: rows.length,
    });
  }

  // Actually import
  if (validRows.length === 0) return jsonError("No valid rows to import");

  const result = await prisma.user.createMany({ data: validRows, skipDuplicates: true });

  logActivity({
    type: "bulk_import",
    actorId,
    organizationId: orgId,
    description: `Bulk imported ${result.count} employees`,
    severity: "warning",
  });

  return jsonSuccess({
    imported: result.count,
    skipped: rows.length - validRows.length,
    errors: errors.length,
    errorDetails: errors.slice(0, 50),
  });
}

// GET: Download CSV template
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const csv = `firstName,lastName,email,phone,department,role,accessLevel
John,Doe,john@example.com,+1234567890,Engineering,Software Engineer,EMPLOYEE
Jane,Smith,jane@example.com,+1234567891,Marketing,Marketing Manager,MANAGER`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=employee-import-template.csv",
    },
  });
}
