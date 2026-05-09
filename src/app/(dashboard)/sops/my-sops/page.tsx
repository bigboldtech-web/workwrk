"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  BookOpen, CheckCircle, AlertTriangle, FileText, ChevronRight,
  CheckSquare, Square, Award, PenLine, Video, ListChecks,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { RichEditor } from "@/components/ui/rich-editor";

interface SOPStep {
  id?: string;
  title?: string;
  description?: string;
  /** Inline image attached by the author (URL or data URI). */
  image?: string;
  // Recorded-SOP shape — different field names, kept here for a unified renderer
  action?: string;
  url?: string;
  screenshot?: string | null;
  order?: number;
}

type SopKind = "richtext" | "steps" | "recorded" | "checklist";

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
    sopType: "WRITTEN" | "RECORDED" | "CHECKLIST";
    content: {
      type?: "richtext" | "process_flow" | "recorded";
      html?: string;
      steps?: SOPStep[];
      sections?: any[];
      quiz?: any[];
    };
    version: number;
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Reduce the two-axis discriminator (sopType + content.type) down to a
// single "kind" the renderer can switch on. Step-by-step guides live as
// sopType=WRITTEN with a content.steps array, which is why we can't just
// key off sopType alone.
function getSopKind(sop: Assignment["sop"]): SopKind {
  if (sop.sopType === "CHECKLIST") return "checklist";
  if (sop.sopType === "RECORDED" || sop.content?.type === "recorded") return "recorded";
  if (sop.content?.type === "richtext") return "richtext";
  return "steps";
}

function KindBadge({ kind }: { kind: SopKind }) {
  const config: Record<SopKind, { icon: typeof PenLine; label: string }> = {
    richtext: { icon: PenLine, label: "Guide" },
    steps: { icon: FileText, label: "Step-by-step" },
    recorded: { icon: Video, label: "Recording" },
    checklist: { icon: ListChecks, label: "Checklist" },
  };
  const { icon: Icon, label } = config[kind];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted px-1.5 py-0.5 rounded border border-border bg-surface-3">
      <Icon size={10} />
      {label}
    </span>
  );
}

// Approximate how many minutes of reading a SOP guide represents. Used
// on reference SOPs so employees know what they're in for without us
// pretending there's a "completion percentage".
function estimateReadMinutes(sop: Assignment["sop"], kind: SopKind): number | null {
  if (kind === "richtext") {
    const text = (sop.content?.html || "").replace(/<[^>]+>/g, " ").trim();
    const words = text ? text.split(/\s+/).length : 0;
    if (words === 0) return null;
    return Math.max(1, Math.round(words / 220));
  }
  if (kind === "steps" || kind === "recorded") {
    const n = sop.content?.steps?.length || 0;
    if (n === 0) return null;
    return Math.max(1, Math.round(n * 0.5));
  }
  return null;
}

