"use client";

/* Timesheets: one week card you can type an hour into, the weeks behind it,
 * and the approver's queue.
 *
 *  GET    /api/timesheets?scope=mine|approve|team&week=&person=&status=
 *  GET    /api/timesheets/summary?scope=approve   { count, canApprove, canReadAll }
 *  GET    /api/timesheets/[id]                    the week with its entries
 *  PATCH  /api/timesheets/[id]                    submit | retract | reopen | decide
 *  POST   /api/time-entries                       one day's hours
 *  DELETE /api/time-entries/[id]                  remove one entry
 *  GET    /api/export/timesheets?week=&scope=     the CSV
 *
 * THE SHAPE, AND WHY IT CHANGED AGAIN (spec-planner.md section 2
 * /timesheets). The previous pass had every week as a row that unfolded.
 * That reads fine for an approver and badly for the person whose hours they
 * are: filling in a week meant finding your own row among the others,
 * unfolding it, and typing into a list that pushed every week below it down
 * the page. The week a person is in is now a CARD at the top with seven day
 * columns, the weeks behind it are a table under it, and the approver's
 * queue is its own view with a drawer. Nothing was removed: adding,
 * editing, deleting, week navigation, submit, retract, reopen, approve and
 * send back are all still here, and export and the two display switches are
 * new.
 *
 * THE URL IS THE STATE:
 *
 *   ?view=mine|approvals|team       the Planner sidebar's rows. A view this
 *                                   viewer cannot read is not rendered as a
 *                                   pill, the parameter is stripped, and one
 *                                   notice line says why (spec-planner
 *                                   section 1 situation 2, access rule 4)
 *   ?week=YYYY-MM-DD                which week the card holds. The decision
 *                                   notification links it, the Clock page's
 *                                   "Open timesheet" action links it, and
 *                                   the stepper writes it
 *   ?sheet=<id>                     the Timesheet drawer, on the queue views
 *   ?add=today                      opens the add row on today's column
 *   ?status= ?person= ?weekOf=      the Filter panel; ?sort= the Sort control
 *
 * TIME ZONES. Every stored day and week key is 00:00 UTC
 * (src/lib/timesheet-week.ts says why), so `new Date("2026-09-22")` is a UTC
 * instant and rendering it with the machine's zone shifts it BACK a calendar
 * day for every viewer west of UTC: hours logged on Tuesday appeared under
 * Monday's heading, on the surface that feeds payroll. Nothing here formats
 * a day itself. Keys go to the one formatter at MIDDAY UTC, so no zone in
 * the world moves the date. src/lib/timesheet-grid.ts carries the rule.
 *
 * SAVE PATHS. Every write goes through apiFetchWithRetry with keepalive, so
 * a submit fired as the tab closes is not dropped, and a failure keeps what
 * the person typed with a Retry beside it rather than a toast that fades.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  RotateCcw,
  Send,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { BulkAction, TableCard, type TableColumn } from "@/components/ui/table-card";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { DateField } from "@/components/ui/date-field";
import { Picker, type PickerOption } from "@/components/ui/picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { Dots } from "@/components/ui/dots";
import { useFormat } from "@/lib/format/use-date-prefs";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { formatHm, minutesToHours, utcDayKey } from "@/lib/time-format";
import { useWorkSchedule } from "@/lib/use-work-schedule";
import { expectedWeekHours, type WorkSchedule } from "@/lib/work-schedule";
import { weekStartUTC } from "@/lib/timesheet-week";
import { timesheetsDisplay } from "@/lib/planner-prefs";
import {
  WEEK_STATUS_LABELS,
  isDayKey,
  shiftDayKey,
  sumMinutes,
  weekAcceptsHours,
  weekStartKeyOf,
  type DayKey,
  type GridEntry,
  type WeekStatus,
} from "@/lib/timesheet-grid";
import { TimesheetWeekCard, fmtExpected, type NewEntry } from "@/components/planner/timesheet-week-card";
import { TimesheetDrawer } from "@/components/planner/timesheet-drawer";

type Scope = "mine" | "approve" | "team";

type Person = { id: string; firstName?: string | null; lastName?: string | null };

type ApiTimesheet = {
  id: string;
  status: WeekStatus;
  weekStartDate: string;
  userId?: string;
  totalMinutes?: number | null;
  submittedAt?: string | null;
  decisionAt?: string | null;
  decisionNote?: string | null;
  user?: Person | null;
  approver?: Person | null;
  _count?: { entries?: number };
};

type SheetDetail = {
  id: string;
  userId?: string;
  status?: WeekStatus;
  submittedAt?: string | null;
  decisionNote?: string | null;
  decisionAt?: string | null;
  approver?: Person | null;
  entries: GridEntry[];
};

type MyItem = { id: string; title: string; board?: { name?: string | null } | null };

/**
 * `?view=` to a scope. The URL word is the sidebar's, the API word is the
 * scope.
 *
 * THREE VIEWS, NOT FOUR. spec-planner section 2 /timesheets Data: "`all`
 * folds into `team` for the People team and Admin. This absorbs today's
 * `team` and `all` scopes (T-5, T-6)." The fold is now performed at the API
 * (src/app/api/timesheets/route.ts), so Team IS the widest read a viewer
 * holds and there is no fourth pill. `?view=all` is still understood, so a
 * stored link minted before this release lands on Team rather than being
 * stripped with a notice.
 */
const VIEW_TO_SCOPE: Record<string, Scope> = {
  mine: "mine", approvals: "approve", approve: "approve", team: "team", all: "team",
};
const SCOPE_TO_VIEW: Record<Scope, string> = {
  mine: "mine", approve: "approvals", team: "team",
};
/** naming-canon section 1: Approvals, not "Approve queue". */
const SCOPE_LABELS: Record<Scope, string> = {
  mine: "My timesheets", approve: "Approvals", team: "Team",
};
/**
 * The one notice line a stripped view leaves behind (access rule 4). Not a
 * screen, not a Back link, not a Request access button: there is no object
 * to request, only a view this role does not hold.
 */
const STRIPPED_NOTICE: Record<Scope, string> = {
  mine: "",
  approve: "Approvals show the people who report to you.",
  team: "Team shows the people who report to you.",
};

