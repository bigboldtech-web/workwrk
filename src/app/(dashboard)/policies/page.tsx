"use client";

import { useState, useEffect } from "react";
import { RichEditor } from "@/components/ui/rich-editor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Shield, Plus, CheckCircle2, X, Save, Trash2, Pencil, Eye, Copy,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useRole } from "@/hooks/use-role";
import { useSession } from "next-auth/react";

const CATEGORIES = ["HR", "Security", "Compliance", "Operations", "Code of Conduct", "Leave Policy", "Expense Policy", "Data Privacy", "Work From Home", "General"];

export default function PoliciesPage() {
  const { isManager } = useRole();
  const { data: sessionData } = useSession();
  const currentUser = sessionData?.user as any;
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "", requiresAck: true, effectiveDate: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/policies")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setPolicies(Array.isArray(d) ? d : d?.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, effectiveDate: form.effectiveDate || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        const created = data.data || data;
        setPolicies([created, ...policies]);
        setCreating(false);
        setSelectedPolicy(created);
        setForm({ title: "", content: "", category: "", requiresAck: true, effectiveDate: "" });
        toastSuccess("Policy published");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  async function handleAcknowledge(policyId: string) {
    setAcknowledging(policyId);
    try {
      const res = await fetch(`/api/policies/${policyId}/acknowledge`, { method: "POST" });
      if (res.ok) {
        const now = new Date().toISOString();
        const userName = currentUser ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() : "You";
        const userEmail = currentUser?.email || "";
        const ackData = { acknowledged: true, acknowledgedAt: now, acknowledgedBy: userName, acknowledgedEmail: userEmail };
        setPolicies(policies.map((p) => p.id === policyId ? { ...p, ...ackData } : p));
        if (selectedPolicy?.id === policyId) setSelectedPolicy({ ...selectedPolicy, ...ackData });
        toastSuccess("Policy acknowledged");
      }
    } catch { toastError("Failed"); } finally { setAcknowledging(null); }
  }

  function startEditing(policy: any) {
    setForm({
      title: policy.title || "",
      content: policy.content || "",
      category: policy.category || "",
      requiresAck: policy.requiresAck ?? true,
      effectiveDate: policy.effectiveDate ? new Date(policy.effectiveDate).toISOString().split("T")[0] : "",
    });
    setEditing(true);
    setCreating(false);
  }

  async function handleUpdate() {
    if (!selectedPolicy || !form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${selectedPolicy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, effectiveDate: form.effectiveDate || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.data || data;
        const merged = { ...selectedPolicy, ...updated };
        setPolicies(policies.map((p) => p.id === selectedPolicy.id ? merged : p));
        setSelectedPolicy(merged);
        setEditing(false);
        setForm({ title: "", content: "", category: "", requiresAck: true, effectiveDate: "" });
        toastSuccess("Policy updated");
      } else {
        toastError("Failed to update");
      }
    } catch { toastError("Failed to update"); } finally { setSaving(false); }
  }

  async function handleDelete(policyId: string) {
    if (!(await confirm({
      title: "Delete this policy?",
      description: "The policy and any acknowledgement records on it will be removed. This cannot be undone.",
      confirmLabel: "Delete policy",
      destructive: true,
    }))) return;
    try {
      const res = await fetch(`/api/policies/${policyId}`, { method: "DELETE" });
      if (res.ok) {
        setPolicies(policies.filter((p) => p.id !== policyId));
        if (selectedPolicy?.id === policyId) setSelectedPolicy(null);
        toastSuccess("Policy deleted");
      } else {
        toastError("Failed to delete");
      }
    } catch { toastError("Failed to delete"); }
  }

  const pendingAcks = policies.filter((p) => p.requiresAck && !p.acknowledged).length;

  return (
    <div className="flex gap-0 h-[calc(100vh-64px)] animate-fade-in">
      {/* LEFT: Policy List */}
      <div className={`overflow-y-auto border-r border-border ${selectedPolicy || creating ? "w-[30%]" : "w-full"} transition-all`}>
        <div className="p-3 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
          <div>
            <h1 className="text-lg font-bold">Policies</h1>
            <p className="text-[10px] text-muted">{policies.length} policies {pendingAcks > 0 && <span className="text-amber-400">&middot; {pendingAcks} pending</span>}</p>
          </div>
          {isManager && <Button size="sm" onClick={() => { setCreating(true); setSelectedPolicy(null); }} className="gap-1 text-xs"><Plus size={12} /> New</Button>}
        </div>

        {loading ? (
          <div className="p-3 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : policies.length === 0 ? (
          <div className="p-8 text-center">
            <Shield size={32} className="mx-auto text-muted mb-2" />
            <p className="text-sm font-medium">No policies yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {policies.map((p) => (
              <ContextMenu key={p.id}>
                <ContextMenuTrigger asChild>
                  <button onClick={() => { setSelectedPolicy(p); setCreating(false); }}
                    className={`w-full text-left p-3 hover:bg-surface-2 transition-colors ${selectedPolicy?.id === p.id ? "bg-[rgba(212,255,46,0.06)] border-l-2 border-l-[#d4ff2e]" : ""}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <Shield size={11} className="text-[color:var(--accent-strong)] shrink-0" />
                      <span className="text-xs font-semibold truncate flex-1">{p.title}</span>
                      {p.requiresAck && !p.acknowledged && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5 ml-5">
                      {p.category && <Badge variant="outline" className="text-[8px]">{p.category}</Badge>}
                      {p.acknowledged && <Badge variant="success" className="text-[8px]">Done</Badge>}
                    </div>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel>Policy</ContextMenuLabel>
                  <ContextMenuItem onSelect={() => { setSelectedPolicy(p); setCreating(false); }}>
                    <Eye size={14} /> View
                  </ContextMenuItem>
                  {p.requiresAck && !p.acknowledged && (
                    <ContextMenuItem onSelect={() => handleAcknowledge(p.id)}>
                      <CheckCircle2 size={14} /> Acknowledge
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onSelect={() => { navigator.clipboard.writeText(p.title).catch(() => {}); }}>
                    <Copy size={14} /> Copy title
                  </ContextMenuItem>
                  {isManager && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => { setSelectedPolicy(p); startEditing(p); }}>
                        <Pencil size={14} /> Edit
                      </ContextMenuItem>
                      <ContextMenuItem destructive onSelect={() => handleDelete(p.id)}>
                        <Trash2 size={14} /> Delete
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: Full Content Editor / View */}
      {(selectedPolicy || creating) && (
        <div className="flex-1 overflow-y-auto">
          {(creating || editing) ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">{editing ? "Edit Policy" : "New Policy"}</h2>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setCreating(false); setEditing(false); setForm({ title: "", content: "", category: "", requiresAck: true, effectiveDate: "" }); }}><X size={14} /></Button>
              </div>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Policy title..." className="text-lg font-semibold border-none p-0 h-auto focus-visible:ring-0" />
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="w-36 h-7 text-[10px]"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} className="w-36 h-7 text-[10px]" />
                <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                  <input type="checkbox" checked={form.requiresAck} onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })} className="rounded" />
                  Requires acknowledgment
                </label>
              </div>
              <RichEditor content={form.content} onChange={(html) => setForm({ ...form, content: html })} placeholder="Write the full policy here — use headings, lists, bold, links, images..." minHeight="calc(100vh - 280px)" />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setCreating(false); setEditing(false); setForm({ title: "", content: "", category: "", requiresAck: true, effectiveDate: "" }); }}>Cancel</Button>
                <Button size="sm" onClick={editing ? handleUpdate : handleCreate} disabled={saving || !form.title.trim() || !form.content.trim()} className="gap-1">
                  <Save size={12} /> {saving ? "Saving..." : editing ? "Save Changes" : "Publish"}
                </Button>
              </div>
            </div>
          ) : selectedPolicy ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold">{selectedPolicy.title}</h2>
                  {selectedPolicy.category && <Badge variant="outline" className="text-[9px]">{selectedPolicy.category}</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  {isManager && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-[color:var(--accent-strong)] hover:text-[#e2ff6b] hover:bg-[#e2ff6b]/10" onClick={() => startEditing(selectedPolicy)} title="Edit policy">
                      <Pencil size={14} />
                    </Button>
                  )}
                  {isManager && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => handleDelete(selectedPolicy.id)} title="Delete policy">
                      <Trash2 size={14} />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedPolicy(null)}><X size={14} /></Button>
                </div>
              </div>
              {isManager && (
                <div className="flex items-center gap-2 mb-3">
                  <Progress value={selectedPolicy.ackRate || 0} className="h-1 w-24" />
                  <span className="text-[10px] text-muted">{selectedPolicy.totalAcks || 0}/{selectedPolicy.totalUsers || 0} acknowledged</span>
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg p-5 bg-surface border border-border min-h-[calc(100vh-280px)]" dangerouslySetInnerHTML={{ __html: selectedPolicy.content }} />
              {selectedPolicy.requiresAck && !selectedPolicy.acknowledged && (
                <div className="mt-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                  <p className="text-xs text-muted mb-2">I confirm I have read and understood this policy.</p>
                  <Button size="sm" onClick={() => handleAcknowledge(selectedPolicy.id)} disabled={acknowledging === selectedPolicy.id} className="gap-1">
                    <CheckCircle2 size={12} /> {acknowledging === selectedPolicy.id ? "..." : "I Acknowledge"}
                  </Button>
                </div>
              )}
              {selectedPolicy.acknowledged && (
                <div className="mt-4 p-4 rounded-lg border border-green-500/20 bg-green-500/5">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 size={16} className="text-green-400 mt-0.5 shrink-0" />
                    <div className="space-y-1.5">
                      <p className="text-sm font-semibold text-green-400">Policy Acknowledged</p>
                      <div className="space-y-0.5">
                        {selectedPolicy.acknowledgedBy && (
                          <p className="text-xs text-foreground">
                            <span className="text-muted">Signed by:</span>{" "}
                            <span className="font-medium">{selectedPolicy.acknowledgedBy}</span>
                          </p>
                        )}
                        {selectedPolicy.acknowledgedEmail && (
                          <p className="text-xs text-muted">{selectedPolicy.acknowledgedEmail}</p>
                        )}
                        {selectedPolicy.acknowledgedAt && (
                          <p className="text-xs text-foreground">
                            <span className="text-muted">Date & Time:</span>{" "}
                            <span className="font-medium">{new Date(selectedPolicy.acknowledgedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</span>
                            <span className="text-muted"> at </span>
                            <span className="font-medium">{new Date(selectedPolicy.acknowledgedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
                          </p>
                        )}
                        {selectedPolicy.acknowledgedIp && (
                          <p className="text-xs text-muted">IP: {selectedPolicy.acknowledgedIp}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
