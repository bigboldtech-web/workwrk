import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import Anthropic from "@anthropic-ai/sdk";
import { getTopPerformers } from "@/services/performanceScoreService";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

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

  // Gather comprehensive org context
  const [
    users,
    taskStats,
    departments,
    recentKPIs,
    sops,
    activeTasks,
    overdueTasks,
    reviewCycles,
    recentMeetings,
    recentActivity,
  ] = await Promise.all([
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
        _count: { select: { assignedTasks: true, directReports: true } },
      },
    }),
    prisma.task.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: true,
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
    prisma.task.findMany({
      where: { organizationId: orgId, status: { in: ["IN_PROGRESS", "NOT_STARTED", "IN_REVIEW"] } },
      select: {
        title: true,
        priority: true,
        status: true,
        deadline: true,
        assignee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { priority: "asc" },
      take: 20,
    }),
    prisma.task.count({
      where: {
        organizationId: orgId,
        status: { in: ["NOT_STARTED", "IN_PROGRESS"] },
        deadline: { lt: new Date() },
      },
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
  ]);

  // Get performance scores for AI context
  const topPerformers = await getTopPerformers(orgId, 10);
  const performanceScores = await prisma.performanceScore.findMany({
    where: { organizationId: orgId, period: new Date().toISOString().slice(0, 7) },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { score: "desc" },
    take: 50,
  });

  // Build context for Claude
  const orgContext = `
ORGANIZATION DATA:
- Total employees: ${users.length}
- Departments: ${departments.map(d => `${d.name} (${d._count.members} members, head: ${d.head ? d.head.firstName + ' ' + d.head.lastName : 'vacant'})`).join('; ')}

PEOPLE:
${users.map(u => `- ${u.firstName} ${u.lastName}: ${u.role?.title || 'No role'}, ${u.department?.name || 'No dept'}, Status: ${u.status}, Level: ${u.accessLevel}, Tasks: ${u._count.assignedTasks}, Reports: ${u._count.directReports}`).join('\n')}

COMPOSITE PERFORMANCE SCORES (current period):
${performanceScores.length > 0 ? performanceScores.map(s => {
  const bd = s.breakdown as Record<string, unknown>;
  return `- ${s.user.firstName} ${s.user.lastName}: Score ${Math.round(s.score)} (KPI: ${bd.kpiScore ?? 'N/A'}, Manager: ${bd.managerRating ?? 'N/A'}, Peer: ${bd.peerRating ?? 'N/A'}, Self: ${bd.selfRating ?? 'N/A'}, SOP: ${bd.sopCompliance ?? 'N/A'}, Tasks: ${bd.taskCompletion ?? 'N/A'})`;
}).join('\n') : 'No performance scores calculated yet. Scores auto-calculate from KPI records, reviews, SOP compliance, and task completion.'}

TASK STATUS:
- Breakdown: ${taskStats.map(s => `${s.status}: ${s._count}`).join(', ')}
- Overdue tasks: ${overdueTasks}
- Active tasks: ${activeTasks.map(t => `"${t.title}" (${t.priority}, ${t.status}, assigned to ${t.assignee?.firstName || 'unassigned'}, deadline: ${t.deadline?.toISOString().split('T')[0] || 'none'})`).join('; ')}

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
    if (!process.env.ANTHROPIC_API_KEY) {
      response = generateFallbackResponse(query, users, taskStats, departments, overdueTasks, recentKPIs, sops);
    } else {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: `You are the AI assistant for TheywrK, a Business Operating System. You help managers and leaders understand their organization's performance, identify issues, and make data-driven decisions.

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
    response = generateFallbackResponse(query, users, taskStats, departments, overdueTasks, recentKPIs, sops);
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
  taskStats: any[],
  departments: any[],
  overdueTasks: number,
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
      return `Based on composite performance scores, here are the top performers:\n\n${unique.map((p, i) => `${i + 1}. **${p.name}** — Score: ${Math.round(p.score)}`).join('\n')}\n\nComposite scores factor in KPI achievement, manager ratings, peer feedback, self-assessment, SOP compliance, and task completion.`;
    }
    return `No performance scores calculated yet. Scores auto-calculate when employees have KPI records, completed reviews, SOP assignments, or task data.`;
  }

  if (q.includes("overdue") || q.includes("late") || q.includes("missed")) {
    return `There are currently **${overdueTasks} overdue tasks** across the organization.\n\nTask breakdown: ${taskStats.map(s => `${s.status.replace(/_/g, ' ')}: ${s._count}`).join(', ')}.`;
  }

  if (q.includes("department") || q.includes("team")) {
    return `**Department Overview:**\n\n${departments.map(d => `- **${d.name}**: ${d._count.members} members${d.head ? `, led by ${d.head.firstName} ${d.head.lastName}` : ' (no head assigned)'}`).join('\n')}\n\nTotal: ${users.length} people across ${departments.length} departments.`;
  }

  if (q.includes("sop") || q.includes("process") || q.includes("compliance")) {
    const published = sops.filter(s => s.status === "PUBLISHED");
    return `**SOP Overview:**\n\n- Total SOPs: ${sops.length}\n- Published: ${published.length}\n- Draft/In Review: ${sops.length - published.length}\n\n${sops.map(s => `- "${s.title}" (${s.category}, ${s.status})`).join('\n')}`;
  }

  if (q.includes("promot") || q.includes("hike") || q.includes("raise")) {
    return `To determine promotion eligibility, I look at:\n\n1. **KPI scores** (must be >85 for 2 consecutive periods)\n2. **Task completion rate**\n3. **SOP compliance**\n4. **Manager ratings**\n\nCurrently there are ${kpiRecords.length} KPI records in the system. Add more performance data to get personalized promotion recommendations.`;
  }

  return `Here's a quick summary of your organization:\n\n- **${users.length}** total people\n- **${departments.length}** departments\n- **${overdueTasks}** overdue tasks\n- **${sops.length}** SOPs\n- Task status: ${taskStats.map(s => `${s.status.replace(/_/g, ' ')}: ${s._count}`).join(', ') || 'No tasks yet'}\n\nTry asking about:\n- "Who are the top performers?"\n- "Show overdue tasks"\n- "Department breakdown"\n- "SOP compliance status"\n- "Who should I promote?"`;
}
