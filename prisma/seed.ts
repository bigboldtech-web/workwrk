// The local development seed: an "Acme Corp" workspace with people, KRAs and
// SOPs. Rewritten 2026-10-05: it loaded .env through dotenv (on a laptop,
// the production tunnel) and hard-coded the passwords it set, including the
// one for a SUPER_ADMIN admin@workwrk.com, in a repository that is public.
// Now it reads DATABASE_URL and nothing else (scripts/lib/script-prisma.ts),
// says which database it is pointed at, and takes both passwords from the
// environment without printing them:
//
//   DIRECT_URL= DATABASE_URL=<a LOCAL database> SEED_ADMIN_PASSWORD=<12+ chars> SEED_PASSWORD=<12+ chars> \
//     npx tsx prisma/seed.ts
//
// Never point it at production, and never write a password into this file.

import bcrypt from "bcryptjs";
import { databaseLabel, scriptPrisma } from "../scripts/lib/script-prisma";

const prisma = scriptPrisma();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";
const PEOPLE_PASSWORD = process.env.SEED_PASSWORD ?? "";
if (ADMIN_PASSWORD.length < 12 || PEOPLE_PASSWORD.length < 12) {
  throw new Error("Set SEED_ADMIN_PASSWORD and SEED_PASSWORD (12 characters or more each). They are never printed.");
}
console.log(`Database: ${databaseLabel()}`);

