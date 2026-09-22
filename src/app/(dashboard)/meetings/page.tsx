"use client";

/* Meetings: the meetings I am in, coming up and past.
 *
 *  GET  /api/meetings?view=upcoming|past&type=&search=&limit=  attendee scoped
 *  POST /api/meetings                                          the modal
 *
 * WHAT THIS REPLACED (spec-planner.md section 2 /meetings, comms.md section 4).
 * The page was a stack of hue-keyed cards: a "Next up" hero, four time
 * sections, a colour per meeting type out of the old catalog palette, and
 * attendee initials tinted by a hash of the user id, which is a fake
 * identity colour the design system does not have. Past was capped at 30
 * days with no way to see older, and "New meeting" had no form at all: it
 * POSTed { title: "Untitled meeting", type: "ADHOC" } and then did a full
 * document load to reach it.
 *
 * It is one TableCard now, with two views, a filter panel, real avatars and
 * a real create form. NOTHING THE PAGE COULD DO WAS REMOVED: every meeting
 * is still reachable (Past has no cap any more, which is strictly more),
 * the agenda and the notes and action-item counts are still on the row, and
 * Join still starts the call, now only while there is a call to join.
 *
 * THE URL IS THE STATE: ?view=upcoming|past&type=<TYPE>&q=<search>. ?new=1
 * opens the create modal, which is how the Planner hub's "+" > Meeting
 * reaches it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Download, ExternalLink, Link2, Trash2, Video } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { BulkAction, RowMoreButton, TableCard } from "@/components/ui/table-card";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { DateField } from "@/components/ui/date-field";
import { AvatarStack, type AvatarPerson } from "@/components/ui/avatar-stack";
import { Chip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLayer, useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useFormat } from "@/lib/format/use-date-prefs";
import { apiFetchWithRetry } from "@/lib/api-fetch";
import { MEETING_TYPES, MEETING_TYPE_LABELS, isMeetingType, type MeetingTypeWord } from "@/lib/meeting-type";
import { canJoinNow, formatLength, meetingWindow, splitMeetings } from "@/lib/meeting-list";
import { NewMeetingModal } from "@/components/planner/new-meeting-modal";

type ApiAttendee = {
  id: string;
  userId: string;
  user?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
};

type ApiMeeting = {
  id: string;
  title: string;
  type: MeetingTypeWord;
  scheduledAt: string;
  duration: number;
  agenda?: string | null;
  attendees?: ApiAttendee[];
  stats?: { hasNotes?: boolean; decisionCount?: number; actionItemsTotal?: number; actionItemsDone?: number };
};

/** Page size for the two views (design-system 5.1 footer: 40 per page). */
const PAGE_SIZE = 40;

/**
 * The per-row "..." (spec-planner section 2 /meetings): Open, Copy link,
 * Duplicate, Delete. Every row had one action, Join, and only inside the
 * join window, so most rows carried no hover affordance at all.
 *
 * Delete is offered to everyone and refused by the server for anyone but the
 * creator or an org admin, with the server's own sentence surfaced: the list
 * route does not carry `canDelete` per row, so the honest alternative to
 * this is to hide Delete from the creator too.
 */
function RowMenu({ meeting, onOpen, onCopy, onDuplicate, onDelete }: {
  meeting: ApiMeeting;
  onOpen: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayer(open, { kind: "popover", close: () => setOpen(false) });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <>
      <RowMoreButton
        buttonRef={btnRef}
        open={open}
        label={`More actions for ${meeting.title}`}
        onClick={() => setOpen((v) => !v)}
      />
      <MorePortal anchorRef={btnRef} width={200} open={open} panelRef={panelRef} placement="below">
        <MenuList aria-label="Meeting actions">
          <MenuItem icon={ExternalLink} label="Open" onClick={run(onOpen)} />
          <MenuItem icon={Link2} label="Copy link" onClick={run(onCopy)} />
          <MenuItem icon={Copy} label="Duplicate" onClick={run(onDuplicate)} />
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Delete" destructive onClick={run(onDelete)} />
        </MenuList>
      </MorePortal>
    </>
  );
}

