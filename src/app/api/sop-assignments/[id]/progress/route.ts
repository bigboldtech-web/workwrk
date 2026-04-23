import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { triggerRecalculation } from "@/services/performanceScoreService";

// PATCH: Update step completion progress
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const userId = getUserId(session);

  const assignment = await prisma.sOPAssignment.findFirst({
    where: { id, userId, sop: { organizationId: getOrgId(session) } },
    include: { sop: { select: { content: true, sopType: true } } },
  });

  if (!assignment) return jsonError("Assignment not found", 404);
  if (assignment.status === "COMPLETED") return jsonError("Already completed");

  // Reference SOPs (WRITTEN / RECORDED) have no completion state — the
  // UI no longer calls this route for them, but guard the backend too so
  // stale clients or external callers can't push a rich-text guide into
  // a fake-completed state.
  if (assignment.sop.sopType !== "CHECKLIST") {
    return jsonError("Progress is only tracked for checklist SOPs", 400);
  }

  const body = await req.json();
  const { stepIndex, completed, quizScore } = body;

  // Get current progress
  const currentProgress = (assignment.progress as any) || { completedSteps: [] };
  let completedSteps: number[] = currentProgress.completedSteps || [];

  if (stepIndex != null) {
    if (completed) {
      if (!completedSteps.includes(stepIndex)) {
        completedSteps.push(stepIndex);
        completedSteps.sort((a, b) => a - b);
      }
    } else {
      completedSteps = completedSteps.filter((s) => s !== stepIndex);
    }
  }

  const stepsCompleted = completedSteps.length;
  const allDone = stepsCompleted >= assignment.stepsTotal && assignment.stepsTotal > 0;

  // Calculate score: (stepsCompleted / stepsTotal) * 100, adjusted by quiz if present
  let score: number | null = null;
  if (assignment.stepsTotal > 0) {
    const completionPct = (stepsCompleted / assignment.stepsTotal) * 100;
    if (quizScore != null) {
      // 70% completion + 30% quiz
      score = Math.round(completionPct * 0.7 + quizScore * 0.3);
    } else if (currentProgress.quizScore != null) {
      score = Math.round(completionPct * 0.7 + currentProgress.quizScore * 0.3);
    } else {
      score = Math.round(completionPct);
    }
  }

  const newProgress = {
    completedSteps,
    quizScore: quizScore ?? currentProgress.quizScore ?? null,
  };

  const updated = await prisma.sOPAssignment.update({
    where: { id },
    data: {
      progress: newProgress,
      stepsCompleted,
      score,
      status: allDone ? "COMPLETED" : stepsCompleted > 0 ? "IN_PROGRESS" : "ASSIGNED",
      completedAt: allDone ? new Date() : null,
    },
  });

  // If completed, also update/create SOPCompliance record for performance reviews
  if (allDone) {
    await prisma.sOPCompliance.upsert({
      where: {
        id: `${assignment.sopId}_${userId}_current`,
      },
      create: {
        sopId: assignment.sopId,
        userId,
        period: new Date().toISOString().slice(0, 7), // YYYY-MM
        stepsTotal: assignment.stepsTotal,
        stepsCompleted,
        score,
        completedAt: new Date(),
      },
      update: {
        stepsCompleted,
        score,
        completedAt: new Date(),
      },
    });
  }

  // Auto-recalculate performance score
  triggerRecalculation(userId, getOrgId(session));

  return jsonSuccess(updated);
}

// POST: Submit quiz answers
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const userId = getUserId(session);

  const assignment = await prisma.sOPAssignment.findFirst({
    where: { id, userId, sop: { organizationId: getOrgId(session) } },
    include: { sop: { select: { content: true } } },
  });

  if (!assignment) return jsonError("Assignment not found", 404);

  const body = await req.json();
  const { answers } = body; // [{questionIndex, answer}]

  if (!answers || !Array.isArray(answers)) {
    return jsonError("answers array is required");
  }

  // Get quiz from SOP content
  const content = assignment.sop.content as any;
  const quiz = content?.quiz || [];

  if (quiz.length === 0) return jsonError("This SOP has no quiz");

  // Grade quiz
  let correct = 0;
  answers.forEach((a: any) => {
    const question = quiz[a.questionIndex];
    if (question && question.correctAnswer === a.answer) {
      correct++;
    }
  });

  const quizScore = Math.round((correct / quiz.length) * 100);

  // Update progress with quiz score
  const currentProgress = (assignment.progress as any) || { completedSteps: [] };
  const completedSteps = currentProgress.completedSteps || [];
  const stepsCompleted = completedSteps.length;

  let score: number | null = null;
  if (assignment.stepsTotal > 0) {
    const completionPct = (stepsCompleted / assignment.stepsTotal) * 100;
    score = Math.round(completionPct * 0.7 + quizScore * 0.3);
  } else {
    score = quizScore;
  }

  const updated = await prisma.sOPAssignment.update({
    where: { id },
    data: {
      progress: { ...currentProgress, quizScore },
      score,
    },
  });

  return jsonSuccess({
    quizScore,
    correct,
    total: quiz.length,
    overallScore: score,
  });
}