async function main() {
  console.log("Seeding database...");

  // Create organization
  const org = await prisma.organization.create({
    data: {
      name: "Acme Corp",
      slug: "acme-corp",
      plan: "GROWTH",
      status: "ACTIVE",
    },
  });

  // Create departments
  const departments = await Promise.all(
    [
      { name: "Engineering", description: "Product development and technical infrastructure", color: "#6C5CE7" },
      { name: "Sales", description: "Revenue generation and client relationships", color: "#00D68F" },
      { name: "Marketing", description: "Brand awareness and lead generation", color: "#FF9F43" },
      { name: "Operations", description: "Day-to-day business operations", color: "#FF6B6B" },
      { name: "HR", description: "People management and culture", color: "#A29BFE" },
      { name: "Finance", description: "Financial planning and compliance", color: "#54A0FF" },
    ].map((dept) =>
      prisma.department.create({
        data: { ...dept, organizationId: org.id },
      })
    )
  );

  const deptMap = Object.fromEntries(departments.map((d) => [d.name, d.id]));

  // Create roles
  const roles = await Promise.all(
    [
      { title: "Software Engineer", level: "EMPLOYEE" as const, departmentId: deptMap["Engineering"] },
      { title: "Sr. Developer", level: "EMPLOYEE" as const, departmentId: deptMap["Engineering"] },
      { title: "Product Manager", level: "MANAGER" as const, departmentId: deptMap["Engineering"] },
      { title: "Sales Executive", level: "EMPLOYEE" as const, departmentId: deptMap["Sales"] },
      { title: "Sales Lead", level: "TEAM_LEAD" as const, departmentId: deptMap["Sales"] },
      { title: "Marketing Executive", level: "EMPLOYEE" as const, departmentId: deptMap["Marketing"] },
      { title: "Ops Manager", level: "MANAGER" as const, departmentId: deptMap["Operations"] },
      { title: "Support Agent", level: "AGENT" as const, departmentId: deptMap["Operations"] },
      { title: "HR Manager", level: "HR" as const, departmentId: deptMap["HR"] },
      { title: "Finance Lead", level: "TEAM_LEAD" as const, departmentId: deptMap["Finance"] },
    ].map((role) =>
      prisma.role.create({
        data: { ...role, organizationId: org.id },
      })
    )
  );

  const roleMap = Object.fromEntries(roles.map((r) => [r.title, r.id]));
  const passwordHash = await bcrypt.hash(PEOPLE_PASSWORD, 12);
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      email: "admin@workwrk.com",
      passwordHash: adminPasswordHash,
      firstName: "Admin",
      lastName: "User",
      accessLevel: "SUPER_ADMIN",
      organizationId: org.id,
    },
  });

  // Create team members
  const people = [
    { firstName: "Priya", lastName: "Sharma", email: "priya@acmecorp.com", departmentId: deptMap["Sales"], roleId: roleMap["Sales Lead"], accessLevel: "TEAM_LEAD" as const, managerId: admin.id },
    { firstName: "Amit", lastName: "Joshi", email: "amit@acmecorp.com", departmentId: deptMap["Engineering"], roleId: roleMap["Sr. Developer"], accessLevel: "EMPLOYEE" as const, managerId: admin.id },
    { firstName: "Ravi", lastName: "Kumar", email: "ravi@acmecorp.com", departmentId: deptMap["Operations"], roleId: roleMap["Ops Manager"], accessLevel: "MANAGER" as const, managerId: admin.id },
    { firstName: "Neha", lastName: "Mehta", email: "neha@acmecorp.com", departmentId: deptMap["Marketing"], roleId: roleMap["Marketing Executive"], accessLevel: "EMPLOYEE" as const, managerId: admin.id },
    { firstName: "Sanjay", lastName: "Reddy", email: "sanjay@acmecorp.com", departmentId: deptMap["Operations"], roleId: roleMap["Support Agent"], accessLevel: "AGENT" as const, managerId: admin.id, status: "PIP" as const },
    { firstName: "Kavitha", lastName: "Nair", email: "kavitha@acmecorp.com", departmentId: deptMap["HR"], roleId: roleMap["HR Manager"], accessLevel: "HR" as const, managerId: admin.id },
    { firstName: "Deepak", lastName: "Patel", email: "deepak@acmecorp.com", departmentId: deptMap["Finance"], roleId: roleMap["Finance Lead"], accessLevel: "TEAM_LEAD" as const, managerId: admin.id },
    { firstName: "Anjali", lastName: "Singh", email: "anjali@acmecorp.com", departmentId: deptMap["Engineering"], roleId: roleMap["Product Manager"], accessLevel: "MANAGER" as const, managerId: admin.id },
  ];

  const users = await Promise.all(
    people.map((p) =>
      prisma.user.create({
        data: { ...p, passwordHash, organizationId: org.id },
      })
    )
  );

  const userMap = Object.fromEntries(users.map((u) => [`${u.firstName} ${u.lastName}`, u.id]));

  // Assign department heads
  await prisma.department.update({ where: { id: deptMap["Engineering"] }, data: { headId: userMap["Anjali Singh"] } });
  await prisma.department.update({ where: { id: deptMap["Sales"] }, data: { headId: userMap["Priya Sharma"] } });
  await prisma.department.update({ where: { id: deptMap["Operations"] }, data: { headId: userMap["Ravi Kumar"] } });
  await prisma.department.update({ where: { id: deptMap["HR"] }, data: { headId: userMap["Kavitha Nair"] } });
  await prisma.department.update({ where: { id: deptMap["Finance"] }, data: { headId: userMap["Deepak Patel"] } });

  // Create KRAs
  const kras = await Promise.all(
    [
      { name: "Revenue Generation", category: "Sales", roleId: roleMap["Sales Executive"] },
      { name: "Client Acquisition", category: "Sales", roleId: roleMap["Sales Lead"] },
      { name: "Code Quality", category: "Engineering", roleId: roleMap["Software Engineer"] },
      { name: "Sprint Velocity", category: "Engineering", roleId: roleMap["Software Engineer"] },
      { name: "Lead Generation", category: "Marketing", roleId: roleMap["Marketing Executive"] },
      { name: "Process Efficiency", category: "Operations", roleId: roleMap["Ops Manager"] },
      { name: "Customer Satisfaction", category: "Support", roleId: roleMap["Support Agent"] },
      { name: "Employee Retention", category: "HR", roleId: roleMap["HR Manager"] },
    ].map((kra) =>
      prisma.kRA.create({
        data: { ...kra, organizationId: org.id },
      })
    )
  );

  // Create some calendar tasks
  const tasks = [
    { title: "Finalize hiring plan for Ops team", status: "IN_PROGRESS" as const, assigneeId: userMap["Amit Joshi"], date: new Date("2026-04-01"), startTime: "09:00", endTime: "11:00" },
    { title: "Prepare client escalation report", status: "PLANNED" as const, assigneeId: userMap["Priya Sharma"], date: new Date("2026-04-02"), startTime: "10:00", endTime: "12:00" },
    { title: "Review vendor SLA documents", status: "COMPLETED" as const, assigneeId: userMap["Neha Mehta"], date: new Date("2026-04-01"), startTime: "14:00", endTime: "15:00" },
    { title: "Fix authentication timeout bug", status: "IN_PROGRESS" as const, assigneeId: userMap["Deepak Patel"], date: new Date("2026-04-01"), startTime: "09:00", endTime: "17:00" },
  ];

  await Promise.all(
    tasks.map((t) =>
      prisma.task.create({
        data: { ...t, organizationId: org.id },
      })
    )
  );

  // Create SOPs — content shape must match sopType: WRITTEN reads
  // { type: "steps" } lists, CHECKLIST reads { type: "CHECKLIST",
  // sections } (the shape the checklist runner + step-counter expect).
  const writtenSteps = (titles: string[]) => ({
    type: "steps",
    steps: titles.map((title, i) => ({ id: `s${i + 1}`, title })),
  });
  const sops = [
    { title: "Client Onboarding Process", category: "Sales", status: "PUBLISHED" as const, sopType: "WRITTEN" as const, content: writtenSteps(["Initial contact", "Needs assessment", "Proposal", "Onboarding call", "Setup", "Training", "Go-live"]), version: 3 },
    { title: "Order Processing Workflow", category: "Operations", status: "PUBLISHED" as const, sopType: "WRITTEN" as const, content: writtenSteps(["Order received", "Verification", "Processing", "Quality check", "Dispatch", "Confirmation"]), version: 5 },
    { title: "Code Review Guidelines", category: "Engineering", status: "PUBLISHED" as const, sopType: "WRITTEN" as const, content: writtenSteps(["PR creation", "Self-review", "Assign reviewers", "Address feedback", "Final approval", "Merge"]), version: 6 },
    {
      title: "Employee Onboarding Checklist", category: "HR", status: "PUBLISHED" as const, sopType: "CHECKLIST" as const,
      content: {
        type: "CHECKLIST",
        sections: [{
          title: "Onboarding",
          steps: ["Documentation", "IT setup", "Team intro", "Role briefing", "Buddy assignment", "30-day check"]
            .map((title, i) => ({ id: `eo${i + 1}`, title, type: "task", inputs: [], contentBlocks: [] })),
        }],
      },
      version: 4,
    },
  ];

  await Promise.all(
    sops.map((s) =>
      prisma.sOP.create({
        data: { ...s, organizationId: org.id, publishedAt: new Date() },
      })
    )
  );

  console.log("Seed complete!");
  console.log("Sign in as admin@workwrk.com with SEED_ADMIN_PASSWORD, or as anyone else with SEED_PASSWORD.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
