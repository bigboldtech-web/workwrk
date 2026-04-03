"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Edit3, Save, Trash2, FileText, Users, CheckSquare,
  MessageSquare, Plus, Calendar, Clock, ArrowRight, Square,
  CheckCircle, X, ExternalLink,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ActionItem {
  id: string;
  title: string;
  assigneeId: string;
  assignee: { id: string; firstName: string; lastName: string };
  deadline: string | null;
  status: string;
  completedAt: string | null;
}

interface Decision {
  text: string;
  decidedBy: string;
  date: string;
}

interface Meeting {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  duration: number;
  agenda: string | null;
  notes: string | null;
  decisions: string | null;
  attendees: { id: string; userId: string; attended: boolean; user: { id: string; firstName: string; lastName: string; avatar: string | null; email: string } }[];
  actionItems: ActionItem[];
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getMeetingTypeLabel(type: string) {
  return type.replace(/_/g, " ");
}

function getMeetingTypeColor(type: string) {
  switch (type) {
    case "DAILY_STANDUP": return "bg-blue-500/20 text-blue-400";
    case "WEEKLY_REVIEW": return "bg-purple-500/20 text-purple-400";
    case "ONE_ON_ONE": return "bg-green-500/20 text-green-400";
    case "QUARTERLY_REVIEW": return "bg-orange-500/20 text-orange-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();
  const [tab, setTab] = useState("details");
  const [users, setUsers] = useState<any[]>([]);

  // Edit details state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editAgenda, setEditAgenda] = useState("");

  // Notes state
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);

  // Decisions state
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [showDecisionDialog, setShowDecisionDialog] = useState(false);
  const [newDecisionText, setNewDecisionText] = useState("");

  // Action items state
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [aiTitle, setAiTitle] = useState("");
  const [aiAssigneeId, setAiAssigneeId] = useState("");
  const [aiDeadline, setAiDeadline] = useState("");

  // Delete confirmation
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Previous meeting follow-up
  const [prevIncomplete, setPrevIncomplete] = useState<ActionItem[]>([]);

  const fetchMeeting = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${id}`);
      if (!res.ok) throw new Error("Failed");
      const data: Meeting = await res.json();
      setMeeting(data);
      setEditTitle(data.title);
      setEditAgenda(data.agenda || "");
      setNotes(data.notes || "");

      // Parse decisions from JSON string
      try {
        const parsed = data.decisions ? JSON.parse(data.decisions) : [];
        setDecisions(Array.isArray(parsed) ? parsed : []);
      } catch {
        setDecisions(data.decisions ? [{ text: data.decisions, decidedBy: "", date: "" }] : []);
      }
    } catch (err) {
      console.error("Error fetching meeting:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  // Fetch follow-up from previous meeting of same type
  const fetchPreviousIncomplete = useCallback(async (meetingData: Meeting) => {
    try {
      const res = await fetch(`/api/meetings?type=${meetingData.type}`);
      if (!res.ok) return;
      const all = await res.json();
      if (!Array.isArray(all)) return;

      // Find previous meeting (scheduled before this one, same type)
      const current = new Date(meetingData.scheduledAt).getTime();
      const previous = all
        .filter((m: any) => new Date(m.scheduledAt).getTime() < current && m.id !== meetingData.id)
        .sort((a: any, b: any) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];

      if (!previous) return;

      // Check if attendees overlap
      const currentAttendees = new Set(meetingData.attendees.map((a) => a.userId));
      const prevAttendees = (previous.attendees || []).map((a: any) => a.user?.id || a.userId);
      const overlap = prevAttendees.some((uid: string) => currentAttendees.has(uid));
      if (!overlap) return;

      // Fetch that meeting's action items
      const detailRes = await fetch(`/api/meetings/${previous.id}`);
      if (!detailRes.ok) return;
      const detail = await detailRes.json();
      const incomplete = (detail.actionItems || []).filter((ai: ActionItem) => ai.status !== "COMPLETED");
      setPrevIncomplete(incomplete);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMeeting();
    fetchUsers();
  }, [fetchMeeting, fetchUsers]);

  useEffect(() => {
    if (meeting) fetchPreviousIncomplete(meeting);
  }, [meeting, fetchPreviousIncomplete]);

  // Auto-save notes every 30 seconds
  useEffect(() => {
    if (!notesDirty || !meeting) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      await fetch(`/api/meetings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      setNotesDirty(false);
    }, 30000);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [notes, notesDirty, id, meeting]);

  const saveNotes = async () => {
    setSaving(true);
    await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setNotesDirty(false);
    setSaving(false);
  };

  const saveDetails = async () => {
    setSaving(true);
    const res = await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, agenda: editAgenda }),
    });
    if (res.ok) {
      await fetchMeeting();
      setEditing(false);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    if (res.ok) {
      toastSuccess("Meeting deleted");
      router.push("/meetings");
    } else {
      toastError("Failed to delete meeting");
    }
    setShowDeleteConfirm(false);
  };

  // Decision handlers
  const addDecision = async () => {
    if (!newDecisionText.trim()) return;
    const updated = [...decisions, { text: newDecisionText, decidedBy: "", date: new Date().toISOString().split("T")[0] }];
    await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: JSON.stringify(updated) }),
    });
    setDecisions(updated);
    setNewDecisionText("");
    setShowDecisionDialog(false);
  };

  const removeDecision = async (index: number) => {
    const updated = decisions.filter((_, i) => i !== index);
    await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: JSON.stringify(updated) }),
    });
    setDecisions(updated);
  };

  // Action item handlers
  const addActionItem = async () => {
    if (!aiTitle || !aiAssigneeId) return;
    setSaving(true);
    const res = await fetch(`/api/meetings/${id}/action-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: aiTitle, assigneeId: aiAssigneeId, deadline: aiDeadline || undefined }),
    });
    if (res.ok) {
      setShowActionDialog(false);
      setAiTitle("");
      setAiAssigneeId("");
      setAiDeadline("");
      fetchMeeting();
    }
    setSaving(false);
  };

  const toggleActionItem = async (item: ActionItem) => {
    const newStatus = item.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED";
    await fetch(`/api/meetings/${id}/action-items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, status: newStatus }),
    });
    fetchMeeting();
  };

  const deleteActionItem = async (itemId: string) => {
    await fetch(`/api/meetings/${id}/action-items?itemId=${itemId}`, { method: "DELETE" });
    fetchMeeting();
  };

  const convertToTask = async (itemId: string) => {
    const res = await fetch(`/api/meetings/${id}/action-items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (res.ok) {
      const data = await res.json();
      toastSuccess(`Task created: ${data.task.title}`);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 bg-surface-2 rounded animate-pulse" />
          <div className="h-6 w-64 bg-surface-2 rounded animate-pulse" />
        </div>
        <div className="h-96 bg-surface-2 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="text-center py-20">
        <p className="text-muted">Meeting not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/meetings")}>Back to Meetings</Button>
      </div>
    );
  }

  const actionItemsDone = meeting.actionItems.filter((a) => a.status === "COMPLETED").length;
  const actionItemsTotal = meeting.actionItems.length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/meetings")} className="shrink-0">
            <ArrowLeft size={18} />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{meeting.title}</h1>
              <Badge className={`text-[10px] ${getMeetingTypeColor(meeting.type)}`}>
                {getMeetingTypeLabel(meeting.type)}
              </Badge>
            </div>
            <p className="text-sm text-muted flex items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1"><Calendar size={12} /> {formatDateTime(meeting.scheduledAt)}</span>
              <span className="flex items-center gap-1"><Clock size={12} /> {meeting.duration} min</span>
              <span className="flex items-center gap-1"><Users size={12} /> {meeting.attendees.length} attendees</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-red-400 hover:text-red-300" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      {/* Follow-up from previous meeting */}
      {prevIncomplete.length > 0 && (
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-orange-400 mb-2">
              Follow-up from previous meeting ({prevIncomplete.length} incomplete action items)
            </p>
            <div className="space-y-1">
              {prevIncomplete.map((ai) => (
                <div key={ai.id} className="flex items-center gap-2 text-xs text-muted">
                  <Square size={12} className="text-orange-400 shrink-0" />
                  <span>{ai.title}</span>
                  <span className="ml-auto">{ai.assignee.firstName} {ai.assignee.lastName}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="details" className="gap-1.5"><Edit3 size={14} /> Details</TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5"><FileText size={14} /> Notes</TabsTrigger>
          <TabsTrigger value="decisions" className="gap-1.5"><MessageSquare size={14} /> Decisions ({decisions.length})</TabsTrigger>
          <TabsTrigger value="actions" className="gap-1.5">
            <CheckSquare size={14} /> Action Items ({actionItemsDone}/{actionItemsTotal})
          </TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Meeting Details</CardTitle>
                {editing ? (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEditing(false); setEditTitle(meeting.title); setEditAgenda(meeting.agenda || ""); }}>Cancel</Button>
                    <Button size="sm" onClick={saveDetails} disabled={saving} className="gap-1.5"><Save size={14} /> {saving ? "Saving..." : "Save"}</Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5"><Edit3 size={14} /> Edit</Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">Title</Label>
                  {editing ? (
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1" />
                  ) : (
                    <p className="text-sm mt-1">{meeting.title}</p>
                  )}
                </div>
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">Type</Label>
                  <p className="text-sm mt-1">{getMeetingTypeLabel(meeting.type)}</p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">Scheduled</Label>
                  <p className="text-sm mt-1">{formatDateTime(meeting.scheduledAt)}</p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">Duration</Label>
                  <p className="text-sm mt-1">{meeting.duration} minutes</p>
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted uppercase tracking-wider">Agenda</Label>
                {editing ? (
                  <Textarea value={editAgenda} onChange={(e) => setEditAgenda(e.target.value)} className="mt-1" rows={4} />
                ) : (
                  <p className="text-sm mt-1 text-muted whitespace-pre-wrap">{meeting.agenda || "No agenda set."}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Attendees */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Attendees ({meeting.attendees.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {meeting.attendees.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface-3">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">
                        {a.user.firstName[0]}{a.user.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{a.user.firstName} {a.user.lastName}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Meeting Notes</CardTitle>
                <div className="flex items-center gap-2">
                  {notesDirty && <span className="text-[10px] text-orange-400">Unsaved changes (auto-saves in 30s)</span>}
                  <Button size="sm" onClick={saveNotes} disabled={saving || !notesDirty} className="gap-1.5">
                    <Save size={14} /> {saving ? "Saving..." : "Save Notes"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
                placeholder="Write meeting notes here... (auto-saves every 30 seconds)"
                rows={16}
                className="bg-surface-3 border-border font-mono text-sm"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Decisions Tab */}
        <TabsContent value="decisions" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Decisions ({decisions.length})</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setShowDecisionDialog(true)} className="gap-1.5">
                  <Plus size={14} /> Add Decision
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {decisions.length === 0 ? (
                <div className="text-center py-8 text-muted text-sm">No decisions recorded yet.</div>
              ) : (
                <div className="space-y-2">
                  {decisions.map((d, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-3 group">
                      <div className="rounded-full bg-purple-500/10 p-1.5 mt-0.5 shrink-0">
                        <MessageSquare size={12} className="text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm">{d.text}</p>
                        <p className="text-[10px] text-muted mt-1">{d.date ? formatDate(d.date) : ""}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-400" onClick={() => removeDecision(i)}>
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Action Items Tab */}
        <TabsContent value="actions" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  Action Items — {actionItemsDone} of {actionItemsTotal} complete
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => setShowActionDialog(true)} className="gap-1.5">
                  <Plus size={14} /> Add Action Item
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {meeting.actionItems.length === 0 ? (
                <div className="text-center py-8 text-muted text-sm">No action items yet.</div>
              ) : (
                <div className="space-y-2">
                  {meeting.actionItems.map((item) => (
                    <div key={item.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-all group ${
                      item.status === "COMPLETED" ? "border-green-500/20 bg-green-500/5" : "border-border bg-surface-3"
                    }`}>
                      <button onClick={() => toggleActionItem(item)} className="mt-0.5 shrink-0">
                        {item.status === "COMPLETED" ? (
                          <CheckCircle size={18} className="text-green-400" />
                        ) : (
                          <Square size={18} className="text-muted hover:text-purple-400" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${item.status === "COMPLETED" ? "line-through text-muted" : ""}`}>
                          {item.title}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted">
                          <span>{item.assignee.firstName} {item.assignee.lastName}</span>
                          {item.deadline && <span>Due {formatDate(item.deadline)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Convert to Task" onClick={() => convertToTask(item.id)}>
                          <ExternalLink size={12} className="text-purple-400" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => deleteActionItem(item.id)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Decision Dialog */}
      <Dialog open={showDecisionDialog} onOpenChange={setShowDecisionDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Decision</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Decision</Label>
              <Textarea value={newDecisionText} onChange={(e) => setNewDecisionText(e.target.value)} placeholder="What was decided?" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDecisionDialog(false)}>Cancel</Button>
            <Button onClick={addDecision} disabled={!newDecisionText.trim()}>Add Decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Action Item Dialog */}
      <Dialog open={showActionDialog} onOpenChange={setShowActionDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Action Item</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={aiTitle} onChange={(e) => setAiTitle(e.target.value)} placeholder="What needs to be done?" />
            </div>
            <div className="space-y-2">
              <Label>Assigned To</Label>
              <Select value={aiAssigneeId} onValueChange={setAiAssigneeId}>
                <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                <SelectContent>
                  {(meeting?.attendees || []).map((a) => (
                    <SelectItem key={a.user.id} value={a.user.id}>{a.user.firstName} {a.user.lastName}</SelectItem>
                  ))}
                  {users.filter((u) => !meeting?.attendees.some((a) => a.user.id === u.id)).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Deadline</Label>
              <Input type="date" value={aiDeadline} onChange={(e) => setAiDeadline(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActionDialog(false)}>Cancel</Button>
            <Button onClick={addActionItem} disabled={saving || !aiTitle || !aiAssigneeId}>
              {saving ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Meeting</DialogTitle></DialogHeader>
          <p className="text-sm text-muted py-4">
            Are you sure you want to delete &ldquo;{meeting.title}&rdquo;? This will also delete all notes, decisions, and action items.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>Delete Meeting</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Meeting"
        description="This will permanently delete this meeting and all its notes, decisions, and action items. This cannot be undone."
        confirmLabel="Delete Meeting"
      />
    </div>
  );
}
