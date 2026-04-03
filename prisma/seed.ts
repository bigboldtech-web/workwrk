import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");

console.log("Connecting to:", connStr.replace(/:[^@]+@/, ":****@"));
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

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
  const passwordHash = await bcrypt.hash("password123", 12);
  const adminPasswordHash = await bcrypt.hash("TheyWrk@1212@TW", 12);

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

  // Create SOPs
  const sops = [
    { title: "Client Onboarding Process", category: "Sales", status: "PUBLISHED" as const, content: { steps: ["Initial contact", "Needs assessment", "Proposal", "Onboarding call", "Setup", "Training", "Go-live"] }, version: 3 },
    { title: "Order Processing Workflow", category: "Operations", status: "PUBLISHED" as const, content: { steps: ["Order received", "Verification", "Processing", "Quality check", "Dispatch", "Confirmation"] }, version: 5 },
    { title: "Code Review Guidelines", category: "Engineering", status: "PUBLISHED" as const, content: { steps: ["PR creation", "Self-review", "Assign reviewers", "Address feedback", "Final approval", "Merge"] }, version: 6 },
    { title: "Employee Onboarding Checklist", category: "HR", status: "PUBLISHED" as const, content: { steps: ["Documentation", "IT setup", "Team intro", "Role briefing", "Buddy assignment", "30-day check"] }, version: 4 },
  ];

  await Promise.all(
    sops.map((s) =>
      prisma.sOP.create({
        data: { ...s, organizationId: org.id, publishedAt: new Date() },
      })
    )
  );

  console.log("Seed complete!");
  console.log(`\nLogin credentials:`);
  console.log(`  Email: admin@workwrk.com`);
  console.log(`  Password: password123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
