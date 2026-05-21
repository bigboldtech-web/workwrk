// Role-definition defaults + backfill.
//
// The KRA/KPI/SOP entry gate (added 2026-05-22) blocks future invites
// from going out without a role definition. This module handles the
// other half: existing users in an org who pre-date the gate and have
// zero KRAAssignment / SOPAssignment rows.
//
// `ensureOrgStarterDefinitions` seeds a universal set of KRAs (each
// with a starter KPI) plus a welcome SOP into an org once. Idempotent
// — re-running on an org that already has the seeds is a no-op.
//
// `backfillUserRoleDefinitions(userId)` picks the right starter KRAs
// for that user's access level and stamps KRAAssignment + SOPAssignment
// rows. Safe to call on a user that already has them — uses
// skipDuplicates and short-circuits when the user is already set.

import { prisma } from "@/lib/prisma";

// One starter KRA per row. `tier` controls which access levels get it.
// `category` is also stored on the KRA so the /kra-kpi page can group
// them sensibly.
type StarterTier = "core" | "execution" | "leadership" | "executive";

interface StarterKra {
  name: string;
  description: string;
  category: string;
  tier: StarterTier;
  /** One KPI is seeded under this KRA so the org has measurable
   *  targets from day one. */
  kpi: {
    name: string;
    description?: string;
    targetValue: number;
    targetLabel?: string;
    frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUALLY";
    lowerIsBetter?: boolean;
    unit?: string;
  };
}

const STARTER_KRAS: StarterKra[] = [
  // ── Core (everyone)
  {
    name: "Goal completion",
    description: "Hit committed deliverables on time, every cycle.",
    category: "core",
    tier: "core",
    kpi: {
      name: "On-time delivery rate",
      description: "Share of committed deliverables shipped by their due date.",
      targetValue: 90,
      targetLabel: "≥ 90%",
      unit: "%",
      frequency: "MONTHLY",
    },
  },
  {
    name: "Quality of work",
    description: "Output meets the bar — minimal rework, no escapes to downstream consumers.",
    category: "core",
    tier: "core",
    kpi: {
      name: "Rework rate",
      description: "Share of work that needs material rework after first delivery.",
      targetValue: 10,
      targetLabel: "≤ 10%",
      unit: "%",
      frequency: "MONTHLY",
      lowerIsBetter: true,
    },
  },
  {
    name: "Collaboration",
    description: "Lift teammates and partner teams; share context proactively.",
    category: "core",
    tier: "core",
    kpi: {
      name: "Peer rating",
      description: "Average peer score from quarterly 360.",
      targetValue: 4,
      targetLabel: "≥ 4 / 5",
      unit: "/5",
      frequency: "QUARTERLY",
    },
  },

  // ── Execution (ICs + frontline)
  {
    name: "Process adherence",
    description: "Follow assigned SOPs end-to-end; flag exceptions instead of shortcutting.",
    category: "execution",
    tier: "execution",
    kpi: {
      name: "SOP completion rate",
      description: "Share of assigned SOPs acknowledged or marked complete on time.",
      targetValue: 100,
      targetLabel: "100%",
      unit: "%",
      frequency: "MONTHLY",
    },
  },
  {
    name: "Task throughput",
    description: "Sustain a healthy rate of completed tasks each week.",
    category: "execution",
    tier: "execution",
    kpi: {
      name: "Tasks completed per week",
      targetValue: 8,
      targetLabel: "≥ 8 / week",
      unit: "tasks",
      frequency: "WEEKLY",
    },
  },

  // ── Leadership (managers + team leads)
  {
    name: "Team performance",
    description: "Direct reports hit their goals — your job is to make sure they do.",
    category: "leadership",
    tier: "leadership",
    kpi: {
      name: "Team OKR achievement",
      description: "Share of team's quarterly OKRs scored above 0.7.",
      targetValue: 70,
      targetLabel: "≥ 70%",
      unit: "%",
      frequency: "QUARTERLY",
    },
  },
  {
    name: "1:1 cadence",
    description: "Hold a meaningful 1:1 with every direct report at least every two weeks.",
    category: "leadership",
    tier: "leadership",
    kpi: {
      name: "1:1s held per direct report",
      description: "Average number of 1:1 conversations logged per direct report per month.",
      targetValue: 2,
      targetLabel: "≥ 2 / mo per report",
      unit: "1:1s",
      frequency: "MONTHLY",
    },
  },

  // ── Executive (directors + VPs + C-level)
  {
    name: "Strategic execution",
    description: "Translate company strategy into shipped outcomes inside your scope.",
    category: "executive",
    tier: "executive",
    kpi: {
      name: "Quarterly goals delivered",
      description: "Share of committed quarterly initiatives in your scope marked Shipped.",
      targetValue: 80,
      targetLabel: "≥ 80%",
      unit: "%",
      frequency: "QUARTERLY",
    },
  },
  {
    name: "Cross-functional alignment",
    description: "Unblock dependencies across teams; resolve escalations quickly.",
    category: "executive",
    tier: "executive",
    kpi: {
      name: "Cross-team blockers resolved",
      description: "Number of cross-team blockers you personally cleared each month.",
      targetValue: 5,
      targetLabel: "≥ 5 / month",
      unit: "blockers",
      frequency: "MONTHLY",
    },
  },
];

