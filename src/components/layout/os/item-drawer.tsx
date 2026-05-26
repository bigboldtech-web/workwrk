"use client";

/* OsItemDrawer — right-slide-in detail panel for any board row.
 *
 * Two data sources:
 *  1. `openItem.payload` (snapshot from the table at click time) — used
 *     for the inline fields panel at the top of the drawer (status,
 *     priority, owner, due, tags, progress) so the user sees the *real*
 *     row data the moment the drawer opens.
 *
 *  2. Lazy per-module fetches — for moduleId === "tasks" we hit
 *     `/api/tasks/[id]/comments` to load real Updates and let the
 *     composer POST new comments. For other modules we fall back to
 *     the original demo content so every drawer still feels populated.
 *
 * Sub-items / Files / Activity are sample content for now — no per-item
 * API exists in WorkwrK yet for those surfaces.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  X, Maximize2, MoreHorizontal, Share2, Star, Smile, Paperclip,
  AtSign, Send, MessageCircle, History, Files, ListTree, Calendar as CalendarIcon,
  CheckSquare,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { getModule, C } from "./catalog";
import { OsPickerPopover, type PickerOption } from "./picker-popover";
import type { StatusValue, PrioValue, LabelColor } from "./main-table";
import type { Person } from "./title-bar";

type DrawerTab = "updates" | "files" | "activity" | "subitems";

/** Modules that have a wired-up [id] detail page route. The drawer's
 *  Share button and Maximize ("Open as page") icon link to `/{moduleId}/{itemId}`
 *  for these; everything else gets a fallback to the current page URL. */
const MODULES_WITH_DETAIL = new Set([
  "tasks", "crm", "meetings", "itsm", "helpdesk", "recruiting", "marketing", "procurement",
]);

// ─── Task-specific persistence mappings ─────────────────────
const TASK_STATUS_OPTIONS: PickerOption[] = [
  { value: "planning", label: "Planned",     color: C.indigo },
  { value: "working",  label: "In progress", color: C.orange },
  { value: "done",     label: "Done",        color: C.green },
];
const TASK_PRIO_OPTIONS: PickerOption[] = [
  { value: "critical", label: "Critical", color: C.pink },
  { value: "high",     label: "High",     color: C.red },
  { value: "medium",   label: "Medium",   color: C.yellow },
  { value: "low",      label: "Low",      color: C.teal },
];
const TASK_STATUS_OS_TO_API: Partial<Record<StatusValue, string>> = {
  planning: "PLANNED",
  working: "IN_PROGRESS",
  done: "COMPLETED",
};
const TASK_PRIO_OS_TO_API: Partial<Record<PrioValue, string>> = {
  low: "LOW", medium: "NORMAL", high: "HIGH", critical: "URGENT",
};

// ─── Helpers ─────────────────────────────────────────────────
const STATUS_META: Record<StatusValue, { label: string; color: string }> = {
  done:     { label: "Done",          color: C.green },
  working:  { label: "Working on it", color: C.orange },
  stuck:    { label: "Stuck",         color: C.red },
  progress: { label: "In progress",   color: C.blue },
  review:   { label: "Review",        color: C.purple },
  hold:     { label: "On hold",       color: C.brown },
  planning: { label: "Planning",      color: C.indigo },
  shipped:  { label: "Shipped",       color: C.sage },
  pending:  { label: "Pending",       color: C.yellow },
  critical: { label: "Critical",      color: C.pink },
  empty:    { label: "—",             color: "var(--os-surface-2)" },
};

const PRIO_META: Record<PrioValue, { label: string; color: string }> = {
  critical: { label: "Critical", color: C.pink },
  high:     { label: "High",     color: C.red },
  medium:   { label: "Medium",   color: C.yellow },
  low:      { label: "Low",      color: C.teal },
  empty:    { label: "—",        color: "var(--os-surface-2)" },
};

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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

