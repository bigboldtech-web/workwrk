"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Wrench, Plus, Share2, Eye, EyeOff, ExternalLink, Copy, Trash2, Users, X,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useRole } from "@/hooks/use-role";

const CATEGORIES = ["Communication", "Design", "Development", "Finance", "HR", "Marketing", "Sales", "Project Management", "Analytics", "Storage", "Other"];

interface Tool {
  id: string;
  name: string;
  description?: string;
  url?: string;
  icon?: string;
  category?: string;
  credentials?: { username?: string; password?: string; apiKey?: string; notes?: string };
  shares?: { userId: string; sharedAt: string }[];
  sharedAt?: string;
}

export default function ToolsPage() {
  const { isAdmin } = useRole();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showShare, setShowShare] = useState<Tool | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());
  // Show/hide toggles for the *create* form's credential fields. Without
  // this you can't verify what you pasted into a masked field — which
  // matters because the password you store here is what gets shared
  // with teammates verbatim.
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [showFormApiKey, setShowFormApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [shareUserIds, setShareUserIds] = useState<string[]>([]);
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();

  const [form, setForm] = useState({
    name: "", description: "", url: "", icon: "", category: "",
    username: "", password: "", apiKey: "", notes: "",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/tools").then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/users?limit=200").then((r) => r.ok ? r.json() : { data: [] }),
    ]).then(([t, u]) => {
      setTools(t?.data || []);
      setUsers(Array.isArray(u) ? u : u?.data || []);
    }).finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const credentials: any = {};
      if (form.username) credentials.username = form.username;
      if (form.password) credentials.password = form.password;
      if (form.apiKey) credentials.apiKey = form.apiKey;
      if (form.notes) credentials.notes = form.notes;

      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, description: form.description || null,
          url: form.url || null, icon: form.icon || null,
          category: form.category || null,
          credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ name: "", description: "", url: "", icon: "", category: "", username: "", password: "", apiKey: "", notes: "" });
        setShowFormPassword(false);
        setShowFormApiKey(false);
        const d = await fetch("/api/tools").then((r) => r.json());
        setTools(d?.data || []);
        toastSuccess("Tool added");
      } else {
        // Surface server errors instead of silently swallowing them.
        // Common case: 403 if the role can't manage tools, or 400
        // with a validation message. Keep the dialog + form data so
        // the user doesn't have to retype.
        const err = await res.json().catch(() => ({}));
        toastError(err?.error || `Failed to add tool (HTTP ${res.status})`);
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleShare() {
    if (!showShare || shareUserIds.length === 0) return;
    const res = await fetch(`/api/tools/${showShare.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: shareUserIds }),
    });
    if (res.ok) {
      const data = await res.json();
      toastSuccess(`Shared with ${(data.data || data).shared} people`);
      setShowShare(null);
      setShareUserIds([]);
      const d = await fetch("/api/tools").then((r) => r.json());
      setTools(d?.data || []);
    }
  }

  async function handleDelete(toolId: string) {
    if (!(await confirm({
      title: "Delete this tool?",
      description: "The tool entry and any stored credentials will be removed.",
      confirmLabel: "Delete",
      destructive: true,
    }))) return;
    await fetch(`/api/tools/${toolId}`, { method: "DELETE" });
    setTools(tools.filter((t) => t.id !== toolId));
    if (selectedTool?.id === toolId) setSelectedTool(null);
    toastSuccess("Tool deleted");
  }

  function togglePassword(toolId: string) {
    setShowPasswords((prev) => { const n = new Set(prev); n.has(toolId) ? n.delete(toolId) : n.add(toolId); return n; });
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toastSuccess("Copied!");
  }

  return (
    <div className="flex gap-0 h-[calc(100vh-64px)] animate-fade-in">
      {/* LEFT: Tools List */}
      <div className={`overflow-y-auto border-r border-border ${selectedTool ? "w-[35%]" : "w-full"} transition-all`}>
        <div className="p-3 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
          <div>
            <h1 className="text-lg font-bold">Tools & Apps</h1>
            <p className="text-[10px] text-muted">{tools.length} tools</p>
          </div>
          {isAdmin && <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1 text-xs"><Plus size={12} /> Add Tool</Button>}
        </div>

        {loading ? (
          <div className="p-3 space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 bg-surface-2 rounded animate-pulse" />)}</div>
        ) : tools.length === 0 ? (
          <div className="p-8 text-center">
            <Wrench size={32} className="mx-auto text-muted mb-2" />
            <p className="text-sm font-medium">{isAdmin ? "No tools added yet" : "No tools shared with you"}</p>
            <p className="text-xs text-muted">{isAdmin ? "Add company tools and share credentials with your team." : "Your admin will share tool access with you."}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tools.map((tool) => (
              <button key={tool.id} onClick={() => setSelectedTool(tool)}
                className={`w-full text-left p-3 hover:bg-surface-2 transition-colors ${selectedTool?.id === tool.id ? "bg-[rgba(212,255,46,0.06)] border-l-2 border-l-[#d4ff2e]" : ""}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-lg">{tool.icon || "🔧"}</span>
                  <span className="text-xs font-semibold truncate flex-1">{tool.name}</span>
                  {tool.shares && <Badge variant="outline" className="text-[8px]">{tool.shares.length} shared</Badge>}
                </div>
                <div className="flex items-center gap-1.5 ml-7">
                  {tool.category && <Badge variant="outline" className="text-[8px]">{tool.category}</Badge>}
                  {tool.sharedAt && <Badge variant="success" className="text-[8px]">Shared with you</Badge>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: Tool Details */}
      {selectedTool && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{selectedTool.icon || "🔧"}</span>
              <div>
                <h2 className="text-base font-bold">{selectedTool.name}</h2>
                {selectedTool.category && <Badge variant="outline" className="text-[9px]">{selectedTool.category}</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {isAdmin && <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => { setShowShare(selectedTool); setShareUserIds([]); }}><Share2 size={12} /> Share</Button>}
              {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => handleDelete(selectedTool.id)}><Trash2 size={12} /></Button>}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedTool(null)}><X size={14} /></Button>
            </div>
          </div>

          {selectedTool.description && <p className="text-sm text-muted">{selectedTool.description}</p>}

          {selectedTool.url && (
            <a href={selectedTool.url} target="_blank" rel="noopener" className="flex items-center gap-1.5 text-xs text-[#d4ff2e] hover:underline">
              <ExternalLink size={12} /> {selectedTool.url}
            </a>
          )}

          {/* Credentials */}
          {selectedTool.credentials && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold text-muted uppercase">Credentials</p>
                {selectedTool.credentials.username && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-muted">Username / Email</p>
                      <p className="text-sm font-mono">{selectedTool.credentials.username}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(selectedTool.credentials!.username!)}><Copy size={12} /></Button>
                  </div>
                )}
                {selectedTool.credentials.password && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-muted">Password</p>
                      <p className="text-sm font-mono">
                        {showPasswords.has(selectedTool.id) ? selectedTool.credentials.password : "••••••••••"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => togglePassword(selectedTool.id)}>
                        {showPasswords.has(selectedTool.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(selectedTool.credentials!.password!)}><Copy size={12} /></Button>
                    </div>
                  </div>
                )}
                {selectedTool.credentials.apiKey && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-muted">API Key</p>
                      <p className="text-sm font-mono truncate max-w-[300px]">
                        {showPasswords.has(selectedTool.id) ? selectedTool.credentials.apiKey : "••••••••••"}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(selectedTool.credentials!.apiKey!)}><Copy size={12} /></Button>
                  </div>
                )}
                {selectedTool.credentials.notes && (
                  <div>
                    <p className="text-[10px] text-muted">Notes</p>
                    <p className="text-xs text-muted">{selectedTool.credentials.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Shared With (admin view) */}
          {isAdmin && selectedTool.shares && selectedTool.shares.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <p className="text-xs font-semibold text-muted uppercase mb-2">Shared With ({selectedTool.shares.length})</p>
                <div className="space-y-1">
                  {selectedTool.shares.map((s: any) => {
                    const user = users.find((u: any) => u.id === s.userId);
                    return (
                      <div key={s.userId} className="flex items-center justify-between text-xs">
                        <span>{user ? `${user.firstName} ${user.lastName}` : s.userId}</span>
                        <span className="text-muted-2">{new Date(s.sharedAt).toLocaleDateString()}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create Tool Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Tool</DialogTitle></DialogHeader>
          <div className="space-y-3 py-4">
            <div className="grid grid-cols-[60px_1fr] gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Icon</Label>
                <Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="🔧" className="text-center text-lg h-10" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Slack, Figma, GitHub" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">URL</Label>
                <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is this tool used for?" className="h-8 text-xs" />
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs font-semibold text-muted">Credentials (optional)</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">Username / Email</Label>
                  <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="admin@company.com" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Password</Label>
                  <div className="relative">
                    <Input
                      type={showFormPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="paste or type"
                      className="h-8 text-xs pr-8 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowFormPassword((v) => !v)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground"
                      aria-label={showFormPassword ? "Hide password" : "Show password"}
                      tabIndex={-1}
                    >
                      {showFormPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">API Key (optional)</Label>
                <div className="relative">
                  <Input
                    type={showFormApiKey ? "text" : "password"}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="h-8 text-xs pr-8 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFormApiKey((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground"
                    aria-label={showFormApiKey ? "Hide API key" : "Show API key"}
                    tabIndex={-1}
                  >
                    {showFormApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any extra info..." className="h-8 text-xs" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={saving || !form.name.trim()}>{saving ? "Adding..." : "Add Tool"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog */}
      <Dialog open={!!showShare} onOpenChange={(open) => { if (!open) setShowShare(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Share "{showShare?.name}" with employees</DialogTitle></DialogHeader>
          <div className="py-4 space-y-2">
            <p className="text-xs text-muted">Selected employees will see this tool and its credentials in their Tools section.</p>
            <div className="max-h-60 overflow-y-auto border border-border rounded-md p-2 space-y-1">
              {users.map((u: any) => {
                const alreadyShared = showShare?.shares?.some((s: any) => s.userId === u.id);
                return (
                  <label key={u.id} className={`flex items-center gap-2 p-1.5 rounded hover:bg-surface-2 text-xs ${alreadyShared ? "opacity-40" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      disabled={alreadyShared}
                      checked={shareUserIds.includes(u.id)}
                      onChange={(e) => {
                        if (e.target.checked) setShareUserIds([...shareUserIds, u.id]);
                        else setShareUserIds(shareUserIds.filter((id) => id !== u.id));
                      }}
                      className="rounded"
                    />
                    {u.firstName} {u.lastName}
                    {alreadyShared && <span className="text-[10px] text-muted ml-auto">Already shared</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowShare(null)}>Cancel</Button>
            <Button size="sm" onClick={handleShare} disabled={shareUserIds.length === 0} className="gap-1">
              <Share2 size={12} /> Share with {shareUserIds.length} people
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
