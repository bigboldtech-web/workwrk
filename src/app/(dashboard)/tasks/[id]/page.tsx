"use client";

/* Detail page for a single task — full-page equivalent of the drawer.
 * Shareable URL: /tasks/<id>
 *
 * Shows the same fields + updates as the drawer, but full-width and
 * with its own breadcrumb back to /tasks. Mutations persist via the
 * existing /api/tasks PATCH endpoint and the comments API.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CheckSquare, ArrowLeft, Calendar as CalendarIcon, MessageCircle,
  Send, Paperclip, Smile, AtSign, Share2, Star, MoreHorizontal, MessageSquare,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsPickerPopover, type PickerOption } from "@/components/layout/os/picker-popover";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiTask = {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  completedAt?: string | null;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  labels?: { label: { id: string; name: string; color?: string | null } }[];
};

type ApiComment = {
  id: string;
  body: string;
  createdAt: string;
  author?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STATUS_OPTIONS: PickerOption[] = [
  { value: "PLANNED",     label: "Planned",     color: C.indigo },
  { value: "IN_PROGRESS", label: "In progress", color: C.orange },
  { value: "COMPLETED",   label: "Done",        color: C.green },
];
const PRIO_OPTIONS: PickerOption[] = [
  { value: "URGENT", label: "Critical", color: C.pink },
  { value: "HIGH",   label: "High",     color: C.red },
  { value: "NORMAL", label: "Medium",   color: C.yellow },
  { value: "LOW",    label: "Low",      color: C.teal },
];

const STATUS_META = {
  PLANNED: { label: "Planned", color: C.indigo },
  IN_PROGRESS: { label: "In progress", color: C.orange },
  COMPLETED: { label: "Done", color: C.green },
};
const PRIO_META = {
  LOW: { label: "Low", color: C.teal },
  NORMAL: { label: "Medium", color: C.yellow },
  HIGH: { label: "High", color: C.red },
  URGENT: { label: "Critical", color: C.pink },
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}

const TABS: TabDef[] = [
  { id: "updates",  label: "Updates",   Icon: MessageCircle },
  { id: "activity", label: "Activity",  Icon: MessageSquare },
];

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();

  const [task, setTask] = useState<ApiTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState("updates");
  const [title, setTitle] = useState("");
  const [composer, setComposer] = useState("");
  const [comments, setComments] = useState<ApiComment[] | null>(null);
  const [posting, setPosting] = useState(false);
  const [picker, setPicker] = useState<
    | null
    | { rect: DOMRect; type: "status" | "priority" }
  >(null);

  // ── Load task (filter from list; no GET-by-id endpoint) ────
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      // Wide window — find the task wherever its date lands
      const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: ApiTask[] = Array.isArray(data) ? data : (data.data ?? []);
      const found = list.find((t) => t.id === id);
      if (!found) { setNotFound(true); setTask(null); }
      else { setTask(found); setTitle(found.title); setNotFound(false); }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadComments = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/tasks/${id}/comments`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: ApiComment[] = Array.isArray(data) ? data : (data.data ?? []);
      setComments(list);
    } catch {
      setComments([]);
    }
  }, [id]);

  useEffect(() => { void load(); void loadComments(); }, [load, loadComments]);

  async function patch(body: Record<string, unknown>) {
    if (!id) return false;
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(String(res.status));
      bumpRowVersion("tasks");
      void load();
      return true;
    } catch {
      toast("Couldn't save");
      return false;
    }
  }

  async function postComment() {
    if (!composer.trim() || posting || !id) return;
    const text = composer.trim();
    setComposer("");
    setPosting(true);
    const tempId = `temp-${Date.now()}`;
    const optimistic: ApiComment = {
      id: tempId,
      body: text,
      createdAt: new Date().toISOString(),
      author: { id: "you", firstName: "You", lastName: "" },
    };
    setComments((c) => [...(c ?? []), optimistic]);
    try {
      const res = await fetch(`/api/tasks/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const created: ApiComment = data.data ?? data;
      setComments((c) => (c ?? []).map((x) => (x.id === tempId ? created : x)));
      toast("Update posted");
    } catch {
      setComments((c) => (c ?? []).filter((x) => x.id !== tempId));
      setComposer(text);
      toast("Couldn't post");
    } finally {
      setPosting(false);
    }
  }

  function copyLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy"),
    );
  }

  // ─── Loading / not-found ────────────────────────────────────
  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading task…" Icon={CheckSquare} iconGradient={GRAD.bluePurple} showActions={false} />
        <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>
          Loading task…
        </div>
      </>
    );
  }
  if (notFound || !task) {
    return (
      <>
        <OsTitleBar title="Task not found" Icon={CheckSquare} iconGradient={GRAD.redPink} showActions={false} />
        <OsEmptyView
          Icon={CheckSquare}
          iconGradient={GRAD.redPink}
          title="We couldn't find that task"
          subtitle="It may have been deleted, archived, or you don't have access. Go back to your task board."
          cta="Back to My tasks"
        />
      </>
    );
  }

  const statusMeta = STATUS_META[task.status];
  const prioMeta = PRIO_META[task.priority];
  const visibleComments = comments ?? [];

  return (
    <>
      {/* Title bar with back link */}
      <div className="os-title-bar">
        <Link href="/tasks" className="os-title-bar__btn" aria-label="Back to tasks" style={{ height: 32, padding: "0 10px" }}>
          <ArrowLeft />
          <span>My tasks</span>
        </Link>
        <div style={{ width: 1, height: 24, background: "var(--os-line)", margin: "0 4px" }} />
        <div className="os-title-bar__icon" style={{ background: GRAD.bluePurple }}>
          <CheckSquare />
        </div>
        <div className="os-title-bar__main">
          <span className="os-title-bar__name">{title || "(untitled)"}</span>
          <button type="button" className="os-title-bar__star" aria-label="Star"><Star /></button>
        </div>
        <div className="os-title-bar__spacer" />
        <button type="button" className="os-title-bar__btn" onClick={copyLink}>
          <Share2 />
          <span>Copy link</span>
        </button>
        <button type="button" className="os-title-bar__btn" aria-label="More"><MoreHorizontal /></button>
      </div>

      <OsTabs tabs={TABS} active={tab} onSelect={setTab} canAdd={false} />

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "24px 32px 80px", width: "100%" }}>
        {/* Inline-editable title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={async () => {
            const t = title.trim();
            if (!t || t === task.title) return;
            const ok = await patch({ title: t });
            if (ok) toast("Renamed");
            else setTitle(task.title);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setTitle(task.title); (e.target as HTMLInputElement).blur(); }
          }}
          aria-label="Task title"
          style={{
            width: "100%",
            fontFamily: "var(--os-font)",
            fontSize: 28,
            fontWeight: 700,
            color: "var(--os-ink)",
            letterSpacing: "-0.02em",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 6,
            padding: "6px 10px",
            margin: "0 -10px 20px",
            outline: "none",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--os-brand)"; e.currentTarget.style.background = "var(--os-canvas)"; }}
        />

        {/* Pinned fields panel */}
        <div className="os-drawer__fields" style={{ marginBottom: 22 }}>
          <div className="os-drawer__field">
            <span className="os-drawer__field-label">Status</span>
            <span className="os-drawer__field-value">
              <button
                type="button"
                className="os-drawer__field-pill"
                style={{ background: statusMeta.color, color: "white", border: "none", cursor: "pointer" }}
                onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), type: "status" })}
              >
                {statusMeta.label}
              </button>
            </span>
          </div>
          <div className="os-drawer__field">
            <span className="os-drawer__field-label">Priority</span>
            <span className="os-drawer__field-value">
              <button
                type="button"
                className="os-drawer__field-pill"
                style={{ background: prioMeta.color, color: prioMeta.color === C.yellow ? C.indigo : "white", border: "none", cursor: "pointer" }}
                onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), type: "priority" })}
              >
                {prioMeta.label}
              </button>
            </span>
          </div>
          <div className="os-drawer__field">
            <span className="os-drawer__field-label">Owner</span>
            <span className="os-drawer__field-value">
              {task.assignee ? (
                <>
                  <span className="os-av os-av--sm" style={{ background: avatarFor(task.assignee.id) }}>
                    {((task.assignee.firstName?.[0] ?? "") + (task.assignee.lastName?.[0] ?? "")).toUpperCase() || "?"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--os-ink-2)", marginLeft: 6 }}>
                    {`${task.assignee.firstName ?? ""} ${task.assignee.lastName ?? ""}`.trim() || "Unknown"}
                  </span>
                </>
              ) : (
                <span style={{ color: "var(--os-ink-3)", fontSize: 12 }}>Unassigned</span>
              )}
            </span>
          </div>
          <div className="os-drawer__field">
            <span className="os-drawer__field-label">Due date</span>
            <span className="os-drawer__field-value">
              <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
              {fmtDate(task.date)}
            </span>
          </div>
          {task.labels && task.labels.length > 0 ? (
            <div className="os-drawer__field" style={{ gridColumn: "1 / -1" }}>
              <span className="os-drawer__field-label">Labels</span>
              <span className="os-drawer__field-value" style={{ flexWrap: "wrap", gap: 4 }}>
                {task.labels.map((l) => (
                  <span key={l.label.id} className="os-drawer__field-tag" style={{ background: C.indigo }}>
                    {l.label.name}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          {task.description ? (
            <div className="os-drawer__field" style={{ gridColumn: "1 / -1" }}>
              <span className="os-drawer__field-label">Description</span>
              <span className="os-drawer__field-value" style={{ display: "block", fontSize: 13, lineHeight: 1.55, color: "var(--os-ink)" }}>
                {task.description}
              </span>
            </div>
          ) : null}
        </div>

        {tab === "updates" && (
          <>
            <h3 className="os-drawer__section-title">
              <MessageCircle />
              Updates
              <span style={{ fontWeight: 500, color: "var(--os-ink-3)", marginLeft: 6 }}>
                {visibleComments.length}
              </span>
            </h3>
            {visibleComments.length === 0 ? (
              <div style={{ padding: "24px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
                No updates yet. Start the conversation below.
              </div>
            ) : (
              visibleComments.map((u) => {
                const initials = u.author
                  ? ((u.author.firstName?.[0] ?? "") + (u.author.lastName?.[0] ?? "")).toUpperCase() || "?"
                  : "?";
                const color = avatarFor(u.author?.id ?? u.id);
                const name = u.author
                  ? `${u.author.firstName ?? ""} ${u.author.lastName ?? ""}`.trim() || "Unknown"
                  : "Unknown";
                return (
                  <div key={u.id} className="os-drawer__update">
                    <span className="os-av os-av--md" style={{ background: color }}>{initials}</span>
                    <div className="os-drawer__update-body">
                      <div className="os-drawer__update-head">
                        <span className="os-drawer__update-author">{name}</span>
                        <span className="os-drawer__update-time">{fmtRelative(u.createdAt)}</span>
                      </div>
                      <div className="os-drawer__update-text" style={{ whiteSpace: "pre-wrap" }}>
                        {u.body}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            <div className="os-drawer__composer" style={{ marginTop: 18 }}>
              <textarea
                className="os-drawer__composer-input"
                placeholder="Write an update… ⌘⏎ to send"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void postComment();
                  }
                }}
                disabled={posting}
              />
              <div className="os-drawer__composer-foot">
                <button type="button" className="os-drawer__composer-icon" aria-label="Attach"><Paperclip /></button>
                <button type="button" className="os-drawer__composer-icon" aria-label="Emoji"><Smile /></button>
                <button type="button" className="os-drawer__composer-icon" aria-label="Mention"><AtSign /></button>
                <button
                  type="button"
                  className="os-drawer__composer-send"
                  onClick={() => void postComment()}
                  disabled={!composer.trim() || posting}
                >
                  <Send />
                  {posting ? "Posting…" : "Update"}
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "activity" && (
          <div style={{ padding: "32px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
            Activity log API coming next. Until then, the Updates tab shows everything that's been said about this task.
          </div>
        )}
      </div>

      {picker ? (
        <OsPickerPopover
          anchorRect={picker.rect}
          title={picker.type === "status" ? "Set status" : "Set priority"}
          options={picker.type === "status" ? STATUS_OPTIONS : PRIO_OPTIONS}
          activeValue={picker.type === "status" ? task.status : task.priority}
          onSelect={async (v) => {
            if (picker.type === "status") {
              const ok = await patch({ status: v });
              if (ok) toast(`Status set to ${STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v}`);
            } else {
              const ok = await patch({ priority: v });
              if (ok) toast(`Priority set to ${PRIO_OPTIONS.find((o) => o.value === v)?.label ?? v}`);
            }
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}
