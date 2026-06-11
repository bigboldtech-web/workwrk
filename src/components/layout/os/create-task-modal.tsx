"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  X,
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Flag,
  Tag,
  MoreHorizontal,
  Wand2,
  Paperclip,
  Bell,
  Search,
  Check,
  ListChecks,
  CircleDot,
  Diamond,
  ClipboardList,
  MessageSquareText,
  Loader2,
  Hourglass,
  GitFork,
  ListTree,
  ListChecks as ChecklistIcon,
  Plus,
  Ban,
  FileUp,
  RefreshCw,
  Save,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { useRouter } from "next/navigation";
import { Chip, StatusChip } from "@/components/ui/chip";
import { TAUPE, taupeButton } from "@/components/ui/accent";

// ── Task types ─────────────────────────────────────────────────────
// No `type` column on Item — the chosen type is persisted into
// Item.metadata.taskType. Each type re-skins the form to mirror ClickUp.
type TaskTypeKey = "TASK" | "MILESTONE" | "FORM_RESPONSE" | "MEETING_NOTE";
const TASK_TYPES: { key: TaskTypeKey; label: string; Icon: typeof CircleDot }[] = [
  { key: "TASK", label: "Task", Icon: CircleDot },
  { key: "MILESTONE", label: "Milestone", Icon: Diamond },
  { key: "FORM_RESPONSE", label: "Form Response", Icon: ClipboardList },
  { key: "MEETING_NOTE", label: "Meeting Note", Icon: MessageSquareText },
];

// ── Statuses (resolved from the selected list's Space) ─────────────
type StatusGroup = "ACTIVE" | "DONE" | "CLOSED";
type StatusDef = { key: string; label: string; group: StatusGroup; color: string };
const FALLBACK_STATUSES: StatusDef[] = [
  { key: "TO_DO", label: "TO DO", group: "ACTIVE", color: "#71717A" },
  { key: "IN_PROGRESS", label: "IN PROGRESS", group: "ACTIVE", color: "#6366F1" },
  { key: "COMPLETE", label: "COMPLETE", group: "DONE", color: "#10B981" },
];
const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  ACTIVE: "Statuses",
  DONE: "Done",
  CLOSED: "Closed",
};

// ── Priority ───────────────────────────────────────────────────────
type PriorityKey = "URGENT" | "HIGH" | "NORMAL" | "LOW";
const PRIORITIES: { key: PriorityKey; label: string; color: string }[] = [
  { key: "URGENT", label: "Urgent", color: "#ef4444" },
  { key: "HIGH", label: "High", color: "#eab308" },
  { key: "NORMAL", label: "Normal", color: "#3b82f6" },
  { key: "LOW", label: "Low", color: "#94a3b8" },
];

type SpaceRow = { id: string; name: string; icon: string | null; color: string | null };
type BoardRow = { id: string; slug: string; name: string; spaceId: string | null };
type SelectedList = { id: string; slug: string; name: string; spaceId: string | null };
type Person = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; avatar?: string | null };
type ChecklistItem = { text: string; done: boolean };
type ExtraKey = "TIME_ESTIMATE" | "DEPENDENCIES" | "SUBTASKS" | "CHECKLIST";
type MenuKey =
  | "list" | "type" | "status" | "assignee" | "due"
  | "priority" | "tags" | "more" | "attach" | "followers"
  | "templates" | "createMenu";

function firstActiveKey(list: StatusDef[]): string {
  return (list.find((s) => s.group === "ACTIVE") ?? list[0])?.key ?? "TO_DO";
}
function personName(p: Person): string {
  const n = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return n || p.email || "Unknown";
}
function initials(p: Person): string {
  const f = (p.firstName ?? "").charAt(0);
  const l = (p.lastName ?? "").charAt(0);
  const fallback = (p.email ?? "?").charAt(0);
  return (f + l).toUpperCase() || fallback.toUpperCase();
}
// Stable per-person hue (djb2) so avatars are consistent.
function hueFor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return `hsl(${Math.abs(h) % 360} 55% 55%)`;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

function Avatar({ person, size = 24 }: { person: Person; size?: number }) {
  const s = { width: size, height: size };
  if (person.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={person.avatar} alt={personName(person)} style={s} className="rounded-full object-cover shrink-0" />;
  }
  return (
    <span
      style={{ ...s, backgroundColor: hueFor(person.id) }}
      className="rounded-full flex items-center justify-center text-white font-semibold text-[10px] shrink-0"
    >
      {initials(person)}
    </span>
  );
}

// Reusable people picker (single for assignee, multi for followers).
function PeoplePicker({
  people, me, selected, onToggle, position = "top",
}: {
  people: Person[];
  me: Person | null;
  selected: string[];
  onToggle: (id: string) => void;
  position?: "top" | "bottom";
}) {
  const [q, setQ] = useState("");
  const ordered = useMemo(() => {
    const seen = new Set<string>();
    const out: Person[] = [];
    if (me) { out.push(me); seen.add(me.id); }
    for (const p of people) { if (!seen.has(p.id)) { out.push(p); seen.add(p.id); } }
    const needle = q.trim().toLowerCase();
    if (!needle) return out;
    return out.filter((p) => personName(p).toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle));
  }, [people, me, q]);
  return (
    <div className={`absolute ${position === "top" ? "bottom-full mb-1" : "top-full mt-1"} left-0 w-[300px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] overflow-hidden`}>
      <div className="p-2 border-b border-zinc-100">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[#c39b8c]">
          <Search className="w-3.5 h-3.5 text-zinc-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or enter email..." className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400" />
        </div>
      </div>
      <div className="max-h-[260px] overflow-y-auto px-1.5 py-1">
        <div className="px-2.5 py-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">People</div>
        {ordered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors"
          >
            <Avatar person={p} />
            <span className="flex-1 truncate">{me && p.id === me.id ? "Me" : personName(p)}</span>
            {selected.includes(p.id) && <Check className="w-3.5 h-3.5 text-[#a78b80]" />}
          </button>
        ))}
        {ordered.length === 0 && <div className="px-4 py-4 text-center text-[13px] text-zinc-400">No people found.</div>}
      </div>
    </div>
  );
}