export default function MySOPsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [updating, setUpdating] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizResult, setQuizResult] = useState<any>(null);

  // Ephemeral "I've done this step today" marks for reference SOPs. Keyed
  // by "{assignmentId}:{stepIndex}" so multiple guides open in one session
  // don't collide. Intentionally NOT persisted — these guides are daily
  // reference material, so marks reset on refresh/reopen.
  const [localStepMarks, setLocalStepMarks] = useState<Record<string, boolean>>({});

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

  // Split assignments into two groups:
  //   - references (WRITTEN / RECORDED): daily guides, no completion state
  //   - runnable (CHECKLIST): real work with pending/completed buckets
  const { references, checklistPending, checklistCompleted, overdue } = useMemo(() => {
    const references: Assignment[] = [];
    const checklistPending: Assignment[] = [];
    const checklistCompleted: Assignment[] = [];
    const now = new Date();
    for (const a of assignments) {
      const kind = getSopKind(a.sop);
      if (kind === "checklist") {
        if (a.status === "COMPLETED") checklistCompleted.push(a);
        else checklistPending.push(a);
      } else {
        references.push(a);
      }
    }
    const overdue = checklistPending.filter(
      (a) => a.dueDate && new Date(a.dueDate) < now
    );
    return { references, checklistPending, checklistCompleted, overdue };
  }, [assignments]);

  if (loading) {
    return (
      <div className="space-y-3 animate-fade-in">
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

  const activeKind = activeAssignment ? getSopKind(activeAssignment.sop) : null;

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        kicker="SOPs · personal queue"
        title="My SOPs"
        subtitle={`${references.length} reference · ${checklistPending.length} to run · ${checklistCompleted.length} completed`}
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{references.length}</p>
          <p className="text-xs text-muted">Reference Guides</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{checklistPending.length}</p>
          <p className="text-xs text-muted">Checklists To Run</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{checklistCompleted.length}</p>
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
              <p className="text-sm font-medium text-red-400">You have {overdue.length} overdue checklist{overdue.length > 1 ? "s" : ""}</p>
              <p className="text-xs text-muted">Please complete them as soon as possible.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reference Library (WRITTEN + RECORDED) — always-on, no completion */}
      {references.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Reference Library</h2>
            <p className="text-[11px] text-muted-2 mt-0.5">
              Guides and recordings to read and reference — no completion required.
            </p>
          </div>
          {references.map((a) => {
            const kind = getSopKind(a.sop);
            const minutes = estimateReadMinutes(a.sop, kind);
            return (
              <Card key={a.id} className="hover:border-muted-2 transition-all cursor-pointer" onClick={() => setActiveAssignment(a)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="rounded-lg bg-[rgba(212,255,46,0.08)] p-2.5 shrink-0">
                    {kind === "richtext" && <PenLine size={18} className="text-[color:var(--accent-strong)]" />}
                    {kind === "steps" && <FileText size={18} className="text-[color:var(--accent-strong)]" />}
                    {kind === "recorded" && <Video size={18} className="text-[color:var(--accent-strong)]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm truncate">{a.sop.title}</h3>
                      <KindBadge kind={kind} />
                      {a.mandatory && <Badge variant="outline" className="text-[10px] shrink-0">Required</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      {a.sop.category && <span>{a.sop.category}</span>}
                      {minutes != null && <span>{minutes} min read</span>}
                      <span>v{a.sop.version}</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Checklists — pending bucket */}
      {checklistPending.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Checklists To Run</h2>
            <p className="text-[11px] text-muted-2 mt-0.5">
              One-off process executions — complete each step to finish.
            </p>
          </div>
          {checklistPending.map((a) => {
            const pct = a.stepsTotal > 0 ? Math.round((a.stepsCompleted / a.stepsTotal) * 100) : 0;
            const isOverdue = a.dueDate && new Date(a.dueDate) < new Date();
            return (
              <Card key={a.id} className="hover:border-muted-2 transition-all cursor-pointer" onClick={() => setActiveAssignment(a)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="rounded-lg bg-[rgba(212,255,46,0.08)] p-2.5 shrink-0">
                    <ListChecks size={18} className="text-[color:var(--accent-strong)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm truncate">{a.sop.title}</h3>
                      <KindBadge kind="checklist" />
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

      {/* Completed checklists */}
      {checklistCompleted.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Completed</h2>
          {checklistCompleted.map((a) => (
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

      {/* SOP Viewer Dialog — renders a different body per kind */}
      <Dialog open={!!activeAssignment} onOpenChange={(open) => { if (!open) { setActiveAssignment(null); setQuizOpen(false); setQuizResult(null); setQuizAnswers({}); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {activeAssignment && activeKind && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {activeKind === "richtext" && <PenLine size={18} className="text-[color:var(--accent-strong)]" />}
                  {activeKind === "steps" && <FileText size={18} className="text-[color:var(--accent-strong)]" />}
                  {activeKind === "recorded" && <Video size={18} className="text-[color:var(--accent-strong)]" />}
                  {activeKind === "checklist" && <ListChecks size={18} className="text-[color:var(--accent-strong)]" />}
                  <span className="flex-1">{activeAssignment.sop.title}</span>
                  <KindBadge kind={activeKind} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* Rich-text guide */}
                {activeKind === "richtext" && (
                  <div className="rounded-lg border border-border bg-surface">
                    {activeAssignment.sop.content?.html ? (
                      <RichEditor
                        key={activeAssignment.id}
                        content={activeAssignment.sop.content.html}
                        onChange={() => {}}
                        editable={false}
                        minHeight="120px"
                      />
                    ) : (
                      <div className="p-8 text-center text-sm text-muted">
                        This guide has no content yet. Ask the author to add some.
                      </div>
                    )}
                  </div>
                )}

                {/* Step-by-step reference — checkable, but marks don't persist */}
                {activeKind === "steps" && (
                  <StepByStepReader
                    assignmentId={activeAssignment.id}
                    steps={activeAssignment.sop.content?.steps || []}
                    marks={localStepMarks}
                    onToggle={(key, next) =>
                      setLocalStepMarks((m) => ({ ...m, [key]: next }))
                    }
                  />
                )}

                {/* Recorded workflow — screenshots + descriptions */}
                {activeKind === "recorded" && (
                  <RecordedReader steps={(activeAssignment.sop.content?.steps || []) as SOPStep[]} />
                )}

                {/* Checklist (the only kind that persists completion) */}
                {activeKind === "checklist" && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted">
                          {activeAssignment.stepsCompleted}/{activeAssignment.stepsTotal} steps completed
                        </span>
                        <span className="font-mono font-bold">
                          {activeAssignment.stepsTotal > 0
                            ? Math.round((activeAssignment.stepsCompleted / activeAssignment.stepsTotal) * 100)
                            : 0}%
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

                    <ChecklistSteps
                      assignment={activeAssignment}
                      updating={updating}
                      onToggle={(idx, next) => handleToggleStep(activeAssignment, idx, next)}
                    />
                  </>
                )}

                {/* Quiz — still available for any kind that defines one */}
                {activeAssignment.sop.content?.quiz && activeAssignment.sop.content.quiz.length > 0 && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Award size={14} className="text-[color:var(--accent-strong)]" /> Knowledge Quiz
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
                                    className="text-[color:var(--accent-strong)]"
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

// Render a step description that may be plain text (legacy) or rich
// HTML (new format). Sniffs for tags so we don't need to migrate old
// descriptions before the new editor ships.
function StepDescription({ html }: { html?: string }) {
  if (!html) return null;
  const looksLikeHtml = /<[a-z][^>]*>/i.test(html);
  if (looksLikeHtml) {
    return (
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-xs text-muted mt-0.5 [&_p]:my-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <p className="text-xs text-muted mt-0.5 whitespace-pre-wrap">{html}</p>;
}

function StepByStepReader({
  assignmentId,
  steps,
  marks,
  onToggle,
}: {
  assignmentId: string;
  steps: SOPStep[];
  marks: Record<string, boolean>;
  onToggle: (key: string, next: boolean) => void;
}) {
  if (steps.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-3 p-8 text-center">
        <FileText size={32} className="mx-auto text-muted mb-2" />
        <p className="text-sm text-muted">This step-by-step guide has no steps yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-2 italic">
        Tip: you can tick steps as you work through your day — they won&apos;t save,
        so tomorrow&apos;s run starts fresh.
      </p>
      {steps.map((step, index) => {
        const key = `${assignmentId}:${index}`;
        const isChecked = !!marks[key];
        return (
          <div
            key={step.id || index}
            className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
              isChecked
                ? "border-[rgba(212,255,46,0.25)] bg-[rgba(212,255,46,0.04)]"
                : "border-border bg-surface-3 hover:border-muted-2"
            }`}
          >
            <button
              onClick={() => onToggle(key, !isChecked)}
              className="mt-0.5 shrink-0"
              aria-label={isChecked ? "Unmark step" : "Mark step"}
            >
              {isChecked ? (
                <CheckSquare size={18} className="text-[color:var(--accent-strong)]" />
              ) : (
                <Square size={18} className="text-muted hover:text-[#e2ff6b]" />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${isChecked ? "line-through text-muted" : ""}`}>
                {index + 1}. {step.title || <span className="italic text-muted">Untitled step</span>}
              </p>
              <StepDescription html={step.description} />
              {step.image && (
                <img
                  src={step.image}
                  alt=""
                  loading="lazy"
                  className="mt-2 rounded-md border border-border max-h-64"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecordedReader({ steps }: { steps: SOPStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-3 p-8 text-center">
        <Video size={32} className="mx-auto text-muted mb-2" />
        <p className="text-sm text-muted">This recording has no steps yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div key={index} className="rounded-lg border border-border bg-surface-3 overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[rgba(212,255,46,0.08)] text-[color:var(--accent-strong)] text-sm font-bold shrink-0">
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{step.description || `Step ${index + 1}`}</p>
              {step.url && <p className="text-xs text-muted-2 mt-0.5 truncate">{step.url}</p>}
            </div>
          </div>
          {step.screenshot && (
            <div className="px-4 pb-4">
              <img
                src={step.screenshot}
                alt={`Step ${index + 1}`}
                loading="lazy"
                decoding="async"
                className="w-full rounded-lg border border-border"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ChecklistSteps({
  assignment,
  updating,
  onToggle,
}: {
  assignment: Assignment;
  updating: boolean;
  onToggle: (stepIndex: number, next: boolean) => void;
}) {
  // A CHECKLIST stores content under `content.sections` (each with steps).
  // For the simple per-assignment progress model we flatten them so the
  // stepIndex stored in `progress.completedSteps` is linear.
  const flat = useMemo(() => {
    const out: { sectionTitle: string; title: string; description?: string }[] = [];
    const sections: any[] = assignment.sop.content?.sections || [];
    for (const section of sections) {
      for (const step of section.steps || []) {
        out.push({
          sectionTitle: section.title,
          title: step.title,
          description: step.description,
        });
      }
    }
    // Legacy fallback: if someone stored a CHECKLIST with content.steps
    // directly (older records), honor it.
    if (out.length === 0 && Array.isArray(assignment.sop.content?.steps)) {
      for (const step of assignment.sop.content.steps as any[]) {
        out.push({ sectionTitle: "", title: step.title, description: step.description });
      }
    }
    return out;
  }, [assignment.sop.content]);

  if (flat.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-3 p-8 text-center">
        <ListChecks size={32} className="mx-auto text-muted mb-2" />
        <p className="text-sm text-muted">This checklist has no steps yet.</p>
      </div>
    );
  }

  const completedSteps = assignment.progress?.completedSteps || [];
  const isFrozen = assignment.status === "COMPLETED" || updating;

  let lastSection = "";
  return (
    <div className="space-y-2">
      {flat.map((step, index) => {
        const showSection = step.sectionTitle && step.sectionTitle !== lastSection;
        lastSection = step.sectionTitle || lastSection;
        const isComplete = completedSteps.includes(index);
        return (
          <div key={index}>
            {showSection && (
              <p className="text-[10px] uppercase tracking-wider text-muted font-semibold pt-2 pb-1">
                {step.sectionTitle}
              </p>
            )}
            <div
              className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                isComplete
                  ? "border-green-500/20 bg-green-500/5"
                  : "border-border bg-surface-3 hover:border-muted-2"
              }`}
            >
              <button
                disabled={isFrozen}
                onClick={() => onToggle(index, !isComplete)}
                className="mt-0.5 shrink-0"
                aria-label={isComplete ? "Mark step incomplete" : "Mark step complete"}
              >
                {isComplete ? (
                  <CheckSquare size={18} className="text-green-400" />
                ) : (
                  <Square size={18} className="text-muted hover:text-[#e2ff6b]" />
                )}
              </button>
              <div className="flex-1">
                <p className={`text-sm font-medium ${isComplete ? "line-through text-muted" : ""}`}>
                  {index + 1}. {step.title}
                </p>
                <StepDescription html={step.description} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
