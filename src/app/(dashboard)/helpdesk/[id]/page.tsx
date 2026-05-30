"use client";

/* Helpdesk · Ticket — chat-like conversation view.
 *
 *  GET   /api/helpdesk/tickets        (find by id; no get-by-id surface)
 *  PATCH /api/helpdesk/tickets        { id, status?, priority?, ... }
 *  GET   /api/activity?scope=team     (timeline filtered to this ticket)
 *
 * Layout:
 *   OsTitleBar with back + copy + more in actions.
 *   Hero strip: priority + status + customer + subject + SLA countdown.
 *   2-col body:
 *     Left wide: chat thread (customer left-bubble, agent right-bubble, system center)
 *       + sticky composer with "Customer reply" vs "Internal note" tabs.
 *     Right: Customer profile + Properties + Quick actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Headphones, ArrowLeft, Share2, MoreHorizontal,
  Mail, MessageCircle, Globe, Phone, Bot,
  Send, Paperclip, Smile, AlertOctagon, Clock,
  Flag, User as UserIcon, Building2, Star, CheckCircle2,
  Activity, Pencil, Plus, ArrowRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsPickerPopover, type PickerOption } from "@/components/layout/os/picker-popover";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type HdStatus = "NEW" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_INTERNAL" | "RESOLVED" | "CLOSED" | "SPAM";
type HdPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type SupportTicket = {
  id: string;
  subject: string;
  body?: string | null;
  status: HdStatus;
  priority: HdPrio;
  channel?: string | null;
  category?: string | null;
  slaTier?: string | null;
  csatScore?: number | null;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  customer?: { id: string; name?: string | null; email?: string | null; companyName?: string | null } | null;
  assigneeId?: string | null;
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

const STATUS_LABELS: Record<HdStatus, string> = {
  NEW: "New", OPEN: "Open", PENDING_CUSTOMER: "Pending · customer",
  PENDING_INTERNAL: "Pending · internal", RESOLVED: "Resolved", CLOSED: "Closed", SPAM: "Spam",
};
const STATUS_COLORS: Record<HdStatus, string> = {
  NEW: C.indigo, OPEN: C.orange, PENDING_CUSTOMER: C.purple,
  PENDING_INTERNAL: C.brown, RESOLVED: C.sage, CLOSED: C.green, SPAM: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as HdStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const PRIO_LABELS: Record<HdPrio, string> = { URGENT: "Urgent", HIGH: "High", NORMAL: "Normal", LOW: "Low" };
const PRIO_SHORT: Record<HdPrio, string> = { URGENT: "P1", HIGH: "P2", NORMAL: "P3", LOW: "P4" };
const PRIO_COLORS: Record<HdPrio, string> = { URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.sage };
const PRIO_OPTIONS: PickerOption[] = (["URGENT", "HIGH", "NORMAL", "LOW"] as HdPrio[]).map((p) => ({
  value: p, label: PRIO_LABELS[p], color: PRIO_COLORS[p],
}));

const CHANNEL_META: Record<string, { Icon: typeof Mail; color: string }> = {
  email: { Icon: Mail, color: C.blue },
  chat: { Icon: MessageCircle, color: C.purple },
  portal: { Icon: Globe, color: C.green },
  phone: { Icon: Phone, color: C.orange },
  api: { Icon: Bot, color: C.gray },
};
function channelMeta(ch?: string | null): { Icon: typeof Mail; color: string; label: string } {
  const k = (ch ?? "email").toLowerCase();
  for (const key of Object.keys(CHANNEL_META)) {
    if (k.includes(key)) return { ...CHANNEL_META[key], label: ch ?? key };
  }
  return { Icon: Mail, color: C.indigo, label: ch ?? "—" };
}

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function fmtFull(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function dueBadge(iso?: string | null, answered?: boolean): { label: string; tone: "good" | "warn" | "bad" | "muted" } | null {
  if (!iso) return null;
  if (answered) return { label: "Answered", tone: "good" };
  const ms = new Date(iso).getTime() - Date.now();
  const h = ms / 3_600_000;
  if (h < 0) return { label: `${Math.ceil(-h)}h late`, tone: "bad" };
  if (h < 1) return { label: `${Math.ceil(h * 60)}m left`, tone: "bad" };
  if (h < 4) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  if (h < 24) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  const d = Math.floor(h / 24);
  return { label: `${d}d left`, tone: d < 3 ? "good" : "muted" };
}

type ChatItem =
  | { kind: "customer"; id: string; iso: string; text: string }
  | { kind: "agent"; id: string; iso: string; text: string; author: string; authorId: string }
  | { kind: "system"; id: string; iso: string; text: string; tone: "info" | "good" | "bad" };

function dayBucket(iso: string): { key: string; label: string } {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return { key: d.toISOString().slice(0, 10), label: "Today" };
  if (diff === 1) return { key: d.toISOString().slice(0, 10), label: "Yesterday" };
  return { key: d.toISOString().slice(0, 10), label: fmtDate(iso) };
}

type ComposerKind = "reply" | "note";

export default function HelpdeskDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();

  const [t, setT] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activities, setActivities] = useState<ApiActivity[] | null>(null);
  const [composer, setComposer] = useState("");
  const [composerKind, setComposerKind] = useState<ComposerKind>("reply");
  const [picker, setPicker] = useState<{ rect: DOMRect; kind: "status" | "priority" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/helpdesk/tickets");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: SupportTicket[] = data.tickets ?? data.data ?? (Array.isArray(data) ? data : []);
      const found = list.find((x) => x.id === id);
      if (!found) { setNotFound(true); setT(null); }
      else { setT(found); setNotFound(false); }
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?scope=team&limit=200");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: ApiActivity[] = data?.data?.data ?? data?.data ?? (Array.isArray(data) ? data : []);
      setActivities(list.filter((a) => {
        const tt = (a.targetType ?? "").toLowerCase();
        return (tt === "support_ticket" || tt === "supportticket" || tt === "helpdesk_ticket") && a.targetId === id;
      }));
    } catch { setActivities([]); }
  }, [id]);

  useEffect(() => { void load(); void loadActivity(); }, [load, loadActivity]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) { toast("Couldn't save"); return false; }
      bumpRowVersion("helpdesk");
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

  function sendComposer() {
    if (!composer.trim()) return;
    toast(composerKind === "reply" ? "Reply posted (UI only — API coming)" : "Internal note saved (UI only — API coming)");
    setComposer("");
  }

  // ─── Compose chat thread ─────────────────────────────────
  const chatItems = useMemo<ChatItem[]>(() => {
    if (!t) return [];
    const items: ChatItem[] = [];
    // Initial customer message from t.body
    items.push({
      kind: "customer",
      id: `_initial-${t.id}`,
      iso: t.createdAt,
      text: t.body ?? "(no message body)",
    });
    // Activity log entries
    for (const a of activities ?? []) {
      const type = a.type.toLowerCase();
      if (type.includes("comment") || type.includes("reply") || type.includes("message")) {
        const author = a.actor ? `${a.actor.firstName ?? ""} ${a.actor.lastName ?? ""}`.trim() || "Agent" : "Agent";
        items.push({ kind: "agent", id: a.id, iso: a.createdAt, text: a.description, author, authorId: a.actor?.id ?? "agent" });
      } else {
        const tone = type.includes("delete") || type.includes("escalat") ? "bad"
          : type.includes("resolv") || type.includes("complet") ? "good"
          : "info";
        items.push({ kind: "system", id: a.id, iso: a.createdAt, text: a.description, tone });
      }
    }
    if (t.firstResponseAt && !items.some((x) => x.kind === "system" && x.text.toLowerCase().includes("first"))) {
      items.push({
        kind: "system",
        id: `_first-resp-${t.id}`,
        iso: t.firstResponseAt,
        text: "First response sent",
        tone: "good",
      });
    }
    if (t.resolvedAt) {
      items.push({
        kind: "system",
        id: `_resolved-${t.id}`,
        iso: t.resolvedAt,
        text: "Ticket resolved",
        tone: "good",
      });
    }
    return items.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  }, [t, activities]);

  // Group chat by day
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: ChatItem[] }>();
    for (const item of chatItems) {
      const b = dayBucket(item.iso);
      if (!map.has(b.key)) map.set(b.key, { label: b.label, items: [] });
      map.get(b.key)!.items.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, label: v.label, items: v.items }));
  }, [chatItems]);

  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading ticket…" Icon={Headphones} iconGradient={GRAD.orangePink} showInvite={false} />
        <div className="hdcd__loading">Loading conversation…</div>
      </>
    );
  }
  if (notFound || !t) {
    return (
      <>
        <OsTitleBar title="Ticket not found" Icon={Headphones} iconGradient={GRAD.redPink} showInvite={false} />
        <OsEmptyView Icon={Headphones} iconGradient={GRAD.redPink} title="We couldn't find that ticket" subtitle="It may have been deleted, marked spam, or you don't have access." cta="Back to Helpdesk" />
      </>
    );
  }

  const statusColor = STATUS_COLORS[t.status];
  const prioColor = PRIO_COLORS[t.priority];
  const due = dueBadge(t.firstResponseDueAt, !!t.firstResponseAt);
  const ch = channelMeta(t.channel);
  const ChIcon = ch.Icon;
  const customerName = t.customer?.companyName || t.customer?.name || t.customer?.email || "Anonymous";
  const customerInit = initialsFromName(customerName);
  const customerColor = t.customer ? avColor(t.customer.id) : C.gray;
  const shortId = t.id.slice(0, 8).toUpperCase();

  return (
    <>
      <OsTitleBar
        title={t.subject || "(no subject)"}
        Icon={Headphones}
        iconGradient={GRAD.orangePink}
        description={`#${shortId} · ${STATUS_LABELS[t.status]} · ${ch.label}`}
        actions={
          <div className="hdcd__head-actions">
            <button type="button" className="hdcd__back" onClick={() => router.push("/helpdesk")}>
              <ArrowLeft /> Inbox
            </button>
            <button type="button" className="hdcd__btn" onClick={copyLink}>
              <Share2 /> Copy link
            </button>
            <button type="button" className="hdcd__btn hdcd__btn--icon" aria-label="More"><MoreHorizontal /></button>
          </div>
        }
      />

      <div className="hdcd">
        {/* Hero strip */}
        <section className="hdcd__hero" style={{ ["--hdcd-c" as unknown as string]: statusColor }}>
          <span className="hdcd__hero-accent" aria-hidden="true" />
          <div className="hdcd__hero-meta">
            <span className="hdcd__hero-id">#{shortId}</span>
            <button
              type="button"
              className="hdcd__hero-prio"
              style={{ ["--p-c" as unknown as string]: prioColor }}
              onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: "priority" })}
            >
              <Flag /> {PRIO_SHORT[t.priority]} · {PRIO_LABELS[t.priority]}
            </button>
            <button
              type="button"
              className="hdcd__hero-status"
              style={{ background: statusColor, color: "white" }}
              onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: "status" })}
            >
              {STATUS_LABELS[t.status]}
            </button>
            <span className="hdcd__hero-channel" style={{ ["--ch-c" as unknown as string]: ch.color }}>
              <ChIcon /> {ch.label}
            </span>
            {due && <span className={`hdcd__hero-due hdcd__hero-due--${due.tone}`}><Clock /> {due.label}</span>}
            {typeof t.csatScore === "number" && (
              <span className="hdcd__hero-csat">
                <Star /> {t.csatScore}/5
              </span>
            )}
          </div>
          <h2 className="hdcd__hero-subject">{t.subject}</h2>
        </section>

        {/* 2-col body */}
        <div className="hdcd__body">
          {/* Chat thread + composer */}
          <section className="hdcd__panel hdcd__panel--chat">
            <div className="hdcd__panel-head">
              <MessageCircle /> Conversation
              <span className="hdcd__panel-sub">{chatItems.length} item{chatItems.length === 1 ? "" : "s"}</span>
            </div>

            {grouped.length === 0 ? (
              <div className="hdcd__chat-empty">No conversation yet.</div>
            ) : (
              <div className="hdcd__chat">
                {grouped.map((g) => (
                  <div key={g.key} className="hdcd__day">
                    <div className="hdcd__day-head">
                      <span />
                      <span className="hdcd__day-label">{g.label}</span>
                      <span />
                    </div>
                    {g.items.map((item) => {
                      if (item.kind === "system") {
                        return (
                          <div key={item.id} className={`hdcd__sys hdcd__sys--${item.tone}`}>
                            <span className="hdcd__sys-text">{item.text}</span>
                            <span className="hdcd__sys-time">{fmtTime(item.iso)}</span>
                          </div>
                        );
                      }
                      if (item.kind === "customer") {
                        return (
                          <div key={item.id} className="hdcd__msg hdcd__msg--cust">
                            <span className="hdcd__msg-av" style={{ background: customerColor }}>{customerInit}</span>
                            <div className="hdcd__msg-stack">
                              <div className="hdcd__msg-head">
                                <span className="hdcd__msg-author">{customerName}</span>
                                <span className="hdcd__msg-time">{fmtTime(item.iso)}</span>
                              </div>
                              <div className="hdcd__msg-bubble">{item.text}</div>
                            </div>
                          </div>
                        );
                      }
                      // agent
                      const agentColor = avColor(item.authorId);
                      const agentInit = initialsFromName(item.author);
                      return (
                        <div key={item.id} className="hdcd__msg hdcd__msg--agent">
                          <div className="hdcd__msg-stack hdcd__msg-stack--right">
                            <div className="hdcd__msg-head">
                              <span className="hdcd__msg-time">{fmtTime(item.iso)}</span>
                              <span className="hdcd__msg-author">{item.author}</span>
                            </div>
                            <div className="hdcd__msg-bubble hdcd__msg-bubble--agent">{item.text}</div>
                          </div>
                          <span className="hdcd__msg-av" style={{ background: agentColor }}>{agentInit}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className={`hdcd__composer${composerKind === "note" ? " is-note" : ""}`}>
              <div className="hdcd__composer-tabs">
                <button type="button" className={composerKind === "reply" ? "is-active" : ""} onClick={() => setComposerKind("reply")}>
                  <Mail /> Customer reply
                </button>
                <button type="button" className={composerKind === "note" ? "is-active" : ""} onClick={() => setComposerKind("note")}>
                  <Pencil /> Internal note
                </button>
              </div>
              <textarea
                className="hdcd__composer-input"
                placeholder={composerKind === "reply" ? "Reply to the customer… ⌘⏎ to send" : "Add a note for your team (not visible to customer)…"}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    sendComposer();
                  }
                }}
                rows={3}
              />
              <div className="hdcd__composer-foot">
                <div className="hdcd__composer-tools">
                  <button type="button" className="hdcd__composer-icon" aria-label="Attach"><Paperclip /></button>
                  <button type="button" className="hdcd__composer-icon" aria-label="Macros" title="Apply macro"><Bot /></button>
                  <button type="button" className="hdcd__composer-icon" aria-label="Emoji"><Smile /></button>
                </div>
                <button type="button" className="hdcd__composer-send" onClick={sendComposer} disabled={!composer.trim()}>
                  <Send /> {composerKind === "reply" ? "Send reply" : "Save note"}
                </button>
              </div>
            </div>
          </section>

          {/* Sidebar */}
          <aside className="hdcd__side">
            {/* Customer profile */}
            <div className="hdcd__panel">
              <div className="hdcd__panel-head"><UserIcon /> Customer</div>
              <div className="hdcd__cust-card">
                <span className="hdcd__cust-av" style={{ background: customerColor }}>{customerInit}</span>
                <div className="hdcd__cust-info">
                  <div className="hdcd__cust-name">{customerName}</div>
                  {t.customer?.email && (
                    <div className="hdcd__cust-line"><Mail /> {t.customer.email}</div>
                  )}
                  {t.customer?.companyName && t.customer?.name && (
                    <div className="hdcd__cust-line"><Building2 /> {t.customer.companyName}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Properties */}
            <div className="hdcd__panel">
              <div className="hdcd__panel-head"><Flag /> Properties</div>
              <div className="hdcd__props">
                <Prop label="Status" Icon={Activity}>
                  <button
                    type="button"
                    className="hdcd__pill"
                    style={{ background: statusColor, color: "white" }}
                    onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: "status" })}
                  >
                    {STATUS_LABELS[t.status]}
                  </button>
                </Prop>
                <Prop label="Priority" Icon={Flag}>
                  <button
                    type="button"
                    className="hdcd__pill"
                    style={{ background: prioColor, color: "white" }}
                    onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: "priority" })}
                  >
                    {PRIO_SHORT[t.priority]} · {PRIO_LABELS[t.priority]}
                  </button>
                </Prop>
                <Prop label="Channel" Icon={Mail}>
                  <span className="hdcd__chan" style={{ ["--ch-c" as unknown as string]: ch.color }}>
                    <ChIcon /> {ch.label}
                  </span>
                </Prop>
                <Prop label="SLA tier" Icon={Clock}>
                  <span className={t.slaTier ? "hdcd__value" : "hdcd__muted"}>{t.slaTier ?? "Default"}</span>
                </Prop>
                <Prop label="1st reply by" Icon={Clock}>
                  <span className="hdcd__value">{fmtFull(t.firstResponseDueAt)}</span>
                </Prop>
                {typeof t.csatScore === "number" && (
                  <Prop label="CSAT" Icon={Star}>
                    <span className="hdcd__value hdcd__value--strong">{t.csatScore} / 5</span>
                  </Prop>
                )}
                <Prop label="Created" Icon={Clock}>
                  <span className="hdcd__value">{fmtFull(t.createdAt)}</span>
                </Prop>
              </div>
            </div>

            {/* Quick actions */}
            <div className="hdcd__panel">
              <div className="hdcd__panel-head"><AlertOctagon /> Quick actions</div>
              <div className="hdcd__quick">
                {t.status !== "PENDING_CUSTOMER" && t.status !== "RESOLVED" && t.status !== "CLOSED" && (
                  <button type="button" className="hdcd__quick-btn" onClick={() => patch({ status: "PENDING_CUSTOMER" })}>
                    <ArrowRight /> Wait on customer
                  </button>
                )}
                {t.status !== "RESOLVED" && t.status !== "CLOSED" && (
                  <button type="button" className="hdcd__quick-btn hdcd__quick-btn--win" onClick={() => patch({ status: "RESOLVED", resolvedAt: new Date().toISOString() })}>
                    <CheckCircle2 /> Resolve
                  </button>
                )}
                {t.status === "RESOLVED" && (
                  <button type="button" className="hdcd__quick-btn hdcd__quick-btn--win" onClick={() => patch({ status: "CLOSED" })}>
                    <CheckCircle2 /> Close
                  </button>
                )}
                <button type="button" className="hdcd__quick-btn" onClick={() => toast("Macro picker coming")}>
                  <Bot /> Apply macro
                </button>
                <button type="button" className="hdcd__quick-btn" onClick={copyLink}>
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
              ? `Status → ${STATUS_LABELS[v as HdStatus]}`
              : `Priority → ${PRIO_LABELS[v as HdPrio]}`);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

function Prop({ label, Icon, children }: { label: string; Icon: typeof Flag; children: React.ReactNode }) {
  return (
    <div className="hdcd__prop">
      <div className="hdcd__prop-label"><Icon /> {label}</div>
      <div className="hdcd__prop-value">{children}</div>
    </div>
  );
}