const STARTER_SOP_TITLE = "Welcome — how we work here";
const STARTER_SOP_CONTENT = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Welcome to the team" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "This is a starter SOP auto-assigned to everyone in the org so the entry gate is satisfied. Replace the steps below with your real onboarding flow — anything from 'where to file expenses' to 'how to push code'.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Day 1" }],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Read the role brief in your Sidekick onboarding panel." }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Acknowledge your assigned KRAs in KRA & KPIs." }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Complete this SOP." }] }] },
      ],
    },
  ],
};

function tierIdsFor(accessLevel: string): StarterTier[] {
  if (accessLevel === "C_LEVEL" || accessLevel === "VP" || accessLevel === "DIRECTOR" || accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN") {
    return ["core", "leadership", "executive"];
  }
  if (accessLevel === "MANAGER" || accessLevel === "TEAM_LEAD" || accessLevel === "HR") {
    return ["core", "execution", "leadership"];
  }
  // EMPLOYEE / AGENT and anything unknown → core + execution
  return ["core", "execution"];
}

/**
 * Seed the org's starter KRAs (with one KPI each) + a welcome SOP if
 * any are missing. Idempotent — re-running is a no-op once the seeds
 * exist. Returns the ids of the starter KRAs and the starter SOP so
 * callers can fan them out into assignments.
 */
