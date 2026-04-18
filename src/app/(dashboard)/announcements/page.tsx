"use client";

import { useState, useEffect } from "react";
import { useRole } from "@/hooks/use-role";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Megaphone, Plus, Pin, Trash2, AlertTriangle, PartyPopper, FileText, Calendar,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";

const TYPES = [
  { value: "INFO", label: "Information", icon: Megaphone },
  { value: "WARNING", label: "Warning", icon: AlertTriangle },
  { value: "CELEBRATION", label: "Celebration", icon: PartyPopper },
  { value: "POLICY", label: "Policy Update", icon: FileText },
  { value: "EVENT", label: "Event", icon: Calendar },
];

const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

export default function AnnouncementsPage() {
  const { isManager } = useRole();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", type: "INFO", priority: "NORMAL", pinned: false, expiresAt: "" });
  const [saving, setSaving] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetch("/api/announcements")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        const items = d?.data || d || [];
        setAnnouncements(Array.isArray(items) ? items : []);
      })
      .catch((err) => console.error("Failed to fetch announcements:", err))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          expiresAt: form.expiresAt || undefined,
        }),
      });
      if (res.ok) {
        // Refetch all announcements to get consistent data
        const refreshRes = await fetch("/api/announcements");
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          const items = refreshData?.data || refreshData || [];
          setAnnouncements(Array.isArray(items) ? items : []);
        }
        setShowCreate(false);
        setForm({ title: "", content: "", type: "INFO", priority: "NORMAL", pinned: false, expiresAt: "" });
        toastSuccess("Announcement published");
      }
    } catch { toastError("Failed to publish"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Announcements</h1>
          <p className="text-muted text-sm mt-1">Publish company-wide announcements</p>
        </div>
        {isManager && (
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus size={14} /> New Announcement
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-16 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}</div>
      ) : announcements.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Megaphone size={40} className="mx-auto text-muted mb-3" />
          <p className="font-medium mb-1">No announcements</p>
          <p className="text-sm text-muted">Publish your first announcement to communicate with your team.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Megaphone size={16} className="mt-1 text-purple-400 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold">{a.title}</h3>
                      <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                      <Badge variant={a.priority === "URGENT" ? "destructive" : "secondary"} className="text-[10px]">{a.priority}</Badge>
                      {a.pinned && <Pin size={12} className="text-purple-400" />}
                    </div>
                    <p className="text-xs text-muted">{a.content}</p>
                    <p className="text-[10px] text-muted-2 mt-2">
                      {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {a.expiresAt && ` · Expires ${new Date(a.expiresAt).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Announcement</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title <span className="text-red-400">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Announcement title" />
            </div>
            <div className="space-y-2">
              <Label>Content <span className="text-red-400">*</span></Label>
              <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="What do you want to announce?" rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Expires On (optional)</Label>
                <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="rounded" />
                  <span className="text-sm">Pin announcement</span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title.trim() || !form.content.trim()}>
              {saving ? "Publishing..." : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
