"use client";

/* Detail page for a single task — full-page bespoke layout.
 * Shareable URL: /tasks/<id>
 *
 * Layout:
 *   - OsTitleBar with back-to-tasks + copy-link in actions slot.
 *   - Hero card with status accent strip + inline-editable title + description.
 *   - 2-col body: Updates feed (left, 2/3) + properties sidebar (right, 1/3).
 *   - Sidebar: status / priority pills (open picker), owner, due, labels, key dates.
 *
 * Mutations go through /api/tasks PATCH and the per-task comments API.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CheckSquare, ArrowLeft, Calendar as CalendarIcon, MessageCircle,
  Send, Paperclip, Smile, AtSign, Share2, MoreHorizontal,
  User as UserIcon, Tag, Clock, Flag, Activity as ActivityIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsPickerPopover, type PickerOption } from "@/components/layout/os/picker-popover";
import { C, GRAD } from "@/components/layout/os/catalog";
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
  createdAt?: string;
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
  PLANNED:     { label: "Planned",     color: "var(--os-c-indigo)" },
  IN_PROGRESS: { label: "In progress", color: "var(--os-c-orange)" },
  COMPLETED:   { label: "Done",        color: "var(--os-c-green)"  },
};
const PRIO_META = {
  LOW:    { label: "Low",      color: "var(--os-c-teal)"   },
  NORMAL: { label: "Medium",   color: "var(--os-c-yellow)" },
  HIGH:   { label: "High",     color: "var(--os-c-red)"    },
  URGENT: { label: "Critical", color: "var(--os-c-pink)"   },
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function fmtShortDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();

  const [task, setTask] = useState<ApiTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [composer, setComposer] = useState("");
  const [comments, setComments] = useState<ApiComment[] | null>(null);
  const [posting, setPosting] = useState(false);
  const [picker, setPicker] = useState<
    | null
    | { rect: DOMRect; type: "status" | "priority" }
  >(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: ApiTask[] = Array.isArray(data) ? data : (data.data ?? []);
      const found = list.find((t) => t.id === id);
      if (!found) { setNotFound(true); setTask(null); }
      else {
        setTask(found);
        setTitle(found.title);
        setDescription(found.description ?? "");
        setNotFound(false);
      }
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

  // ─── Loading / not-found ─────────────────────────────────────
  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading task…" Icon={CheckSquare} iconGradient={GRAD.bluePurple} showInvite={false} />
        <div className="tdt__loading">Loading task…</div>
      </>
    );
  }
  if (notFound || !task) {
    return (
      <>
        <OsTitleBar title="Task not found" Icon={CheckSquare} iconGradient={GRAD.redPink} showInvite={false} />
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
      <OsTitleBar
        title={title || "(untitled)"}
        Icon={CheckSquare}
        iconGradient={GRAD.bluePurple}
        description={`Task · ${statusMeta.label}`}
        actions={
          <div className="tdt__head-actions">
            <button type="button" className="tdt__back" onClick={() => router.push("/tasks")}>
              <ArrowLeft /> My tasks
            </button>
            <button type="button" className="tdt__btn tdt__btn--ghost" onClick={copyLink}>
              <Share2 /> Copy link
            </button>
            <button type="button" className="tdt__btn tdt__btn--icon" aria-label="More"><MoreHorizontal /></button>
          </div>
        }
      />

      <div className="tdt">
        {/* Hero card with status accent strip */}
        <section className="tdt__hero">
          <span className="tdt__hero-accent" style={{ background: statusMeta.color }} aria-hidden="true" />
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
            className="tdt__title"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={async () => {
              const d = description.trim();
              if (d === (task.description ?? "").trim()) return;
              const ok = await patch({ description: d });
              if (ok) toast("Description saved");
            }}
            placeholder="Add a description…"
            aria-label="Task description"
            className="tdt__desc"
            rows={3}
          />
        </section>

        {/* 2-col body */}
        <div className="tdt__body">
          {/* Left: Updates */}
          <section className="tdt__feed">
            <div className="tdt__card-head">
              <MessageCircle /> Updates
              <span className="tdt__card-sub">{visibleComments.length} message{visibleComments.length === 1 ? "" : "s"}</span>
            </div>

            <div className="tdt__updates">
              {visibleComments.length === 0 ? (
                <div className="tdt__updates-empty">
                  <MessageCircle />
                  <div>No updates yet. Start the thread below.</div>
                </div>
              ) : (
                visibleComments.map((u) => {
                  const init = u.author
                    ? ((u.author.firstName?.[0] ?? "") + (u.author.lastName?.[0] ?? "")).toUpperCase() || "?"
                    : "?";
                  const color = avatarFor(u.author?.id ?? u.id);
                  const name = u.author
                    ? `${u.author.firstName ?? ""} ${u.author.lastName ?? ""}`.trim() || "Unknown"
                    : "Unknown";
                  return (
                    <article key={u.id} className="tdt__update">
                      <span className="tdt__update-av" style={{ background: color }}>{init}</span>
                      <div className="tdt__update-body">
                        <div className="tdt__update-head">
                          <span className="tdt__update-author">{name}</span>
                          <span className="tdt__update-time">{fmtRelative(u.createdAt)}</span>
                        </div>
                        <div className="tdt__update-text">{u.body}</div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            {/* Composer */}
            <div className="tdt__composer">
              <textarea
                className="tdt__composer-input"
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
                rows={2}
              />
              <div className="tdt__composer-foot">
                <div className="tdt__composer-tools">
                  <button type="button" className="tdt__composer-icon" aria-label="Attach"><Paperclip /></button>
                  <button type="button" className="tdt__composer-icon" aria-label="Emoji"><Smile /></button>
                  <button type="button" className="tdt__composer-icon" aria-label="Mention"><AtSign /></button>
                </div>
                <button
                  type="button"
                  className="tdt__composer-send"
                  onClick={() => void postComment()}
                  disabled={!composer.trim() || posting}
                >
                  <Send />
                  {posting ? "Posting…" : "Send update"}
                </button>
              </div>
            </div>
          </section>

          {/* Right: Properties sidebar */}
          <aside className="tdt__side">
            <div className="tdt__side-card">
              <div className="tdt__card-head">
                <Flag /> Properties
              </div>

              <div className="tdt__props">
                <Prop label="Status" Icon={ActivityIcon}>
                  <button
                    type="button"
                    className="tdt__pill"
                    style={{ background: statusMeta.color, color: "white" }}
                    onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), type: "status" })}
                  >
                    {statusMeta.label}
                  </button>
                </Prop>

                <Prop label="Priority" Icon={Flag}>
                  <button
                    type="button"
                    className="tdt__pill"
                    style={{ background: prioMeta.color, color: prioMeta.color === "var(--os-c-yellow)" ? "var(--os-c-indigo)" : "white" }}
                    onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), type: "priority" })}
                  >
                    {prioMeta.label}
                  </button>
                </Prop>

                <Prop label="Owner" Icon={UserIcon}>
                  {task.assignee ? (
                    <div className="tdt__owner">
                      <span className="tdt__owner-av" style={{ background: avatarFor(task.assignee.id) }}>
                        {((task.assignee.firstName?.[0] ?? "") + (task.assignee.lastName?.[0] ?? "")).toUpperCase() || "?"}
                      </span>
                      <span className="tdt__owner-name">
                        {`${task.assignee.firstName ?? ""} ${task.assignee.lastName ?? ""}`.trim() || "Unknown"}
                      </span>
                    </div>
                  ) : (
                    <span className="tdt__muted">Unassigned</span>
                  )}
                </Prop>

                <Prop label="Due date" Icon={CalendarIcon}>
                  <span className="tdt__value">{fmtDate(task.date)}</span>
                </Prop>

                {task.labels && task.labels.length > 0 ? (
                  <Prop label="Labels" Icon={Tag} stacked>
                    <div className="tdt__tags">
                      {task.labels.map((l) => (
                        <span key={l.label.id} className="tdt__tag" style={{ background: l.label.color || "var(--os-c-indigo)" }}>
                          {l.label.name}
                        </span>
                      ))}
                    </div>
                  </Prop>
                ) : null}

                {task.completedAt && (
                  <Prop label="Completed" Icon={Clock}>
                    <span className="tdt__value">{fmtShortDate(task.completedAt)}</span>
                  </Prop>
                )}
              </div>
            </div>

            <div className="tdt__side-card">
              <div className="tdt__card-head">
                <ActivityIcon /> Quick actions
              </div>
              <div className="tdt__quick">
                <button type="button" className="tdt__quick-btn" onClick={() => patch({ status: task.status === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED" })}>
                  <CheckSquare />
                  {task.status === "COMPLETED" ? "Reopen task" : "Mark complete"}
                </button>
                <button type="button" className="tdt__quick-btn" onClick={copyLink}>
                  <Share2 /> Copy share link
                </button>
              </div>
            </div>
          </aside>
        </div>
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

function Prop({ label, Icon, stacked, children }: { label: string; Icon: typeof Flag; stacked?: boolean; children: React.ReactNode }) {
  return (
    <div className={`tdt__prop${stacked ? " tdt__prop--stacked" : ""}`}>
      <div className="tdt__prop-label"><Icon /> {label}</div>
      <div className="tdt__prop-value">{children}</div>
    </div>
  );
}
