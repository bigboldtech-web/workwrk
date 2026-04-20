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
  ClipboardCheck, Plus, Send, Trash2, Globe, Building2, Users as UsersIcon, Check,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/dashboard/page-header";
import { useRole } from "@/hooks/use-role";

interface SurveyQuestion { id: string; text: string; type: "rating" | "nps" | "text" }
type AudienceType = "ALL" | "OFFICES" | "DEPARTMENTS" | "USERS";

interface Office { id: string; name: string; city?: string | null; country?: string | null }
interface Department { id: string; name: string }
interface PersonLite { id: string; firstName: string; lastName: string; role?: { title: string } | null }

export default function SurveysPage() {
  const { isManager } = useRole();
  const [surveys, setSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [respondingSurvey, setRespondingSurvey] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    questions: { id: string; text: string; type: "rating" | "nps" | "text" }[];
    audienceType: AudienceType;
    officeIds: string[];
    departmentIds: string[];
    userIds: string[];
  }>({
    title: "",
    questions: [{ id: "q1", text: "", type: "rating" }],
    audienceType: "ALL",
    officeIds: [],
    departmentIds: [],
    userIds: [],
  });
  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetch("/api/pulse-surveys")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setSurveys(Array.isArray(d) ? d : d?.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isManager || !showCreate) return;
    Promise.all([
      fetch("/api/offices").then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/departments").then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/users?limit=500").then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
    ]).then(([off, dep, usr]) => {
      setOffices(Array.isArray(off) ? off : off?.data || []);
      setDepartments(Array.isArray(dep) ? dep : dep?.data || []);
      setPeople(Array.isArray(usr) ? usr : usr?.data || []);
    });
  }, [isManager, showCreate]);

  async function handleCreate() {
    if (!form.title.trim() || form.questions.every((q) => !q.text.trim())) return;
    if (form.audienceType === "OFFICES" && form.officeIds.length === 0) { toastError("Pick at least one office"); return; }
    if (form.audienceType === "DEPARTMENTS" && form.departmentIds.length === 0) { toastError("Pick at least one department"); return; }
    if (form.audienceType === "USERS" && form.userIds.length === 0) { toastError("Pick at least one person"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/pulse-surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          questions: form.questions.filter((q) => q.text.trim()),
          audienceType: form.audienceType,
          officeIds: form.officeIds,
          departmentIds: form.departmentIds,
          userIds: form.userIds,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ title: "", questions: [{ id: "q1", text: "", type: "rating" }], audienceType: "ALL", officeIds: [], departmentIds: [], userIds: [] });
        setUserSearch("");
        const d = await fetch("/api/pulse-surveys").then((r) => r.json());
        setSurveys(Array.isArray(d) ? d : d?.data || []);
        toastSuccess("Survey published");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  function toggleId(field: "officeIds" | "departmentIds" | "userIds", id: string) {
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id],
    }));
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
        setSurveys(Array.isArray(d) ? d : d?.data || []);
        toastSuccess("Response submitted");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  const pending = surveys.filter((s) => s.status === "ACTIVE" && !s.hasResponded).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        kicker="Surveys · pulse"
        title="Pulse surveys"
        subtitle={`${surveys.length} surveys${pending > 0 ? ` · ${pending} pending` : ""}`}
        actions={
          isManager
            ? [{ label: "New survey", onClick: () => setShowCreate(true), icon: <Plus size={14} /> }]
            : undefined
        }
      />

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
            const size = survey.audienceSize ?? survey.totalUsers;
            const audienceLabel = survey.audienceType === "ALL" ? "Everyone"
              : survey.audienceType === "OFFICES" ? `${(survey.officeIds || []).length} office${(survey.officeIds || []).length === 1 ? "" : "s"}`
              : survey.audienceType === "DEPARTMENTS" ? `${(survey.departmentIds || []).length} dept${(survey.departmentIds || []).length === 1 ? "" : "s"}`
              : `${(survey.userIds || []).length} ${(survey.userIds || []).length === 1 ? "person" : "people"}`;
            const audienceIcon = survey.audienceType === "OFFICES" ? Globe
              : survey.audienceType === "DEPARTMENTS" ? Building2
              : UsersIcon;
            const AudIcon = audienceIcon;
            return (
              <Card key={survey.id} className={!survey.hasResponded && survey.status === "ACTIVE" && survey.inAudience ? "border-amber-500/20" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <ClipboardCheck size={18} className="text-[color:var(--accent-strong)] shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-sm font-semibold">{survey.title}</h3>
                        <Badge variant={survey.status === "ACTIVE" ? "success" : "secondary"} className="text-[10px]">{survey.status}</Badge>
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <AudIcon size={10} /> {audienceLabel}
                        </Badge>
                        {survey.hasResponded && <Badge variant="outline" className="text-[10px] text-green-400">Responded</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted">
                        <span>{questions.length} questions</span>
                        <span>{survey.totalResponses}/{size} responded ({survey.responseRate}%)</span>
                      </div>
                      {isManager && <Progress value={survey.responseRate} className="h-1 mt-2 max-w-[200px]" />}
                    </div>
                    {survey.status === "ACTIVE" && !survey.hasResponded && survey.inAudience && (
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
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Pulse Survey</DialogTitle></DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label>Title <span className="text-red-400">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., Weekly Engagement Check" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Questions</Label>
                <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => setForm({ ...form, questions: [...form.questions, { id: `q${form.questions.length + 1}`, text: "", type: "rating" }] })}>
                  <Plus size={12} /> Add question
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

            <div className="space-y-3 pt-2 border-t border-border">
              <div>
                <Label>Audience</Label>
                <p className="text-[11px] text-muted mt-0.5">Who will see this survey?</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: "ALL" as const, label: "Everyone", icon: UsersIcon, desc: "All active members" },
                  { key: "OFFICES" as const, label: "By office", icon: Globe, desc: "Pick locations" },
                  { key: "DEPARTMENTS" as const, label: "By department", icon: Building2, desc: "Pick departments" },
                  { key: "USERS" as const, label: "Specific people", icon: UsersIcon, desc: "Pick individuals" },
                ]).map(({ key, label, icon: Icon, desc }) => {
                  const active = form.audienceType === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setForm({ ...form, audienceType: key })}
                      className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors ${active ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]" : "border-border hover:bg-surface-2"}`}
                    >
                      <Icon size={16} className={active ? "text-[color:var(--accent-strong)]" : "text-muted"} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-[11px] text-muted">{desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {form.audienceType === "OFFICES" && (
                <div className="space-y-2">
                  <Label className="text-xs">Pick offices ({form.officeIds.length} selected)</Label>
                  {offices.length === 0 ? (
                    <p className="text-xs text-muted p-3 rounded-lg border border-dashed border-border">No offices yet. Add one in Organization &rarr; Offices.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border border-border rounded-lg p-1">
                      {offices.map((o) => {
                        const selected = form.officeIds.includes(o.id);
                        return (
                          <button key={o.id} type="button" onClick={() => toggleId("officeIds", o.id)} className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${selected ? "bg-[color:var(--accent-soft)]" : "hover:bg-surface-2"}`}>
                            <span className={`h-4 w-4 rounded border flex items-center justify-center ${selected ? "border-[color:var(--accent-strong)] bg-[color:var(--accent-strong)]" : "border-border"}`}>
                              {selected && <Check size={12} className="text-[color:var(--accent-contrast)]" />}
                            </span>
                            <span className="flex-1 min-w-0 truncate">{o.name}{o.city ? ` · ${o.city}` : ""}{o.country ? `, ${o.country}` : ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {form.audienceType === "DEPARTMENTS" && (
                <div className="space-y-2">
                  <Label className="text-xs">Pick departments ({form.departmentIds.length} selected)</Label>
                  {departments.length === 0 ? (
                    <p className="text-xs text-muted p-3 rounded-lg border border-dashed border-border">No departments yet.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border border-border rounded-lg p-1">
                      {departments.map((d) => {
                        const selected = form.departmentIds.includes(d.id);
                        return (
                          <button key={d.id} type="button" onClick={() => toggleId("departmentIds", d.id)} className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${selected ? "bg-[color:var(--accent-soft)]" : "hover:bg-surface-2"}`}>
                            <span className={`h-4 w-4 rounded border flex items-center justify-center ${selected ? "border-[color:var(--accent-strong)] bg-[color:var(--accent-strong)]" : "border-border"}`}>
                              {selected && <Check size={12} className="text-[color:var(--accent-contrast)]" />}
                            </span>
                            <span className="flex-1 min-w-0 truncate">{d.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {form.audienceType === "USERS" && (
                <div className="space-y-2">
                  <Label className="text-xs">Pick people ({form.userIds.length} selected)</Label>
                  <Input placeholder="Search by name..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="text-sm" />
                  <div className="max-h-48 overflow-y-auto border border-border rounded-lg p-1">
                    {people
                      .filter((p) => {
                        if (!userSearch) return true;
                        const q = userSearch.toLowerCase();
                        return p.firstName.toLowerCase().includes(q) || p.lastName.toLowerCase().includes(q);
                      })
                      .slice(0, 50)
                      .map((p) => {
                        const selected = form.userIds.includes(p.id);
                        return (
                          <button key={p.id} type="button" onClick={() => toggleId("userIds", p.id)} className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${selected ? "bg-[color:var(--accent-soft)]" : "hover:bg-surface-2"}`}>
                            <span className={`h-4 w-4 rounded border flex items-center justify-center ${selected ? "border-[color:var(--accent-strong)] bg-[color:var(--accent-strong)]" : "border-border"}`}>
                              {selected && <Check size={12} className="text-[color:var(--accent-contrast)]" />}
                            </span>
                            <span className="flex-1 min-w-0 truncate">{p.firstName} {p.lastName}{p.role?.title ? ` — ${p.role.title}` : ""}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
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
                        className={`h-10 w-10 rounded-lg border text-sm font-bold transition-colors ${answers[q.id] === n ? "bg-[#d4ff2e] text-[#0a0a0a] border-[#d4ff2e]" : "border-border hover:border-[#d4ff2e]"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                ) : q.type === "nps" ? (
                  <div className="flex gap-1">
                    {Array.from({ length: 11 }, (_, n) => (
                      <button key={n} onClick={() => setAnswers({ ...answers, [q.id]: n })}
                        className={`h-8 w-8 rounded text-xs font-bold transition-colors ${answers[q.id] === n ? "bg-[#d4ff2e] text-[#0a0a0a]" : "border border-border hover:border-[#d4ff2e]"}`}>
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
