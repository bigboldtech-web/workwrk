"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck, Plus, CheckCircle2, Send, BarChart3, Trash2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";

interface SurveyQuestion { id: string; text: string; type: "rating" | "nps" | "text" }

export default function SurveysPage() {
  const { isManager } = useRole();
  const [surveys, setSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [respondingSurvey, setRespondingSurvey] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    questions: [{ id: "q1", text: "", type: "rating" as const }],
  });
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetch("/api/pulse-surveys")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setSurveys(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!form.title.trim() || form.questions.every((q) => !q.text.trim())) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pulse-surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          questions: form.questions.filter((q) => q.text.trim()),
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ title: "", questions: [{ id: "q1", text: "", type: "rating" }] });
        const d = await fetch("/api/pulse-surveys").then((r) => r.json());
        if (d?.data) setSurveys(d.data);
        toastSuccess("Survey published");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  async function handleRespond() {
    if (!respondingSurvey) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pulse-surveys/${respondingSurvey.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })) }),
      });
      if (res.ok) {
        setRespondingSurvey(null);
        setAnswers({});
        const d = await fetch("/api/pulse-surveys").then((r) => r.json());
        if (d?.data) setSurveys(d.data);
        toastSuccess("Response submitted");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  const pending = surveys.filter((s) => s.status === "ACTIVE" && !s.hasResponded).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pulse Surveys</h1>
          <p className="text-muted text-sm mt-1">{surveys.length} surveys {pending > 0 && <span className="text-amber-400">&middot; {pending} pending</span>}</p>
        </div>
        {isManager && (
          <Button onClick={() => setShowCreate(true)} className="gap-1.5"><Plus size={14} /> New Survey</Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-16 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}</div>
      ) : surveys.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <ClipboardCheck size={40} className="mx-auto text-muted mb-3" />
          <p className="font-medium mb-1">No surveys yet</p>
          <p className="text-sm text-muted">Create pulse surveys to measure team engagement.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {surveys.map((survey) => {
            const questions = (survey.questions || []) as SurveyQuestion[];
            return (
              <Card key={survey.id} className={!survey.hasResponded && survey.status === "ACTIVE" ? "border-amber-500/20" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <ClipboardCheck size={18} className="text-purple-400 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold">{survey.title}</h3>
                        <Badge variant={survey.status === "ACTIVE" ? "success" : "secondary"} className="text-[10px]">{survey.status}</Badge>
                        {survey.hasResponded && <Badge variant="outline" className="text-[10px] text-green-400">Responded</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted">
                        <span>{questions.length} questions</span>
                        <span>{survey.totalResponses}/{survey.totalUsers} responded ({survey.responseRate}%)</span>
                      </div>
                      {isManager && <Progress value={survey.responseRate} className="h-1 mt-2 max-w-[200px]" />}
                    </div>
                    {survey.status === "ACTIVE" && !survey.hasResponded && (
                      <Button size="sm" className="gap-1.5" onClick={() => { setRespondingSurvey(survey); setAnswers({}); }}>
                        <Send size={14} /> Respond
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Survey Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Pulse Survey</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title <span className="text-red-400">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., Weekly Engagement Check" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Questions</Label>
                <Button variant="ghost" size="sm" className="text-xs text-purple-400 h-6" onClick={() => setForm({ ...form, questions: [...form.questions, { id: `q${form.questions.length + 1}`, text: "", type: "rating" }] })}>
                  <Plus size={12} className="mr-1" /> Add
                </Button>
              </div>
              {form.questions.map((q, i) => (
                <div key={q.id} className="flex items-center gap-2">
                  <Input value={q.text} onChange={(e) => { const qs = [...form.questions]; qs[i] = { ...qs[i], text: e.target.value }; setForm({ ...form, questions: qs }); }} placeholder={`Question ${i + 1}`} className="flex-1 text-sm" />
                  <Select value={q.type} onValueChange={(v) => { const qs = [...form.questions]; qs[i] = { ...qs[i], type: v as any }; setForm({ ...form, questions: qs }); }}>
                    <SelectTrigger className="w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rating">Rating (1-5)</SelectItem>
                      <SelectItem value="nps">NPS (0-10)</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.questions.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => setForm({ ...form, questions: form.questions.filter((_, j) => j !== i) })}>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title.trim()}>
              {saving ? "Publishing..." : "Publish Survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Respond Dialog */}
      <Dialog open={!!respondingSurvey} onOpenChange={(open) => { if (!open) setRespondingSurvey(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{respondingSurvey?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            {((respondingSurvey?.questions || []) as SurveyQuestion[]).map((q) => (
              <div key={q.id} className="space-y-2">
                <Label className="text-sm">{q.text}</Label>
                {q.type === "rating" ? (
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => setAnswers({ ...answers, [q.id]: n })}
                        className={`h-10 w-10 rounded-lg border text-sm font-bold transition-colors ${answers[q.id] === n ? "bg-purple-500 text-white border-purple-500" : "border-border hover:border-purple-400"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                ) : q.type === "nps" ? (
                  <div className="flex gap-1">
                    {Array.from({ length: 11 }, (_, n) => (
                      <button key={n} onClick={() => setAnswers({ ...answers, [q.id]: n })}
                        className={`h-8 w-8 rounded text-xs font-bold transition-colors ${answers[q.id] === n ? "bg-purple-500 text-white" : "border border-border hover:border-purple-400"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                ) : (
                  <Textarea value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Your response..." rows={2} />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondingSurvey(null)}>Cancel</Button>
            <Button onClick={handleRespond} disabled={saving}>
              {saving ? "Submitting..." : "Submit Response"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