const AVATAR_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarColorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// ─── Types for what the drawer reads from openItem.payload ──
type StatusCell = { value: StatusValue; label?: string };
type PrioCell = { value: PrioValue; label?: string };
type DateCell = { iso: string; state?: "today" | "overdue" | "done" | "empty" };
type ProgressCell = { pct: number; color?: "green" | "warning" | "danger" | "blue" };
type TagsCell = { label: string; color: LabelColor }[];

type ApiComment = {
  id: string;
  body: string;
  createdAt: string;
  author?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
};

// ─── Component ───────────────────────────────────────────────
export function OsItemDrawer() {
  const { openItem, closeItemDrawer, bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();
  const [tab, setTab] = useState<DrawerTab>("updates");
  const [title, setTitle] = useState("");
  const [composer, setComposer] = useState("");

  // Real-data state (Tasks only for now)
  const [comments, setComments] = useState<ApiComment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [posting, setPosting] = useState(false);

  // Local overlay over openItem.payload so the drawer reflects edits the
  // user just made *before* the next page-level re-fetch completes.
  const [overlay, setOverlay] = useState<Record<string, unknown>>({});
  const [picker, setPicker] = useState<
    | null
    | { rect: DOMRect; type: "status" | "priority"; active?: string }
  >(null);

  useEffect(() => {
    if (openItem) {
      setTitle(openItem.name);
      setComposer("");
      setComments(null);
      setOverlay({});
      setPicker(null);
      setTab("updates");
    }
  }, [openItem]);

  // Lazy-fetch comments for Tasks when drawer opens or item changes
  useEffect(() => {
    if (!openItem || openItem.moduleId !== "tasks") return;
    let cancelled = false;
    setLoadingComments(true);
    fetch(`/api/tasks/${openItem.itemId}/comments`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        const list: ApiComment[] = Array.isArray(data) ? data : (data.data ?? []);
        setComments(list);
      })
      .catch(() => {
        if (!cancelled) setComments([]); // empty state — drawer still works
      })
      .finally(() => { if (!cancelled) setLoadingComments(false); });
    return () => { cancelled = true; };
  }, [openItem]);

  const mod = openItem ? getModule(openItem.moduleId) : null;

  // ─── Pull real cell values out of the payload (with local overlay) ──
  const cells = { ...(openItem?.payload ?? {}), ...overlay };
  const statusCell = cells.status as StatusCell | undefined;
  const prioCell = cells.prio as PrioCell | undefined;
  const ownerCell = cells.owner as Person[] | undefined;
  const dueCell = cells.due as DateCell | undefined;
  const tagsCell = cells.tags as TagsCell | undefined;
  const progressCell = cells.prog as ProgressCell | undefined;

  const isTaskModule = openItem?.moduleId === "tasks";

  // ─── Persistence helpers for the inline fields panel ────────
  async function patchTask(body: Record<string, unknown>) {
    if (!openItem) return false;
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: openItem.itemId, ...body }),
      });
      if (!res.ok) throw new Error(String(res.status));
      bumpRowVersion("tasks");
      return true;
    } catch {
      toast("Couldn't save — try again");
      return false;
    }
  }

  async function handleStatusPick(value: string) {
    if (!openItem) return;
    const prev = statusCell;
    setOverlay((o) => ({ ...o, status: { value } }));
    if (isTaskModule) {
      const apiStatus = TASK_STATUS_OS_TO_API[value as StatusValue];
      if (!apiStatus) return;
      const ok = await patchTask({ status: apiStatus });
      if (!ok) setOverlay((o) => ({ ...o, status: prev }));
      else toast(`Status set to "${TASK_STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value}"`);
    }
  }

  async function handlePrioPick(value: string) {
    if (!openItem) return;
    const prev = prioCell;
    setOverlay((o) => ({ ...o, prio: { value } }));
    if (isTaskModule) {
      const apiPrio = TASK_PRIO_OS_TO_API[value as PrioValue];
      if (!apiPrio) return;
      const ok = await patchTask({ priority: apiPrio });
      if (!ok) setOverlay((o) => ({ ...o, prio: prev }));
      else toast(`Priority set to "${TASK_PRIO_OPTIONS.find((o) => o.value === value)?.label ?? value}"`);
    }
  }

  async function handleTitleBlur() {
    if (!openItem || !isTaskModule) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === openItem.name) return;
    const ok = await patchTask({ title: trimmed });
    if (ok) toast("Renamed");
    else setTitle(openItem.name);
  }

  async function postComment() {
    if (!openItem || !composer.trim() || posting) return;
    if (!isTaskModule) {
      toast("Updates not yet wired for this module");
      return;
    }
    const text = composer.trim();
    setComposer("");
    setPosting(true);
    // optimistic
    const tempId = `temp-${Date.now()}`;
    const optimistic: ApiComment = {
      id: tempId,
      body: text,
      createdAt: new Date().toISOString(),
      author: { id: "you", firstName: "You", lastName: "" },
    };
    setComments((c) => [...(c ?? []), optimistic]);
    try {
      const res = await fetch(`/api/tasks/${openItem.itemId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const created: ApiComment = data.data ?? data;
      setComments((c) => (c ?? []).map((x) => (x.id === tempId ? created : x)));
      toast("Update posted");
    } catch {
      setComments((c) => (c ?? []).filter((x) => x.id !== tempId));
      setComposer(text);
      toast("Couldn't post — try again");
    } finally {
      setPosting(false);
    }
  }

  // ─── Status / priority pills derived from real payload ──────
  const statusMeta = statusCell ? STATUS_META[statusCell.value] : null;
  const prioMeta = prioCell ? PRIO_META[prioCell.value] : null;

  // Sample fallbacks for non-Tasks modules so the drawer still demos well
  const sampleUpdates = useMemo(() => [
    { id: "s1", body: "Reviewed the welcome email — ship it. The day-5 one needs a CTA tweak though.", createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      author: { id: "sc", firstName: "Sarah", lastName: "Cohen" } },
    { id: "s2", body: "Moved status to **Working** · pushed first 4 emails for review.",
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      author: { id: "bb", firstName: "BigBold", lastName: "Tech" } },
    { id: "s3", body: "Added the new user-onboarding SOP to the related docs · docs/sop-onboarding-v2",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      author: { id: "mk", firstName: "Maya", lastName: "Kapoor" } },
  ] as ApiComment[], []);

  const visibleUpdates: ApiComment[] = isTaskModule ? (comments ?? []) : sampleUpdates;

  return (
    <>
      <button
        type="button"
        className={`os-drawer-bd ${openItem ? "is-open" : ""}`}
        onClick={closeItemDrawer}
        aria-label="Close drawer"
        tabIndex={openItem ? 0 : -1}
      />
      <aside
        className={`os-drawer ${openItem ? "is-open" : ""}`}
        aria-hidden={!openItem}
      >
        {openItem && mod ? (
          <>
            <div className="os-drawer__head">
              <div className="os-drawer__head-row">
                <div className="os-drawer__crumb">
                  <span className="os-drawer__crumb-icon" style={{ background: mod.gradient }}>
                    <mod.Icon />
                  </span>
                  <span>{mod.name}</span>
                  <span className="os-drawer__crumb-sep">/</span>
                  <span style={{ fontFamily: "var(--os-font)" }}>{openItem.itemId.slice(0, 10)}</span>
                </div>
                <div className="os-drawer__head-actions">
                  <button type="button" className="os-drawer__icon-btn" aria-label="Pin"><Star /></button>
                  <button
                    type="button"
                    className="os-drawer__icon-btn"
                    aria-label="Copy link"
                    title="Copy link to this item"
                    onClick={() => {
                      const url = MODULES_WITH_DETAIL.has(openItem.moduleId)
                        ? `${window.location.origin}/${openItem.moduleId}/${openItem.itemId}`
                        : window.location.href;
                      void navigator.clipboard.writeText(url).then(
                        () => toast("Link copied"),
                        () => toast("Couldn't copy"),
                      );
                    }}
                  >
                    <Share2 />
                  </button>
                  {MODULES_WITH_DETAIL.has(openItem.moduleId) ? (
                    <Link
                      href={`/${openItem.moduleId}/${openItem.itemId}`}
                      className="os-drawer__icon-btn"
                      aria-label="Open as page"
                      title="Open as full page"
                      onClick={() => closeItemDrawer()}
                    >
                      <Maximize2 />
                    </Link>
                  ) : (
                    <button type="button" className="os-drawer__icon-btn" aria-label="Expand"><Maximize2 /></button>
                  )}
                  <button type="button" className="os-drawer__icon-btn" aria-label="More options"><MoreHorizontal /></button>
                  <button type="button" className="os-drawer__icon-btn" aria-label="Close" onClick={closeItemDrawer}>
                    <X />
                  </button>
                </div>
              </div>

              <div className="os-drawer__title">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                    if (e.key === "Escape") {
                      setTitle(openItem.name);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  aria-label="Item title"
                />
                {statusMeta ? (
                  <button
                    type="button"
                    className="os-drawer__title-status"
                    style={{
                      background: statusMeta.color,
                      color: statusMeta.color === C.yellow ? C.indigo : "white",
                      cursor: isTaskModule ? "pointer" : "default",
                      border: "none",
                    }}
                    onClick={(e) => {
                      if (!isTaskModule) return;
                      setPicker({
                        rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                        type: "status",
                        active: statusCell?.value,
                      });
                    }}
                  >
                    {statusMeta.label}
                  </button>
                ) : null}
              </div>

              <div className="os-drawer__tabs" role="tablist">
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "updates" ? "is-active" : ""}`} onClick={() => setTab("updates")}>
                  <MessageCircle />
                  Updates
                  <span className="os-drawer__tab-count">{visibleUpdates.length}</span>
                </button>
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "files" ? "is-active" : ""}`} onClick={() => setTab("files")}>
                  <Files />
                  Files
                </button>
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "activity" ? "is-active" : ""}`} onClick={() => setTab("activity")}>
                  <History />
                  Activity
                </button>
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "subitems" ? "is-active" : ""}`} onClick={() => setTab("subitems")}>
                  <ListTree />
                  Sub-items
                </button>
              </div>
            </div>

            <div className="os-drawer__body">
              {/* Inline editable fields — rendered from real payload */}
              <div className="os-drawer__fields">
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Status</span>
                  <span className="os-drawer__field-value">
                    {statusMeta ? (
                      <button
                        type="button"
                        className="os-drawer__field-pill"
                        style={{
                          background: statusMeta.color,
                          color: statusMeta.color === C.yellow ? C.indigo : "white",
                          cursor: isTaskModule ? "pointer" : "default",
                          border: "none",
                        }}
                        onClick={(e) => {
                          if (!isTaskModule) return;
                          setPicker({
                            rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                            type: "status",
                            active: statusCell?.value,
                          });
                        }}
                      >
                        {statusMeta.label}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="os-drawer__field-add"
                        onClick={(e) => isTaskModule && setPicker({
                          rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                          type: "status",
                        })}
                      >
                        Set status
                      </button>
                    )}
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Priority</span>
                  <span className="os-drawer__field-value">
                    {prioMeta && prioCell?.value !== "empty" ? (
                      <button
                        type="button"
                        className="os-drawer__field-pill"
                        style={{
                          background: prioMeta.color,
                          color: prioMeta.color === C.yellow ? C.indigo : "white",
                          cursor: isTaskModule ? "pointer" : "default",
                          border: "none",
                        }}
                        onClick={(e) => {
                          if (!isTaskModule) return;
                          setPicker({
                            rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                            type: "priority",
                            active: prioCell?.value,
                          });
                        }}
                      >
                        {prioMeta.label}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="os-drawer__field-add"
                        onClick={(e) => isTaskModule && setPicker({
                          rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                          type: "priority",
                        })}
                      >
                        Set priority
                      </button>
                    )}
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Owner</span>
                  <span className="os-drawer__field-value">
                    {ownerCell && ownerCell.length > 0 ? (
                      <>
                        {ownerCell.slice(0, 3).map((p, i) => (
                          <span
                            key={i}
                            className="os-av os-av--sm"
                            style={{ background: p.color, marginLeft: i === 0 ? 0 : -6, border: "2px solid var(--os-canvas)" }}
                          >
                            {p.initials}
                          </span>
                        ))}
                        <span style={{ fontSize: 12, color: "var(--os-ink-2)", marginLeft: 6 }}>
                          {ownerCell.length} assigned
                        </span>
                      </>
                    ) : (
                      <button type="button" className="os-drawer__field-add">Assign</button>
                    )}
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Due date</span>
                  <span className="os-drawer__field-value">
                    {dueCell?.iso && dueCell.state !== "empty" ? (
                      <>
                        <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
                        <span style={
                          dueCell.state === "overdue" ? { color: "var(--os-c-red)", fontWeight: 600 } :
                          dueCell.state === "today" ? { color: "#B26800", fontWeight: 600 } :
                          dueCell.state === "done" ? { color: "var(--os-c-sage)" } :
                          undefined
                        }>
                          {fmtDate(dueCell.iso)}
                        </span>
                      </>
                    ) : (
                      <button type="button" className="os-drawer__field-add">Set date</button>
                    )}
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Labels</span>
                  <span className="os-drawer__field-value" style={{ flexWrap: "wrap" }}>
                    {tagsCell && tagsCell.length > 0 ? (
                      tagsCell.map((t, i) => (
                        <span key={i} className={`os-drawer__field-tag os-c-${t.color}`}>{t.label}</span>
                      ))
                    ) : null}
                    <button type="button" className="os-drawer__field-add">+</button>
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Progress</span>
                  <span className="os-drawer__field-value">
                    {progressCell ? (
                      <>
                        <span style={{ width: 100, height: 6, background: "var(--os-surface-2)", borderRadius: 999, overflow: "hidden" }}>
                          <span style={{
                            display: "block",
                            width: `${progressCell.pct}%`,
                            height: "100%",
                            background:
                              progressCell.color === "danger"  ? C.red :
                              progressCell.color === "warning" ? C.orange :
                              progressCell.color === "blue"    ? C.blue :
                              C.green,
                            borderRadius: 999,
                          }} />
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--os-ink-2)" }}>{progressCell.pct}%</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--os-ink-3)" }}>—</span>
                    )}
                  </span>
                </div>
              </div>

              {tab === "updates" && (
                <>
                  <h3 className="os-drawer__section-title">
                    <MessageCircle />
                    Updates
                    {isTaskModule && loadingComments ? <span style={{ fontWeight: 500, color: "var(--os-ink-3)", marginLeft: 6 }}>loading…</span> : null}
                  </h3>

                  {visibleUpdates.length === 0 && !loadingComments ? (
                    <div style={{ padding: "20px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
                      No updates yet. Start the conversation below.
                    </div>
                  ) : (
                    visibleUpdates.map((u) => {
                      const author = u.author;
                      const initials = author
                        ? ((author.firstName?.[0] ?? "") + (author.lastName?.[0] ?? "")).toUpperCase() || "?"
                        : "?";
                      const color = avatarColorFor(author?.id ?? u.id);
                      const fullName = author
                        ? `${author.firstName ?? ""} ${author.lastName ?? ""}`.trim() || "Unknown"
                        : "Unknown";
                      return (
                        <div key={u.id} className="os-drawer__update">
                          <span className="os-av os-av--md" style={{ background: color }}>{initials}</span>
                          <div className="os-drawer__update-body">
                            <div className="os-drawer__update-head">
                              <span className="os-drawer__update-author">{fullName}</span>
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

                  <div className="os-drawer__composer">
                    <textarea
                      className="os-drawer__composer-input"
                      placeholder={isTaskModule ? "Write an update…" : "Updates not wired for this module yet"}
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void postComment();
                        }
                      }}
                      disabled={!isTaskModule || posting}
                    />
                    <div className="os-drawer__composer-foot">
                      <button type="button" className="os-drawer__composer-icon" aria-label="Attach"><Paperclip /></button>
                      <button type="button" className="os-drawer__composer-icon" aria-label="Emoji"><Smile /></button>
                      <button type="button" className="os-drawer__composer-icon" aria-label="Mention"><AtSign /></button>
                      <button
                        type="button"
                        className="os-drawer__composer-send"
                        onClick={() => void postComment()}
                        disabled={!isTaskModule || !composer.trim() || posting}
                      >
                        <Send />
                        {posting ? "Posting…" : "Update"}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {tab === "activity" && (
                <>
                  <h3 className="os-drawer__section-title">
                    <History />
                    Recent activity
                  </h3>
                  {[
                    { who: "Sarah Cohen", what: <>changed <strong>Status</strong> from <strong>Planning</strong> to <strong>Working on it</strong></>, color: C.orange, when: "12 min ago" },
                    { who: "BigBold (You)", what: <>assigned <strong>Sarah Cohen</strong></>, color: C.purple, when: "1 hr ago" },
                    { who: "BigBold (You)", what: <>set <strong>Due date</strong> to Fri, Sep 12</>, color: C.blue, when: "1 hr ago" },
                    { who: "BigBold (You)", what: <>created this item</>, color: C.indigo, when: "yesterday" },
                  ].map((a, i) => (
                    <div key={i} className="os-drawer__activity">
                      <span className="os-drawer__activity-dot" style={{ background: a.color }} />
                      <span><strong>{a.who}</strong> {a.what}</span>
                      <span className="os-drawer__activity-time">{a.when}</span>
                    </div>
                  ))}
                  <div style={{ padding: "16px 0 4px", color: "var(--os-ink-3)", fontSize: 12, fontStyle: "italic", textAlign: "center" }}>
                    (sample activity — real activity log API coming next)
                  </div>
                </>
              )}

              {tab === "files" && (
                <>
                  <h3 className="os-drawer__section-title">
                    <Files />
                    Files
                  </h3>
                  <div style={{ padding: "32px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
                    No files attached to this item.
                    <div style={{ marginTop: 12 }}>
                      <button type="button" className="os-drawer__field-add">
                        <Paperclip style={{ width: 12, height: 12, marginRight: 4 }} />
                        Attach a file
                      </button>
                    </div>
                  </div>
                </>
              )}

              {tab === "subitems" && (
                <>
                  <h3 className="os-drawer__section-title">
                    <ListTree />
                    Sub-items
                  </h3>
                  <div style={{ padding: "20px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
                    Sub-items coming soon. For now, create related items in the main table.
                  </div>
                  <button type="button" className="os-tbl-add" style={{ paddingLeft: 0 }}>
                    <CheckSquare />
                    Add sub-item
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
      </aside>
      {picker ? (
        <OsPickerPopover
          anchorRect={picker.rect}
          title={picker.type === "status" ? "Set status" : "Set priority"}
          options={picker.type === "status" ? TASK_STATUS_OPTIONS : TASK_PRIO_OPTIONS}
          activeValue={picker.active}
          onSelect={(v) => (picker.type === "status" ? handleStatusPick(v) : handlePrioPick(v))}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}