/** The Sort control on the Team view (spec-planner section 2, default Week desc). */
type SortKey = "week" | "person" | "hours" | "status";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "person", label: "Person" },
  { key: "hours", label: "Hours" },
  { key: "status", label: "Status" },
];
const STATUSES: WeekStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"];

const STATUS_TONE: Record<WeekStatus, string | null> = {
  DRAFT: null,
  SUBMITTED: "var(--os-brand)",
  APPROVED: "var(--os-success-solid)",
  REJECTED: "var(--os-danger-solid)",
};

function WeekStatusChip({ status }: { status: WeekStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-sm font-medium"
      style={tone
        ? {
            color: tone,
            borderColor: `color-mix(in srgb, ${tone} 32%, transparent)`,
            background: `color-mix(in srgb, ${tone} 12%, var(--os-surface))`,
          }
        : {
            color: "var(--os-ink-2)",
            borderColor: "var(--os-line-strong)",
            background: "var(--os-surface-2)",
          }}
    >
      {WEEK_STATUS_LABELS[status]}
    </span>
  );
}

function personName(p: Person | null | undefined, fallback = "Someone"): string {
  if (!p) return fallback;
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || fallback;
}

export default function TimesheetsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fmt = useFormat();
  const { rowVersion, prefs, patchPrefs } = useOsShell();
  const { toast } = useOsToast();

  // The company's working calendar: which days are off (tinted) and how many
  // hours the week is expected to hold. Defaults to Monday-to-Friday eight
  // hours until it loads and when no calendar is set, which is exactly what
  // this surface assumed silently before the calendar existed.
  const { schedule } = useWorkSchedule();
  const display = useMemo(() => timesheetsDisplay(prefs.home?.timesheets), [prefs.home?.timesheets]);

  const viewParam = searchParams.get("view");
  const weekParam = searchParams.get("week");
  const sheetParam = searchParams.get("sheet");
  // The Filter panel and the Sort control both live in the URL, so a
  // narrowed queue is a link somebody can send.
  const statusRaw = searchParams.get("status");
  const filterStatus = statusRaw && (STATUSES as string[]).includes(statusRaw) ? statusRaw : "";
  const filterPerson = searchParams.get("person") ?? "";
  const weekFilterRaw = searchParams.get("weekOf");
  const filterWeek = weekFilterRaw && isDayKey(weekFilterRaw) ? weekStartKeyOf(weekFilterRaw) : "";
  const sortRaw = searchParams.get("sort");
  const sortKey: SortKey = (SORTS.some((s) => s.key === sortRaw) ? sortRaw : "week") as SortKey;
  const activeFilterCount = [filterStatus, filterPerson, filterWeek].filter(Boolean).length;
  const urlScope = (viewParam && VIEW_TO_SCOPE[viewParam.toLowerCase()]) || null;
  // A week that is not YYYY-MM-DD is dropped rather than sent: the API
  // answers 400 for it and an unreadable bookmark should show this week,
  // not an error banner.
  const week: DayKey | null = weekParam && isDayKey(weekParam) ? weekStartKeyOf(weekParam) : null;

  const [caps, setCaps] = useState<{ canApprove: boolean; canReadAll: boolean; count: number } | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<ApiTimesheet[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SheetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [items, setItems] = useState<MyItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** A write that failed, kept so the person can send exactly it again. */
  const [failed, setFailed] = useState<{ label: string; retry: () => void } | null>(null);
  const [stripped, setStripped] = useState<Scope | null>(null);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // What the SERVER says this person may read. Rendering Approvals, Team and
  // All to everyone and letting each answer 403 is the dead control the
  // access model forbids, and the "Try again" under it could never succeed.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await apiFetch<Record<string, unknown>>("/api/timesheets/summary?scope=approve");
      if (!alive) return;
      if (!r.ok) { setCaps({ canApprove: false, canReadAll: false, count: 0 }); return; }
      const raw = r.data as Record<string, unknown>;
      const d = (raw.data ?? raw) as { count?: number; canApprove?: boolean; canReadAll?: boolean };
      setCaps({
        canApprove: Boolean(d.canApprove),
        canReadAll: Boolean(d.canReadAll),
        count: Number(d.count ?? 0),
      });
    })();
    return () => { alive = false; };
  }, []);

  // Who I am, so the drawer never offers a decision on my own week and the
  // queue tables can say "you" rather than my own name.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await apiFetch<{ user?: { id?: string } }>("/api/me");
      if (!alive) return;
      setMeId(r.ok ? (r.data.user?.id ?? null) : null);
    })();
    return () => { alive = false; };
  }, []);

  const visibleScopes = useMemo<Scope[]>(() => {
    const out: Scope[] = ["mine"];
    // Team is the org-wide read for the People team, Owners and Admins and
    // the report tree for every other manager: one row, two audiences, which
    // is what the fold means.
    if (caps?.canApprove || caps?.canReadAll) out.push("approve", "team");
    return out;
  }, [caps]);

  // THE URL IS THE STATE, so the scope is DERIVED and never mirrored into
  // component state. A `?view=` naming a scope this person cannot read is
  // ignored here rather than obeyed and then 403'd.
  const scope: Scope = urlScope && (!caps || visibleScopes.includes(urlScope)) ? urlScope : "mine";

  const setParams = useCallback((mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `/timesheets?${qs}` : "/timesheets", { scroll: false });
  }, [router, searchParams]);

  // And the parameter is actually STRIPPED, with one notice line under the
  // toolbar for that page load, so the address bar stops naming a view this
  // page is not showing.
  useEffect(() => {
    if (!caps || !urlScope || visibleScopes.includes(urlScope)) return;
    // On the next tick, so the effect body sets no state inside the render
    // that resolved the capabilities (react-hooks/set-state-in-effect).
    const t = setTimeout(() => {
      setStripped(urlScope);
      setParams((p) => p.delete("view"));
    }, 0);
    return () => clearTimeout(t);
  }, [caps, urlScope, visibleScopes, setParams]);

  // The anchored week: the one the card holds. `?week` absent means this one.
  const currentWeekKey = useMemo(() => utcDayKey(weekStartUTC(new Date())), []);
  const weekKey = week ?? currentWeekKey;
  const isThisWeek = weekKey === currentWeekKey;

  const expectedHours = useMemo(() => {
    // weekStartDate is Monday 00:00 UTC. Read the DAY out of the key and
    // rebuild a LOCAL date from those parts: handing the instant straight to
    // expectedWeekHours shifts the week by a day for anyone west of UTC.
    const [y, m, d] = weekKey.split("-").map(Number);
    return expectedWeekHours(schedule, new Date(y, m - 1, d));
  }, [schedule, weekKey]);

  // ── Loading ──────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ scope, limit: scope === "mine" ? "26" : "50" });
    // The Filter panel's narrowing, which the API has always implemented and
    // no control ever sent (`week`, `person`, `status`). A deep link
    // carrying them now lands on the narrowed table with the Filter chip
    // counting them, rather than on an unfiltered one with the parameters
    // silently dropped.
    if (filterStatus) qs.set("status", filterStatus);
    if (scope !== "mine") {
      if (filterPerson) qs.set("person", filterPerson);
      if (filterWeek) qs.set("week", filterWeek);
    }
    const r = await apiFetchWithRetry<{ data?: ApiTimesheet[] } | ApiTimesheet[]>(`/api/timesheets?${qs.toString()}`);
    if (!r.ok) { setLoadError(r.error); return; }
    const raw = r.data as Record<string, unknown>;
    const list = (Array.isArray(raw) ? raw : (raw.data as ApiTimesheet[] | undefined)) ?? [];
    setSheets(list);
    setLoadError(null);
  }, [scope, filterStatus, filterPerson, filterWeek]);

  // The load is wrapped rather than called directly, so the effect body
  // itself sets no state before its first await
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  const v = rowVersion("timesheets");
  useEffect(() => {
    if (v === 0) return;
    const run = async () => { await load(); };
    void run();
  }, [v, load]);

  // My open tasks, for the add row's task picker. One read for the page.
  useEffect(() => {
    if (scope !== "mine") return;
    let alive = true;
    void (async () => {
      const r = await apiFetch<{ items?: MyItem[] }>("/api/me/items?status=open");
      if (!alive) return;
      setItems(r.ok ? (r.data.items ?? []) : []);
    })();
    return () => { alive = false; };
  }, [scope]);

  /** The sheet row for the anchored week, if it exists yet. */
  const weekSheet = useMemo(
    () => (sheets ?? []).find((s) => utcDayKey(new Date(s.weekStartDate)) === weekKey) ?? null,
    [sheets, weekKey],
  );

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const r = await apiFetchWithRetry<{ data?: SheetDetail } | SheetDetail>(`/api/timesheets/${id}`);
    setDetailLoading(false);
    if (!r.ok) { setDetail(null); return; }
    const raw = r.data as Record<string, unknown>;
    setDetail((raw.data ?? raw) as SheetDetail);
  }, []);

  useEffect(() => {
    if (detail?.id === weekSheet?.id && weekSheet) return;
    let alive = true;
    const run = async () => {
      // A microtask first, so clearing the last week's entries is a
      // reaction to the week changing rather than a second render inside
      // the first (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (!alive) return;
      if (scope !== "mine" || !weekSheet) { setDetail(null); return; }
      await loadDetail(weekSheet.id);
    };
    void run();
    return () => { alive = false; };
  }, [scope, weekSheet, detail?.id, loadDetail]);

  // ── Writes ───────────────────────────────────────────────────────

  /**
   * One write path: keepalive, one retry on a transient failure, and a
   * failure that STAYS on screen with the exact request behind a Retry
   * rather than a toast that fades and loses the action.
   *
   * A function declaration rather than a useCallback, because the failure
   * row's Retry sends exactly this request again: a useCallback cannot
   * name itself inside its own initializer.
   */
  async function write(
    label: string,
    url: string,
    init: { method: string; json?: unknown },
  ): Promise<boolean> {
    setBusy(label);
    const r = await apiFetchWithRetry(url, { ...init, keepalive: true }, { attempts: 2, retryWrites: false });
    setBusy(null);
    if (!r.ok) {
      setFailed({
        label: `${label} didn't go through. ${r.error}`,
        retry: () => { setFailed(null); void write(label, url, init); },
      });
      return false;
    }
    setFailed(null);
    return true;
  }

  const refresh = useCallback(() => {
    void load();
    if (weekSheet) void loadDetail(weekSheet.id);
    window.dispatchEvent(new CustomEvent("workwrk:timesheets-changed"));
  }, [load, loadDetail, weekSheet]);

  /**
   * Submit the visible week even when nothing has been logged on it.
   *
   * A week with no entries has no Timesheet ROW, and every transition needs
   * an id, so the zero-hour path the spec names could not be reached at all.
   * POST /api/timesheets is the idempotent upsert for exactly this: it
   * returns the existing row when there is one and creates an empty DRAFT
   * when there is not. Nothing is written until the person confirms.
   */
  async function submitVisibleWeek() {
    let id = weekSheet?.id ?? null;
    if (!id) {
      const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/timesheets", {
        method: "POST",
        json: { weekStartDate: `${weekKey}T00:00:00.000Z` },
      });
      id = r.ok ? (r.data?.id ?? r.data?.data?.id ?? null) : null;
      if (!id) {
        setFailed({
          label: "Submit didn't go through. The week could not be opened.",
          retry: () => { setFailed(null); void submitVisibleWeek(); },
        });
        return;
      }
    }
    await act(id, "submit");
  }

  async function act(id: string, action: "submit" | "retract" | "reopen") {
    const label = action === "submit" ? "Submit" : action === "retract" ? "Retract" : "Reopen";
    const ok = await write(label, `/api/timesheets/${id}`, { method: "PATCH", json: { action } });
    if (!ok) return;
    toast(
      action === "submit" ? "Submitted"
        : action === "retract" ? "Retracted to draft"
          : "Reopened as a draft",
    );
    setSubmitConfirm(false);
    refresh();
  }

  async function addTime(entry: NewEntry): Promise<boolean> {
    const ok = await write("Log time", "/api/time-entries", {
      method: "POST",
      json: {
        day: `${entry.dayKey}T00:00:00.000Z`,
        hours: minutesToHours(entry.minutes),
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.itemId ? { itemId: entry.itemId } : {}),
        ...(entry.billable ? { billable: true } : {}),
        ...(entry.tags.length ? { tags: entry.tags } : {}),
      },
    });
    if (!ok) return false;
    toast(`Logged ${formatHm(entry.minutes)}`);
    refresh();
    return true;
  }

  /**
   * Inline edit of a row (spec-planner section 2: "Clicking a row's hours or
   * title makes it editable inline"). Without it the only way to fix a typo
   * was to delete the entry, which is permanent, and type it again.
   */
  async function editEntry(entryId: string, patch: { hours?: number; description?: string }): Promise<boolean> {
    const ok = await write("Save", `/api/time-entries/${entryId}`, { method: "PATCH", json: patch });
    if (!ok) return false;
    toast("Entry updated");
    refresh();
    return true;
  }

  async function removeEntry(entryId: string) {
    const ok = await write("Delete", `/api/time-entries/${entryId}`, { method: "DELETE" });
    if (!ok) return;
    toast("Entry removed");
    refresh();
  }

  /**
   * Open the add row and BRING IT ON SCREEN.
   *
   * Clicking the trigger replaces it with the four-line composer, so
   * scrolling the trigger itself does nothing: by the time the browser
   * honours it the node is unmounted. At 1440x900 on a busy week that left
   * the page's one blue button opening a row whose hours field sat at
   * y=881 and whose task picker, note and Billable flag were entirely below
   * the fold, so the primary action looked like it had done almost nothing.
   * The row is found again on the next frame, by the marker the card puts on
   * the composer, and scrolled to the middle of the viewport.
   */
  function openAddRow(trigger: HTMLElement) {
    const day = trigger.getAttribute("data-day");
    trigger.click();
    requestAnimationFrame(() => {
      const row = (day ? document.querySelector<HTMLElement>(`[data-ts-add-row="${day}"]`) : null)
        ?? document.querySelector<HTMLElement>("[data-ts-add-row]");
      (row ?? trigger).scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  // ── `?add=today` opens the add row on arrival ────────────────────
  // It is how the Planner hub's "+" > Time entry creates one, so a person
  // never has to find this page and then find the button.
  const wantsAdd = searchParams.get("add") !== null;
  const addFired = useRef(false);
  useEffect(() => {
    if (!wantsAdd || addFired.current) return;
    // THE GUARD IS SET WHEN THE WORK HAPPENS, NOT WHEN IT IS SCHEDULED.
    // Setting `addFired.current = true` on this line and only then calling
    // setTimeout made StrictMode's double invoke cancel the one timer in its
    // cleanup and return early on the second pass, so the add row never
    // opened and `?add=today` was never stripped: the Planner hub's
    // "+" > Time entry row landed people on the week with nothing to type
    // into. It also POLLS rather than firing once at 50ms, because the first
    // data load has usually not landed by then and the button does not exist
    // yet to be clicked.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      const el = document.querySelector<HTMLElement>("[data-ts-add-today]")
        ?? document.querySelector<HTMLElement>("[data-ts-add-first]");
      if (el) {
        addFired.current = true;
        openAddRow(el);
        setParams((p) => p.delete("add"));
        return;
      }
      // About three seconds, which covers a cold list on a slow connection.
      if (tries++ > 30) { addFired.current = true; setParams((p) => p.delete("add")); return; }
      timer = setTimeout(attempt, 100);
    };
    timer = setTimeout(attempt, 0);
    return () => { if (timer) clearTimeout(timer); };
  }, [wantsAdd, setParams]);

  // ── Header ───────────────────────────────────────────────────────

  const weekLabel = `Week of ${fmt.date(`${weekKey}T12:00:00.000Z`, "date")}`;
  const isOwner = scope === "mine";
  const editable = weekAcceptsHours(weekSheet?.status ?? null, isOwner);
  // ONE TOTAL. The list route sums the Decimal hours and rounds once; the
  // card sums each entry's rounded minutes. On a week of many part-hour
  // entries those two disagree by a minute, and the header and the footer
  // of the SAME card then printed two different numbers. The loaded entries
  // are the source whenever they are loaded; the server's number is the
  // fallback for the moment before they are.
  const totalMinutes = detail && detail.id === weekSheet?.id
    ? sumMinutes(detail.entries)
    : weekSheet?.totalMinutes ?? 0;

  const taskOptions = useMemo<PickerOption[]>(
    () => (items ?? []).slice(0, 200).map((i) => ({
      value: i.id,
      label: i.title,
      description: i.board?.name ?? undefined,
      keywords: i.board?.name ?? undefined,
    })),
    [items],
  );

  const pastWeeks = useMemo(
    () => (sheets ?? [])
      .filter((s) => utcDayKey(new Date(s.weekStartDate)) !== weekKey)
      .sort((a, b) => new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime()),
    [sheets, weekKey],
  );

  const queueRows = useMemo(
    () => (sheets ?? []).slice().sort((a, b) => {
      // The approver's queue reads oldest first: the week that has waited
      // longest is the one somebody is waiting on. The Team view is sorted
      // by the Sort control, Week desc by default.
      if (scope === "approve") {
        return new Date(a.submittedAt ?? a.weekStartDate).getTime() - new Date(b.submittedAt ?? b.weekStartDate).getTime();
      }
      if (sortKey === "person") return personName(a.user).localeCompare(personName(b.user));
      if (sortKey === "hours") return (b.totalMinutes ?? 0) - (a.totalMinutes ?? 0);
      if (sortKey === "status") return a.status.localeCompare(b.status);
      return new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime();
    }),
    [sheets, scope, sortKey],
  );

  /** The people in the loaded rows, for the Filter panel's Person group. */
  const peopleOptions = useMemo<PickerOption[]>(() => {
    const seen = new Map<string, string>();
    for (const s of sheets ?? []) {
      if (s.user?.id) seen.set(s.user.id, personName(s.user));
    }
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [sheets]);

  return (
    <>
      <OsPageHeader
        title="Timesheets"
        views={visibleScopes.length > 1 ? (
          <ViewTabStrip aria-label="Timesheet views">
            {visibleScopes.map((s) => (
              <ViewTab
                key={s}
                label={SCOPE_LABELS[s]}
                active={scope === s}
                onClick={() => setParams((p) => {
                  p.set("view", SCOPE_TO_VIEW[s]);
                  p.delete("sheet");
                })}
                trailing={s === "approve" && caps?.count ? (
                  <span className="tabular-nums text-xs text-ink-3">{caps.count}</span>
                ) : undefined}
              />
            ))}
          </ViewTabStrip>
        ) : undefined}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilterCount },
          sort: scope !== "mine"
            ? {
                onClick: () => setSortOpen((o) => !o),
                label: sortKey === "week" ? "Sort" : SORTS.find((s) => s.key === sortKey)?.label,
                active: sortKey !== "week",
              }
            : undefined,
          left: scope === "mine" ? (
            <div className="flex items-center gap-1">
              <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
              <button
                type="button"
                aria-label="Previous week"
                onClick={() => setParams((p) => p.set("week", shiftDayKey(weekKey, -7)))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => setParams((p) => p.delete("week"))}
                disabled={isThisWeek}
                className="h-8 rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:text-ink-4 disabled:hover:bg-transparent"
              >
                This week
              </button>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => setParams((p) => p.set("week", shiftDayKey(weekKey, 7)))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} />
              </button>
              <span className="ms-1 min-w-[150px] text-base font-medium text-ink">{weekLabel}</span>
            </div>
          ) : undefined,
          // "Log time" is on every view, and on the queue views it logs the
          // VIEWER'S OWN time: that is the honest reading of the label, and
          // it is also what spec-planner says ("on Approvals and Team the
          // button still logs the viewer's own time"). Hiding it left the
          // approver's toolbar with nothing in it but the "..." square.
          // AND IT IS ON EVERY STATE, not only on an editable week. Removing
          // it once the week was submitted left the page with no primary at
          // all, and took the only chrome route to logging against a
          // DIFFERENT week with it: the person had to work the week stepper
          // first. It always does something honest now: open the add row
          // here, or move to the current week, or say why not.
          primary: scope !== "mine"
            ? { label: "Log time", onClick: () => { setParams((p) => { p.set("view", "mine"); p.set("add", "today"); p.delete("sheet"); }); } }
            : {
                label: "Log time",
                onClick: () => {
                  if (editable) {
                    const el = document.querySelector<HTMLElement>("[data-ts-add-today]")
                      ?? document.querySelector<HTMLElement>("[data-ts-add-first]");
                    if (el) openAddRow(el);
                    return;
                  }
                  if (!isThisWeek) {
                    setParams((p) => { p.delete("week"); p.set("add", "today"); p.delete("sheet"); });
                    return;
                  }
                  toast(
                    status === "APPROVED"
                      ? "This week is approved. Ask your approver to reopen it."
                      : status === "REJECTED"
                        ? "This week was sent back. Reopen it to change the hours."
                        : "This week is submitted. Retract it to log more time.",
                  );
                },
                busy: busy === "Log time",
              },
          // The Display rows are SWITCHES: one stable name each with the
          // state as a check, rather than a label that flips to say what the
          // next click would do. The menu stays open so both can be set in
          // one visit (spec-planner section 2, Display).
          menu: [
            {
              label: "Notes",
              checked: display.showNotes,
              onClick: () => { void patchPrefs({ home: { timesheets: { showNotes: !display.showNotes } } }); },
            },
            {
              label: "Source",
              checked: display.showSource,
              onClick: () => { void patchPrefs({ home: { timesheets: { showSource: !display.showSource } } }); },
            },
            { separator: true },
            // Your own hours are yours, so the mine export needs no gate and
            // the API agrees. Every other scope reads other people's rows,
            // so the row only renders for somebody the server has already
            // said may read them: a control the role cannot use is not
            // rendered rather than rendered and answered 403.
            ...(scope === "mine"
              ? [{
                  label: "Export this week (CSV)",
                  icon: Download,
                  href: `/api/export/timesheets?scope=mine&week=${weekKey}`,
                }]
              : caps?.canApprove || caps?.canReadAll
                ? [{
                    label: "Export these weeks (CSV)",
                    icon: Download,
                    href: `/api/export/timesheets?scope=team`,
                  }]
                : []),
          ],
        }}
      />

      {/* The Sort popover, anchored under the toolbar's Sort chip. */}
      {sortOpen ? (
        <div className="relative z-30 px-6">
          <div className="absolute start-[104px] top-0">
            <Picker
              open
              onClose={() => setSortOpen(false)}
              ariaLabel="Sort timesheets"
              selected={sortKey}
              sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label })) }]}
              onSelect={(v) => {
                setSortOpen(false);
                setParams((p) => { if (v === "week") p.delete("sort"); else p.set("sort", v); });
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="flex gap-4 px-6 py-4">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="timesheets"
          activeCount={activeFilterCount}
          onClearAll={() => setParams((p) => { p.delete("status"); p.delete("person"); p.delete("weekOf"); })}
        >
          <FilterGroup label="Status">
            {STATUSES.map((s) => (
              <FilterRow
                key={s}
                label={WEEK_STATUS_LABELS[s]}
                checked={filterStatus === s}
                onCheckedChange={(on) => setParams((p) => { if (on) p.set("status", s); else p.delete("status"); })}
              />
            ))}
          </FilterGroup>
          {/* Person and Week range narrow somebody else's rows, so they are
              only offered on the two views that hold somebody else's rows. */}
          {scope !== "mine" ? (
            <>
              <FilterGroup label="Person">
                {peopleOptions.length === 0 ? (
                  <li className="px-2 py-1 text-sm text-ink-3">Nobody in this view yet</li>
                ) : peopleOptions.map((o) => (
                  <FilterRow
                    key={o.value}
                    label={o.label}
                    checked={filterPerson === o.value}
                    onCheckedChange={(on) => setParams((p) => { if (on) p.set("person", o.value); else p.delete("person"); })}
                  />
                ))}
              </FilterGroup>
              <FilterGroup label="Week">
                {/* DateField, not `<input type="date">`: design-system
                    section 5 is explicit that dates are pickers and never
                    native. Any day in a week selects that whole week. */}
                <li className="px-2 py-1">
                  <DateField
                    value={filterWeek || null}
                    size="sm"
                    ariaLabel="Week starting"
                    placeholder="Any week"
                    onChange={(v) => setParams((p) => {
                      if (v && isDayKey(v)) p.set("weekOf", weekStartKeyOf(v)); else p.delete("weekOf");
                    })}
                  />
                </li>
              </FilterGroup>
            </>
          ) : null}
        </FilterPanel>

        <div className="min-w-0 flex-1">
        {stripped ? (
          <p className="mb-3 text-base text-ink-2">{STRIPPED_NOTICE[stripped]}</p>
        ) : null}

        {failed ? (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-danger-solid bg-danger-soft px-3 py-2 text-base text-ink">
            <CircleAlert className="h-4 w-4 shrink-0 text-danger-solid" strokeWidth={1.5} aria-hidden />
            <span className="flex-1">{failed.label}</span>
            <button type="button" onClick={failed.retry} className="h-7 rounded-md border border-line-strong px-2.5 text-sm font-medium text-ink hover:bg-hover">
              Retry
            </button>
            <button type="button" onClick={() => setFailed(null)} aria-label="Dismiss" className="h-7 rounded-md px-2 text-sm text-ink-2 hover:bg-hover">
              Dismiss
            </button>
          </div>
        ) : null}

        {loadError ? (
          <OsEmptyView
            variant="error"
            title="Couldn't load timesheets"
            hint={loadError}
            action={{ label: "Try again", onClick: () => { setLoadError(null); void load(); } }}
          />
        ) : scope === "mine" ? (
          <MyTimesheets
            weekKey={weekKey}
            sheet={weekSheet}
            detail={detail}
            detailLoading={detailLoading}
            editable={editable}
            expectedHours={expectedHours}
            schedule={schedule}
            display={display}
            taskOptions={taskOptions}
            totalMinutes={totalMinutes}
            busy={busy}
            submitConfirm={submitConfirm}
            onSubmitConfirm={setSubmitConfirm}
            onAct={act}
            onSubmitWeek={submitVisibleWeek}
            onAdd={addTime}
            onDelete={removeEntry}
            onEdit={editEntry}
            pastWeeks={sheets === null ? null : pastWeeks}
            onOpenWeek={(key) => setParams((p) => p.set("week", key))}
          />
        ) : (
          <QueueTable
            scope={scope}
            rows={sheets === null ? null : queueRows}
            sortKey={sortKey}
            onSort={(k) => setParams((p) => { if (k === "week") p.delete("sort"); else p.set("sort", k); })}
            onOpen={(id) => setParams((p) => p.set("sheet", id))}
            viewerId={meId}
            onBulkDone={() => { void load(); window.dispatchEvent(new CustomEvent("workwrk:timesheets-changed")); }}
          />
        )}
        </div>
      </div>

      <TimesheetDrawer
        sheetId={scope === "mine" ? null : sheetParam}
        onClose={() => setParams((p) => p.delete("sheet"))}
        canDecide={scope === "approve" || Boolean(caps?.canApprove)}
        viewerId={meId}
        schedule={schedule}
        onDecided={() => {
          toast("Decision sent");
          void load();
          window.dispatchEvent(new CustomEvent("workwrk:timesheets-changed"));
        }}
      />
    </>
  );
}

