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
  Megaphone, Plus, Pin, PinOff, Trash2, AlertTriangle, PartyPopper, FileText, Calendar, Copy,
  Clock, Globe, Building2, Users as UsersIcon, CheckCircle2, ShieldCheck,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/dashboard/page-header";

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

type AudienceMode = "ALL" | "DEPARTMENTS" | "OFFICES" | "USERS";
type TargetAudience =
  | { mode: "ALL" }
  | { mode: "DEPARTMENTS"; departmentIds: string[] }
  | { mode: "OFFICES"; officeIds: string[] }
  | { mode: "USERS"; userIds: string[] };

interface DeptOption { id: string; name: string }
interface OfficeOption { id: string; name: string; city?: string | null; country?: string | null }
interface UserOption { id: string; firstName: string; lastName: string; role?: { title: string } | null }

function describeAudience(a: TargetAudience | null | undefined, counts: { depts: number; offices: number; users: number } | null): string {
  if (!a || a.mode === "ALL") return "Everyone";
  if (a.mode === "DEPARTMENTS") {
    const n = (a as Extract<TargetAudience, { mode: "DEPARTMENTS" }>).departmentIds.length;
    return n === 0 ? "Everyone" : `${n} dept${n === 1 ? "" : "s"}`;
  }
  if (a.mode === "OFFICES") {
    const n = (a as Extract<TargetAudience, { mode: "OFFICES" }>).officeIds.length;
    return n === 0 ? "Everyone" : `${n} office${n === 1 ? "" : "s"}`;
  }
  if (a.mode === "USERS") {
    const n = (a as Extract<TargetAudience, { mode: "USERS" }>).userIds.length;
    return n === 0 ? "Everyone" : `${n} person${n === 1 ? "" : "s"}`;
  }
  // Unknown shape — degrade gracefully rather than throw.
  void counts;
  return "Custom audience";
}