export async function ensureOrgStarterDefinitions(organizationId: string): Promise<{
  krasByTier: Record<StarterTier, string[]>;
  starterSopId: string | null;
}> {
  const krasByTier: Record<StarterTier, string[]> = {
    core: [],
    execution: [],
    leadership: [],
    executive: [],
  };

  for (const starter of STARTER_KRAS) {
    // Match by name within the org so an admin who already typed
    // "Goal completion" by hand doesn't get a duplicate.
    const existing = await prisma.kRA.findFirst({
      where: { organizationId, name: starter.name },
      select: { id: true },
    });
    let kraId: string;
    if (existing) {
      kraId = existing.id;
    } else {
      const created = await prisma.kRA.create({
        data: {
          organizationId,
          name: starter.name,
          description: starter.description,
          category: starter.category,
        },
        select: { id: true },
      });
      kraId = created.id;
    }

    // Ensure a starter KPI sits under this KRA. Same name-match
    // idempotency as above.
    const existingKpi = await prisma.kPI.findFirst({
      where: { organizationId, kraId, name: starter.kpi.name },
      select: { id: true },
    });
    if (!existingKpi) {
      await prisma.kPI.create({
        data: {
          organizationId,
          kraId,
          name: starter.kpi.name,
          description: starter.kpi.description,
          targetValue: starter.kpi.targetValue,
          targetLabel: starter.kpi.targetLabel,
          unit: starter.kpi.unit,
          frequency: starter.kpi.frequency,
          lowerIsBetter: starter.kpi.lowerIsBetter ?? false,
        },
      });
    }

    krasByTier[starter.tier].push(kraId);
  }

  // Starter SOP — ensure at least one published SOP exists so the
  // assignment fan-out has something to point at.
  let starterSop = await prisma.sOP.findFirst({
    where: { organizationId, title: STARTER_SOP_TITLE },
    select: { id: true, status: true },
  });
  if (!starterSop) {
    const created = await prisma.sOP.create({
      data: {
        organizationId,
        title: STARTER_SOP_TITLE,
        description: "Auto-generated starter SOP. Replace with your real onboarding doc.",
        content: STARTER_SOP_CONTENT,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
      select: { id: true, status: true },
    });
    starterSop = created;
  } else if (starterSop.status !== "PUBLISHED") {
    await prisma.sOP.update({
      where: { id: starterSop.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }

  return { krasByTier, starterSopId: starterSop?.id ?? null };
}

/**
 * Stamp KRA + SOP assignments onto an existing user who has none.
 * No-op when the user already has any KRAAssignment. KRAs picked by
 * the user's access tier; SOPs default to the org's published org-wide
 * (no folder) SOP set, or fall back to the starter SOP.
 */
export async function backfillUserRoleDefinitions(userId: string): Promise<{
  kraAssignments: number;
  sopAssignments: number;
  skipped: boolean;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, accessLevel: true },
  });
  if (!user) return { kraAssignments: 0, sopAssignments: 0, skipped: true };

  const existingCount = await prisma.kRAAssignment.count({ where: { userId } });
  if (existingCount > 0) return { kraAssignments: 0, sopAssignments: 0, skipped: true };

  const { krasByTier, starterSopId } = await ensureOrgStarterDefinitions(user.organizationId);

  // Combine KRAs from the tiers that apply to this access level.
  const tiers = tierIdsFor(user.accessLevel as string);
  const kraIds = Array.from(new Set(tiers.flatMap((t) => krasByTier[t])));

  // SOPs to assign: prefer the org's existing org-wide (unfoldered)
  // published SOPs so users acknowledge real docs when they exist. If
  // none exist, fall back to the starter we just guaranteed.
  const orgSops = await prisma.sOP.findMany({
    where: {
      organizationId: user.organizationId,
      status: "PUBLISHED",
      folderId: null,
    },
    select: { id: true },
    take: 5,
  });
  const sopIds = orgSops.length > 0
    ? orgSops.map((s) => s.id)
    : starterSopId ? [starterSopId] : [];

  let kraAssignments = 0;
  let sopAssignments = 0;

  if (kraIds.length > 0) {
    const weight = Math.round((100 / kraIds.length) * 100) / 100;
    const result = await prisma.kRAAssignment.createMany({
      data: kraIds.map((kraId) => ({
        userId,
        kraId,
        weightage: weight,
        period: "ongoing",
        status: "ACTIVE" as const,
      })),
      skipDuplicates: true,
    });
    kraAssignments = result.count;
  }

  if (sopIds.length > 0) {
    const result = await prisma.sOPAssignment.createMany({
      data: sopIds.map((sopId) => ({
        userId,
        sopId,
        status: "ASSIGNED" as const,
        mandatory: true,
      })),
      skipDuplicates: true,
    });
    sopAssignments = result.count;
  }

  return { kraAssignments, sopAssignments, skipped: false };
}

/**
 * Org-wide backfill — finds every user in the org with zero
 * KRAAssignment rows and runs `backfillUserRoleDefinitions` against
 * each. Returns an aggregated summary so the UI can show "12 users
 * got 3 KRAs + 1 SOP each."
 */
export async function backfillOrgRoleDefinitions(organizationId: string): Promise<{
  usersTouched: number;
  totalKraAssignments: number;
  totalSopAssignments: number;
}> {
  const missing = await prisma.user.findMany({
    where: {
      organizationId,
      kraAssignments: { none: {} },
    },
    select: { id: true },
  });

  let usersTouched = 0;
  let totalKraAssignments = 0;
  let totalSopAssignments = 0;

  for (const u of missing) {
    const result = await backfillUserRoleDefinitions(u.id);
    if (!result.skipped) {
      usersTouched += 1;
      totalKraAssignments += result.kraAssignments;
      totalSopAssignments += result.sopAssignments;
    }
  }

  return { usersTouched, totalKraAssignments, totalSopAssignments };
}