export function CreateTaskModal() {
  const { createTaskOpen, closeCreateTask } = useOsShell();
  const router = useRouter();
  const { data: session } = useSession();
  const me: Person | null = useMemo(() => {
    const u = session?.user as (Person & { id?: string }) | undefined;
    return u?.id ? { id: u.id, firstName: u.firstName, lastName: u.lastName, avatar: u.avatar ?? null } : null;
  }, [session]);

  // Core
  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<TaskTypeKey>("TASK");
  const [selectedList, setSelectedList] = useState<SelectedList | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>("TO_DO");

  // Toolbar values
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<Date | null>(null);
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [priority, setPriority] = useState<PriorityKey | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const [timeEstimate, setTimeEstimate] = useState<{ h: string; m: string }>({ h: "", m: "" });
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [extras, setExtras] = useState<ExtraKey[]>([]);

  // Data
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [statusCache, setStatusCache] = useState<Record<string, StatusDef[]>>({});

  // UI
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [listSearch, setListSearch] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [checklistDraft, setChecklistDraft] = useState("");
  const [dateField, setDateField] = useState<"start" | "due">("due");
  const today = useMemo(() => startOfDay(new Date()), []);
  const [calMonth, setCalMonth] = useState<{ y: number; m: number }>({ y: today.getFullYear(), m: today.getMonth() });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // Attachments — uploaded immediately (so we have FileEntry ids), then
  // linked to the new Item via EntityLink once it's created.
  const [stagedFiles, setStagedFiles] = useState<{ id: string; name: string; mimeType: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Templates — org-shared task presets.
  type TemplateRow = { id: string; name: string; config: Record<string, unknown> };
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [tplMode, setTplMode] = useState<"root" | "use" | "instant" | "update" | "save">("root");
  const [tplNameDraft, setTplNameDraft] = useState("");

  const activeType = TASK_TYPES.find((t) => t.key === taskType) ?? TASK_TYPES[0];

  const statuses = useMemo<StatusDef[]>(() => {
    if (selectedList?.spaceId && statusCache[selectedList.spaceId]) return statusCache[selectedList.spaceId];
    return FALLBACK_STATUSES;
  }, [selectedList, statusCache]);
  const selectedStatusDef = statuses.find((s) => s.key === selectedStatus) ?? statuses[0] ?? FALLBACK_STATUSES[0];

  const assignee = useMemo(() => {
    if (!assigneeId) return null;
    if (me && me.id === assigneeId) return me;
    return people.find((p) => p.id === assigneeId) ?? null;
  }, [assigneeId, me, people]);

  // ── Load lists + people once on first open ──
  useEffect(() => {
    if (!createTaskOpen || loadedRef.current) return;
    loadedRef.current = true;
    setLoadingLists(true);
    Promise.all([
      fetch("/api/spaces", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { spaces: [] })),
      fetch("/api/boards?all=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { boards: [] })),
      fetch("/api/users?scope=all&limit=200", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/item-templates", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { templates: [] })),
    ])
      .then(([s, b, u, t]) => {
        setSpaces(Array.isArray(s.spaces) ? s.spaces : []);
        setBoards(Array.isArray(b.boards) ? b.boards : []);
        setPeople(Array.isArray(u.data) ? u.data : []);
        setTemplates(Array.isArray(t.templates) ? t.templates : []);
      })
      .catch(() => {})
      .finally(() => setLoadingLists(false));
  }, [createTaskOpen]);

  // Default followers to the creator once we know who that is.
  useEffect(() => {
    if (me && followers.length === 0) setFollowers([me.id]);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve status palette for the selected list's Space ──
  useEffect(() => {
    const spaceId = selectedList?.spaceId;
    if (!spaceId) { setSelectedStatus(firstActiveKey(FALLBACK_STATUSES)); return; }
    if (statusCache[spaceId]) { setSelectedStatus(firstActiveKey(statusCache[spaceId])); return; }
    let alive = true;
    fetch(`/api/spaces/${spaceId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        const raw = data?.space?.settings?.workflow?.statuses;
        const palette: StatusDef[] = Array.isArray(raw) && raw.length > 0 ? (raw as StatusDef[]) : FALLBACK_STATUSES;
        setStatusCache((prev) => ({ ...prev, [spaceId]: palette }));
        setSelectedStatus(firstActiveKey(palette));
      })
      .catch(() => { if (alive) setSelectedStatus(firstActiveKey(FALLBACK_STATUSES)); });
    return () => { alive = false; };
  }, [selectedList, statusCache]);

  const clearFields = useCallback((keepIdentity: boolean) => {
    setStagedFiles([]);
    setTaskName("");
    setDescription("");
    setStartAt(null);
    setDueAt(null);
    setPriority(null);
    setTags([]);
    setSubtasks([]);
    setChecklist([]);
    setTimeEstimate({ h: "", m: "" });
    setExtras([]);
    setTagDraft(""); setSubtaskDraft(""); setChecklistDraft("");
    if (!keepIdentity) {
      setTaskType("TASK");
      setSelectedList(null);
      setAssigneeId(null);
      setFollowers(me ? [me.id] : []);
    }
  }, [me]);

  const resetAndClose = useCallback(() => {
    clearFields(false);
    setListSearch("");
    setOpenMenu(null);
    setTplMode("root");
    setTplNameDraft("");
    setError(null);
    setNotice(null);
    closeCreateTask();
  }, [clearFields, closeCreateTask]);

  const grouped = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const spaceById = new Map(spaces.map((s) => [s.id, s]));
    const bySpace = new Map<string, BoardRow[]>();
    for (const b of boards) {
      if (q && !b.name.toLowerCase().includes(q)) continue;
      const key = b.spaceId ?? "__none__";
      const arr = bySpace.get(key) ?? [];
      arr.push(b);
      bySpace.set(key, arr);
    }
    return Array.from(bySpace.entries()).map(([spaceId, list]) => ({
      space: spaceById.get(spaceId) ?? null,
      boards: list.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [boards, spaces, listSearch]);

  // Build the calendar grid (6 weeks) for the current calMonth.
  const calGrid = useMemo(() => {
    const first = new Date(calMonth.y, calMonth.m, 1);
    const startIdx = first.getDay(); // 0=Sun
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(addDays(first, i - startIdx));
    return days;
  }, [calMonth]);

  const toggleExtra = (k: ExtraKey) => {
    setExtras((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
    setOpenMenu(null);
  };

  const applyDate = (d: Date) => {
    if (dateField === "start") setStartAt(d);
    else setDueAt(d);
  };

  function buildMetadata(): Record<string, unknown> {
    const md: Record<string, unknown> = { taskType };
    if (description.trim()) md.description = description.trim();
    if (priority) md.priority = priority;
    if (tags.length) md.tags = tags;
    if (followers.length) md.followers = followers;
    const mins = (parseInt(timeEstimate.h || "0", 10) || 0) * 60 + (parseInt(timeEstimate.m || "0", 10) || 0);
    if (mins > 0) md.timeEstimate = mins;
    if (checklist.length) md.checklist = checklist;
    return md;
  }

  // ── Attachments ──
  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setOpenMenu(null);
    const arr = Array.from(files);
    setUploading((n) => n + arr.length);
    await Promise.all(
      arr.map(async (file) => {
        try {
          const fd = new FormData();
          fd.append("file", file);
          const up = await fetch("/api/upload", { method: "POST", body: fd }).then((r) => r.json());
          const entry = await fetch("/api/files", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: up.name ?? file.name,
              mimeType: file.type || "application/octet-stream",
              size: up.size ?? file.size,
              url: up.url,
              spaceId: selectedList?.spaceId ?? undefined,
            }),
          }).then((r) => r.json());
          const id = entry?.id ?? entry?.data?.id;
          if (id) setStagedFiles((p) => [...p, { id, name: up.name ?? file.name, mimeType: file.type, url: up.url }]);
        } catch {
          /* ignore single-file failure */
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }),
    );
  };

  // ── Templates ──
  function serializeConfig(): Record<string, unknown> {
    return {
      taskType,
      status: selectedStatus,
      description: description.trim() || undefined,
      priority,
      tags,
      timeEstimate: { h: timeEstimate.h, m: timeEstimate.m },
      checklist,
      subtasks,
    };
  }

  const applyTemplate = (cfg: Record<string, unknown>) => {
    if (typeof cfg.taskType === "string") setTaskType(cfg.taskType as TaskTypeKey);
    if (typeof cfg.status === "string") setSelectedStatus(cfg.status as string);
    setDescription(typeof cfg.description === "string" ? cfg.description : "");
    setPriority((cfg.priority as PriorityKey) ?? null);
    setTags(Array.isArray(cfg.tags) ? (cfg.tags as string[]) : []);
    const te = (cfg.timeEstimate as { h?: string; m?: string } | undefined) ?? {};
    setTimeEstimate({ h: te.h ?? "", m: te.m ?? "" });
    const cl = Array.isArray(cfg.checklist) ? (cfg.checklist as ChecklistItem[]) : [];
    setChecklist(cl);
    const st = Array.isArray(cfg.subtasks) ? (cfg.subtasks as string[]) : [];
    setSubtasks(st);
    const ex: ExtraKey[] = [];
    if (te.h || te.m) ex.push("TIME_ESTIMATE");
    if (st.length) ex.push("SUBTASKS");
    if (cl.length) ex.push("CHECKLIST");
    setExtras(ex);
  };

  const refreshTemplates = async () => {
    try {
      const t = await fetch("/api/item-templates", { cache: "no-store" }).then((r) => r.json());
      setTemplates(Array.isArray(t.templates) ? t.templates : []);
    } catch { /* ignore */ }
  };

  const saveTemplate = async (name: string) => {
    if (!name.trim()) return;
    await fetch("/api/item-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), config: serializeConfig() }),
    }).catch(() => {});
    await refreshTemplates();
    setTplMode("root");
    setTplNameDraft("");
    setOpenMenu(null);
    setNotice(`Saved template “${name.trim()}”`);
  };

  const updateTemplate = async (tpl: TemplateRow) => {
    await fetch(`/api/item-templates/${tpl.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: serializeConfig() }),
    }).catch(() => {});
    await refreshTemplates();
    setTplMode("root");
    setOpenMenu(null);
    setNotice(`Updated template “${tpl.name}”`);
  };

  // Build a create-item payload straight from a template config (used by
  // "Create instantly from template" so we don't wait on async state).
  function payloadFromConfig(cfg: Record<string, unknown>, title: string) {
    const md: Record<string, unknown> = { taskType: (cfg.taskType as string) ?? "TASK" };
    if (cfg.description) md.description = cfg.description;
    if (cfg.priority) md.priority = cfg.priority;
    if (Array.isArray(cfg.tags) && cfg.tags.length) md.tags = cfg.tags;
    const te = (cfg.timeEstimate as { h?: string; m?: string } | undefined) ?? {};
    const mins = (parseInt(te.h || "0", 10) || 0) * 60 + (parseInt(te.m || "0", 10) || 0);
    if (mins > 0) md.timeEstimate = mins;
    if (Array.isArray(cfg.checklist) && cfg.checklist.length) md.checklist = cfg.checklist;
    if (me) md.followers = [me.id];
    const status = (cfg.status as string) ?? selectedStatus;
    return { title, status, groupKey: status, metadata: md };
  }

  const createInstant = async (tpl: TemplateRow) => {
    setOpenMenu(null);
    setError(null);
    if (!selectedList) { setError("Choose a list first"); setOpenMenu("list"); return; }
    setSubmitting(true);
    try {
      const body = payloadFromConfig(tpl.config, taskName.trim() || tpl.name);
      const res = await fetch(`/api/boards/${selectedList.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create from template");
      const { item } = await res.json();
      const subs = Array.isArray(tpl.config.subtasks) ? (tpl.config.subtasks as string[]) : [];
      if (subs.length && item?.id) {
        await Promise.all(
          subs.map((title) =>
            fetch(`/api/boards/${selectedList.id}/items`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title, parentItemId: item.id, status: body.status }),
            }).catch(() => {}),
          ),
        );
      }
      setNotice(`Created “${item?.title ?? tpl.name}” from template`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create from template");
    } finally {
      setSubmitting(false);
    }
  };

  // Create the task (+ subtasks). Returns the created item or null on error.
  const doCreate = useCallback(async (): Promise<{ id: string; slug: string } | null> => {
    setError(null);
    setNotice(null);
    if (!selectedList) { setError("Choose a list first"); setOpenMenu("list"); return null; }
    if (!taskName.trim()) { setError("Add a name"); return null; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/boards/${selectedList.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: taskName.trim(),
          status: selectedStatus,
          groupKey: selectedStatus,
          ownerId: assigneeId ?? undefined,
          startAt: startAt ? startAt.toISOString() : null,
          dueAt: dueAt ? dueAt.toISOString() : null,
          metadata: buildMetadata(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to create task");
      }
      const { item } = await res.json();
      // Create subtasks (best-effort) under the new parent.
      const titles = subtasks.map((t) => t.trim()).filter(Boolean);
      if (titles.length && item?.id) {
        await Promise.all(
          titles.map((title) =>
            fetch(`/api/boards/${selectedList.id}/items`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title, parentItemId: item.id, status: selectedStatus }),
            }).catch(() => {}),
          ),
        );
      }
      // Link staged attachments to the new item.
      if (stagedFiles.length && item?.id) {
        await Promise.all(
          stagedFiles.map((f) =>
            fetch("/api/entity-links", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ source: { type: "BOARD_ITEM", id: item.id }, target: { type: "FILE", id: f.id } }),
            }).catch(() => {}),
          ),
        );
      }
      return { id: item.id, slug: selectedList.slug };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
      return null;
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedList, taskName, selectedStatus, assigneeId, startAt, dueAt, subtasks, taskType, description, priority, tags, followers, timeEstimate, checklist]);

  type Variant = "default" | "open" | "another" | "duplicate";
  const handleCreate = useCallback(async (variant: Variant) => {
    setOpenMenu(null);
    const created = await doCreate();
    if (!created) return;
    if (variant === "open") {
      const slug = created.slug;
      resetAndClose();
      router.push(`/boards/${slug}?item=${created.id}`);
      return;
    }
    if (variant === "another") {
      clearFields(true); // keep list/type/assignee
      setNotice("Task created — add another");
      return;
    }
    if (variant === "duplicate") {
      setNotice("Task created — tweak & create the duplicate");
      return; // keep ALL fields including name for a quick duplicate
    }
    resetAndClose();
  }, [doCreate, resetAndClose, clearFields, router]);

  if (!createTaskOpen) return null;

  const TypeIcon = activeType.Icon;
  const placeholder = taskType === "TASK" ? "Task Name or type '/' for commands" : `${activeType.label} Name`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={resetAndClose} aria-hidden="true" />

      <div
        className="relative w-full max-w-[750px] bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col overflow-visible animate-in fade-in zoom-in-95 duration-200 border border-zinc-200/60"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
      >
        {/* Click-away catcher for any open popover */}
        {openMenu && <div className="fixed inset-0 z-[55]" onClick={() => setOpenMenu(null)} aria-hidden="true" />}

        {/* Hidden file input — driven by the attachment menu's "Upload file" */}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />

        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white rounded-t-2xl z-[60] relative">
          <div className="flex items-center gap-3">
            {/* Select List */}
            <div className="relative">
              <Chip
                onClick={() => setOpenMenu(openMenu === "list" ? null : "list")}
                state={error === "Choose a list first" ? "danger" : undefined}
                active={!!selectedList}
                className="max-w-[260px]"
              >
                <ListChecks size={14} className="shrink-0" />
                <span className="truncate">{selectedList ? selectedList.name : "Select List..."}</span>
                <ChevronDown size={12} className="ml-0.5 opacity-70 shrink-0" />
              </Chip>
              {openMenu === "list" && (
                <div className="absolute top-full left-0 mt-1 w-[320px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[70] overflow-hidden">
                  <div className="p-2 border-b border-zinc-100">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[#c39b8c]">
                      <Search className="w-3.5 h-3.5 text-zinc-400" />
                      <input autoFocus value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="Search..." className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400" />
                    </div>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto py-1">
                    {loadingLists ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading lists…</div>
                    ) : grouped.length === 0 ? (
                      <div className="px-4 py-6 text-center text-[13px] text-zinc-400">No lists found.</div>
                    ) : (
                      grouped.map(({ space, boards: sb }) => (
                        <div key={space?.id ?? "__none__"} className="px-1 pb-1">
                          <div className="flex items-center gap-2 px-2.5 py-1.5">
                            <span className="w-[18px] h-[18px] rounded flex items-center justify-center text-white font-semibold text-[10px] shrink-0" style={{ backgroundColor: space?.color ?? "#a1a1aa" }}>
                              {(space?.name ?? "·").charAt(0).toUpperCase()}
                            </span>
                            <span className="text-[12px] font-medium text-zinc-500 truncate">{space?.name ?? "Other"}</span>
                          </div>
                          {sb.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => { setSelectedList({ id: b.id, slug: b.slug, name: b.name, spaceId: b.spaceId }); setOpenMenu(null); setListSearch(""); setError(null); }}
                              className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-md text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
                            >
                              <ListChecks className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                              <span className="truncate flex-1">{b.name}</span>
                              {selectedList?.id === b.id && <Check className="w-3.5 h-3.5 text-[#a78b80] shrink-0" />}
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Task Type */}
            <div className="relative">
              <Chip onClick={() => setOpenMenu(openMenu === "type" ? null : "type")} active>
                <TypeIcon size={14} className="text-zinc-500" />
                {activeType.label}
                <ChevronDown size={12} className="ml-0.5 opacity-70" />
              </Chip>
              {openMenu === "type" && (
                <div className="absolute top-full left-0 mt-1 w-[230px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[70] py-2">
                  <div className="px-3 pb-1.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Task Types</div>
                  {TASK_TYPES.map((t) => {
                    const Icon = t.Icon;
                    return (
                      <button key={t.key} type="button" onClick={() => { setTaskType(t.key); setOpenMenu(null); }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] ${taskType === t.key ? "bg-zinc-50 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-zinc-50"}`}>
                        <Icon className="w-4 h-4 text-zinc-500" />
                        <span className="flex-1">{t.label}</span>
                        {t.key === "TASK" && <span className="text-[11px] text-zinc-400">(default)</span>}
                        {taskType === t.key && <Check className="w-3.5 h-3.5 text-[#a78b80]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 text-zinc-400">
            <button onClick={resetAndClose} className="p-1.5 hover:bg-zinc-100 hover:text-zinc-600 rounded-md transition-colors" aria-label="Minimize">
              <ArrowDownRight size={16} />
            </button>
            <button onClick={resetAndClose} className="p-1.5 hover:bg-zinc-100 hover:text-zinc-600 rounded-md transition-colors" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1 min-h-[330px]">
          {/* Title */}
          <div className="px-6 pt-2 pb-2">
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder={placeholder}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && !submitting) handleCreate("default"); }}
              className="w-full text-[24px] font-medium text-zinc-900 bg-transparent border-none outline-none placeholder:text-zinc-300 placeholder:font-normal"
            />
          </div>

          {/* Description */}
          <div className="px-6 relative group pb-4 mt-2">
            <textarea 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              placeholder="Add description, or write with AI" 
              rows={3} 
              className="w-full min-h-[120px] resize-none text-[15px] text-zinc-700 bg-transparent border-none outline-none placeholder:text-zinc-400 transition-all" 
            />
            {!description && (
              <div className="absolute right-10 bottom-8 pointer-events-none text-zinc-400 flex items-center gap-1.5 opacity-50">
                <Wand2 size={16} />
                <span className="text-sm font-medium">AI</span>
              </div>
            )}
          </div>

          {/* Extras (revealed from the … menu) */}
          {extras.length > 0 && (
            <div className="px-6 py-2 flex flex-col gap-3">
              {extras.includes("TIME_ESTIMATE") && (
                <div className="flex items-center gap-2 text-[13px]">
                  <Hourglass className="w-4 h-4 text-zinc-400" />
                  <span className="text-zinc-500 w-28">Time estimate</span>
                  <input value={timeEstimate.h} onChange={(e) => setTimeEstimate((p) => ({ ...p, h: e.target.value.replace(/\D/g, "") }))} placeholder="0" className="w-12 px-2 py-1 border border-zinc-200 rounded text-center outline-none focus:border-[#a78b80]" />
                  <span className="text-zinc-500">h</span>
                  <input value={timeEstimate.m} onChange={(e) => setTimeEstimate((p) => ({ ...p, m: e.target.value.replace(/\D/g, "") }))} placeholder="0" className="w-12 px-2 py-1 border border-zinc-200 rounded text-center outline-none focus:border-[#a78b80]" />
                  <span className="text-zinc-500">m</span>
                </div>
              )}
              {extras.includes("SUBTASKS") && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-[13px] text-zinc-500"><ListTree className="w-4 h-4 text-zinc-400" /> Subtasks</div>
                  {subtasks.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 pl-6 text-[13px] text-zinc-700">
                      <CircleDot className="w-3.5 h-3.5 text-zinc-300" />
                      <span className="flex-1">{s}</span>
                      <button type="button" onClick={() => setSubtasks((p) => p.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pl-6">
                    <Plus className="w-3.5 h-3.5 text-zinc-400" />
                    <input value={subtaskDraft} onChange={(e) => setSubtaskDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && subtaskDraft.trim()) { setSubtasks((p) => [...p, subtaskDraft.trim()]); setSubtaskDraft(""); } }} placeholder="Add subtask…" className="flex-1 text-[13px] py-1 bg-transparent outline-none placeholder:text-zinc-400" />
                  </div>
                </div>
              )}
              {extras.includes("CHECKLIST") && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-[13px] text-zinc-500"><ChecklistIcon className="w-4 h-4 text-zinc-400" /> Checklist</div>
                  {checklist.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 pl-6 text-[13px] text-zinc-700">
                      <button type="button" onClick={() => setChecklist((p) => p.map((x, idx) => idx === i ? { ...x, done: !x.done } : x))} className={`w-4 h-4 rounded border flex items-center justify-center ${c.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-zinc-300"}`}>{c.done && <Check className="w-3 h-3" />}</button>
                      <span className={`flex-1 ${c.done ? "line-through text-zinc-400" : ""}`}>{c.text}</span>
                      <button type="button" onClick={() => setChecklist((p) => p.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pl-6">
                    <Plus className="w-3.5 h-3.5 text-zinc-400" />
                    <input value={checklistDraft} onChange={(e) => setChecklistDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && checklistDraft.trim()) { setChecklist((p) => [...p, { text: checklistDraft.trim(), done: false }]); setChecklistDraft(""); } }} placeholder="Add checklist item…" className="flex-1 text-[13px] py-1 bg-transparent outline-none placeholder:text-zinc-400" />
                  </div>
                </div>
              )}
              {extras.includes("DEPENDENCIES") && (
                <div className="flex items-center gap-2 text-[13px] text-zinc-400 pl-0">
                  <GitFork className="w-4 h-4" />
                  <span>Dependencies link to other tasks — add them from the task page once it exists.</span>
                </div>
              )}
            </div>
          )}

          {/* Staged attachments */}
          {(stagedFiles.length > 0 || uploading > 0) && (
            <div className="px-6 py-2 flex flex-wrap items-center gap-2">
              {stagedFiles.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 text-[12px] text-zinc-700 max-w-[200px]">
                  <Paperclip className="w-3 h-3 text-zinc-400 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <button type="button" onClick={() => setStagedFiles((p) => p.filter((x) => x.id !== f.id))} className="text-zinc-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                </span>
              ))}
              {uploading > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-50 text-[12px] text-zinc-500">
                  <Loader2 className="w-3 h-3 animate-spin" /> Uploading {uploading}…
                </span>
              )}
            </div>
          )}

          {/* Toolbar */}
          <div className="px-6 pb-6 pt-4 mt-auto flex flex-wrap items-center gap-2 relative z-[56]">
            {/* Status */}
            <div className="relative">
              <StatusChip
                onClick={() => setOpenMenu(openMenu === "status" ? null : "status")}
                color={selectedStatusDef?.color ?? "#71717A"}
                label={selectedStatusDef?.label ?? "TO DO"}
              />
              {openMenu === "status" && (
                <div className="absolute bottom-full left-0 mb-1 w-[240px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] py-1.5 max-h-[300px] overflow-y-auto">
                  {(["ACTIVE", "DONE", "CLOSED"] as StatusGroup[]).map((group) => {
                    const gs = statuses.filter((s) => s.group === group);
                    if (gs.length === 0) return null;
                    return (
                      <div key={group} className="pb-1">
                        <div className="px-3 py-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">{STATUS_GROUP_LABEL[group]}</div>
                        {gs.map((s) => (
                          <button key={s.key} type="button" onClick={() => { setSelectedStatus(s.key); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="flex-1 truncate">{s.label}</span>
                            {selectedStatus === s.key && <Check className="w-3.5 h-3.5 text-[#a78b80]" />}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Assignee */}
            <div className="relative">
              <Chip onClick={() => setOpenMenu(openMenu === "assignee" ? null : "assignee")} active={!!assignee}>
                {assignee ? <Avatar person={assignee} size={18} /> : <span className="w-4 h-4 rounded-full border border-dashed border-zinc-400 flex items-center justify-center"><Plus className="w-2.5 h-2.5 text-zinc-400" /></span>}
                {assignee ? (me && assignee.id === me.id ? "Me" : personName(assignee).split(" ")[0]) : "Assignee"}
              </Chip>
              {openMenu === "assignee" && (
                <PeoplePicker people={people} me={me} selected={assigneeId ? [assigneeId] : []} onToggle={(id) => { setAssigneeId((cur) => (cur === id ? null : id)); setOpenMenu(null); }} />
              )}
            </div>

            {/* Due date */}
            <div className="relative">
              <Chip onClick={() => setOpenMenu(openMenu === "due" ? null : "due")} active={!!(dueAt || startAt)}>
                <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                {dueAt ? fmtDate(dueAt) : startAt ? `${fmtDate(startAt)} →` : "Due date"}
              </Chip>
              {openMenu === "due" && (
                <div className="absolute bottom-full left-0 mb-1 w-[440px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] p-3">
                  <div className="flex gap-2 mb-3">
                    {(["start", "due"] as const).map((f) => {
                      const val = f === "start" ? startAt : dueAt;
                      return (
                        <button key={f} type="button" onClick={() => setDateField(f)} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-md border text-[13px] ${dateField === f ? "border-[#c39b8c] text-zinc-800" : "border-zinc-200 text-zinc-500"}`}>
                          <Calendar className="w-3.5 h-3.5" />
                          {val ? fmtDate(val) : f === "start" ? "Start date" : "Due date"}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-3">
                    <div className="w-[160px] flex flex-col text-[13px]">
                      {([["Today", 0], ["Tomorrow", 1], ["This weekend", (6 - today.getDay() + 7) % 7 || 6], ["Next week", (8 - today.getDay()) % 7 || 7], ["2 weeks", 14], ["4 weeks", 28]] as [string, number][]).map(([label, offset]) => {
                        const d = addDays(today, offset);
                        return (
                          <button key={label} type="button" onClick={() => applyDate(d)} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-zinc-50 text-left">
                            <span className="text-zinc-700">{label}</span>
                            <span className="text-zinc-400 text-[12px]">{fmtDate(d)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex-1 border-l border-zinc-100 pl-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] font-medium text-zinc-700">{new Date(calMonth.y, calMonth.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setCalMonth((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))} className="p-1 rounded hover:bg-zinc-100 text-zinc-500"><ChevronLeft className="w-4 h-4" /></button>
                          <button type="button" onClick={() => setCalMonth({ y: today.getFullYear(), m: today.getMonth() })} className="text-[12px] text-zinc-500 px-1.5 hover:text-zinc-800">Today</button>
                          <button type="button" onClick={() => setCalMonth((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))} className="p-1 rounded hover:bg-zinc-100 text-zinc-500"><ChevronRight className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-zinc-400 mb-1">
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <span key={d}>{d}</span>)}
                      </div>
                      <div className="grid grid-cols-7 gap-0.5">
                        {calGrid.map((d, i) => {
                          const inMonth = d.getMonth() === calMonth.m;
                          const isToday = d.getTime() === today.getTime();
                          const active = (dateField === "start" ? startAt : dueAt)?.getTime() === d.getTime();
                          return (
                            <button key={i} type="button" onClick={() => applyDate(d)} style={active ? { backgroundColor: TAUPE.soft } : undefined} className={`h-7 rounded text-[12px] ${active ? "text-white" : isToday ? "bg-red-500 text-white" : inMonth ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-50"}`}>
                              {d.getDate()}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex justify-between mt-2">
                        <button type="button" onClick={() => { setStartAt(null); setDueAt(null); }} className="text-[12px] text-zinc-500 hover:text-red-500">Clear</button>
                        <button type="button" onClick={() => setOpenMenu(null)} className="text-[12px] font-medium text-[#9d7d70] hover:text-[#8e7165]">Done</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Priority */}
            <div className="relative">
              <Chip onClick={() => setOpenMenu(openMenu === "priority" ? null : "priority")} active={!!priority}>
                <Flag className="w-3.5 h-3.5" style={{ color: priority ? PRIORITIES.find((p) => p.key === priority)!.color : "#a1a1aa" }} />
                {priority ? PRIORITIES.find((p) => p.key === priority)!.label : "Priority"}
              </Chip>
              {openMenu === "priority" && (
                <div className="absolute bottom-full left-0 mb-1 w-[180px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] py-1.5">
                  <div className="px-3 py-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Priority</div>
                  {PRIORITIES.map((p) => (
                    <button key={p.key} type="button" onClick={() => { setPriority(p.key); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors">
                      <Flag className="w-4 h-4" style={{ color: p.color }} />
                      <span className="flex-1">{p.label}</span>
                      {priority === p.key && <Check className="w-3.5 h-3.5 text-[#a78b80]" />}
                    </button>
                  ))}
                  <div className="border-t border-zinc-100 mt-1 pt-1">
                    <button type="button" onClick={() => { setPriority(null); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-zinc-500 hover:bg-zinc-50">
                      <Ban className="w-4 h-4 text-zinc-400" /> Clear
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="relative">
              <Chip onClick={() => setOpenMenu(openMenu === "tags" ? null : "tags")} active={tags.length > 0}>
                <Tag className="w-3.5 h-3.5 text-zinc-400" />
                {tags.length ? `${tags.length} tag${tags.length > 1 ? "s" : ""}` : "Tags"}
              </Chip>
              {openMenu === "tags" && (
                <div className="absolute bottom-full left-0 mb-1 w-[260px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] p-2">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[#c39b8c] mb-2">
                    <Search className="w-3.5 h-3.5 text-zinc-400" />
                    <input autoFocus value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const t = tagDraft.trim(); if (t && !tags.includes(t)) setTags((p) => [...p, t]); setTagDraft(""); } }} placeholder="Search or add a tag…" className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400" />
                  </div>
                  {tagDraft.trim() && !tags.includes(tagDraft.trim()) && (
                    <button type="button" onClick={() => { setTags((p) => [...p, tagDraft.trim()]); setTagDraft(""); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50 rounded">
                      <Plus className="w-3.5 h-3.5 text-zinc-400" /> Create “{tagDraft.trim()}”
                    </button>
                  )}
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {tags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 text-[12px] text-zinc-700">
                          {t}
                          <button type="button" onClick={() => setTags((p) => p.filter((x) => x !== t))} className="text-zinc-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ... more */}
            <div className="relative">
              <Chip size="icon" onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}>
                <MoreHorizontal className="w-4 h-4" />
              </Chip>
              {openMenu === "more" && (
                <div className="absolute bottom-full left-0 mb-1 w-[200px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] py-1.5">
                  {([["TIME_ESTIMATE", "Time Estimate", Hourglass], ["DEPENDENCIES", "Dependencies", GitFork], ["SUBTASKS", "Subtasks", ListTree], ["CHECKLIST", "Checklist", ChecklistIcon]] as [ExtraKey, string, typeof Hourglass][]).map(([k, label, Icon]) => (
                    <button key={k} type="button" onClick={() => toggleExtra(k)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors">
                      <Icon className="w-4 h-4 text-zinc-500" />
                      <span className="flex-1">{label}</span>
                      {extras.includes(k) && <Check className="w-3.5 h-3.5 text-[#a78b80]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center justify-between bg-white rounded-b-[16px] relative z-[56]">
          <div className="flex items-center gap-2">
            {/* Templates */}
            <div className="relative">
              <button type="button" onClick={() => { setTplMode("root"); setOpenMenu(openMenu === "templates" ? null : "templates"); }} className="inline-flex items-center gap-1.5 px-2 py-1 text-[13px] font-medium text-zinc-600 bg-transparent rounded hover:bg-zinc-100 transition-colors">
                <Wand2 className="w-4 h-4 text-zinc-400" /> Templates
              </button>
              {openMenu === "templates" && (
                <div className="absolute bottom-full left-0 mb-1 w-[280px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] py-1.5">
                  {tplMode === "root" && (
                    <>
                      <button type="button" onClick={() => setTplMode("use")} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors"><Wand2 className="w-4 h-4 text-zinc-500" /><span className="flex-1">Use Template</span><ChevronRight className="w-3.5 h-3.5 text-zinc-300" /></button>
                      <button type="button" onClick={() => setTplMode("instant")} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors"><Wand2 className="w-4 h-4 text-zinc-500" /><span className="flex-1">Create instantly from template</span><ChevronRight className="w-3.5 h-3.5 text-zinc-300" /></button>
                      <div className="border-t border-zinc-100 my-1" />
                      <button type="button" onClick={() => setTplMode("save")} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors"><Save className="w-4 h-4 text-zinc-500" /><span className="flex-1">Save as template</span></button>
                      <button type="button" onClick={() => setTplMode("update")} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors"><RefreshCw className="w-4 h-4 text-zinc-500" /><span className="flex-1">Update existing template</span><ChevronRight className="w-3.5 h-3.5 text-zinc-300" /></button>
                    </>
                  )}

                  {tplMode === "save" && (
                    <div className="px-3 py-2">
                      <button type="button" onClick={() => setTplMode("root")} className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-800 mb-2"><ChevronLeft className="w-3.5 h-3.5" /> Back</button>
                      <div className="text-[12px] text-zinc-500 mb-1.5">Save the current task setup as a reusable template.</div>
                      <input autoFocus value={tplNameDraft} onChange={(e) => setTplNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveTemplate(tplNameDraft); }} placeholder="Template name…" className="w-full px-2.5 py-1.5 text-[13px] border border-[#c39b8c] rounded-md outline-none mb-2 placeholder:text-zinc-400" />
                      <button type="button" onClick={() => saveTemplate(tplNameDraft)} disabled={!tplNameDraft.trim()} className="w-full px-3 py-1.5 text-[13px] font-medium text-white bg-[#9d7d70] hover:bg-[#8e7165] rounded-md disabled:opacity-50">Save template</button>
                    </div>
                  )}

                  {(tplMode === "use" || tplMode === "instant" || tplMode === "update") && (
                    <div>
                      <button type="button" onClick={() => setTplMode("root")} className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-800 px-3 py-1.5"><ChevronLeft className="w-3.5 h-3.5" /> Back</button>
                      <div className="max-h-[240px] overflow-y-auto">
                        {templates.length === 0 ? (
                          <div className="px-4 py-5 text-center text-[13px] text-zinc-400">No templates yet.<br />Save one with “Save as template”.</div>
                        ) : (
                          templates.map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => {
                                if (tplMode === "use") { applyTemplate(tpl.config); setOpenMenu(null); setNotice(`Applied “${tpl.name}”`); }
                                else if (tplMode === "instant") { createInstant(tpl); }
                                else { updateTemplate(tpl); }
                              }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors"
                            >
                              <Wand2 className="w-4 h-4 text-zinc-400 shrink-0" />
                              <span className="flex-1 truncate">{tpl.name}</span>
                              {tplMode === "update" && <RefreshCw className="w-3.5 h-3.5 text-zinc-300" />}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Attachment */}
            <div className="relative">
              <button type="button" onClick={() => setOpenMenu(openMenu === "attach" ? null : "attach")} className="text-zinc-500 hover:text-zinc-700 p-1.5 rounded hover:bg-zinc-100 transition-colors"><Paperclip className="w-5 h-5" /></button>
              {openMenu === "attach" && (
                <div className="absolute bottom-full left-0 mb-1 w-[230px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] py-1.5">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors">
                    <FileUp className="w-4 h-4 text-zinc-500" />
                    <span className="flex-1">Upload file</span>
                  </button>
                  <div className="border-t border-zinc-100 my-1" />
                  {["Dropbox", "OneDrive/SharePoint", "Box", "Google Drive", "New Google Doc"].map((label) => (
                    <button key={label} type="button" onClick={() => { setOpenMenu(null); setNotice("Cloud providers aren’t connected yet"); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-400 hover:bg-zinc-50">
                      <Paperclip className="w-4 h-4 text-zinc-300" />
                      <span className="flex-1">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Followers */}
            <div className="relative">
              <button type="button" onClick={() => setOpenMenu(openMenu === "followers" ? null : "followers")} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-700 p-1.5 rounded hover:bg-zinc-100 transition-colors" title="Followers">
                <Bell className="w-5 h-5" />
                {followers.length > 0 && <span className="text-[12px] font-medium">{followers.length}</span>}
              </button>
              {openMenu === "followers" && (
                <PeoplePicker people={people} me={me} selected={followers} onToggle={(id) => setFollowers((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} position="top" />
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {error && <span className="text-[12px] font-medium text-red-500">{error}</span>}
            {!error && notice && <span className="text-[12px] font-medium text-emerald-600">{notice}</span>}

            {/* Create split button */}
            <div className="flex items-center rounded-lg shadow-sm overflow-visible ml-1 relative">
              <button type="button" onClick={() => handleCreate("default")} disabled={submitting} className={`px-4 h-[34px] text-[13px] rounded-l-lg inline-flex items-center gap-2 ${taupeButton}`}>
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create {activeType.label}
              </button>
              <button type="button" onClick={() => setOpenMenu(openMenu === "createMenu" ? null : "createMenu")} disabled={submitting} className={`px-2 h-[34px] flex items-center justify-center rounded-r-lg border-l border-white/25 ${taupeButton}`}>
                {openMenu === "createMenu" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {openMenu === "createMenu" && (
                <div className="absolute bottom-full right-0 mb-1 w-[230px] bg-white border border-zinc-200/70 rounded-xl shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] z-[60] py-1.5">
                  {([["open", "Create and open"], ["another", "Create and start another"], ["duplicate", "Create and duplicate"]] as [Variant, string][]).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => handleCreate(v)} className="w-full px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100/70 transition-colors">{label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