export default function AnnouncementsPage() {
  const { isManager } = useRole();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", type: "INFO", priority: "NORMAL", pinned: false, mustAcknowledge: false, expiresAt: "" });
  // Audience + scheduling are separate state slices so the form object
  // can stay a flat string-keyed bag (re-used by API).
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("ALL");
  const [audienceDepts, setAudienceDepts] = useState<string[]>([]);
  const [audienceOffices, setAudienceOffices] = useState<string[]>([]);
  const [audienceUsers, setAudienceUsers] = useState<string[]>([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  // Lookups for the audience picker. Lazy-loaded when the dialog opens.
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [offices, setOffices] = useState<OfficeOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();
  const t = useTranslations("announcements");
  const tCommon = useTranslations("common");

  function resetForm() {
    setForm({ title: "", content: "", type: "INFO", priority: "NORMAL", pinned: false, mustAcknowledge: false, expiresAt: "" });
    setAudienceMode("ALL");
    setAudienceDepts([]);
    setAudienceOffices([]);
    setAudienceUsers([]);
    setScheduleEnabled(false);
    setScheduleAt("");
  }

  // Hydrate audience-picker lookups the first time the create dialog
  // opens. Three parallel fetches; failures keep that list empty so the
  // user can still pick from whichever lookups succeeded.
  useEffect(() => {
    if (!showCreate || lookupsLoaded || !isManager) return;
    Promise.all([
      fetch("/api/departments").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/offices").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/users?limit=500").then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
    ]).then(([d, o, u]) => {
      setDepts(Array.isArray(d) ? d : d?.data || []);
      setOffices(Array.isArray(o) ? o : o?.data || []);
      setUsers(Array.isArray(u) ? u : u?.data || []);
      setLookupsLoaded(true);
    });
  }, [showCreate, lookupsLoaded, isManager]);

  useEffect(() => {
    fetch("/api/announcements", { cache: "no-store" })
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

  async function handleAcknowledge(id: string) {
    // Optimistic — flip the local row immediately so the button doesn't
    // wobble. On failure, refetch to reconcile with server state.
    setAnnouncements((prev) => prev.map((x) => (x.id === id ? { ...x, ackedByMe: true, ackedAt: new Date().toISOString() } : x)));
    try {
      const res = await fetch(`/api/announcements/${id}/acknowledge`, { method: "POST" });
      if (!res.ok) throw new Error("ack failed");
      toastSuccess("Acknowledged");
    } catch {
      toastError("Failed to acknowledge");
      const refresh = await fetch("/api/announcements", { cache: "no-store" });
      if (refresh.ok) {
        const d = await refresh.json();
        setAnnouncements(Array.isArray(d) ? d : d?.data || []);
      }
    }
  }

  async function handleTogglePin(a: any) {
    try {
      const res = await fetch(`/api/announcements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !a.pinned }),
      });
      if (res.ok) {
        setAnnouncements((prev) => prev.map((x) => (x.id === a.id ? { ...x, pinned: !a.pinned } : x)));
        toastSuccess(a.pinned ? "Unpinned" : "Pinned");
      } else { toastError("Failed to update"); }
    } catch { toastError("Failed to update"); }
  }

  async function handleDeleteAnnouncement(id: string) {
    if (!(await confirm({
      title: "Delete this announcement?",
      description: "It will be removed from everyone's feed. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    }))) return;
    try {
      const res = await fetch(`/api/announcements/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAnnouncements((prev) => prev.filter((x) => x.id !== id));
        toastSuccess("Deleted");
      } else { toastError("Failed to delete"); }
    } catch { toastError("Failed to delete"); }
  }

  // Build the JSON payload for `targetAudience`. ALL with no selection
  // stays null so the API stores `undefined` and the post broadcasts.
  function buildAudiencePayload(): TargetAudience | null {
    if (audienceMode === "ALL") return null;
    if (audienceMode === "DEPARTMENTS" && audienceDepts.length > 0)
      return { mode: "DEPARTMENTS", departmentIds: audienceDepts };
    if (audienceMode === "OFFICES" && audienceOffices.length > 0)
      return { mode: "OFFICES", officeIds: audienceOffices };
    if (audienceMode === "USERS" && audienceUsers.length > 0)
      return { mode: "USERS", userIds: audienceUsers };
    return null;
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.content.trim() || !form.expiresAt) return;
    if (scheduleEnabled && !scheduleAt) {
      toastError("Pick a publish time, or turn off scheduling");
      return;
    }
    const targetAudience = buildAudiencePayload();
    setSaving(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          expiresAt: form.expiresAt,
          targetAudience,
          publishedAt: scheduleEnabled && scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
        }),
      });
      if (res.ok) {
        // Refetch all announcements to get consistent data
        const refreshRes = await fetch("/api/announcements", { cache: "no-store" });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          const items = refreshData?.data || refreshData || [];
          setAnnouncements(Array.isArray(items) ? items : []);
        }
        setShowCreate(false);
        resetForm();
        toastSuccess(scheduleEnabled ? "Announcement scheduled" : "Announcement published");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to publish");
      }
    } catch { toastError("Failed to publish"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: t("title") }]}
        kicker="Comms · announcements"
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          isManager
            ? [{ label: t("newAnnouncement"), onClick: () => setShowCreate(true), icon: <Plus size={14} /> }]
            : undefined
        }
      />

      {loading ? (
        <div className="space-y-3">{[1,2,3].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-16 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}</div>
      ) : announcements.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Megaphone size={40} className="mx-auto text-muted mb-3" />
          <p className="font-medium mb-1">{t("noAnnouncements")}</p>
          <p className="text-sm text-muted">{t("noAnnouncementsHint")}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => {
            const publishedAt = a.publishedAt ? new Date(a.publishedAt) : null;
            const isScheduled = !!publishedAt && publishedAt.getTime() > Date.now();
            const audience: TargetAudience | null = a.targetAudience ?? null;
            const audienceLabel = describeAudience(audience, null);
            return (
            <ContextMenu key={a.id}>
              <ContextMenuTrigger asChild>
                <Card className={isScheduled ? "border-dashed opacity-90" : undefined}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Megaphone size={16} className="mt-1 text-[color:var(--accent-strong)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="text-sm font-semibold">{a.title}</h3>
                          <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                          <Badge variant={a.priority === "URGENT" ? "destructive" : "secondary"} className="text-[10px]">{a.priority}</Badge>
                          {a.pinned && <Pin size={12} className="text-[color:var(--accent-strong)]" aria-label="Pinned" />}
                          <Badge variant="outline" className="text-[10px] gap-1">
                            {audience?.mode === "DEPARTMENTS" ? <Building2 size={9} /> :
                              audience?.mode === "OFFICES" ? <Building2 size={9} /> :
                              audience?.mode === "USERS" ? <UsersIcon size={9} /> :
                              <Globe size={9} />}
                            {audienceLabel}
                          </Badge>
                          {isScheduled && (
                            <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300">
                              <Clock size={9} />
                              Scheduled · {publishedAt!.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </Badge>
                          )}
                          {a.mustAcknowledge && (
                            <Badge variant="outline" className="text-[10px] gap-1 text-[color:var(--accent-strong)] border-[color:var(--accent-strong)]">
                              <ShieldCheck size={9} />
                              {a.ackedByMe ? "Acknowledged" : "Acknowledgement required"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted whitespace-pre-wrap">{a.content}</p>
                        <div className="flex items-center justify-between mt-2 gap-3">
                          <p className="text-[10px] text-muted-2">
                            {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {a.expiresAt && ` · Expires ${new Date(a.expiresAt).toLocaleDateString()}`}
                          </p>
                          {a.mustAcknowledge && !a.ackedByMe && !isScheduled && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => handleAcknowledge(a.id)}>
                              <CheckCircle2 size={12} /> I acknowledge
                            </Button>
                          )}
                          {a.mustAcknowledge && a.ackedByMe && (
                            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-2">
                              <CheckCircle2 size={11} className="text-emerald-500" />
                              You acknowledged {a.ackedAt ? `· ${new Date(a.ackedAt).toLocaleDateString()}` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuLabel>Announcement</ContextMenuLabel>
                <ContextMenuItem onSelect={() => { navigator.clipboard.writeText(`${a.title}\n\n${a.content}`).catch(() => {}); }}>
                  <Copy size={14} /> Copy text
                </ContextMenuItem>
                {isManager && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => handleTogglePin(a)}>
                      {a.pinned ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin to top</>}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem destructive onSelect={() => handleDeleteAnnouncement(a.id)}>
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("newAnnouncement")}</DialogTitle></DialogHeader>
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
                <Label>Expires On <span className="text-red-400">*</span></Label>
                <Input
                  type="date"
                  required
                  min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                />
              </div>
              <div className="flex flex-col items-start gap-2 pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="rounded" />
                  <span className="text-sm">Pin announcement</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" title="Recipients must explicitly acknowledge this announcement">
                  <input type="checkbox" checked={form.mustAcknowledge} onChange={(e) => setForm({ ...form, mustAcknowledge: e.target.checked })} className="rounded" />
                  <span className="text-sm inline-flex items-center gap-1.5">
                    <ShieldCheck size={12} className="text-[color:var(--accent-strong)]" /> Require acknowledgement
                  </span>
                </label>
              </div>
            </div>

            {/* Audience targeting. ALL is the default (matches old
                behavior); switching to DEPARTMENTS/OFFICES/USERS opens
                an inline picker for that lookup. Empty selection falls
                back to "everyone" on submit. */}
            <div className="space-y-2 border-t border-border pt-3">
              <Label className="flex items-center gap-1.5">
                <UsersIcon size={12} className="text-muted" /> Audience
              </Label>
              <div className="inline-flex rounded-md border border-border p-0.5 bg-surface-2 w-full">
                {([
                  { id: "ALL" as const, label: "Everyone", Icon: Globe },
                  { id: "DEPARTMENTS" as const, label: "Departments", Icon: Building2 },
                  { id: "OFFICES" as const, label: "Offices", Icon: Building2 },
                  { id: "USERS" as const, label: "People", Icon: UsersIcon },
                ]).map((m) => {
                  const active = audienceMode === m.id;
                  const Icon = m.Icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAudienceMode(m.id)}
                      className={
                        "flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11.5px] font-medium transition-colors " +
                        (active
                          ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]"
                          : "text-muted hover:bg-surface-3 hover:text-foreground")
                      }
                      aria-pressed={active}
                    >
                      <Icon size={11} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
              {audienceMode === "DEPARTMENTS" && (
                <CheckboxList
                  items={depts.map((d) => ({ id: d.id, label: d.name }))}
                  selected={audienceDepts}
                  onChange={setAudienceDepts}
                  emptyLabel="No departments to pick from"
                />
              )}
              {audienceMode === "OFFICES" && (
                <CheckboxList
                  items={offices.map((o) => ({
                    id: o.id,
                    label: o.city ? `${o.name} — ${o.city}` : o.name,
                  }))}
                  selected={audienceOffices}
                  onChange={setAudienceOffices}
                  emptyLabel="No offices to pick from"
                />
              )}
              {audienceMode === "USERS" && (
                <CheckboxList
                  items={users.map((u) => ({
                    id: u.id,
                    label: `${u.firstName} ${u.lastName}${u.role?.title ? ` · ${u.role.title}` : ""}`,
                  }))}
                  selected={audienceUsers}
                  onChange={setAudienceUsers}
                  searchable
                  emptyLabel="No people to pick from"
                />
              )}
              {audienceMode !== "ALL" && (
                <p className="text-[10.5px] text-muted-2">
                  Leave empty to broadcast to everyone.
                </p>
              )}
            </div>

            {/* Scheduling. Off by default — flipping it on shows a
                datetime input that must be in the future. Past values
                fall back to "publish now" server-side. */}
            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  className="rounded"
                />
                <span className="text-[12.5px] font-medium inline-flex items-center gap-1.5">
                  <Clock size={12} className="text-muted" /> Schedule for later
                </span>
              </label>
              {scheduleEnabled && (
                <Input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  min={new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{tCommon("cancel")}</Button>
            <Button
              onClick={handleCreate}
              disabled={
                saving
                || !form.title.trim()
                || !form.content.trim()
                || !form.expiresAt
                || (scheduleEnabled && !scheduleAt)
              }
            >
              {saving
                ? (scheduleEnabled ? "Scheduling…" : t("publishing"))
                : (scheduleEnabled ? "Schedule" : t("publish"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Generic scrollable checkbox list used by the audience picker. Items
// render in their given order; `searchable` adds a tiny input that
// filters by label substring (useful when there are 100+ users).
function CheckboxList({
  items,
  selected,
  onChange,
  searchable,
  emptyLabel,
}: {
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  searchable?: boolean;
  emptyLabel: string;
}) {
  const [q, setQ] = useState("");
  const lc = q.trim().toLowerCase();
  const visible = lc ? items.filter((i) => i.label.toLowerCase().includes(lc)) : items;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="border border-border rounded-md bg-surface">
      {searchable && (
        <div className="border-b border-border p-1.5">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-7 text-[12px]"
          />
        </div>
      )}
      <div className="max-h-40 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-[11.5px] text-muted-2 text-center">{emptyLabel}</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-3 text-[11.5px] text-muted-2 text-center">No matches.</p>
        ) : (
          visible.map((i) => {
            const checked = selected.includes(i.id);
            return (
              <label
                key={i.id}
                className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] cursor-pointer hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(i.id)}
                  className="rounded"
                />
                <span className="truncate">{i.label}</span>
              </label>
            );
          })
        )}
      </div>
      {selected.length > 0 && (
        <div className="border-t border-border px-2 py-1 flex items-center justify-between text-[10.5px] text-muted">
          <span>{selected.length} selected</span>
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