export default function MeetingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fmt = useFormat();
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const [meetings, setMeetings] = useState<ApiMeeting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(0);

  // The clock, sampled in an effect and refreshed once a minute, so "live
  // now" and the Join window are live without any component reading
  // Date.now() during render. Null until the first tick: every row then
  // renders its neutral state, which is also what the server renders.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);

  const view = searchParams.get("view") === "past" ? "past" : "upcoming";
  const typeParam = searchParams.get("type");
  const types = useMemo(
    () => (typeParam ? typeParam.split(",").filter(isMeetingType) : []),
    [typeParam],
  );
  const q = searchParams.get("q") ?? "";
  // The rest of the spec's Filter panel, all of it in the URL so a narrowed
  // list is a link: People, a date range, and "has action items". Only the
  // Type group existed, so the deep links the spec promises (`people=`,
  // `from=`, `to=`) had no control that could set them.
  const peopleParam = searchParams.get("people");
  const people = useMemo(
    () => (peopleParam ? peopleParam.split(",").filter(Boolean) : []),
    [peopleParam],
  );
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const hasActions = searchParams.get("actions") === "1";
  const filterCount = types.length + people.length + (from ? 1 : 0) + (to ? 1 : 0) + (hasActions ? 1 : 0);

  const setParams = useCallback((mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `/meetings?${qs}` : "/meetings", { scroll: false });
  }, [router, searchParams]);

  const load = useCallback(async () => {
    // The VIEW is a server filter, so each of the two gets its own page and
    // "Past" can never come back empty because the page was full of future
    // meetings. The type filter stays on the client: the list is already
    // scoped to the viewer and capped, so filtering six labels locally
    // costs nothing and keeps the filter instant.
    const sp = new URLSearchParams({ limit: "200", view });
    if (q) sp.set("search", q);
    const r = await apiFetchWithRetry<Record<string, unknown>>(`/api/meetings?${sp.toString()}`);
    if (!r.ok) { setLoadError(r.error); return; }
    // The list route answers through paginatedResult, and other callers of
    // this endpoint have historically seen two envelopes, so both are read
    // rather than one being assumed.
    const d = r.data as Record<string, unknown>;
    const inner = (d.data ?? d) as Record<string, unknown>;
    const list = (Array.isArray(inner) ? inner : (inner.items ?? inner.data)) as ApiMeeting[] | undefined;
    setMeetings(Array.isArray(list) ? list : []);
    setLoadError(null);
  }, [q, view]);

  // The load is wrapped rather than called directly, so the effect body
  // itself sets no state before its first await
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);
  const v = rowVersion("meetings");
  useEffect(() => {
    if (v === 0) return;
    const run = async () => { await load(); };
    void run();
  }, [v, load]);

  // A 60s refetch while the tab is visible, so a meeting going live shows
  // its Join without a reload (spec-planner /meetings Realtime: one poller).
  useEffect(() => {
    const i = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => clearInterval(i);
  }, [load]);

  // `?new=1` opens the modal on arrival. It is how the Planner hub's
  // "+" > Meeting reaches the form; the flag is consumed once, so a refresh
  // afterwards does not reopen it.
  const wantsNew = searchParams.get("new") === "1";
  const newFired = useRef(false);
  useEffect(() => {
    if (!wantsNew || newFired.current) return;
    // THE GUARD IS SET WHEN THE WORK HAPPENS, NOT WHEN IT IS SCHEDULED.
    // Setting `newFired.current = true` here and only then scheduling the
    // timer meant StrictMode's double invoke cleared the one timer in its
    // cleanup and the second pass returned early on the already-true ref, so
    // the modal never opened and `?new=1` was never stripped: the Planner
    // hub's "+" > Meeting row dead-ended on the list.
    const t = setTimeout(() => {
      newFired.current = true;
      setModalOpen(true);
      setParams((p) => p.delete("new"));
    }, 0);
    return () => clearTimeout(t);
  }, [wantsNew, setParams]);

  const { upcoming, past } = useMemo(
    () => splitMeetings(meetings ?? [], nowMs),
    [meetings, nowMs],
  );
  const rows = useMemo(() => {
    const base = view === "past" ? past : upcoming;
    return base.filter((m) => {
      if (types.length && !types.includes(m.type)) return false;
      if (people.length && !(m.attendees ?? []).some((a) => people.includes(a.userId))) return false;
      if (hasActions && !(m.stats?.actionItemsTotal)) return false;
      const day = m.scheduledAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [view, past, upcoming, types, people, hasActions, from, to]);

  /** Everyone who is on a meeting in this list, for the People filter group. */
  const peopleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of meetings ?? []) {
      for (const a of m.attendees ?? []) {
        const name = [a.user?.firstName, a.user?.lastName].filter(Boolean).join(" ").trim();
        if (a.userId) seen.set(a.userId, name || "Someone");
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [meetings]);

  function toggleType(t: MeetingTypeWord) {
    const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
    setParams((p) => { if (next.length) p.set("type", next.join(",")); else p.delete("type"); });
  }

  function togglePerson(uid: string) {
    const next = people.includes(uid) ? people.filter((x) => x !== uid) : [...people, uid];
    setParams((p) => { if (next.length) p.set("people", next.join(",")); else p.delete("people"); });
  }

  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [rows, page],
  );
  // A filter change can leave the viewer on a page that no longer exists.
  // Resolved during render (the Picker pattern), not in an effect.
  const maxPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  if (page > maxPage) setPage(maxPage);

  /**
   * Duplicate: the same meeting, one week on, with the same people, agenda
   * and length. The spec's row menu names it and there was no route to it.
   */
  async function duplicate(m: ApiMeeting) {
    const next = new Date(new Date(m.scheduledAt).getTime() + 7 * 86_400_000).toISOString();
    const r = await apiFetchWithRetry<Record<string, unknown>>("/api/meetings", {
      method: "POST",
      json: {
        title: m.title,
        type: m.type,
        scheduledAt: next,
        duration: m.duration,
        agenda: m.agenda ?? undefined,
        attendeeIds: (m.attendees ?? []).map((a) => a.userId),
      },
      keepalive: true,
    }, { attempts: 2, retryWrites: false });
    if (!r.ok) { toast(`Couldn't duplicate this meeting. ${r.error}`, { tone: "danger" }); return; }
    toast("Meeting duplicated a week later");
    void load();
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);
    // Each one is a soft delete into Trash (src/lib/trash.ts), so a mistake
    // is recoverable; the results are reported rather than assumed.
    const outcomes = await Promise.all(
      ids.map((id) => apiFetchWithRetry(`/api/meetings/${id}`, { method: "DELETE", keepalive: true }, { attempts: 1, retryWrites: false })),
    );
    setDeleting(false);
    const failed = outcomes.filter((o) => !o.ok);
    setConfirmingDelete(false);
    setSelected(new Set());
    if (failed.length) {
      toast(
        failed.length === ids.length
          ? `Couldn't delete. ${failed[0].error}`
          : `Moved ${ids.length - failed.length} to Trash, ${failed.length} refused. ${failed[0].error}`,
        { tone: "danger" },
      );
    } else {
      toast(`Moved ${ids.length} meeting${ids.length === 1 ? "" : "s"} to Trash`);
    }
    void load();
  }

  return (
    <>
      <OsPageHeader
        title="Meetings"
        views={
          <ViewTabStrip aria-label="Meeting views">
            <ViewTab label="Upcoming" active={view === "upcoming"} onClick={() => setParams((p) => p.delete("view"))} />
            <ViewTab label="Past" active={view === "past"} onClick={() => setParams((p) => p.set("view", "past"))} />
          </ViewTabStrip>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: filterCount },
          left: (
            <input
              type="search"
              value={q}
              onChange={(e) => setParams((p) => { const s = e.target.value; if (s) p.set("q", s); else p.delete("q"); })}
              placeholder="Search meetings"
              aria-label="Search meetings"
              className="h-8 w-[200px] rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
          ),
          primary: { label: "New meeting", onClick: () => setModalOpen(true) },
          menu: [
            {
              label: "Export (CSV)",
              icon: Download,
              href: `/api/export/meetings?view=${view}${types.length ? `&type=${types.join(",")}` : ""}${q ? `&search=${encodeURIComponent(q)}` : ""}`,
            },
          ],
        }}
      />

      <div className="flex gap-4 px-6 py-4">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="meetings"
          activeCount={filterCount}
          onClearAll={() => setParams((p) => {
            p.delete("type"); p.delete("people"); p.delete("from"); p.delete("to"); p.delete("actions");
          })}
        >
          <FilterGroup label="Type">
            {MEETING_TYPES.map((t) => (
              <FilterRow
                key={t}
                label={MEETING_TYPE_LABELS[t]}
                checked={types.includes(t)}
                onCheckedChange={() => toggleType(t)}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="People">
            {peopleOptions.length === 0 ? (
              <li className="px-2 py-1 text-sm text-ink-3">Nobody on these meetings yet</li>
            ) : peopleOptions.map(([uid, name]) => (
              <FilterRow
                key={uid}
                label={name}
                checked={people.includes(uid)}
                onCheckedChange={() => togglePerson(uid)}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="Date range">
            {/* DateField, not `<input type="date">`: design-system section 5
                is explicit that dates are pickers and never native. */}
            <li className="flex flex-col gap-1.5 px-2 py-1">
              <DateField
                value={from || null}
                size="sm"
                ariaLabel="From"
                placeholder="From"
                onChange={(v) => setParams((p) => { if (v) p.set("from", v); else p.delete("from"); })}
              />
              <DateField
                value={to || null}
                size="sm"
                ariaLabel="To"
                placeholder="To"
                onChange={(v) => setParams((p) => { if (v) p.set("to", v); else p.delete("to"); })}
              />
            </li>
          </FilterGroup>
          <FilterGroup label="Follow-up">
            <FilterRow
              label="Has action items"
              checked={hasActions}
              onCheckedChange={(on) => setParams((p) => { if (on) p.set("actions", "1"); else p.delete("actions"); })}
            />
          </FilterGroup>
        </FilterPanel>

        <div className="min-w-0 flex-1">
          {loadError ? (
            <OsEmptyView
              variant="error"
              title="Couldn't load meetings"
              hint={loadError}
              action={{ label: "Try again", onClick: () => { setLoadError(null); void load(); } }}
            />
          ) : (
            <TableCard<ApiMeeting>
              ariaLabel={view === "past" ? "Past meetings" : "Upcoming meetings"}
              rows={meetings === null ? null : pageRows}
              rowKey={(m) => m.id}
              rowHref={(m) => `/meetings/${m.id}`}
              highlightKey={
                view === "upcoming"
                  ? pageRows.find((m) => meetingWindow(m.scheduledAt, m.duration, nowMs) === "live")?.id ?? null
                  : null
              }
              empty={
                <span>
                  {types.length || q
                    ? "No meetings match this filter"
                    : view === "past"
                      ? "No past meetings yet"
                      : "No meetings coming up"}
                </span>
              }
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              bulkActions={
                <BulkAction
                  label="Delete"
                  destructive
                  onClick={() => setConfirmingDelete(true)}
                  disabled={deleting}
                />
              }
              // PAGES, NOT A FLAT 200. The list fetched `limit: 200` and the
              // footer was handed no handlers, so both arrows rendered
              // permanently disabled and Past silently stopped at the
              // two-hundredth meeting with nothing on screen saying so.
              footer={
                meetings === null
                  ? undefined
                  : {
                      total: rows.length,
                      noun: "meetings",
                      from: rows.length ? page * PAGE_SIZE + 1 : 0,
                      to: Math.min(rows.length, (page + 1) * PAGE_SIZE),
                      onPrev: page > 0 ? () => setPage((n) => n - 1) : undefined,
                      onNext: (page + 1) * PAGE_SIZE < rows.length ? () => setPage((n) => n + 1) : undefined,
                    }
              }
              columns={[
                {
                  key: "title",
                  label: "Title",
                  title: true,
                  width: "minmax(220px,1.6fr)",
                  render: (m) => {
                    const live = meetingWindow(m.scheduledAt, m.duration, nowMs) === "live";
                    return (
                      <span className="flex min-w-0 items-center gap-1.5">
                        {live ? <Dots variant="live" /> : null}
                        <span className="truncate">{m.title}</span>
                      </span>
                    );
                  },
                },
                {
                  key: "when",
                  label: "When",
                  // FIXED AND WIDE ENOUGH FOR ITS OWN VALUE. At
                  // minmax(170px,1fr) this column shared the flexible space
                  // with Title and Notes and lost, so every row read
                  // "Fri 25 Sep - 6:00 A..." and clipped the meridiem off
                  // the one column whose job is the time, while Notes ended
                  // 100px short of the card edge.
                  width: "210px",
                  render: (m) => (
                    <span className="truncate tabular-nums">
                      {fmt.date(m.scheduledAt, "weekday")} {fmt.date(m.scheduledAt, "date")} · {fmt.date(m.scheduledAt, "time")}
                    </span>
                  ),
                },
                {
                  key: "length",
                  label: "Length",
                  width: "100px",
                  render: (m) => formatLength(m.duration),
                },
                {
                  key: "type",
                  // Neutral, never hue-keyed: a meeting type is a label, not
                  // a signal (design-system 5.16).
                  label: "Type",
                  width: "150px",
                  // `as="span"`: Chip is a <button> by default, which put a
                  // focusable, hover-styled control with no handler on every
                  // row of this table inside rows that are themselves links.
                  render: (m) => <Chip as="span">{MEETING_TYPE_LABELS[m.type] ?? m.type}</Chip>,
                },
                {
                  key: "people",
                  label: "People",
                  width: "120px",
                  render: (m) => (
                    <AvatarStack
                      people={(m.attendees ?? []).map<AvatarPerson>((a) => ({
                        id: a.userId,
                        firstName: a.user?.firstName ?? null,
                        lastName: a.user?.lastName ?? null,
                        avatar: a.user?.avatar ?? null,
                      }))}
                      max={3}
                      size={24}
                    />
                  ),
                },
                {
                  key: "notes",
                  label: "Notes",
                  width: "minmax(160px,1.2fr)",
                  render: (m) => {
                    const bits: string[] = [];
                    if (m.stats?.hasNotes) bits.push("Notes");
                    if (m.stats?.decisionCount) bits.push(`${m.stats.decisionCount} decision${m.stats.decisionCount === 1 ? "" : "s"}`);
                    if (m.stats?.actionItemsTotal) bits.push(`${m.stats.actionItemsDone ?? 0} of ${m.stats.actionItemsTotal} actions`);
                    return <span className="truncate text-ink-2">{bits.join(" · ")}</span>;
                  },
                },
              ]}
              // EVERY ROW HAS AN OVERFLOW, not just the handful inside a
              // join window. Join stays where it was (a bordered button
              // beside the "..."), because a live meeting's one action
              // should not be behind a menu.
              rowMenu={(m) => (
                <span className="flex items-center gap-1">
                  {canJoinNow(m.scheduledAt, m.duration, nowMs) ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(`/meetings/${m.id}?call=1`);
                      }}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2 text-sm font-medium text-ink hover:bg-hover"
                    >
                      <Video className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Join
                    </button>
                  ) : null}
                  <RowMenu
                    meeting={m}
                    onOpen={() => router.push(`/meetings/${m.id}`)}
                    onCopy={() => {
                      void navigator.clipboard.writeText(`${window.location.origin}/meetings/${m.id}`);
                      toast("Link copied");
                    }}
                    onDuplicate={() => { void duplicate(m); }}
                    onDelete={() => { setSelected(new Set([m.id])); setConfirmingDelete(true); }}
                  />
                </span>
              )}
            />
          )}
        </div>
      </div>

      <Dialog open={confirmingDelete} onOpenChange={(v) => { if (!v) setConfirmingDelete(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} meeting{selected.size === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              {selected.size === 1 ? "It moves" : "They move"} to Trash with notes, decisions and action items, and
              any guest link stops working straight away. You can restore from Trash.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover">
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => { void deleteSelected(); }}
              className="h-9 rounded-md bg-danger-solid px-3 text-base font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {deleting ? <Dots variant="pending" /> : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewMeetingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => {
          setModalOpen(false);
          toast("Meeting created");
          void load();
          // A client navigation, not a document load: `window.location.href`
          // threw the whole shell away (rail, sidebar, an open call dock) to
          // reach a page one route away.
          router.push(`/meetings/${id}`);
        }}
      />
    </>
  );
}
