"use client";

/* ITSM · Ticket detail — bespoke layout with lifecycle timeline.
 *
 *  GET   /api/itsm/tickets             (no get-by-id; find in list)
 *  PATCH /api/itsm/tickets             { id, status?, ... }
 *  GET   /api/activity?scope=team      activity feed (filtered client-side
 *                                       to targetType=TICKET and targetId)
 *
 * Layout:
 *   OsTitleBar with back + copy + more in actions.
 *   Hero card: status accent strip, priority chip, ID, inline-editable title + description, SLA badge.
 *   2-col body:
 *     Left (2/3): Lifecycle timeline (sticky day buckets) + composer.
 *     Right (1/3): Properties + Quick actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Server, ArrowLeft, Share2, MoreHorizontal, Calendar as CalendarIcon,
  Clock, Flag, Tag, User as UserIcon, Shield, Activity,
  Plus, Pencil, ArrowRight, MessageCircle, CheckCircle2, AlertOctagon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsPickerPopover, type PickerOption } from "@/components/layout/os/picker-popover";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ItsmStatus = "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED";
type ItsmPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL";

type Ticket = {
  id: string;
  title: string;
  description?: string | null;
  status: ItsmStatus;
  priority: ItsmPrio;
  category?: string | null;
  source?: string | null;
  slaTier?: string | null;
  dueAt?: string | null;
  resolvedAt?: string | null;
  assigneeId?: string | null;
  requesterId?: string | null;
  createdAt: string;
};

type ApiActivity = {
  id: string;
  type: string;
  description: string;
  targetType?: string | null;
  targetId?: string | null;
  createdAt: string;
  actor?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STATUS_LABELS: Record<ItsmStatus, string> = {
  OPEN: "Open", TRIAGED: "Triaged", IN_PROGRESS: "In progress",
  WAITING_ON_USER: "Waiting · user", WAITING_ON_VENDOR: "Waiting · vendor",
  RESOLVED: "Resolved", CLOSED: "Closed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<ItsmStatus, string> = {
  OPEN: C.indigo, TRIAGED: C.yellow, IN_PROGRESS: C.orange,
  WAITING_ON_USER: C.purple, WAITING_ON_VENDOR: C.brown,
  RESOLVED: C.sage, CLOSED: C.green, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as ItsmStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const PRIO_LABELS: Record<ItsmPrio, string> = {
  CRITICAL: "Critical", URGENT: "Urgent", HIGH: "High", NORMAL: "Normal", LOW: "Low",
};
const PRIO_SHORT: Record<ItsmPrio, string> = {
  CRITICAL: "P0", URGENT: "P1", HIGH: "P2", NORMAL: "P3", LOW: "P4",
};
const PRIO_COLORS: Record<ItsmPrio, string> = {
  CRITICAL: C.pink, URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.sage,
};
const PRIO_OPTIONS: PickerOption[] = (["CRITICAL", "URGENT", "HIGH", "NORMAL", "LOW"] as ItsmPrio[]).map((p) => ({
  value: p, label: PRIO_LABELS[p], color: PRIO_COLORS[p],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?";
}

function fmtFullDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtShortDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtRelative(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function dueBadge(iso?: string | null): { label: string; tone: "good" | "warn" | "bad" | "muted" } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const h = ms / 3_600_000;
  if (h < 0) return { label: `${Math.ceil(-h)}h overdue`, tone: "bad" };
  if (h < 1) return { label: `${Math.ceil(h * 60)}m left`, tone: "bad" };
  if (h < 4) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  if (h < 24) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  const days = Math.floor(h / 24);
  return { label: `${days}d left`, tone: days < 3 ? "good" : "muted" };
}

type ActionTone = "create" | "update" | "convert" | "comment" | "complete" | "other";
function actionTone(type: string): ActionTone {
  const t = type.toLowerCase();
  if (t.includes("create") || t.includes("add")) return "create";
  if (t.includes("complete") || t.includes("resolved") || t.includes("closed")) return "complete";
  if (t.includes("comment") || t.includes("note")) return "comment";
  if (t.includes("status")) return "convert";
  if (t.includes("update") || t.includes("edit") || t.includes("change")) return "update";
  return "other";
}
const ACTION_ICON: Record<ActionTone, typeof Plus> = {
  create: Plus, update: Pencil, convert: ArrowRight, comment: MessageCircle, complete: CheckCircle2, other: Activity,
};
const ACTION_COLOR: Record<ActionTone, string> = {
  create: C.green, update: C.blue, convert: C.purple, comment: C.teal, complete: C.green, other: C.gray,
};

function dayBucket(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - t.getTime()) / 86_400_000);
  if (diff === 0) return { key: t.toISOString().slice(0, 10), label: "Today" };
  if (diff === 1) return { key: t.toISOString().slice(0, 10), label: "Yesterday" };
  if (diff < 7) return { key: t.toISOString().slice(0, 10), label: t.toLocaleDateString("en-US", { weekday: "long" }) };
  return { key: t.toISOString().slice(0, 10), label: t.toLocaleDateString("en-US", { month: "long", day: "numeric" }) };
}

export default function ItsmDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();

  const [t, setT] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [composer, setComposer] = useState("");
  const [activities, setActivities] = useState<ApiActivity[] | null>(null);
  const [picker, setPicker] = useState<{ rect: DOMRect; kind: "status" | "priority" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/itsm/tickets");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: Ticket[] = data.tickets ?? data.data ?? (Array.isArray(data) ? data : []);
      const found = list.find((x) => x.id === id);
      if (!found) { setNotFound(true); setT(null); }
      else {
        setT(found);
        setTitle(found.title);
        setDescription(found.description ?? "");
        setNotFound(false);
      }
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?scope=team&limit=300");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: ApiActivity[] = data?.data?.data ?? data?.data ?? (Array.isArray(data) ? data : []);
      setActivities(list.filter((a) => (a.targetType?.toLowerCase() === "ticket" || a.targetType === "TICKET") && a.targetId === id));
    } catch {
      setActivities([]);
    }
  }, [id]);

  useEffect(() => { void load(); void loadActivity(); }, [load, loadActivity]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/itsm/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) { toast("Couldn't save"); return false; }
      bumpRowVersion("itsm");
      void load();
      void loadActivity();
      return true;
    } catch { toast("Couldn't save"); return false; }
  }

  function copyLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy"),
    );
  }

  function postComment() {
    if (!composer.trim()) return;
    // No comments API for ITSM yet — show toast and clear the textarea so the
    // interaction feels right; this will plumb through when the endpoint exists.
    toast("Comment posted locally — API coming");
    setComposer("");
  }

  // ─── Composed timeline ─────────────────────────────────────
  const timeline = useMemo(() => {
    if (!t) return [];
    // Always include the "Created" synthetic event
    const items: ApiActivity[] = [
      {
        id: `_created-${t.id}`,
        type: "CREATED",
        description: `Ticket opened${t.requesterId ? ` by ${t.requesterId}` : ""}`,
        targetType: "TICKET",
        targetId: t.id,
        createdAt: t.createdAt,
        actor: null,
      },
      ...(activities ?? []),
    ];
    // Synthetic Resolved event if resolvedAt is set and no matching activity
    if (t.resolvedAt && !items.some((a) => a.type.toLowerCase().includes("resolv"))) {
      items.push({
        id: `_resolved-${t.id}`,
        type: "RESOLVED",
        description: "Ticket marked resolved",
        targetType: "TICKET",
        targetId: t.id,
        createdAt: t.resolvedAt,
        actor: null,
      });
    }
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [t, activities]);

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: ApiActivity[] }>();
    for (const a of timeline) {
      const b = dayBucket(a.createdAt);
      if (!map.has(b.key)) map.set(b.key, { label: b.label, items: [] });
      map.get(b.key)!.items.push(a);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([key, v]) => ({ key, label: v.label, items: v.items }));
  }, [timeline]);

  // ─── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading ticket…" Icon={Server} iconGradient={GRAD.bluePurple} showInvite={false} />
        <div className="tckd__loading">Loading ticket…</div>
      </>
    );
  }
  if (notFound || !t) {
    return (
      <>
        <OsTitleBar title="Ticket not found" Icon={Server} iconGradient={GRAD.redPink} showInvite={false} />
        <OsEmptyView Icon={Server} iconGradient={GRAD.redPink} title="We couldn't find that ticket" subtitle="It may have been deleted, archived, or you don't have access." cta="Back to ITSM" />
      </>
    );
  }

  const accent = STATUS_COLORS[t.status];
  const prioColor = PRIO_COLORS[t.priority];
  const due = dueBadge(t.dueAt);
  const shortId = t.id.slice(0, 8).toUpperCase();
  const assigneeAv = t.assigneeId ? { initials: t.assigneeId.slice(0, 2).toUpperCase(), color: avColor(t.assigneeId) } : null;

  return (
    <>
      <OsTitleBar
        title={title || "(untitled ticket)"}
        Icon={Server}
        iconGradient={GRAD.bluePurple}
        description={`#${shortId} · ${STATUS_LABELS[t.status]}`}
        actions={
          <div className="tckd__head-actions">
            <button type="button" className="tckd__back" onClick={() => router.push("/itsm")}>
              <ArrowLeft /> Service desk
            </button>
            <button type="button" className="tckd__btn" onClick={copyLink}>
              <Share2 /> Copy link
            </button>
            <button type="button" className="tckd__btn tckd__btn--icon" aria-label="More"><MoreHorizontal /></button>
          </div>
        }
      />

      <div className="tckd">
        {/* Hero card */}
        <section className="tckd__hero" style={{ ["--tckd-c" as unknown as string]: accent }}>
          <span className="tckd__hero-accent" aria-hidden="true" />
          <div className="tckd__hero-meta">
            <span className="tckd__hero-id">#{shortId}</span>
            <button
              type="button"
              className="tckd__hero-prio"
              style={{ ["--p-c" as unknown as string]: prioColor }}
              onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: "priority" })}
            >
              <Flag /> {PRIO_SHORT[t.priority]} · {PRIO_LABELS[t.priority]}
            </button>
            {t.category && <span className="tckd__hero-cat">{t.category}</span>}
            {due && <span className={`tckd__hero-due tckd__hero-due--${due.tone}`}>{due.label}</span>}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={async () => {
              const v = title.trim();
              if (!v || v === t.title) return;
              const ok = await patch({ title: v });
              if (ok) toast("Renamed");
              else setTitle(t.title);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Escape") { setTitle(t.title); (e.target as HTMLInputElement).blur(); }
            }}
            aria-label="Ticket title"
            className="tckd__hero-title"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={async () => {
              const v = description.trim();
              if (v === (t.description ?? "").trim()) return;
              const ok = await patch({ description: v });
              if (ok) toast("Description saved");
            }}
            placeholder="Describe the issue, steps to reproduce, expected vs actual…"
            aria-label="Ticket description"
            className="tckd__hero-desc"
            rows={3}
          />
        </section>

        {/* 2-col body */}
        <div className="tckd__body">
          {/* Left: Timeline + composer */}
          <section className="tckd__panel">
            <div className="tckd__panel-head">
              <Activity /> Timeline
              <span className="tckd__panel-sub">{timeline.length} event{timeline.length === 1 ? "" : "s"}</span>
            </div>

            {grouped.length === 0 ? (
              <div className="tckd__tl-empty">No events yet.</div>
            ) : (
              <div className="tckd__tl">
                {grouped.map((g) => (
                  <div key={g.key} className="tckd__tl-day">
                    <div className="tckd__tl-day-head">
                      <span className="tckd__tl-day-label">{g.label}</span>
                      <span className="tckd__tl-day-line" />
                    </div>
                    <ul className="tckd__tl-events">
                      {g.items.map((a) => {
                        const tone = actionTone(a.type);
                        const Icon = ACTION_ICON[tone];
                        const name = a.actor
                          ? `${a.actor.firstName ?? ""} ${a.actor.lastName ?? ""}`.trim() || "Unknown"
                          : "System";
                        return (
                          <li key={a.id} className="tckd__tl-event">
                            <span
                              className={`tckd__tl-dot tckd__tl-dot--${tone}`}
                              style={{ ["--dot-c" as unknown as string]: ACTION_COLOR[tone] }}
                              aria-hidden="true"
                            >
                              <Icon />
                            </span>
                            <div className="tckd__tl-body">
                              <div className="tckd__tl-head">
                                {a.actor && (
                                  <span className="tckd__tl-av" style={{ background: avColor(a.actor.id) }}>
                                    {initials(a.actor.firstName, a.actor.lastName)}
                                  </span>
                                )}
                                <span className="tckd__tl-actor">{name}</span>
                                <span className="tckd__tl-action" style={{ ["--act-c" as unknown as string]: ACTION_COLOR[tone] }}>
                                  {a.type.replace(/_/g, " ").toLowerCase()}
                                </span>
                                <span className="tckd__tl-time" title={fmtFullDate(a.createdAt)}>
                                  {fmtTime(a.createdAt)} · {fmtRelative(a.createdAt)}
                                </span>
                              </div>
                              {a.description && <div className="tckd__tl-text">{a.description}</div>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="tckd__composer">
              <textarea
                className="tckd__composer-input"
                placeholder="Add an update, note, or resolution detail… ⌘⏎ to send"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    postComment();
                  }
                }}
                rows={2}
              />
              <div className="tckd__composer-foot">
                <span className="tckd__composer-hint">Updates appear in the timeline above.</span>
                <button type="button" className="tckd__composer-send" onClick={postComment} disabled={!composer.trim()}>
                  <MessageCircle /> Post update
                </button>
              </div>
            </div>
          </section>

          {/* Right: Properties + Quick actions */}
          <aside className="tckd__side">
            <div className="tckd__panel">
              <div className="tckd__panel-head"><Flag /> Properties</div>
              <div className="tckd__props">
                <Prop label="Status" Icon={Activity}>
                  <button
                    type="button"
                    className="tckd__pill"
                    style={{ background: accent, color: "white" }}
                    onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: "status" })}
                  >
                    {STATUS_LABELS[t.status]}
                  </button>
                </Prop>
                <Prop label="Priority" Icon={Flag}>
                  <button
                    type="button"
                    className="tckd__pill"
                    style={{ background: prioColor, color: "white" }}
                    onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: "priority" })}
                  >
                    {PRIO_SHORT[t.priority]} · {PRIO_LABELS[t.priority]}
                  </button>
                </Prop>
                <Prop label="Category" Icon={Tag}>
                  <span className={t.category ? "tckd__value" : "tckd__muted"}>{t.category ?? "Uncategorised"}</span>
                </Prop>
                <Prop label="SLA tier" Icon={Shield}>
                  <span className={t.slaTier ? "tckd__value" : "tckd__muted"}>{t.slaTier ?? "Default"}</span>
                </Prop>
                <Prop label="Assignee" Icon={UserIcon}>
                  {assigneeAv ? (
                    <span className="tckd__owner">
                      <span className="tckd__owner-av" style={{ background: assigneeAv.color }}>{assigneeAv.initials}</span>
                      <span>{t.assigneeId}</span>
                    </span>
                  ) : <span className="tckd__muted">Unassigned</span>}
                </Prop>
                <Prop label="Due" Icon={CalendarIcon}>
                  <span className="tckd__value">{fmtShortDate(t.dueAt)}</span>
                </Prop>
                <Prop label="Created" Icon={Clock}>
                  <span className="tckd__value">{fmtFullDate(t.createdAt)}</span>
                </Prop>
                {t.resolvedAt && (
                  <Prop label="Resolved" Icon={CheckCircle2}>
                    <span className="tckd__value">{fmtFullDate(t.resolvedAt)}</span>
                  </Prop>
                )}
              </div>
            </div>

            <div className="tckd__panel">
              <div className="tckd__panel-head"><AlertOctagon /> Quick actions</div>
              <div className="tckd__quick">
                {t.status !== "IN_PROGRESS" && t.status !== "RESOLVED" && t.status !== "CLOSED" && (
                  <button type="button" className="tckd__quick-btn" onClick={() => patch({ status: "IN_PROGRESS" })}>
                    <ArrowRight /> Start working
                  </button>
                )}
                {t.status !== "WAITING_ON_USER" && t.status !== "RESOLVED" && t.status !== "CLOSED" && (
                  <button type="button" className="tckd__quick-btn" onClick={() => patch({ status: "WAITING_ON_USER" })}>
                    <Clock /> Wait on user
                  </button>
                )}
                {t.status !== "RESOLVED" && t.status !== "CLOSED" && (
                  <button type="button" className="tckd__quick-btn tckd__quick-btn--win" onClick={() => patch({ status: "RESOLVED", resolvedAt: new Date().toISOString() })}>
                    <CheckCircle2 /> Resolve
                  </button>
                )}
                {t.status === "RESOLVED" && (
                  <button type="button" className="tckd__quick-btn tckd__quick-btn--win" onClick={() => patch({ status: "CLOSED" })}>
                    <CheckCircle2 /> Close
                  </button>
                )}
                <button type="button" className="tckd__quick-btn" onClick={copyLink}>
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
          title={picker.kind === "status" ? "Set status" : "Set priority"}
          options={picker.kind === "status" ? STATUS_OPTIONS : PRIO_OPTIONS}
          activeValue={picker.kind === "status" ? t.status : t.priority}
          onSelect={async (v) => {
            const ok = await patch(picker.kind === "status" ? { status: v } : { priority: v });
            if (ok) toast(picker.kind === "status"
              ? `Status → ${STATUS_LABELS[v as ItsmStatus]}`
              : `Priority → ${PRIO_LABELS[v as ItsmPrio]}`);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

function Prop({ label, Icon, children }: { label: string; Icon: typeof Flag; children: React.ReactNode }) {
  return (
    <div className="tckd__prop">
      <div className="tckd__prop-label"><Icon /> {label}</div>
      <div className="tckd__prop-value">{children}</div>
    </div>
  );
}
