"use client";

import { useState, useEffect } from "react";
import { RichEditor } from "@/components/ui/rich-editor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Shield, Plus, CheckCircle2, X, Save,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";

const CATEGORIES = ["HR", "Security", "Compliance", "Operations", "Code of Conduct", "Leave Policy", "Expense Policy", "Data Privacy", "Work From Home", "General"];

export default function PoliciesPage() {
  const { isManager } = useRole();
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();

  const [creating, setCreating] = useState(false);
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
        setPolicies(policies.map((p) => p.id === policyId ? { ...p, acknowledged: true, acknowledgedAt: new Date().toISOString() } : p));
        if (selectedPolicy?.id === policyId) setSelectedPolicy({ ...selectedPolicy, acknowledged: true, acknowledgedAt: new Date().toISOString() });
        toastSuccess("Policy acknowledged");
      }
    } catch { toastError("Failed"); } finally { setAcknowledging(null); }
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
          <div className="p-3 space-y-2">{[1,2,3].map((i) => <div key={i} className="h-12 bg-surface-2 rounded animate-pulse" />)}</div>
        ) : policies.length === 0 ? (
          <div className="p-8 text-center">
            <Shield size={32} className="mx-auto text-muted mb-2" />
            <p className="text-sm font-medium">No policies yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {policies.map((p) => (
              <button key={p.id} onClick={() => { setSelectedPolicy(p); setCreating(false); }}
                className={`w-full text-left p-3 hover:bg-surface-2 transition-colors ${selectedPolicy?.id === p.id ? "bg-purple-500/5 border-l-2 border-l-purple-500" : ""}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <Shield size={11} className="text-purple-400 shrink-0" />
                  <span className="text-xs font-semibold truncate flex-1">{p.title}</span>
                  {p.requiresAck && !p.acknowledged && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
                </div>
                <div className="flex items-center gap-1.5 ml-5">
                  {p.category && <Badge variant="outline" className="text-[8px]">{p.category}</Badge>}
                  {p.acknowledged && <Badge variant="success" className="text-[8px]">Done</Badge>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: Full Content Editor / View */}
      {(selectedPolicy || creating) && (
        <div className="flex-1 overflow-y-auto">
          {creating ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">New Policy</h2>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCreating(false)}><X size={14} /></Button>
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
                <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={saving || !form.title.trim() || !form.content.trim()} className="gap-1">
                  <Save size={12} /> {saving ? "Publishing..." : "Publish"}
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
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedPolicy(null)}><X size={14} /></Button>
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
                <p className="text-xs text-green-400 mt-3 flex items-center gap-1"><CheckCircle2 size={12} /> Acknowledged {new Date(selectedPolicy.acknowledgedAt).toLocaleDateString()}</p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
