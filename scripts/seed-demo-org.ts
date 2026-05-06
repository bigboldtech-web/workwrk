/**
 * Demo / sandbox org seeder.
 *
 * Creates an org named "Sandbox" with a realistic spread of users,
 * departments, KRAs, KPIs, SOPs, OKRs, and meetings. Used for:
 *   · AppSumo / G2 reviewers — give them a login that already has
 *     content so they can poke around without setting anything up
 *   · Demo videos
 *   · Internal QA across the role × surface matrix
 *
 * Re-runnable: deletes the previous Sandbox org first (cascades
 * through all related rows), then recreates it. Don't run this
 * against any other org name.
 *
 * Usage:
 *   DATABASE_URL=... SEED_PASSWORD=... npx tsx scripts/seed-demo-org.ts
 *
 * Default password if SEED_PASSWORD is unset: "demo-1234". Reviewers
 * sign in with admin@sandbox.workwrk.com + that password.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const ORG_NAME = "Sandbox";
const ORG_SLUG = "sandbox";
const PASSWORD = process.env.SEED_PASSWORD || "demo-1234";

async function main() {
  console.log(`Seeding demo org "${ORG_NAME}"…`);
  console.log(`Default password: ${PASSWORD}\n`);

  // Wipe any previous demo org for an idempotent re-seed.
  const existing = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (existing) {
    console.log(`Deleting previous "${ORG_NAME}" (id=${existing.id})…`);
    await prisma.organization.delete({ where: { id: existing.id } });
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // 1. Org
  const org = await prisma.organization.create({
    data: {
      name: ORG_NAME,
      slug: ORG_SLUG,
      plan: "ENTERPRISE",
      status: "ACTIVE",
      settings: {
        // Switch on the modules a real customer would use day 1.
        enabledModules: ["people", "kra-kpi", "tasks", "sops", "reviews", "meetings", "analytics", "ai", "checkins"],
        // Demo-friendly defaults for white-label / BYOK off.
        features: { byok: false, whiteLabel: false, customDomain: false },
      },
    },
  });
  console.log(`✓ Org created: ${org.id}`);

  // 2. Departments + offices
  const [engDept, opsDept, salesDept, mktDept] = await Promise.all([
    prisma.department.create({ data: { name: "Engineering", organizationId: org.id } }),
    prisma.department.create({ data: { name: "Operations", organizationId: org.id } }),
    prisma.department.create({ data: { name: "Sales", organizationId: org.id } }),
    prisma.department.create({ data: { name: "Marketing", organizationId: org.id } }),
  ]);
  console.log(`✓ Departments: 4`);

  // 3. Roles
  const [ceoRole, engMgrRole, opsMgrRole, salesMgrRole, engRole, salesRole, mktRole] = await Promise.all([
    prisma.role.create({ data: { title: "CEO", level: "C_LEVEL", organizationId: org.id } }),
    prisma.role.create({ data: { title: "Engineering Manager", level: "MANAGER", organizationId: org.id, departmentId: engDept.id } }),
    prisma.role.create({ data: { title: "Operations Manager", level: "MANAGER", organizationId: org.id, departmentId: opsDept.id } }),
    prisma.role.create({ data: { title: "Sales Manager", level: "MANAGER", organizationId: org.id, departmentId: salesDept.id } }),
    prisma.role.create({ data: { title: "Software Engineer", level: "EMPLOYEE", organizationId: org.id, departmentId: engDept.id } }),
    prisma.role.create({ data: { title: "Account Executive", level: "EMPLOYEE", organizationId: org.id, departmentId: salesDept.id } }),
    prisma.role.create({ data: { title: "Marketing Specialist", level: "EMPLOYEE", organizationId: org.id, departmentId: mktDept.id } }),
  ]);

  // 4. Users — reviewer-friendly, easy to remember emails
  const ceo = await prisma.user.create({
    data: {
      email: "admin@sandbox.workwrk.com",
      firstName: "Maya",
      lastName: "Sharma",
      passwordHash,
      accessLevel: "COMPANY_ADMIN",
      organizationId: org.id,
      departmentId: engDept.id,
      roleId: ceoRole.id,
      status: "ACTIVE",
      joinDate: new Date("2024-01-15"),
    },
  });

  const engMgr = await prisma.user.create({
    data: {
      email: "engineering@sandbox.workwrk.com",
      firstName: "Aarav", lastName: "Mehta", passwordHash,
      accessLevel: "MANAGER",
      organizationId: org.id, departmentId: engDept.id, roleId: engMgrRole.id, managerId: ceo.id,
      status: "ACTIVE", joinDate: new Date("2024-03-01"),
    },
  });

  const salesMgr = await prisma.user.create({
    data: {
      email: "sales@sandbox.workwrk.com",
      firstName: "Priya", lastName: "Iyer", passwordHash,
      accessLevel: "MANAGER",
      organizationId: org.id, departmentId: salesDept.id, roleId: salesMgrRole.id, managerId: ceo.id,
      status: "ACTIVE", joinDate: new Date("2024-04-10"),
    },
  });

  const opsMgr = await prisma.user.create({
    data: {
      email: "ops@sandbox.workwrk.com",
      firstName: "Rohan", lastName: "Desai", passwordHash,
      accessLevel: "MANAGER",
      organizationId: org.id, departmentId: opsDept.id, roleId: opsMgrRole.id, managerId: ceo.id,
      status: "ACTIVE", joinDate: new Date("2024-05-12"),
    },
  });

  const employees = await Promise.all([
    prisma.user.create({ data: { email: "alex@sandbox.workwrk.com", firstName: "Alex", lastName: "Kim", passwordHash, accessLevel: "EMPLOYEE", organizationId: org.id, departmentId: engDept.id, roleId: engRole.id, managerId: engMgr.id, status: "ACTIVE", joinDate: new Date("2024-08-01") } }),
    prisma.user.create({ data: { email: "sam@sandbox.workwrk.com", firstName: "Sam", lastName: "Patel", passwordHash, accessLevel: "EMPLOYEE", organizationId: org.id, departmentId: engDept.id, roleId: engRole.id, managerId: engMgr.id, status: "ACTIVE", joinDate: new Date("2025-01-15") } }),
    prisma.user.create({ data: { email: "jordan@sandbox.workwrk.com", firstName: "Jordan", lastName: "Lee", passwordHash, accessLevel: "EMPLOYEE", organizationId: org.id, departmentId: salesDept.id, roleId: salesRole.id, managerId: salesMgr.id, status: "ACTIVE", joinDate: new Date("2024-09-20") } }),
    prisma.user.create({ data: { email: "casey@sandbox.workwrk.com", firstName: "Casey", lastName: "Garcia", passwordHash, accessLevel: "EMPLOYEE", organizationId: org.id, departmentId: mktDept.id, roleId: mktRole.id, managerId: ceo.id, status: "ACTIVE", joinDate: new Date("2025-02-05") } }),
  ]);
  console.log(`✓ Users: ${[ceo, engMgr, salesMgr, opsMgr, ...employees].length}`);

  // 5. Categories + subcategories
  const [hrCat, mktCat, opsCat, salesCat] = await Promise.all([
    prisma.sOPCategory.create({ data: { name: "HR", organizationId: org.id } }),
    prisma.sOPCategory.create({ data: { name: "Marketing", organizationId: org.id } }),
    prisma.sOPCategory.create({ data: { name: "Operations", organizationId: org.id } }),
    prisma.sOPCategory.create({ data: { name: "Sales", organizationId: org.id } }),
  ]);
  await Promise.all([
    prisma.sOPSubcategory.create({ data: { name: "Onboarding", categoryId: hrCat.id } }),
    prisma.sOPSubcategory.create({ data: { name: "Coupon Management", categoryId: mktCat.id } }),
    prisma.sOPSubcategory.create({ data: { name: "Order Management", categoryId: opsCat.id } }),
    prisma.sOPSubcategory.create({ data: { name: "Sales Operations", categoryId: salesCat.id } }),
  ]);

  // 6. SOPs
  await prisma.sOP.createMany({
    data: [
      { title: "New employee onboarding", description: "First-week checklist for any new hire — IT setup, paperwork, intro meetings.", category: "HR", subcategory: "Onboarding", sopType: "WRITTEN", status: "PUBLISHED", version: 2, publishedAt: new Date(), content: { type: "richtext", html: "<h3>Day 1</h3><p>Welcome the new hire, walk through laptop setup, share team channel.</p><h3>Week 1</h3><p>Schedule 1:1s with their direct teammates, share KRAs, walk through OKRs.</p>" }, organizationId: org.id },
      { title: "Weekly content scheduling", description: "How the marketing team plans + ships content each week.", category: "Marketing", sopType: "WRITTEN", status: "PUBLISHED", version: 1, publishedAt: new Date(), content: { type: "richtext", html: "<p>Monday: brainstorm topics. Tuesday: draft. Wednesday: review. Thursday: schedule. Friday: review metrics.</p>" }, organizationId: org.id },
      { title: "Order exception handling", description: "What to do when a customer order fails to fulfill on the first try.", category: "Operations", subcategory: "Order Management", sopType: "WRITTEN", status: "PUBLISHED", version: 1, publishedAt: new Date(), content: { type: "richtext", html: "<p>1. Identify the failure mode. 2. Notify the customer within 2 hours. 3. Resolve within 24h or escalate.</p>" }, organizationId: org.id },
      { title: "Lead reallocation rules", description: "How leads get reassigned when an AE is on PTO or hits SLA breach.", category: "Sales", subcategory: "Sales Operations", sopType: "WRITTEN", status: "DRAFT", version: 1, content: { type: "richtext", html: "<p>If no response in 24h, lead gets reassigned to the team-lead pool.</p>" }, organizationId: org.id },
    ],
  });
  console.log(`✓ SOPs: 4`);

  // 7. KRAs + KPIs
  const engKra = await prisma.kRA.create({
    data: {
      name: "Engineering throughput",
      description: "Ship features predictably, with high quality.",
      category: "Performance",
      organizationId: org.id,
      roleId: engMgrRole.id,
      kpis: {
        create: [
          { name: "Story points / sprint", unit: "count", type: "QUANTITATIVE", frequency: "WEEKLY", targetValue: 30, organizationId: org.id },
          { name: "Bug escape rate", unit: "%", type: "QUANTITATIVE", frequency: "MONTHLY", targetValue: 2, lowerIsBetter: true, organizationId: org.id },
        ],
      },
    },
  });
  const salesKra = await prisma.kRA.create({
    data: {
      name: "Revenue generation",
      description: "Close deals, hit ARR targets.",
      category: "Growth",
      organizationId: org.id,
      roleId: salesMgrRole.id,
      kpis: {
        create: [
          { name: "Monthly ARR added", unit: "$", type: "QUANTITATIVE", frequency: "MONTHLY", targetValue: 50000, organizationId: org.id },
          { name: "Demos booked", unit: "count", type: "QUANTITATIVE", frequency: "WEEKLY", targetValue: 12, organizationId: org.id },
        ],
      },
    },
  });

  // Assign KRAs to people
  await Promise.all([
    prisma.kRAAssignment.create({ data: { kraId: engKra.id, userId: engMgr.id, weightage: 100, status: "ACTIVE" } }),
    prisma.kRAAssignment.create({ data: { kraId: engKra.id, userId: employees[0].id, weightage: 60, status: "ACTIVE" } }),
    prisma.kRAAssignment.create({ data: { kraId: engKra.id, userId: employees[1].id, weightage: 60, status: "ACTIVE" } }),
    prisma.kRAAssignment.create({ data: { kraId: salesKra.id, userId: salesMgr.id, weightage: 100, status: "ACTIVE" } }),
    prisma.kRAAssignment.create({ data: { kraId: salesKra.id, userId: employees[2].id, weightage: 80, status: "ACTIVE" } }),
  ]);
  console.log(`✓ KRAs + KPIs: 2 KRAs / 4 KPIs / 5 assignments`);

  // 8. OKRs (one company, one team, one personal — to show the cascade)
  const quarter = "Q2 2026";
  const companyOkr = await prisma.oKR.create({
    data: {
      title: "Reach $1M ARR by end of Q2",
      description: "Combine new customer growth with expansion revenue from existing accounts.",
      level: "COMPANY",
      status: "ON_TRACK",
      progress: 60,
      quarter,
      ownerId: ceo.id,
      organizationId: org.id,
      checkInCadence: "WEEKLY",
      keyResults: {
        create: [
          { title: "New ARR", unit: "$", startValue: 0, targetValue: 600000, currentValue: 350000, progress: 58 },
          { title: "Expansion ARR", unit: "$", startValue: 0, targetValue: 200000, currentValue: 130000, progress: 65 },
        ],
      },
    },
  });
  await prisma.oKR.create({
    data: {
      title: "Engineering ships 2 major features",
      description: "Ship the assignment-rules engine and the new dashboard widgets.",
      level: "TEAM", status: "ON_TRACK", progress: 70, quarter,
      ownerId: engMgr.id, organizationId: org.id, parentId: companyOkr.id,
      departmentId: engDept.id, checkInCadence: "WEEKLY",
      keyResults: {
        create: [
          { title: "Features shipped", unit: "count", startValue: 0, targetValue: 2, currentValue: 1, progress: 50 },
          { title: "Sprint velocity", unit: "points", startValue: 25, targetValue: 32, currentValue: 30, progress: 71 },
        ],
      },
    },
  });
  await prisma.oKR.create({
    data: {
      title: "Personal: improve PR review turnaround",
      description: "Cut my median PR review time so the team isn't blocked on me.",
      level: "INDIVIDUAL", status: "AT_RISK", progress: 35, quarter,
      ownerId: employees[0].id, organizationId: org.id,
      checkInCadence: "WEEKLY",
      keyResults: {
        create: [
          { title: "Median review time", unit: "hours", startValue: 18, targetValue: 6, currentValue: 14, progress: 33, lastReminderAt: null },
        ],
      },
    },
  });
  console.log(`✓ OKRs: 3 (1 company / 1 team / 1 individual)`);

  // 9. Announcements
  await prisma.announcement.createMany({
    data: [
      { title: "🎉 Welcome to WorkwrK Sandbox", content: "This is a demo organization with realistic data. Click around — nothing's destructive.", type: "CELEBRATION", priority: "HIGH", authorId: ceo.id, organizationId: org.id, pinned: true, publishedAt: new Date() },
      { title: "Quarterly review window opens Monday", content: "Self-assessments due in two weeks. Manager reviews due in three.", type: "INFO", priority: "NORMAL", authorId: ceo.id, organizationId: org.id, publishedAt: new Date() },
    ],
  });

  // 10. Some kudos to make the dashboard feel alive
  await prisma.kudos.createMany({
    data: [
      { giverId: ceo.id, receiverId: engMgr.id, message: "Killer demo for the board last week. Engineering depth shone through.", organizationId: org.id, companyValue: "Excellence" },
      { giverId: engMgr.id, receiverId: employees[0].id, message: "Your refactor cut deploy time by 40%. Hero work.", organizationId: org.id, companyValue: "Ownership" },
      { giverId: salesMgr.id, receiverId: employees[2].id, message: "Closed three deals this week. Texas is officially yours.", organizationId: org.id, companyValue: "Customer First" },
    ],
  });

  console.log(`\n=== Demo org ready ===`);
  console.log(`Org id:   ${org.id}`);
  console.log(`Org slug: ${ORG_SLUG}`);
  console.log(`Sign in:`);
  console.log(`  admin@sandbox.workwrk.com         · Maya (CEO / Admin)`);
  console.log(`  engineering@sandbox.workwrk.com   · Aarav (Engineering Manager)`);
  console.log(`  sales@sandbox.workwrk.com         · Priya (Sales Manager)`);
  console.log(`  alex@sandbox.workwrk.com          · Alex (Software Engineer)`);
  console.log(`  jordan@sandbox.workwrk.com        · Jordan (Account Executive)`);
  console.log(`Password: ${PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
