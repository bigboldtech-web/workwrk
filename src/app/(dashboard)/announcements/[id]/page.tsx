"use client";

/**
 * /announcements/[id], one announcement (spec-talk section 2.4). New route.
 *
 * WHY IT EXISTS. Every notification and every email about an announcement
 * used to link at the LIST, so the one thing the notice was about had to be
 * found again in a feed, and a post past its expiry could not be reached at
 * all. A direct link now resolves for anyone in the audience: expiry hides a
 * post from the list, not from its own URL.
 *
 * It also takes over from `ack-status-dialog.tsx`, which was a second roster
 * surface for the same job. The roster lives here, on the Acknowledgments
 * tab, for the author, Owners and Admins, and the list's "Ack status" button
 * is now a link into that tab.
 *
 * ONE BLUE BUTTON: Acknowledge, and only on a post that asks for it.
 *
 * DATA. GET /api/announcements/[id] (the post, my ack state, and for editors
 * the two counts), GET /api/announcements/[id]/acknowledge (the roster),
 * POST /api/announcements/[id]/acknowledge. Every reader tolerates the
 * endpoint being absent for a release: the page shows its error state with a
 * wired Retry rather than a blank screen.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CalendarRange, Check, Info, PartyPopper, Pin, ShieldCheck } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { SkeletonLines, SkeletonRows } from "@/components/ui/skeleton";
import { TeamAvatar } from "@/components/team/ui";
import { useOsToast } from "@/components/layout/os/toast";
import { useFormat } from "@/lib/format/use-date-prefs";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";

type AnnType = "INFO" | "WARNING" | "CELEBRATION" | "POLICY" | "EVENT";
type AnnPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

const TYPE_LABEL: Record<AnnType, string> = {
  INFO: "Info", WARNING: "Warning", CELEBRATION: "Celebration", POLICY: "Policy", EVENT: "Event",
};
const TYPE_ICON: Record<AnnType, typeof Info> = {
  INFO: Info, WARNING: AlertTriangle, CELEBRATION: PartyPopper, POLICY: ShieldCheck, EVENT: CalendarRange,
};

/**
 * The priority word as a pale chip: danger, warning, then neutral. It is a
 * <span>, not a StatusChip, because StatusChip is a <button> and a chip that
 * reads out a priority has nothing to do when you click it.
 */
const PRIO_CHIP: Record<AnnPrio, string> = {
  URGENT: "border-danger-solid/25 bg-danger-soft text-danger-text",
  HIGH: "border-warning-solid/25 bg-warning-soft text-warning-text",
  NORMAL: "border-line bg-surface-2 text-ink-2",
  LOW: "border-line bg-surface-2 text-ink-2",
};
const PRIO_LABEL: Record<AnnPrio, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

type Announcement = {
  id: string;
  title: string;
  content: string;
  type: AnnType;
  priority: AnnPrio;
  pinned: boolean;
  mustAcknowledge: boolean;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  author?: { id: string; firstName: string | null; lastName: string | null; avatar: string | null } | null;
  ackedByMe?: boolean;
  ackedAt?: string | null;
  canEdit?: boolean;
  counts?: { acknowledged: number; pending: number } | null;
};

type RosterRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  acknowledgedAt: string | null;
};

function personName(u: { firstName?: string | null; lastName?: string | null }): string {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone";
}

