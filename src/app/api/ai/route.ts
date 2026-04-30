import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";

// GET: Load conversation history for persistent context
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const history = await prisma.aIQuery.findMany({
    where: { userId, organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, query: true, response: true, createdAt: true },
  });

  return jsonSuccess({ history: history.reverse() });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const { query, conversationHistory } = body;

  if (!query) return jsonError("Query is required");

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // Plan limit enforcement
  const planCheck = await checkPlanLimit(orgId, "ai");
  if (!planCheck.allowed) return jsonError(planCheck.message, 403);

  // Gather comprehensive org context.
  // User list is capped at 100 — past that the LLM context wastes tokens on a
  // head-sized sample anyway. For total headcount we use a separate count query.
  const [
    totalUserCount,
    users,
    departments,
    recentKPIs,
    sops,
    kraAssignments,
    reviewCycles,
    recentMeetings,
    recentActivity,
    performanceScores,
  ] = await Promise.all([
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
    prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        accessLevel: true,
        department: { select: { name: true } },
        role: { select: { title: true } },
        _count: { select: { directReports: true, kraAssignments: true } },
      },
      take: 100,
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      include: {
        head: { select: { firstName: true, lastName: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.kPIRecord.findMany({
      where: { kpi: { organizationId: orgId } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        kpi: { select: { name: true, unit: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.sOP.findMany({
      where: { organizationId: orgId },
      select: { title: true, category: true, status: true, version: true },
    }),
    prisma.kRAAssignment.findMany({
      where: { kra: { organizationId: orgId }, status: "ACTIVE" },
      include: {
        user: { select: { firstName: true, lastName: true } },
        kra: { select: { name: true } },
      },
      take: 50,
    }),
    prisma.reviewCycle.findMany({
      where: { organizationId: orgId },
      select: {
        name: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        _count: { select: { reviews: true } },
      },
      orderBy: { startDate: "desc" },
      take: 5,
    }),
    prisma.meeting.findMany({
      where: { organizationId: orgId },
      select: {
        title: true,
        type: true,
        scheduledAt: true,
        _count: { select: { attendees: true, actionItems: true } },
      },
      orderBy: { scheduledAt: "desc" },
      take: 10,
    }),
    prisma.activityLog.findMany({
      where: { organizationId: orgId },
      select: { type: true, description: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.performanceScore.findMany({
      where: { organizationId: orgId, period: new Date().toISOString().slice(0, 7) },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { score: "desc" },
      take: 50,
    }),
  ]);

  // Build context for Claude
  const orgContext = `
ORGANIZATION DATA:
- Total employees: ${totalUserCount}
- Departments: ${departments.map(d => `${d.name} (${d._count.members} members, head: ${d.head ? d.head.firstName + ' ' + d.head.lastName : 'vacant'})`).join('; ')}

PEOPLE${totalUserCount > users.length ? ` (showing ${users.length} of ${totalUserCount})` : ""}:
${users.map(u => `- ${u.firstName} ${u.lastName}: ${u.role?.title || 'No role'}, ${u.department?.name || 'No dept'}, Status: ${u.status}, Level: ${u.accessLevel}, KRAs: ${u._count.kraAssignments}, Reports: ${u._count.directReports}`).join('\n')}

COMPOSITE PERFORMANCE SCORES (current period):
${performanceScores.length > 0 ? performanceScores.map(s => {
  const bd = s.breakdown as Record<string, unknown>;
  return `- ${s.user.firstName} ${s.user.lastName}: Score ${Math.round(s.score)} (KPI: ${bd.kpiScore ?? 'N/A'}, Manager: ${bd.managerRating ?? 'N/A'}, Peer: ${bd.peerRating ?? 'N/A'}, Self: ${bd.selfRating ?? 'N/A'}, SOP: ${bd.sopCompliance ?? 'N/A'})`;
}).join('\n') : 'No performance scores calculated yet. Scores auto-calculate from KPI achievement (40%), manager rating (25%), SOP compliance (20%), peer rating (10%), and self rating (5%).'}

KRA ASSIGNMENTS:
${kraAssignments.length > 0 ? kraAssignments.map(a => `- ${a.user.firstName} ${a.user.lastName}: "${a.kra.name}" (weight: ${a.weightage}%)`).join('\n') : 'No KRA assignments yet.'}

KPI RECORDS (Recent):
${recentKPIs.length > 0 ? recentKPIs.map(r => `- ${r.user.firstName} ${r.user.lastName}: ${r.kpi.name} = ${r.actualValue ?? 'pending'}/${r.targetValue} ${r.kpi.unit || ''} (Score: ${r.score ?? 'N/A'})`).join('\n') : 'No KPI records yet.'}

SOPs:
${sops.map(s => `- "${s.title}" (${s.category}, ${s.status}, v${s.version})`).join('\n')}

REVIEW CYCLES:
${reviewCycles.length > 0 ? reviewCycles.map(rc => `- "${rc.name}" (${rc.type}, ${rc.status}, ${rc.startDate.toISOString().split('T')[0]} to ${rc.endDate.toISOString().split('T')[0]}, ${rc._count.reviews} reviews)`).join('\n') : 'No review cycles yet.'}

RECENT MEETINGS:
${recentMeetings.length > 0 ? recentMeetings.map(m => `- "${m.title}" (${m.type}, ${m.scheduledAt.toISOString().split('T')[0]}, ${m._count.attendees} attendees, ${m._count.actionItems} action items)`).join('\n') : 'No meetings yet.'}

RECENT ACTIVITY:
${recentActivity.length > 0 ? recentActivity.map(a => `- [${a.createdAt.toISOString().split('T')[0]}] ${a.description}`).join('\n') : 'No recent activity.'}
`.trim();

  // Build conversation messages for multi-turn context
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  // Add conversation history (last 10 turns max to stay within token limits)
  if (conversationHistory && Array.isArray(conversationHistory)) {
    const recent = conversationHistory.slice(-10);
    for (const msg of recent) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Add current query
  messages.push({ role: "user", content: query });

  let response = "";

  try {
    const ai = await getAnthropicForOrg(orgId);
    if (ai.source === "shared" && !process.env.ANTHROPIC_API_KEY) {
      response = generateFallbackResponse(query, users, departments, recentKPIs, sops);
    } else {
      const message = await ai.client.messages.create({
        model: modelFor(ai, "claude-sonnet-4-20250514"),
        max_tokens: 1500,
        system: `You are the AI assistant for WorkwrK, a Business Operating System. You help managers and leaders understand their organization's performance, identify issues, and make data-driven decisions.

You have access to real-time organization data provided below. Answer questions directly with specific data points, names, and numbers. Be concise but thorough. Use markdown formatting — bullet points for lists, **bold** for emphasis, and headers when appropriate. If you identify concerning patterns, flag them proactively.

When asked about trends or comparisons, present data clearly. When asked for recommendations, be specific and actionable.

Today's date: ${new Date().toISOString().split('T')[0]}

${orgContext}`,
        messages,
      });

      const textBlock = message.content.find((b: any) => b.type === "text");
      response = textBlock ? (textBlock as any).text : "I couldn't generate a response.";
    }
  } catch (err: any) {
    console.error("AI error:", err);
    response = generateFallbackResponse(query, users, departments, recentKPIs, sops);
  }

  // Save the query
  await prisma.aIQuery.create({
    data: {
      query,
      response,
      userId,
      organizationId: orgId,
    },
  });

  return jsonSuccess({ query, response });
}

function generateFallbackResponse(
  query: string,
  users: any[],
  departments: any[],
  kpiRecords: any[],
  sops: any[],
): string {
  const q = query.toLowerCase();

  if (q.includes("performer") || q.includes("performing") || q.includes("top") || q.includes("score")) {
    if (kpiRecords.length > 0) {
      const sorted = [...kpiRecords].filter(r => r.score != null).sort((a, b) => (b.score || 0) - (a.score || 0));
      const unique = sorted.reduce((acc: any[], r) => {
        const name = `${r.user.firstName} ${r.user.lastName}`;
        if (!acc.find(x => x.name === name)) acc.push({ name, score: r.score });
        return acc;
      }, []).slice(0, 5);
      return `Based on KPI scores, here are the top performers:\n\n${unique.map((p, i) => `${i + 1}. **${p.name}** — Score: ${Math.round(p.score)}`).join('\n')}\n\nComposite scores factor in KPI achievement (40%), manager ratings (25%), SOP compliance (20%), peer feedback (10%), and self-assessment (5%).`;
    }
    return `No performance scores calculated yet. Assign KRAs with KPIs and start recording scores to see performance data.`;
  }

  if (q.includes("department") || q.includes("team")) {
    return `**Department Overview:**\n\n${departments.map(d => `- **${d.name}**: ${d._count.members} members${d.head ? `, led by ${d.head.firstName} ${d.head.lastName}` : ' (no head assigned)'}`).join('\n')}\n\nTotal: ${users.length} people across ${departments.length} departments.`;
  }

  if (q.includes("sop") || q.includes("process") || q.includes("compliance")) {
    const published = sops.filter(s => s.status === "PUBLISHED");
    return `**SOP Overview:**\n\n- Total SOPs: ${sops.length}\n- Published: ${published.length}\n- Draft/In Review: ${sops.length - published.length}\n\n${sops.map(s => `- "${s.title}" (${s.category}, ${s.status})`).join('\n')}`;
  }

  if (q.includes("promot") || q.includes("hike") || q.includes("raise")) {
    return `To determine promotion eligibility, I look at:\n\n1. **KPI achievement** (must be >85 for 2 consecutive periods)\n2. **SOP compliance**\n3. **Manager ratings**\n4. **Peer feedback**\n\nCurrently there are ${kpiRecords.length} KPI records in the system. Add more performance data to get personalized promotion recommendations.`;
  }

  return `Here's a quick summary of your organization:\n\n- **${users.length}** total people\n- **${departments.length}** departments\n- **${sops.length}** SOPs\n- **${kpiRecords.length}** KPI records\n\nTry asking about:\n- "Who are the top performers?"\n- "Department breakdown"\n- "SOP compliance status"\n- "Who should I promote?"`;
}
