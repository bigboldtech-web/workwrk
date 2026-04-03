"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  BookOpen, CheckCircle, Clock, AlertTriangle, FileText, ChevronRight,
  CheckSquare, Square, Award,
} from "lucide-react";

interface SOPStep {
  id: string;
  title: string;
  description?: string;
}

interface Assignment {
  id: string;
  sopId: string;
  status: string;
  mandatory: boolean;
  dueDate: string | null;
  stepsTotal: number;
  stepsCompleted: number;
  score: number | null;
  completedAt: string | null;
  progress: { completedSteps: number[]; quizScore?: number | null } | null;
  sop: {
    id: string;
    title: string;
    category: string | null;
    status: string;
    content: { steps: SOPStep[]; quiz?: any[] };
    version: number;
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function MySOPsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [updating, setUpdating] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizResult, setQuizResult] = useState<any>(null);

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch("/api/sop-assignments");
      if (res.ok) {
        const data = await res.json();
        setAssignments(data);
      }
    } catch (err) {
      console.error("Error fetching assignments:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const handleToggleStep = async (assignment: Assignment, stepIndex: number, completed: boolean) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/sop-assignments/${assignment.id}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex, completed }),
      });
      if (res.ok) {
        const updated = await res.json();
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignment.id ? { ...a, ...updated, sop: a.sop } : a))
        );
        if (activeAssignment?.id === assignment.id) {
          setActiveAssignment({ ...activeAssignment, ...updated, sop: activeAssignment.sop });
        }
      }
    } catch (err) {
      console.error("Error updating step:", err);
    } finally {
      setUpdating(false);
    }
  };

  const handleSubmitQuiz = async () => {
    if (!activeAssignment) return;
    const quiz = activeAssignment.sop.content?.quiz || [];
    const answers = Object.entries(quizAnswers).map(([idx, answer]) => ({
      questionIndex: parseInt(idx),
      answer,
    }));

    try {
      const res = await fetch(`/api/sop-assignments/${activeAssignment.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (res.ok) {
        const result = await res.json();
        setQuizResult(result);
        fetchAssignments();
      }
    } catch (err) {
      console.error("Error submitting quiz:", err);
    }
  };

  const pending = assignments.filter((a) => a.status !== "COMPLETED");
  const completed = assignments.filter((a) => a.status === "COMPLETED");
  const overdue = assignments.filter(
    (a) => a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date()
  );
  const avgScore = completed.length > 0
    ? Math.round(completed.filter((a) => a.score != null).reduce((sum, a) => sum + (a.score || 0), 0) / completed.filter((a) => a.score != null).length)
    : 0;

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 bg-surface-2 rounded animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><div className="h-12 bg-surface-2 rounded animate-pulse" /></CardContent></Card>
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface-2 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My SOPs</h1>
        <p className="text-muted text-sm mt-1">
          {assignments.length} assigned &middot; {pending.length} pending &middot; {completed.length} completed
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{assignments.length}</p>
          <p className="text-xs text-muted">Total Assigned</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{pending.length}</p>
          <p className="text-xs text-muted">Pending</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{completed.length}</p>
          <p className="text-xs text-muted">Completed</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className={`text-2xl font-bold ${overdue.length > 0 ? "text-red-400" : "text-muted"}`}>{overdue.length}</p>
          <p className="text-xs text-muted">Overdue</p>
        </CardContent></Card>
      </div>

      {/* Overdue Alert */}
      {overdue.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">You have {overdue.length} overdue SOP{overdue.length > 1 ? "s" : ""}</p>
              <p className="text-xs text-muted">Please complete them as soon as possible.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending SOPs */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Pending</h2>
          {pending.map((a) => {
            const pct = a.stepsTotal > 0 ? Math.round((a.stepsCompleted / a.stepsTotal) * 100) : 0;
            const isOverdue = a.dueDate && new Date(a.dueDate) < new Date();
            return (
              <Card key={a.id} className="hover:border-muted-2 transition-all cursor-pointer" onClick={() => setActiveAssignment(a)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="rounded-lg bg-purple-500/10 p-2.5 shrink-0">
                    <FileText size={18} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm truncate">{a.sop.title}</h3>
                      {a.mandatory && <Badge variant="outline" className="text-[10px] shrink-0">Required</Badge>}
                      {isOverdue && <Badge variant="destructive" className="text-[10px] shrink-0">Overdue</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      {a.sop.category && <span>{a.sop.category}</span>}
                      <span>{a.stepsCompleted}/{a.stepsTotal} steps</span>
                      {a.dueDate && (
                        <span className={isOverdue ? "text-red-400" : ""}>Due {formatDate(a.dueDate)}</span>
                      )}
                    </div>
                    <Progress value={pct} className="h-1.5 mt-2" />
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold font-mono">{pct}%</p>
                  </div>
                  <ChevronRight size={16} className="text-muted shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Completed SOPs */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Completed</h2>
          {completed.map((a) => (
            <Card key={a.id} className="opacity-70 hover:opacity-100 transition-all cursor-pointer" onClick={() => setActiveAssignment(a)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="rounded-lg bg-green-500/10 p-2.5 shrink-0">
                  <CheckCircle size={18} className="text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm truncate">{a.sop.title}</h3>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    {a.sop.category && <span>{a.sop.category}</span>}
                    <span>Completed {formatDate(a.completedAt)}</span>
                    {a.score != null && <span>Score: {a.score}%</span>}
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {assignments.length === 0 && (
        <div className="text-center py-20">
          <BookOpen size={48} className="mx-auto text-muted mb-3" />
          <p className="text-muted">No SOPs assigned to you yet.</p>
        </div>
      )}

      {/* Step-by-Step Checklist Dialog */}
      <Dialog open={!!activeAssignment} onOpenChange={(open) => { if (!open) { setActiveAssignment(null); setQuizOpen(false); setQuizResult(null); setQuizAnswers({}); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {activeAssignment && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText size={18} className="text-purple-400" />
                  {activeAssignment.sop.title}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">
                      {activeAssignment.stepsCompleted}/{activeAssignment.stepsTotal} steps completed
                    </span>
                    <span className="font-mono font-bold">
                      {activeAssignment.stepsTotal > 0 ? Math.round((activeAssignment.stepsCompleted / activeAssignment.stepsTotal) * 100) : 0}%
                    </span>
                  </div>
                  <Progress
                    value={activeAssignment.stepsTotal > 0 ? (activeAssignment.stepsCompleted / activeAssignment.stepsTotal) * 100 : 0}
                    className="h-2"
                  />
                </div>

                {activeAssignment.status === "COMPLETED" && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <CheckCircle size={16} className="text-green-400" />
                    <span className="text-sm text-green-400">
                      Completed {formatDate(activeAssignment.completedAt)}
                      {activeAssignment.score != null && ` — Score: ${activeAssignment.score}%`}
                    </span>
                  </div>
                )}

                {/* Steps checklist */}
                <div className="space-y-2">
                  {(activeAssignment.sop.content?.steps || []).map((step: SOPStep, index: number) => {
                    const completedSteps = activeAssignment.progress?.completedSteps || [];
                    const isComplete = completedSteps.includes(index);
                    const isDisabled = activeAssignment.status === "COMPLETED" || updating;

                    return (
                      <div
                        key={step.id || index}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                          isComplete
                            ? "border-green-500/20 bg-green-500/5"
                            : "border-border bg-surface-3 hover:border-muted-2"
                        }`}
                      >
                        <button
                          disabled={isDisabled}
                          onClick={() => handleToggleStep(activeAssignment, index, !isComplete)}
                          className="mt-0.5 shrink-0"
                        >
                          {isComplete ? (
                            <CheckSquare size={18} className="text-green-400" />
                          ) : (
                            <Square size={18} className="text-muted hover:text-purple-400" />
                          )}
                        </button>
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${isComplete ? "line-through text-muted" : ""}`}>
                            {index + 1}. {step.title}
                          </p>
                          {step.description && (
                            <p className="text-xs text-muted mt-0.5">{step.description}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Quiz section */}
                {activeAssignment.sop.content?.quiz && activeAssignment.sop.content.quiz.length > 0 && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Award size={14} className="text-purple-400" /> Knowledge Quiz
                      </h3>
                      {activeAssignment.progress?.quizScore != null && (
                        <Badge variant={activeAssignment.progress.quizScore >= 70 ? "success" : "destructive"}>
                          Score: {activeAssignment.progress.quizScore}%
                        </Badge>
                      )}
                    </div>

                    {!quizOpen && !quizResult && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setQuizOpen(true)}
                        disabled={activeAssignment.progress?.quizScore != null}
                      >
                        {activeAssignment.progress?.quizScore != null ? "Quiz Completed" : "Take Quiz"}
                      </Button>
                    )}

                    {quizOpen && !quizResult && (
                      <div className="space-y-4">
                        {activeAssignment.sop.content.quiz.map((q: any, qi: number) => (
                          <div key={qi} className="p-3 rounded-lg border border-border bg-surface-3">
                            <p className="text-sm font-medium mb-2">{qi + 1}. {q.question}</p>
                            <div className="space-y-1.5">
                              {(q.options || []).map((opt: string, oi: number) => (
                                <label key={oi} className="flex items-center gap-2 p-2 rounded hover:bg-surface-2 cursor-pointer text-sm">
                                  <input
                                    type="radio"
                                    name={`q-${qi}`}
                                    value={opt}
                                    checked={quizAnswers[qi] === opt}
                                    onChange={() => setQuizAnswers({ ...quizAnswers, [qi]: opt })}
                                    className="text-purple-500"
                                  />
                                  {opt}
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Button onClick={handleSubmitQuiz} disabled={Object.keys(quizAnswers).length < activeAssignment.sop.content.quiz.length}>
                          Submit Quiz
                        </Button>
                      </div>
                    )}

                    {quizResult && (
                      <div className={`p-4 rounded-lg ${quizResult.quizScore >= 70 ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                        <p className="text-sm font-semibold">
                          {quizResult.quizScore >= 70 ? "Passed!" : "Not passed"} — {quizResult.correct}/{quizResult.total} correct ({quizResult.quizScore}%)
                        </p>
                        <p className="text-xs text-muted mt-1">Overall score: {quizResult.overallScore}%</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