export default function AnnouncementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useOsToast();
  const fmt = useFormat();

  const [ann, setAnn] = useState<Announcement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [tab, setTab] = useState<"post" | "acks">("post");
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [acking, setAcking] = useState(false);

  const load = useCallback(() => {
    return apiFetch<{ announcement?: Announcement }>(`/api/announcements/${id}`).then((r) => {
      if (r.status === 404) { setState("missing"); return; }
      if (!r.ok || !r.data?.announcement) { setState("error"); return; }
      setAnn(r.data.announcement);
      setState("ready");
    });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // The roster is the editors' tab and is fetched only when they open it.
  useEffect(() => {
    if (tab !== "acks" || roster !== null) return;
    let alive = true;
    void apiFetch<{ roster?: RosterRow[] }>(`/api/announcements/${id}/acknowledge`).then((r) => {
      if (!alive) return;
      setRoster(r.ok ? (r.data?.roster ?? []) : []);
    });
    return () => { alive = false; };
  }, [tab, roster, id]);

  const acknowledge = async () => {
    setAcking(true);
    // keepalive plus a retry: an acknowledgment is a record that somebody
    // read a policy, and it must not be lost to a flaky connection or to the
    // tab closing a moment later.
    const r = await apiFetchWithRetry(
      `/api/announcements/${id}/acknowledge`,
      { method: "POST", keepalive: true },
      { attempts: 3 },
    );
    setAcking(false);
    if (!r.ok) { toast("Couldn't record your acknowledgment. Try again"); return; }
    setAnn((prev) => (prev ? { ...prev, ackedByMe: true, ackedAt: new Date().toISOString() } : prev));
    setRoster(null);
    window.dispatchEvent(new Event("workwrk:notif-changed"));
  };

  if (state === "loading") {
    return (
      <>
        <OsPageHeader title="Announcement" back={{ fallbackHref: "/announcements", label: "Announcements" }} />
        <div className="px-6 py-4"><SkeletonLines lines={4} /></div>
      </>
    );
  }
  if (state === "missing") return <NotFoundView />;
  if (state === "error" || !ann) {
    return (
      <>
        <OsPageHeader title="Announcement" back={{ fallbackHref: "/announcements", label: "Announcements" }} />
        <OsEmptyView variant="error" title="Couldn't load this announcement" action={{ label: "Retry", onClick: () => { setState("loading"); void load(); } }} />
      </>
    );
  }

  const TypeIcon = TYPE_ICON[ann.type] ?? Info;
  const posted = ann.publishedAt ?? ann.createdAt;

  return (
    <>
      {/* "Talk > Announcements > {title}". The bar adds the hub crumb. */}
      <Breadcrumb items={[{ label: "Announcements", href: "/announcements" }, { label: ann.title }]} />
      <OsPageHeader
        title={ann.title}
        back={{ fallbackHref: "/announcements", label: "Announcements" }}
        views={ann.canEdit ? (
          <ViewTabStrip aria-label="Announcement views">
            <ViewTab label="Announcement" active={tab === "post"} onClick={() => setTab("post")} />
            <ViewTab
              label="Acknowledgments"
              active={tab === "acks"}
              onClick={() => setTab("acks")}
              trailing={ann.counts ? (
                <span className="tabular-nums text-xs text-ink-3">{ann.counts.acknowledged} of {ann.counts.acknowledged + ann.counts.pending}</span>
              ) : undefined}
            />
          </ViewTabStrip>
        ) : undefined}
      />

      <div className="max-w-[720px] px-6 py-4">
        {tab === "post" ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex h-[26px] items-center rounded-md border px-2 text-xs font-medium ${PRIO_CHIP[ann.priority]}`}>
                {PRIO_LABEL[ann.priority]}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
                <TypeIcon className="h-3 w-3" strokeWidth={1.5} /> {TYPE_LABEL[ann.type]}
              </span>
              {ann.pinned ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2"><Pin className="h-3 w-3" strokeWidth={1.5} /> Pinned</span>
              ) : null}
              <span className="text-xs text-ink-3">{fmt.date(posted, "datetime")}</span>
            </div>

            <p className="whitespace-pre-wrap text-row leading-6 text-ink">{ann.content}</p>

            <dl className="mt-5 rounded-lg border border-line">
              <Meta label="Posted by" value={ann.author ? personName(ann.author) : "Unknown"} />
              <Meta label="Posted" value={fmt.date(posted, "datetime")} />
              <Meta label="Expires" value={ann.expiresAt ? fmt.date(ann.expiresAt, "date") : "No expiry"} />
            </dl>

            {ann.mustAcknowledge ? (
              <div className="mt-5">
                {ann.ackedByMe ? (
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success-text">
                    <Check className="h-4 w-4" strokeWidth={1.5} />
                    You acknowledged this{ann.ackedAt ? ` on ${fmt.date(ann.ackedAt, "datetime")}` : ""}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => void acknowledge()}
                    disabled={acking}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--os-brand)] px-4 text-base font-medium text-white hover:bg-[var(--os-brand-hover)] disabled:opacity-60"
                  >
                    <Check className="h-4 w-4" strokeWidth={1.5} /> Acknowledge
                  </button>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <AckRoster roster={roster} fmt={fmt} />
        )}
      </div>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-9 items-center gap-3 border-b border-line-soft px-3 last:border-b-0">
      <dt className="w-32 shrink-0 text-sm text-ink-2">{label}</dt>
      <dd className="m-0 truncate text-base text-ink">{value}</dd>
    </div>
  );
}

/** The one roster: who has acknowledged, and who has not. */
function AckRoster({ roster, fmt }: { roster: RosterRow[] | null; fmt: ReturnType<typeof useFormat> }) {
  if (roster === null) return <SkeletonRows rows={6} />;
  const done = roster.filter((r) => r.acknowledgedAt);
  const pending = roster.filter((r) => !r.acknowledgedAt);
  if (roster.length === 0) return <OsEmptyView title="Nobody to acknowledge this yet" />;
  return (
    <>
      <Group title={`Acknowledged (${done.length})`}>
        {done.map((r) => (
          <Row key={r.id} person={r} trailing={r.acknowledgedAt ? fmt.date(r.acknowledgedAt, "datetime") : ""} />
        ))}
      </Group>
      <Group title={`Pending (${pending.length})`}>
        {pending.map((r) => <Row key={r.id} person={r} trailing="" />)}
      </Group>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 text-base font-medium text-ink-2">{title}</h2>
      <ul className="rounded-lg border border-line">{children}</ul>
    </section>
  );
}

function Row({ person, trailing }: { person: RosterRow; trailing: string }) {
  return (
    <li className="flex h-9 items-center gap-2 border-b border-line-soft px-3 last:border-b-0">
      <TeamAvatar name={personName(person)} avatar={person.avatar} size={20} />
      <span className="flex-1 truncate text-base text-ink">{personName(person)}</span>
      {trailing ? <span className="shrink-0 text-xs text-ink-3">{trailing}</span> : null}
    </li>
  );
}
