"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import {
  MessageSquareHeart, Plus, Send, Lock, Eye, BarChart3, X,
  Star, MessageSquare, ArrowRight, CheckCircle2, Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";

interface CandorSession {
  id: string;
  title: string;
  description?: string;
  status: string;
  prompts: any[];
  departmentId?: string;
  responseCount: number;
  isOwner: boolean;
  launchedAt?: string;
  closedAt?: string;
  createdAt: string;
}

interface Prompt {
  id: string;
  text: string;
  type: "text" | "rating" | "start_stop_continue";
}

const RESPONDED_KEY = "workwrk-candor-responded";

function hasResponded(sessionId: string): boolean {
  try {
    const data = JSON.parse(localStorage.getItem(RESPONDED_KEY) || "{}");
    return !!data[sessionId];
  } catch { return false; }
}

function markResponded(sessionId: string) {
  try {
    const data = JSON.parse(localStorage.getItem(RESPONDED_KEY) || "{}");
    data[sessionId] = new Date().toISOString();
    localStorage.setItem(RESPONDED_KEY, JSON.stringify(data));
  } catch {}
}

export default function CandorPage() {
  const { isManager } = useRole();
  const { success: toastSuccess, error: toastError } = useToast();

  const [sessions, setSessions] = useState<CandorSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<any[]>([]);

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createDeptId, setCreateDeptId] = useState("");
  const [createPrompts, setCreatePrompts] = useState<Prompt[]>([
    { id: "p1", text: "What should we START doing?", type: "text" },
    { id: "p2", text: "What should we STOP doing?", type: "text" },
    { id: "p3", text: "What should we CONTINUE doing?", type: "text" },
    { id: "p4", text: "Rate overall team communication (1-5)", type: "rating" },
    { id: "p5", text: "Rate your workload balance (1-5)", type: "rating" },
  ]);
  const [saving, setSaving] = useState(false);

  // Respond dialog
  const [respondSession, setRespondSession] = useState<CandorSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Results
  const [viewResults, setViewResults] = useState<any | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/candor");
      if (res.ok) {
        const data = await res.json();
        setSessions(Array.isArray(data) ? data : data.data || []);
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);
  useEffect(() => {
    fetch("/api/departments").then((r) => r.ok ? r.json() : []).then((d) => setDepartments(Array.isArray(d) ? d : d?.data || [])).catch(() => {});
  }, []);

  async function handleCreate(launchNow: boolean) {
    if (!createTitle.trim()) return;
    const validPrompts = createPrompts.filter((p) => p.text.trim());
    if (validPrompts.length === 0) { toastError("Add at least one prompt"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/candor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle, description: createDesc, prompts: validPrompts,
          departmentId: createDeptId || null, status: launchNow ? "ACTIVE" : "DRAFT",
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        resetCreateForm();
        await fetchSessions();
        toastSuccess(launchNow ? "Session launched — team notified!" : "Draft saved");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to create session");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  function resetCreateForm() {
    setCreateTitle(""); setCreateDesc(""); setCreateDeptId("");
    setCreatePrompts([
      { id: "p1", text: "What should we START doing?", type: "text" },
      { id: "p2", text: "What should we STOP doing?", type: "text" },
      { id: "p3", text: "What should we CONTINUE doing?", type: "text" },
      { id: "p4", text: "Rate overall team communication (1-5)", type: "rating" },
      { id: "p5", text: "Rate your workload balance (1-5)", type: "rating" },
    ]);
  }

  function addPrompt() {
    setCreatePrompts([...createPrompts, { id: `p${Date.now()}`, text: "", type: "text" }]);
  }
  function removePrompt(id: string) {
    setCreatePrompts(createPrompts.filter((p) => p.id !== id));
  }
  function updatePrompt(id: string, field: keyof Prompt, value: string) {
    setCreatePrompts(createPrompts.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  async function handleRespond() {
    if (!respondSession) return;
    const prompts = respondSession.prompts || [];
    const answerList = prompts.map((p: any) => ({ promptId: p.id, value: answers[p.id] || "" }));
    if (answerList.every((a) => !a.value.trim())) { toastError("Please answer at least one prompt"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/candor/${respondSession.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answerList }),
      });
      if (res.ok) {
        markResponded(respondSession.id);
        setRespondSession(null);
        setAnswers({});
        await fetchSessions();
        toastSuccess("Feedback submitted anonymously. Thank you!");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to submit");
      }
    } catch { toastError("Failed to submit"); } finally { setSubmitting(false); }
  }

  async function handleLaunch(id: string) {
    try {
      const res = await fetch("/api/candor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "ACTIVE" }),
      });
      if (res.ok) { await fetchSessions(); toastSuccess("Session launched!"); }
    } catch { toastError("Failed to launch"); }
  }

  async function handleClose(id: string) {
    try {
      const res = await fetch("/api/candor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "CLOSED" }),
      });
      if (res.ok) { await fetchSessions(); toastSuccess("Session closed"); }
    } catch { toastError("Failed to close"); }
  }

  async function openResults(sessionId: string) {
    setLoadingResults(true);
    try {
      const res = await fetch(`/api/candor/${sessionId}/results`);
      if (res.ok) {
        const data = await res.json();
        setViewResults(Array.isArray(data) ? data[0] : data.data || data);
      }
    } catch {} finally { setLoadingResults(false); }
  }

  const activeSessions = sessions.filter((s) => s.status === "ACTIVE");
  const draftSessions = sessions.filter((s) => s.status === "DRAFT");
  const closedSessions = sessions.filter((s) => s.status === "CLOSED");

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Candor" }]}
        kicker="Candor · anonymous feedback"
        title="Candor"
        subtitle="Anonymous team feedback sessions. Honest, safe, actionable."
        actions={
          isManager
            ? [{
                label: "New session",
                onClick: () => { resetCreateForm(); setShowCreate(true); },
                icon: <Plus size={14} />,
              }]
            : undefined
        }
      />

      {/* Active Sessions — respond */}
      {activeSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /> Active Sessions
          </h2>
          {activeSessions.map((s) => {
            const responded = hasResponded(s.id);
            return (
              <Card key={s.id} className={`${responded ? "opacity-60" : "border-green-500/20 bg-green-500/5"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{s.title}</p>
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">Active</Badge>
                        {responded && <Badge variant="outline" className="text-[10px]">Responded</Badge>}
                      </div>
                      {s.description && <p className="text-xs text-muted mt-1">{s.description}</p>}
                      <p className="text-[10px] text-muted mt-2">
                        {s.prompts?.length || 0} questions · {s.responseCount} responses
                        {s.launchedAt && ` · Since ${new Date(s.launchedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!responded && (
                        <Button size="sm" className="gap-1.5 text-xs" onClick={() => { setRespondSession(s); setAnswers({}); }}>
                          <Send size={12} /> Share Feedback
                        </Button>
                      )}
                      {s.isOwner && (
                        <>
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => openResults(s.id)}>
                            <Eye size={12} /> Results
                          </Button>
                          <Button variant="ghost" size="sm" className="text-xs text-muted" onClick={() => handleClose(s.id)}>Close</Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Draft Sessions (manager only) */}
      {isManager && draftSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted">Drafts</h2>
          {draftSessions.map((s) => (
            <Card key={s.id} className="border-dashed">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-[10px] text-muted">{s.prompts?.length || 0} questions · Draft</p>
                </div>
                <Button size="sm" className="gap-1.5 text-xs" onClick={() => handleLaunch(s.id)}>
                  <ArrowRight size={12} /> Launch
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Closed Sessions */}
      {closedSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted">Past Sessions</h2>
          {closedSessions.map((s) => (
            <Card key={s.id} className="opacity-60">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-[10px] text-muted">{s.responseCount} responses · Closed {s.closedAt ? new Date(s.closedAt).toLocaleDateString() : ""}</p>
                </div>
                {s.isOwner && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => openResults(s.id)}>
                    <BarChart3 size={12} /> Results
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && (
        <div className="text-center py-16">
          <MessageSquareHeart size={40} className="mx-auto text-muted mb-3" />
          <p className="text-sm text-muted mb-2">No candor sessions yet</p>
          {isManager ? (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => { resetCreateForm(); setShowCreate(true); }}>
              <Plus size={14} /> Create your first session
            </Button>
          ) : (
            <p className="text-xs text-muted">Your manager will create sessions for your team.</p>
          )}
        </div>
      )}

      {/* ═══ CREATE DIALOG ═══ */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Candor Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted">Responses are 100% anonymous — no names, no user IDs, no tracking.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Session Title *</Label>
                <Input value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder="e.g., Q2 Team Health Check" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Team / Department</Label>
                <Select value={createDeptId} onValueChange={setCreateDeptId}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All org (default)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All organization</SelectItem>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Textarea value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="What this session is about..." rows={2} className="text-sm" />
            </div>

            {/* Prompts */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Prompts / Questions</Label>
                <Button variant="ghost" size="sm" className="text-xs text-[color:var(--accent-strong)] h-6 gap-1" onClick={addPrompt}><Plus size={12} /> Add</Button>
              </div>
              {createPrompts.map((p) => (
                <div key={p.id} className="flex items-center gap-2 bg-surface-2 rounded-lg p-2">
                  <select
                    value={p.type}
                    onChange={(e) => updatePrompt(p.id, "type", e.target.value)}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs w-24 shrink-0"
                  >
                    <option value="text">Text</option>
                    <option value="rating">Rating 1-5</option>
                  </select>
                  <Input
                    value={p.text}
                    onChange={(e) => updatePrompt(p.id, "text", e.target.value)}
                    placeholder="Enter your question..."
                    className="h-8 text-sm flex-1"
                  />
                  <button onClick={() => removePrompt(p.id)} className="text-muted hover:text-red-400 shrink-0"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => handleCreate(false)} disabled={saving || !createTitle.trim()}>
              Save as Draft
            </Button>
            <Button onClick={() => handleCreate(true)} disabled={saving || !createTitle.trim()} className="gap-1.5">
              <Send size={14} /> {saving ? "Launching..." : "Launch Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ RESPOND DIALOG ═══ */}
      <Dialog open={!!respondSession} onOpenChange={(open) => { if (!open) { setRespondSession(null); setAnswers({}); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock size={16} className="text-green-400" /> Anonymous Feedback
            </DialogTitle>
          </DialogHeader>
          {respondSession && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <p className="text-xs text-green-400 font-medium mb-1">🔒 Your identity is never stored</p>
                <p className="text-[10px] text-muted">Responses contain no user ID, no name, no tracking. Your manager only sees aggregated, anonymous results.</p>
              </div>
              <p className="text-sm font-semibold">{respondSession.title}</p>
              {respondSession.description && <p className="text-xs text-muted">{respondSession.description}</p>}

              {(respondSession.prompts || []).map((prompt: any) => (
                <div key={prompt.id} className="space-y-1.5">
                  <Label className="text-xs">{prompt.text}</Label>
                  {prompt.type === "rating" ? (
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setAnswers({ ...answers, [prompt.id]: String(n) })}
                          className={`h-10 w-10 rounded-lg border text-sm font-bold transition-colors ${
                            answers[prompt.id] === String(n)
                              ? "border-[#d4ff2e] bg-[rgba(212,255,46,0.12)] text-[color:var(--accent-strong)]"
                              : "border-border hover:border-muted-2 text-muted"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                      <span className="text-[10px] text-muted ml-1">
                        {answers[prompt.id] === "1" ? "Poor" : answers[prompt.id] === "2" ? "Fair" : answers[prompt.id] === "3" ? "OK" : answers[prompt.id] === "4" ? "Good" : answers[prompt.id] === "5" ? "Excellent" : ""}
                      </span>
                    </div>
                  ) : (
                    <Textarea
                      value={answers[prompt.id] || ""}
                      onChange={(e) => setAnswers({ ...answers, [prompt.id]: e.target.value })}
                      placeholder="Be honest — this is anonymous..."
                      rows={3}
                      className="text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondSession(null)}>Cancel</Button>
            <Button onClick={handleRespond} disabled={submitting} className="gap-1.5">
              <Lock size={14} /> {submitting ? "Submitting..." : "Submit Anonymously"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ RESULTS DIALOG ═══ */}
      <Dialog open={!!viewResults} onOpenChange={(open) => { if (!open) setViewResults(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 size={16} className="text-[color:var(--accent-strong)]" /> Results: {viewResults?.session?.title}
            </DialogTitle>
          </DialogHeader>
          {viewResults && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-4 text-sm">
                <Badge variant="outline">{viewResults.totalResponses} responses</Badge>
                <Badge variant="outline" className={viewResults.session.status === "ACTIVE" ? "bg-green-500/10 text-green-400" : ""}>{viewResults.session.status}</Badge>
              </div>

              {(viewResults.results || []).map((r: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold mb-2">{r.prompt.text}</p>
                    {r.type === "rating" ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <p className="text-3xl font-bold font-mono text-[color:var(--accent-strong)]">{r.average || "—"}</p>
                          <div className="flex-1">
                            <div className="flex items-center gap-1">
                              {(r.distribution || []).map((d: any) => (
                                <div key={d.value} className="flex-1 text-center">
                                  <div
                                    className="mx-auto rounded-sm bg-[rgba(212,255,46,0.18)]"
                                    style={{ height: `${Math.max(4, (d.count / Math.max(r.count, 1)) * 40)}px` }}
                                  />
                                  <p className="text-[10px] text-muted mt-1">{d.value}</p>
                                  <p className="text-[9px] text-muted-2">{d.count}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted">{r.count} rating{r.count !== 1 ? "s" : ""}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(r.responses || []).length === 0 ? (
                          <p className="text-xs text-muted italic">No responses yet</p>
                        ) : (
                          (r.responses || []).map((text: string, j: number) => (
                            <div key={j} className="rounded-lg bg-surface-2 px-3 py-2">
                              <p className="text-sm text-muted">{text}</p>
                            </div>
                          ))
                        )}
                        <p className="text-[10px] text-muted">{r.count} response{r.count !== 1 ? "s" : ""}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
