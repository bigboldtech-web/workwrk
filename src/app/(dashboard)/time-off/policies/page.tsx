"use client";

// Time-off policy management. Admin-only via the layout guard.
// Create / rename / archive / delete policies.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { ChevronLeft, Plus, MoreHorizontal, Archive, ArchiveRestore, Trash2, Pencil } from "lucide-react";

type Policy = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  description: string | null;
  annualHours: number;
  carryoverHours: number;
  requiresApproval: boolean;
  archived: boolean;
};

const TYPES = ["PTO", "SICK", "PERSONAL", "BEREAVEMENT", "PARENTAL", "UNPAID", "OTHER"] as const;

export default function TimeOffPoliciesPage() {
  const { toast } = useToast();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/time-off-policies?includeArchived=1");
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load policies" });
        return;
      }
      setPolicies(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function archive(id: string, archived: boolean) {
    const res = await fetch(`/api/time-off-policies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    toast({ type: "success", title: archived ? "Archived" : "Unarchived" });
    load();
  }

  async function deletePolicy(id: string) {
    if (!confirm("Delete this policy? This is only possible if no requests reference it.")) return;
    const res = await fetch(`/api/time-off-policies/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't delete", description: data?.error });
      return;
    }
    toast({ type: "success", title: "Deleted" });
    load();
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/time-off"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg mb-3"
        >
          <ChevronLeft size={12} /> Back to time off
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Time-off policies</h1>
            <p className="text-muted text-sm mt-1">
              Annual hours, approval rules, and labels for each leave type.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={14} className="mr-1.5" /> New policy
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted text-center py-8">Loading…</p>
      ) : policies.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted">
            No policies yet. Click <strong>New policy</strong> to start.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Name</th>
                  <th className="px-4 py-2.5 font-normal">Type</th>
                  <th className="px-4 py-2.5 font-normal text-right">Annual hrs</th>
                  <th className="px-4 py-2.5 font-normal">Approval</th>
                  <th className="px-4 py-2.5 font-normal">State</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {p.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />}
                        <span className="font-medium">{p.name}</span>
                      </div>
                      {p.description && <p className="text-[10px] text-muted mt-0.5">{p.description}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{p.type}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {p.annualHours.toFixed(0)}h
                      {p.carryoverHours > 0 && (
                        <span className="text-muted"> · {p.carryoverHours.toFixed(0)}h roll</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {p.requiresApproval ? "Manager" : <span className="text-muted">Auto</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${p.archived ? "text-muted border-white/20" : "text-green-400 border-green-400/30"}`}>
                        {p.archived ? "Archived" : "Active"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreHorizontal size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(p)}>
                            <Pencil size={12} className="mr-2" /> Edit
                          </DropdownMenuItem>
                          {p.archived ? (
                            <DropdownMenuItem onSelect={() => archive(p.id, false)}>
                              <ArchiveRestore size={12} className="mr-2" /> Unarchive
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => archive(p.id, true)}>
                              <Archive size={12} className="mr-2" /> Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => deletePolicy(p.id)} className="text-red-400">
                            <Trash2 size={12} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {creating && (
        <PolicyDialog
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {editing && (
        <PolicyDialog
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function PolicyDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing?: Policy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<string>(existing?.type ?? "PTO");
  const [annualHours, setAnnualHours] = useState(String(existing?.annualHours ?? 120));
  const [carryoverHours, setCarryoverHours] = useState(String(existing?.carryoverHours ?? 0));
  const [requiresApproval, setRequiresApproval] = useState(existing?.requiresApproval ?? true);
  const [color, setColor] = useState(existing?.color ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const url = existing ? `/api/time-off-policies/${existing.id}` : "/api/time-off-policies";
      const method = existing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          annualHours: Number(annualHours),
          carryoverHours: Number(carryoverHours),
          requiresApproval,
          color: color.trim() || null,
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      toast({ type: "success", title: existing ? "Updated" : "Created" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const valid = name.trim() && Number(annualHours) >= 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{existing ? "Edit policy" : "New policy"}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paid Time Off" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Color (hex, optional)</Label>
              <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#22c55e" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Annual hours</Label>
              <Input value={annualHours} onChange={(e) => setAnnualHours(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label>Carryover</Label>
              <Input value={carryoverHours} onChange={(e) => setCarryoverHours(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input
              id="requiresApproval"
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
            />
            <label htmlFor="requiresApproval">Requires manager approval</label>
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={save}>
            {saving ? "Saving…" : existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
