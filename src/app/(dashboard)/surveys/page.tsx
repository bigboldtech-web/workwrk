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
  ClipboardCheck, Plus, Send, Trash2, Globe, Building2, Users as UsersIcon, Check, MoreHorizontal, Pencil, Archive, RotateCcw, BarChart3, Loader2,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // Responses viewer state — opens a modal with the aggregated results
  // of a single survey. Responses stay anonymous (the API never returns
  // a userId); managers see distribution for rating/NPS questions and
  // the raw answer list for text questions.
  const [responsesFor, setResponsesFor] = useState<any | null>(null);
  const [responsesData, setResponsesData] = useState<any | null>(null);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [responsesFilter, setResponsesFilter] = useState<{ officeId: string; departmentId: string }>({ officeId: "", departmentId: "" });
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
    anonymous: boolean;
  }>({
    title: "",
    questions: [{ id: "q1", text: "", type: "rating" }],
    audienceType: "ALL",
    officeIds: [],
    departmentIds: [],
    userIds: [],
    anonymous: true,
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

  async function refreshSurveys() {
    const d = await fetch("/api/pulse-surveys").then((r) => r.json());
    setSurveys(Array.isArray(d) ? d : d?.data || []);
  }

  function resetForm() {
    setForm({ title: "", questions: [{ id: "q1", text: "", type: "rating" }], audienceType: "ALL", officeIds: [], departmentIds: [], userIds: [], anonymous: true });
    setUserSearch("");
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setShowCreate(true);
  }

  async function openResponses(survey: any) {
    setResponsesFor(survey);
    setResponsesData(null);
    setResponsesFilter({ officeId: "", departmentId: "" });
    await loadResponses(survey.id, { officeId: "", departmentId: "" });
  }

  async function loadResponses(surveyId: string, filter: { officeId: string; departmentId: string }) {
    setLoadingResponses(true);
    try {
      const params = new URLSearchParams();
      if (filter.officeId) params.set("officeId", filter.officeId);
      if (filter.departmentId) params.set("departmentId", filter.departmentId);
      const qs = params.toString();
      const res = await fetch(`/api/pulse-surveys/${surveyId}/responses${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const d = await res.json();
        setResponsesData(d.data ?? d);
      } else {
        toastError("Failed to load responses");
        setResponsesFor(null);
      }
    } catch {
      toastError("Failed to load responses");
      setResponsesFor(null);
    } finally {
      setLoadingResponses(false);
    }
  }

  function updateResponsesFilter(next: { officeId?: string; departmentId?: string }) {
    if (!responsesFor) return;
    const merged = {
      officeId: next.officeId !== undefined ? next.officeId : responsesFilter.officeId,
      departmentId: next.departmentId !== undefined ? next.departmentId : responsesFilter.departmentId,
    };
    setResponsesFilter(merged);
    loadResponses(responsesFor.id, merged);
  }

  function exportResponsesCsv() {
    if (!responsesFor) return;
    const params = new URLSearchParams();
    if (responsesFilter.officeId) params.set("officeId", responsesFilter.officeId);
    if (responsesFilter.departmentId) params.set("departmentId", responsesFilter.departmentId);
    const qs = params.toString();
    const url = `/api/pulse-surveys/${responsesFor.id}/responses/export${qs ? `?${qs}` : ""}`;
    window.location.href = url;
  }

  function openEdit(survey: any) {
    setEditingId(survey.id);
    setForm({
      title: survey.title || "",
      questions: Array.isArray(survey.questions) && survey.questions.length > 0
        ? survey.questions.map((q: any) => ({ id: q.id || crypto.randomUUID(), text: q.text || "", type: q.type || "rating" }))
        : [{ id: "q1", text: "", type: "rating" }],
      audienceType: (survey.audienceType as AudienceType) || "ALL",
      officeIds: Array.isArray(survey.officeIds) ? survey.officeIds : [],
      departmentIds: Array.isArray(survey.departmentIds) ? survey.departmentIds : [],
      userIds: Array.isArray(survey.userIds) ? survey.userIds : [],
      anonymous: survey.anonymous !== false,
    });
    setShowCreate(true);
  }

  async function handleCreate() {
    if (!form.title.trim() || form.questions.every((q) => !q.text.trim())) return;
    if (form.audienceType === "OFFICES" && form.officeIds.length === 0) { toastError("Pick at least one office"); return; }
    if (form.audienceType === "DEPARTMENTS" && form.departmentIds.length === 0) { toastError("Pick at least one department"); return; }
    if (form.audienceType === "USERS" && form.userIds.length === 0) { toastError("Pick at least one person"); return; }
    setSaving(true);
    try {
      const url = editingId ? `/api/pulse-surveys/${editingId}` : "/api/pulse-surveys";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          questions: form.questions.filter((q) => q.text.trim()),
          audienceType: form.audienceType,
          officeIds: form.officeIds,
          departmentIds: form.departmentIds,
          userIds: form.userIds,
          anonymous: form.anonymous,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        resetForm();
        await refreshSurveys();
        toastSuccess(editingId ? "Survey updated" : "Survey published");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  async function handleSetStatus(surveyId: string, status: "ACTIVE" | "CLOSED") {
    try {
      const res = await fetch(`/api/pulse-surveys/${surveyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await refreshSurveys();
        toastSuccess(status === "CLOSED" ? "Survey closed" : "Survey reopened");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed");
      }
    } catch { toastError("Failed"); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pulse-surveys/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteTarget(null);
        await refreshSurveys();
        toastSuccess("Survey deleted");
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
            ? [{ label: "New survey", onClick: openCreate, icon: <Plus size={14} /> }]
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
              <ContextMenu key={survey.id}>
                <ContextMenuTrigger asChild>
              <Card className={!survey.hasResponded && survey.status === "ACTIVE" && survey.inAudience ? "border-amber-500/20" : ""}>
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
                    {isManager && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" aria-label="Survey actions">
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openResponses(survey)} className="gap-2">
                            <BarChart3 size={14} /> View responses
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openEdit(survey)} className="gap-2">
                            <Pencil size={14} /> Edit
                          </DropdownMenuItem>
                          {survey.status === "ACTIVE" ? (
                            <DropdownMenuItem onClick={() => handleSetStatus(survey.id, "CLOSED")} className="gap-2">
                              <Archive size={14} /> Close survey
                            </DropdownMenuItem>
                          ) : survey.status === "CLOSED" ? (
                            <DropdownMenuItem onClick={() => handleSetStatus(survey.id, "ACTIVE")} className="gap-2">
                              <RotateCcw size={14} /> Reopen
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDeleteTarget(survey)} className="gap-2 text-red-400 focus:text-red-400">
                            <Trash2 size={14} /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardContent>
              </Card>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel>Survey</ContextMenuLabel>
                  {survey.status === "ACTIVE" && !survey.hasResponded && survey.inAudience && (
                    <ContextMenuItem onSelect={() => { setRespondingSurvey(survey); setAnswers({}); }}>
                      <Send size={14} /> Respond
                    </ContextMenuItem>
                  )}
                  {isManager && (
                    <>
                      <ContextMenuItem onSelect={() => openResponses(survey)}>
                        <BarChart3 size={14} /> View responses
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => openEdit(survey)}>
                        <Pencil size={14} /> Edit
                      </ContextMenuItem>
                      {survey.status === "ACTIVE" && (
                        <ContextMenuItem onSelect={() => handleSetStatus(survey.id, "CLOSED")}>
                          <Archive size={14} /> Close survey
                        </ContextMenuItem>
                      )}
                      {survey.status === "CLOSED" && (
                        <ContextMenuItem onSelect={() => handleSetStatus(survey.id, "ACTIVE")}>
                          <RotateCcw size={14} /> Reopen
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator />
                      <ContextMenuItem destructive onSelect={() => setDeleteTarget(survey)}>
                        <Trash2 size={14} /> Delete
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}

      {/* Create / Edit Survey Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Pulse Survey" : "Create Pulse Survey"}</DialogTitle></DialogHeader>
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

            {/* Anonymity toggle — on by default. Flip off only when the context
                calls for attributed feedback (e.g. post-review pulse tied to a
                1:1 follow-up). The backend enforces the same default. */}
            <div className="rounded-lg border border-border p-3 flex items-start gap-3">
              <input
                type="checkbox"
                id="anonymous"
                checked={form.anonymous}
                onChange={(e) => setForm({ ...form, anonymous: e.target.checked })}
                className="accent-[#a8cc24] mt-0.5"
              />
              <label htmlFor="anonymous" className="flex-1 cursor-pointer">
                <div className="text-sm font-medium">Anonymous responses</div>
                <div className="text-[11px] text-muted mt-0.5">
                  Managers see answers in aggregate only — no names, no attribution.
                  Turn this off only when the context calls for attributed feedback.
                </div>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title.trim()}>
              {saving
                ? (editingId ? "Saving..." : "Publishing...")
                : (editingId ? "Save Changes" : "Publish Survey")}
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

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this survey?</DialogTitle></DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm">
              <span className="font-medium">{deleteTarget?.title}</span> will be permanently removed,
              along with all {deleteTarget?.totalResponses ?? 0} response{deleteTarget?.totalResponses === 1 ? "" : "s"}.
              This can&apos;t be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? "Deleting..." : "Delete survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Responses viewer — manager-only aggregate of answers */}
      <Dialog open={!!responsesFor} onOpenChange={(open) => { if (!open) { setResponsesFor(null); setResponsesData(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{responsesFor?.title || "Responses"}</DialogTitle>
          </DialogHeader>

          {/* Filter bar + export — usable even while a refetch is in flight */}
          {responsesFor && (
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={responsesFilter.officeId || "all"}
                onValueChange={(v) => updateResponsesFilter({ officeId: v === "all" ? "" : v })}
              >
                <SelectTrigger className="h-8 text-xs w-auto min-w-[140px]"><SelectValue placeholder="All offices" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All offices</SelectItem>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={responsesFilter.departmentId || "all"}
                onValueChange={(v) => updateResponsesFilter({ departmentId: v === "all" ? "" : v })}
              >
                <SelectTrigger className="h-8 text-xs w-auto min-w-[160px]"><SelectValue placeholder="All departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="ml-auto h-8 text-xs gap-1.5" onClick={exportResponsesCsv}>
                Export CSV
              </Button>
            </div>
          )}

          {loadingResponses && (
            <div className="flex items-center justify-center py-10 text-sm text-muted gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading responses…
            </div>
          )}

          {!loadingResponses && responsesData && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted">
                <Badge variant="secondary">{responsesData.totalResponses} response{responsesData.totalResponses === 1 ? "" : "s"}</Badge>
                <Badge variant="outline">{responsesData.survey.status}</Badge>
                <Badge variant={responsesData.survey.anonymous ? "outline" : "secondary"}>
                  {responsesData.survey.anonymous ? "Anonymous" : "Attributed"}
                </Badge>
                {(responsesFilter.officeId || responsesFilter.departmentId) && (
                  <span className="text-[10px] text-muted">· filters applied</span>
                )}
              </div>

              {(!responsesData.questions || responsesData.questions.length === 0 || responsesData.totalResponses === 0) ? (
                <div className="text-center py-8 text-sm text-muted">
                  {(responsesFilter.officeId || responsesFilter.departmentId)
                    ? "No responses match these filters."
                    : "No responses yet. Share this survey with your audience."}
                </div>
              ) : (
                <div className="space-y-4">
                  {responsesData.questions.map((q: any, i: number) => (
                    <div key={q.questionId} className="rounded-lg border border-border p-4">
                      <div className="mb-3">
                        <div className="text-[10px] text-muted">Question {i + 1}</div>
                        <div className="text-sm font-medium">{q.text}</div>
                      </div>

                      {(q.kind === "rating" || q.kind === "nps") && (
                        <RatingBreakdown q={q} />
                      )}

                      {q.kind === "text" && (
                        <TextBreakdown q={q} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setResponsesFor(null); setResponsesData(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RatingBreakdown({ q }: { q: any }) {
  const maxCount = Math.max(1, ...q.distribution.map((d: any) => d.count));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">Average</span>
        <span className="font-semibold text-[#d4ff2e]">{q.average != null ? q.average.toFixed(1) : "—"}</span>
        <span className="text-muted ml-auto">{q.totalAnswered} answered</span>
      </div>
      <div className="space-y-1">
        {q.distribution.map((d: any) => {
          const pct = q.totalAnswered > 0 ? Math.round((d.count / q.totalAnswered) * 100) : 0;
          const barPct = (d.count / maxCount) * 100;
          return (
            <div key={d.value} className="flex items-center gap-2 text-xs">
              <span className="w-6 text-muted text-right">{d.value}</span>
              <div className="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                <div className="h-full bg-[rgba(212,255,46,0.55)]" style={{ width: `${barPct}%` }} />
              </div>
              <span className="w-16 text-right text-muted">{d.count} · {pct}%</span>
            </div>
          );
        })}
      </div>
      {Array.isArray(q.trend) && q.trend.length >= 2 && (
        <TrendSparkline trend={q.trend} min={q.min} max={q.max} />
      )}
    </div>
  );
}

// Small inline SVG sparkline of daily average — kept tiny on purpose so the
// manager can see drift at a glance without the modal turning into a chart
// dashboard. Needs ≥2 data points to draw meaningful movement.
function TrendSparkline({ trend, min, max }: { trend: { date: string; average: number; count: number }[]; min: number; max: number }) {
  const W = 280;
  const H = 40;
  const padX = 4;
  const padY = 4;
  const range = Math.max(1, max - min);
  const step = trend.length === 1 ? 0 : (W - padX * 2) / (trend.length - 1);
  const points = trend.map((t, i) => {
    const x = padX + i * step;
    const y = H - padY - ((t.average - min) / range) * (H - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = trend[0];
  const last = trend[trend.length - 1];
  return (
    <div className="pt-2 border-t border-border">
      <div className="flex items-center justify-between text-[10px] text-muted mb-1">
        <span>Trend (daily average)</span>
        <span>{first.date} → {last.date}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="#d4ff2e"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
        {trend.map((t, i) => {
          const x = padX + i * step;
          const y = H - padY - ((t.average - min) / range) * (H - padY * 2);
          return <circle key={i} cx={x} cy={y} r={1.5} fill="#d4ff2e"><title>{`${t.date}: ${t.average} (${t.count})`}</title></circle>;
        })}
      </svg>
    </div>
  );
}

function TextBreakdown({ q }: { q: any }) {
  if (q.totalAnswered === 0) {
    return <div className="text-xs text-muted">No text responses yet.</div>;
  }
  // Back-compat: the response endpoint used to return a string[]; it now
  // returns `{ value, respondent, createdAt }[]`. Handle both shapes so
  // this page keeps working if the API is ahead or behind during a
  // partial deploy.
  const items: { value: string; respondent: { name: string; office?: any; department?: any } | null; createdAt?: string }[] =
    q.responses.map((r: any) =>
      typeof r === "string" ? { value: r, respondent: null } : { value: r.value, respondent: r.respondent, createdAt: r.createdAt },
    );
  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {items.map((r, idx) => (
        <div key={idx} className="text-xs p-2 rounded-md bg-surface-2">
          <div className="flex items-center gap-2 text-[10px] text-muted mb-1">
            <span>{idx + 1}.</span>
            {r.respondent ? (
              <span className="text-foreground font-medium">
                {r.respondent.name}
                {r.respondent.office?.name && <span className="text-muted ml-1">· {r.respondent.office.name}</span>}
                {r.respondent.department?.name && <span className="text-muted ml-1">· {r.respondent.department.name}</span>}
              </span>
            ) : (
              <span>Anonymous</span>
            )}
            {r.createdAt && <span className="ml-auto">{new Date(r.createdAt).toLocaleDateString()}</span>}
          </div>
          <div className="whitespace-pre-wrap">{r.value}</div>
        </div>
      ))}
    </div>
  );
}
