"use client";

import { useState, useEffect } from "react";
import { RichEditor } from "@/components/ui/rich-editor";
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
  Shield, Plus, CheckCircle2, FileText, Users, AlertCircle, ChevronDown, ChevronRight,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";

const CATEGORIES = ["HR", "Security", "Compliance", "Operations", "Code of Conduct", "Leave Policy", "Expense Policy", "Data Privacy", "Work From Home", "General"];

export default function PoliciesPage() {
  const { isManager } = useRole();
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "", requiresAck: true, effectiveDate: "" });
  const [saving, setSaving] = useState(false);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetch("/api/policies")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setPolicies(d.data); })
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
        setPolicies([data.data || data, ...policies]);
        setShowCreate(false);
        setForm({ title: "", content: "", category: "", requiresAck: true, effectiveDate: "" });
        toastSuccess("Policy published");
      }
    } catch { toastError("Failed to publish policy"); } finally { setSaving(false); }
  }

  async function handleAcknowledge(policyId: string) {
    setAcknowledging(policyId);
    try {
      const res = await fetch(`/api/policies/${policyId}/acknowledge`, { method: "POST" });
      if (res.ok) {
        setPolicies(policies.map((p) => p.id === policyId ? { ...p, acknowledged: true, acknowledgedAt: new Date().toISOString() } : p));
        toastSuccess("Policy acknowledged");
      }
    } catch { toastError("Failed to acknowledge"); } finally { setAcknowledging(null); }
  }

  const pendingAcks = policies.filter((p) => p.requiresAck && !p.acknowledged).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Policies & Bylaws</h1>
          <p className="text-muted text-sm mt-1">
            {policies.length} policies {pendingAcks > 0 && <span className="text-amber-400">&middot; {pendingAcks} pending acknowledgment</span>}
          </p>
        </div>
        {isManager && (
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus size={14} /> New Policy
          </Button>
        )}
      </div>

      {/* Pending acknowledgments alert */}
      {pendingAcks > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-400 shrink-0" />
            <p className="text-sm">You have <strong>{pendingAcks}</strong> polic{pendingAcks === 1 ? "y" : "ies"} that require your acknowledgment.</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-20 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}</div>
      ) : policies.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Shield size={40} className="mx-auto text-muted mb-3" />
          <p className="font-medium mb-1">No policies yet</p>
          <p className="text-sm text-muted">Create company policies, bylaws, and guidelines for your team.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {policies.map((policy) => {
            const isExpanded = expandedId === policy.id;
            return (
              <Card key={policy.id} className={`${policy.requiresAck && !policy.acknowledged ? "border-amber-500/20" : ""}`}>
                <div className="p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : policy.id)}>
                  <div className="flex items-start gap-3">
                    <button className="mt-1 shrink-0 text-muted">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <Shield size={16} className="mt-1 text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold">{policy.title}</h3>
                        {policy.category && <Badge variant="outline" className="text-[10px]">{policy.category}</Badge>}
                        {policy.acknowledged ? (
                          <Badge variant="success" className="text-[10px]">Acknowledged</Badge>
                        ) : policy.requiresAck ? (
                          <Badge variant="warning" className="text-[10px]">Action Required</Badge>
                        ) : null}
                      </div>
                      {isManager && (
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={policy.ackRate} className="h-1 w-24" />
                          <span className="text-[10px] text-muted">{policy.totalAcks}/{policy.totalUsers} acknowledged ({policy.ackRate}%)</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted shrink-0">v{policy.version}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-12 py-4">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: policy.content }} />
                    </div>
                    {policy.effectiveDate && (
                      <p className="text-xs text-muted mt-3">Effective: {new Date(policy.effectiveDate).toLocaleDateString()}</p>
                    )}
                    {policy.requiresAck && !policy.acknowledged && (
                      <div className="mt-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                        <p className="text-xs text-muted mb-2">By clicking below, you confirm that you have read and understood this policy.</p>
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); handleAcknowledge(policy.id); }} disabled={acknowledging === policy.id} className="gap-1.5">
                          <CheckCircle2 size={14} /> {acknowledging === policy.id ? "Acknowledging..." : "I Acknowledge"}
                        </Button>
                      </div>
                    )}
                    {policy.acknowledged && policy.acknowledgedAt && (
                      <p className="text-xs text-green-400 mt-3 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Acknowledged on {new Date(policy.acknowledgedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Policy Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Policy</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title <span className="text-red-400">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., Work From Home Policy" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Content <span className="text-red-400">*</span></Label>
              <RichEditor content={form.content} onChange={(html) => setForm({ ...form, content: html })} placeholder="Write the full policy text here..." minHeight="250px" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.requiresAck} onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })} className="rounded" />
              <span className="text-sm">Require employees to acknowledge this policy</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title.trim() || !form.content.trim()}>
              {saving ? "Publishing..." : "Publish Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