/* ── My timesheets ──────────────────────────────────────────────── */

function MyTimesheets({
  weekKey, sheet, detail, detailLoading, editable, expectedHours, schedule, display,
  taskOptions, totalMinutes, busy, submitConfirm, onSubmitConfirm, onAct, onSubmitWeek,
  onAdd, onDelete, onEdit, pastWeeks, onOpenWeek,
}: {
  weekKey: DayKey;
  sheet: ApiTimesheet | null;
  detail: SheetDetail | null;
  detailLoading: boolean;
  editable: boolean;
  expectedHours: number;
  schedule: WorkSchedule;
  display: { showNotes: boolean; showSource: boolean };
  taskOptions: PickerOption[];
  totalMinutes: number;
  busy: string | null;
  submitConfirm: boolean;
  onSubmitConfirm: (v: boolean) => void;
  onAct: (id: string, action: "submit" | "retract" | "reopen") => void;
  /** Submit the visible week, opening its Timesheet row first if it has none. */
  onSubmitWeek: () => Promise<void>;
  onAdd: (entry: NewEntry) => Promise<boolean>;
  onDelete: (entryId: string) => void;
  onEdit: (entryId: string, patch: { hours?: number; description?: string }) => Promise<boolean>;
  pastWeeks: ApiTimesheet[] | null;
  onOpenWeek: (key: DayKey) => void;
}) {
  // Logged more than the week's capacity. A denominator that carries no
  // signal is a number nobody reads: 39:18 over a 30:00 week was printed in
  // plain ink, exactly like 12:00 over the same week.
  const overCapacity = expectedHours > 0 && totalMinutes > expectedHours * 60;
  const fmt = useFormat();
  const status = sheet?.status ?? null;
  // A week with no row yet is a DRAFT that has not been written: the add
  // rows work, because POST /api/time-entries upserts the week (audit T-12).
  const entries: GridEntry[] | null = sheet
    ? (detail && detail.id === sheet.id ? detail.entries : detailLoading ? null : [])
    : [];

  const approverName = personName(sheet?.approver, "");

  return (
    <>
      <TimesheetWeekCard
        weekStartKey={weekKey}
        status={status}
        entries={entries}
        editable={editable}
        expectedHours={expectedHours}
        schedule={schedule}
        showNotes={display.showNotes}
        showSource={display.showSource}
        taskOptions={taskOptions}
        onAdd={onAdd}
        onDelete={onDelete}
        onEdit={onEdit}
        header={
          <>
            {/* The week the card holds, named on the card (spec-planner
                section 2: "the week label 15/500"). The stepper in the
                toolbar was the only place it appeared, so a screenshot of
                the card said nothing about which week it was. */}
            <span className="text-base font-medium text-ink">
              Week of {fmt.date(`${weekKey}T12:00:00.000Z`, "date")}
            </span>
            <WeekStatusChip status={status ?? "DRAFT"} />
            {status === "APPROVED" && sheet?.decisionAt ? (
              <span className="text-base text-ink-2">
                Approved{approverName ? ` by ${approverName}` : ""} on {fmt.date(sheet.decisionAt, "date")}
              </span>
            ) : null}

            {/* The total is RIGHT of the row, beside the state action, which
                is where spec-planner section 2 puts it ("the total '38:30'
                15/500 tnum right"). Sitting immediately after the status chip
                it read as part of the chip rather than as the week's number,
                and over-capacity said nothing at all. */}
            <span
              className="ms-auto tabular-nums text-base font-medium text-ink"
              title={expectedHours ? `${formatHm(totalMinutes)} logged against ${fmtExpected(expectedHours)} expected` : undefined}
            >
              <span className={overCapacity ? "text-warning-text" : undefined}>{formatHm(totalMinutes)}</span>
              {expectedHours ? <span className="text-ink-3"> / {fmtExpected(expectedHours)}</span> : null}
            </span>

            <span className="flex items-center gap-2">
              {/* No `&& sheet`: a week with nothing logged has no Timesheet
                  row yet, so gating on one hid the control on exactly the
                  week the spec's zero-hour path is about ("This week has no
                  hours." / "Submit anyway", audit T-13). The confirm creates
                  the row on the way through. */}
              {status === "DRAFT" ? (
                <button
                  type="button"
                  onClick={() => onSubmitConfirm(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-base font-medium text-ink hover:bg-hover"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Submit week
                </button>
              ) : null}
              {status === "SUBMITTED" && sheet ? (
                <button
                  type="button"
                  onClick={() => onAct(sheet.id, "retract")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-base font-medium text-ink hover:bg-hover"
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Retract
                </button>
              ) : null}
              {status === "REJECTED" && sheet ? (
                <button
                  type="button"
                  onClick={() => onAct(sheet.id, "reopen")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-base font-medium text-ink hover:bg-hover"
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Reopen and fix
                </button>
              ) : null}
            </span>
          </>
        }
        banner={
          // THE NOTE OUTLIVES THE STATUS ON PURPOSE. Reopening a returned
          // week sets it back to DRAFT and deliberately KEEPS decisionNote,
          // because it is what the person reads while they fix the hours,
          // but the banner was guarded on REJECTED, so "Reopen and fix" made
          // the reason you were fixing it vanish in the same click. It
          // follows the note now, and it NAMES the approver (audit T-4).
          sheet?.decisionNote && status !== "APPROVED" ? (
            <p className="flex min-h-11 items-center gap-2 border-b border-line-soft bg-danger-soft px-3 py-2 text-base text-danger-solid">
              <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
              Sent back
              {approverName ? ` by ${approverName}` : ""}
              {sheet.decisionAt ? ` on ${fmt.date(sheet.decisionAt, "date")}` : ""}
              : {sheet.decisionNote}
            </p>
          ) : status === "SUBMITTED" && sheet?.submittedAt ? (
            <p className="border-b border-line-soft px-3 py-2 text-base text-ink-2">
              Submitted {fmt.date(sheet.submittedAt, "date")}
              {approverName ? `, waiting for ${approverName}` : ", waiting for your manager"}. Retract it to change the hours.
            </p>
          ) : status === "APPROVED" ? (
            <p className="border-b border-line-soft px-3 py-2 text-base text-ink-2">
              This week is approved and read only. Ask your approver to reopen it.
            </p>
          ) : null
        }
      />

      {/* The submit confirmation is the spec's 400 modal, and it NAMES THE
          WEEK: the inline strip it replaces said "Submit 39:10 to Anita
          Rao?" with no way to tell which of the weeks on screen it meant. */}
      <Dialog open={submitConfirm} onOpenChange={(v) => { if (!v) onSubmitConfirm(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Submit this week?</DialogTitle>
            <DialogDescription>
              Submit {formatHm(totalMinutes)} for the week of{" "}
              {fmt.date(`${weekKey}T12:00:00.000Z`, "date")}
              {approverName ? ` to ${approverName}` : " to your manager"}.
              {totalMinutes === 0 ? " This week has no hours on it." : ""}
              {" "}You can retract it until it is decided.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => onSubmitConfirm(false)}
              className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void onSubmitWeek(); }}
              disabled={busy !== null}
              className="h-9 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-40"
            >
              {busy === "Submit" ? <Dots variant="pending" /> : totalMinutes === 0 ? "Submit anyway" : "Submit"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <h2 className="mb-2 mt-6 text-base font-semibold text-ink">Past weeks</h2>
      <TableCard<ApiTimesheet>
        ariaLabel="My past weeks"
        rows={pastWeeks}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpenWeek(utcDayKey(new Date(r.weekStartDate)))}
        empty={<span>No past weeks yet</span>}
        columns={[
          {
            key: "week",
            label: "Week",
            title: true,
            width: "minmax(180px,1fr)",
            render: (r) => `Week of ${fmt.date(`${utcDayKey(new Date(r.weekStartDate))}T12:00:00.000Z`, "date")}`,
          },
          {
            key: "status",
            label: "Status",
            width: "140px",
            render: (r) => <WeekStatusChip status={r.status} />,
          },
          {
            key: "hours",
            label: "Hours",
            numeric: true,
            width: "100px",
            render: (r) => formatHm(r.totalMinutes ?? 0),
          },
          {
            key: "entries",
            label: "Entries",
            numeric: true,
            width: "90px",
            render: (r) => r._count?.entries ?? 0,
          },
          {
            key: "decided",
            label: "Decided",
            width: "minmax(160px,1fr)",
            render: (r) => (r.decisionAt
              ? `${r.status === "APPROVED" ? "Approved" : "Sent back"}${personName(r.approver, "") ? ` by ${personName(r.approver)}` : ""} on ${fmt.date(r.decisionAt, "date")}`
              : ""),
          },
        ]}
      />
    </>
  );
}

/* ── The approver's queue and the Team table ────────────────────── */

function QueueTable({
  scope, rows, sortKey, onSort, onOpen, viewerId, onBulkDone,
}: {
  scope: Scope;
  rows: ApiTimesheet[] | null;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  onOpen: (id: string) => void;
  viewerId: string | null;
  onBulkDone: () => void;
}) {
  const fmt = useFormat();
  const { toast } = useOsToast();
  // BULK APPROVAL, KEPT. The manager this page replaced had a Select all
  // header checkbox, a per-row checkbox and a floating approve/reject bar
  // wired to POST /api/bulk-decide. Rebuilding the page dropped every one of
  // them and left that endpoint's timesheet branch unreachable, which is a
  // capability loss, not a restyle. It is back on the design system's own
  // selection chrome (TableCard `selectable` + `bulkActions`).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"APPROVE" | "REJECT" | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Nobody decides their own week, and the API refuses it, so those rows are
  // never part of a selection rather than selected and silently skipped.
  const decidable = useMemo(
    () => (rows ?? []).filter((r) => r.status === "SUBMITTED" && r.userId !== viewerId).map((r) => r.id),
    [rows, viewerId],
  );
  const chosen = useMemo(
    () => [...selected].filter((id) => decidable.includes(id)),
    [selected, decidable],
  );

  async function decideMany(decision: "APPROVE" | "REJECT", reason?: string) {
    if (chosen.length === 0) return;
    setBulkBusy(decision);
    setBulkError(null);
    const r = await apiFetchWithRetry<{ data?: { applied?: number; skipped?: unknown[] } }>(
      "/api/bulk-decide",
      {
        method: "POST",
        json: { entityType: "timesheet", decision, note: reason ?? null, ids: chosen },
        keepalive: true,
      },
      { attempts: 2, retryWrites: false },
    );
    setBulkBusy(null);
    if (!r.ok) {
      setBulkError(r.error === "note_required" ? "A reason is required to send weeks back." : r.error);
      return;
    }
    const raw = r.data as Record<string, unknown>;
    const d = (raw.data ?? raw) as { applied?: number; skipped?: unknown[] };
    const applied = Number(d.applied ?? 0);
    const skipped = Array.isArray(d.skipped) ? d.skipped.length : 0;
    toast(
      `${decision === "APPROVE" ? "Approved" : "Sent back"} ${applied} week${applied === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}`,
    );
    setSelected(new Set());
    setRejecting(false);
    setNote("");
    onBulkDone();
  }

  const columns: TableColumn<ApiTimesheet>[] = [
    {
      key: "person",
      label: "Person",
      title: true,
      sortable: scope === "team",
      width: "minmax(180px,1fr)",
      render: (r) => personName(r.user),
    },
    {
      key: "week",
      label: "Week",
      sortable: scope === "team",
      width: "minmax(160px,1fr)",
      render: (r) => `Week of ${fmt.date(`${utcDayKey(new Date(r.weekStartDate))}T12:00:00.000Z`, "date")}`,
    },
    {
      key: "hours",
      label: "Hours",
      numeric: true,
      sortable: scope === "team",
      width: "100px",
      render: (r) => formatHm(r.totalMinutes ?? 0),
    },
    {
      key: "entries",
      label: "Entries",
      numeric: true,
      width: "90px",
      render: (r) => r._count?.entries ?? 0,
    },
  ];
  if (scope === "approve") {
    columns.push({
      key: "submitted",
      label: "Submitted",
      width: "minmax(150px,1fr)",
      render: (r) => (r.submittedAt ? fmt.date(r.submittedAt, "datetime") : ""),
    });
  } else {
    columns.push(
      {
        key: "status",
        label: "Status",
        sortable: true,
        width: "140px",
        render: (r) => <WeekStatusChip status={r.status} />,
      },
      {
        key: "decided",
        label: "Decided by",
        width: "minmax(150px,1fr)",
        render: (r) => (r.decisionAt ? personName(r.approver, "") : ""),
      },
    );
  }

  return (
    <>
      {bulkError ? (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-danger-solid bg-danger-soft px-3 py-2 text-base text-ink">
          <CircleAlert className="h-4 w-4 shrink-0 text-danger-solid" strokeWidth={1.5} aria-hidden />
          <span className="flex-1">{bulkError}</span>
          <button type="button" onClick={() => setBulkError(null)} aria-label="Dismiss" className="h-7 rounded-md px-2 text-sm text-ink-2 hover:bg-hover">
            Dismiss
          </button>
        </div>
      ) : null}

      <TableCard<ApiTimesheet>
        ariaLabel={scope === "approve" ? "Weeks waiting on you" : "Team timesheets"}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpen(r.id)}
        columns={columns}
        selectable={decidable.length > 0}
        selected={selected}
        onSelectedChange={(next) => setSelected(new Set([...next].filter((id) => decidable.includes(id))))}
        sort={scope === "team" ? { key: sortKey, dir: sortKey === "person" || sortKey === "status" ? "asc" : "desc" } : null}
        onSort={scope === "team" ? (k) => onSort(k as SortKey) : undefined}
        footer={rows === null ? undefined : {
          total: rows.length,
          noun: "weeks",
          from: rows.length ? 1 : 0,
          to: rows.length,
        }}
        bulkActions={chosen.length > 0 ? (
          <>
            <BulkAction
              label={bulkBusy === "APPROVE" ? "Approving" : "Approve"}
              onClick={() => { void decideMany("APPROVE"); }}
              disabled={bulkBusy !== null}
            />
            <BulkAction
              label="Send back"
              destructive
              onClick={() => { setRejecting(true); setBulkError(null); }}
              disabled={bulkBusy !== null}
            />
          </>
        ) : undefined}
        empty={
          <span>
            {scope === "approve"
              ? "Nothing to approve"
              : "No timesheets from your team yet"}
          </span>
        }
      />

      {/* Sending several weeks back needs ONE reason, and the API refuses a
          reasonless rejection for a batch exactly as it does for a row. */}
      <Dialog open={rejecting} onOpenChange={(v) => { if (!v) setRejecting(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send back {chosen.length} week{chosen.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Everyone whose week this is sees this reason on their own week card and can reopen it to fix the hours.
            </DialogDescription>
          </DialogHeader>
          <textarea
            autoFocus
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell them what to fix"
            aria-label="Reason"
            className="w-full rounded-md border border-line-strong bg-raised px-2 py-1.5 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
          <DialogFooter>
            <button type="button" onClick={() => setRejecting(false)} className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover">
              Cancel
            </button>
            <button
              type="button"
              disabled={!note.trim() || bulkBusy !== null}
              onClick={() => { void decideMany("REJECT", note.trim()); }}
              className="h-9 rounded-md bg-danger-solid px-3 text-base font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {bulkBusy === "REJECT" ? <Dots variant="pending" /> : "Send them back"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
