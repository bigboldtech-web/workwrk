"use client";

// PersonRecord (spec-teams-people section 3, /people/[id]): one person's
// record, the same content as a 520 drawer over the Directory (or the org
// chart, My team, a Skills holder) and as the full page on Expand or a deep
// link. One render driven by the server's `access` answer (GET
// /api/users/[id]): the record card, then only the tabs the viewer holds.
//
//   Overview      About (the job title's description); the Score card for
//                 people-data viewers when a score exists
//   KRAs & KPIs   the alignment, Manage alignment, Record numbers, History
//                 (the old KPI history tab, folded in)
//   Goals         their open goals, each with the verdict /okrs shows
//   Reviews       My weekly review (self) and review-cycle results, as links
//   Skills        names for everyone; ratings, Add, Rate and Remove by rule
//   Kudos         received, with reactions; Give kudos (not self)
//   Assets        the kit assigned to them
//   Reports       direct reports as real links, and Open in Org chart
//
// Removed from the old page: the Check-ins tab and the Avg Mood tile (no
// writer ever fed them; /api/check-ins stays), the always-ACTIVE status chip,
// the access-level chip, the disabled Access Level select (Members is the
// writer), and the "My Profile" eyebrow.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownRight, ArrowUpRight, CalendarCheck, ExternalLink, Eye, Heart, Link2, MessageCircle,
  MoreHorizontal, MoveRight, Network, Pencil, Plus, RotateCcw, Star, Trophy, UserMinus, Users,
} from "lucide-react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/layout/os/top-bar/breadcrumb";
import { personOrigin } from "@/lib/nav/teams-rows";
import { formatPeriodLabel } from "@/lib/kpi-utils";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { Chip } from "@/components/ui/chip";
import { SkeletonLines, SkeletonRows } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar-stack";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { TagPicker } from "@/components/tags/tag-picker";
import { MonthlyKpiRecorder } from "@/components/kpi/monthly-kpi-recorder";
import { KudosReactions } from "@/components/kudos/kudos-reactions";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { appAudienceAllows } from "@/lib/nav/app-audience";
import { assetGlyph } from "@/app/(dashboard)/assets/asset-glyph";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { ratingLabel } from "@/lib/people/skills-aggregate";
import { seniorityLabel } from "@/lib/people/seniority";
import { describeSchedule } from "@/lib/work-schedule";
import { fitTabs } from "@/lib/people/fit-tabs";
import { cn } from "@/lib/utils";
import { verdictChip, type GoalVerdict } from "@/lib/goal-verdict";
import { useMayAssignGoalOwner } from "@/components/okrs/create-goal-modal";
import { PersonAvatar, ToneChip, personName, type PickPerson } from "./person-bits";
import { ManageAlignmentDialog } from "./manage-alignment-dialog";
import { EditDetailsDialog } from "./edit-details-dialog";
import { RemovePersonDialog } from "./remove-person-dialog";
import { RecordAccessDialog } from "./record-access-dialog";
import { WorkingOnSection } from "./working-on-section";
import { AddSkillDialog, RateSkillDialog, SKILLS_CHANGED, emitSkillsChanged } from "./skill-dialogs";

/* ─────────────────────────── payload ─────────────────────────── */

interface Access {
  relation: string;
  peopleData: boolean;
  editable: string[];
  remove: boolean;
  restore: boolean;
  avatar: boolean;
  manageAlignment: boolean;
  rateSkills: boolean;
  addSkills: boolean;
  removeSkills: boolean;
  tags: boolean;
  dottedLines: boolean;
  manageMembers: boolean;
}

interface Skill { id: string; name: string; selfRating: number | null; managerRating: number | null }
interface KudosRow {
  id: string; message: string; companyValue: string | null; createdAt: string;
  giver: PickPerson; reactionCounts: Array<{ emoji: string; count: number }>; myReactions: string[];
}
interface ReviewRow {
  id: string; cycleId: string; status: string; outcome: string | null; overallScore: number | null; calibratedScore: number | null;
  cycle: { id: string; name: string; startDate: string; endDate: string; status: string };
}
interface KpiHistoryRow {
  id: string; period: string; actualValue: number | null; targetValue: number | null; score: number | null; status: string;
  reviewedBy: string | null; kpi: { name: string; unit: string | null };
}
interface Person {
  id: string; firstName: string; lastName: string; email: string; avatar: string | null; status: string;
  joinDate: string; deletedAt: string | null; isAgent: boolean;
  role: { id: string; title: string; description: string | null; seniority: string | null } | null;
  department: { id: string; name: string } | null;
  office: { id: string; name: string; city: string | null } | null;
  manager: PickPerson | null;
  dottedManagers: PickPerson[];
  directReports: Array<PickPerson & { role: { id: string; title: string } | null; department: { id: string; name: string } | null }>;
  presenceStatus: string | null; presenceUntil: string | null;
  skills: Skill[];
  kudosCount: number;
  kudosReceived: KudosRow[];
  access: Access;
  minimal?: boolean;
  phone?: string | null;
  dateOfBirth?: string | null;
  weeklyCapacityHours?: number | null;
  workSchedule?: { workdays: number[]; hoursPerDay: number } | null;
  orgSchedule?: { workdays: number[]; hoursPerDay: number } | null;
  defaultWeeklyHours?: number | null;
  profileFields?: Array<{ key: string; label: string; value: string | null }>;
  kpiHistory?: KpiHistoryRow[];
  kpiHistoryTotal?: number;
  reviews?: ReviewRow[];
  reviewsTotal?: number;
  score?: { score: number; breakdown: Record<string, unknown> | null; band: { label: string; tone: "success" | "warning" | "danger" | "neutral" } | null } | null;
  scoreHistory?: Array<{ period: string; score: number }>;
}

interface AlignKpi {
  id: string; name: string; unit: string | null; targetValue: number | null; direction: "HIGHER" | "LOWER" | "MAINTAIN";
  ownership: "OWNED" | "SHARED"; isNorthStar: boolean; latestValue: number | null; latestPeriod: string | null;
  currentRecord: { status: string } | null;
}
interface AlignKra { assignmentId: string; weightage: number; id: string; name: string; description: string | null; role: { id: string; title: string } | null; kpis: AlignKpi[] }
interface AlignOkr { id: string; title: string; status: string; progress: number; progressSource?: string; quarter: string | null; verdict?: GoalVerdict; quarterLabel?: string | null }
interface Alignment { quarter: string; window?: "current" | "quarter"; currentPeriod: string; kras: AlignKra[]; okrs: AlignOkr[] }

type TabKey = "overview" | "kras" | "goals" | "reviews" | "skills" | "kudos" | "assets" | "reports";
const TAB_LABEL: Record<TabKey, string> = {
  overview: "Overview", kras: "KRAs & KPIs", goals: "Goals", reviews: "Reviews", skills: "Skills", kudos: "Kudos", assets: "Assets", reports: "Reports",
};
/** Old ?tab= values, folded into the tab that owns them now. */
const TAB_ALIAS: Record<string, TabKey> = { history: "kras", checkins: "overview" };

const RECORD_STATUS: Record<string, { label: string; tone: "success" | "info" | "warning" | "neutral" }> = {
  APPROVED: { label: "Approved", tone: "success" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  REJECTED: { label: "Changes requested", tone: "warning" },
  PENDING: { label: "Not recorded", tone: "neutral" },
};

const OUTCOME_LABEL: Record<string, string> = {
  PROMOTION_ELIGIBLE: "Promotion eligible",
  HIKE_ELIGIBLE: "Raise eligible",
  STATUS_QUO: "Status quo",
  PIP_REQUIRED: "Improvement plan",
  EXIT_RECOMMENDATION: "Exit recommended",
};

/* ─────────────────────────── small parts ─────────────────────────── */

function DirectionGlyph({ direction }: { direction: string }) {
  const Icon = direction === "LOWER" ? ArrowDownRight : direction === "MAINTAIN" ? MoveRight : ArrowUpRight;
  const label = direction === "LOWER" ? "Lower is better" : direction === "MAINTAIN" ? "Hold the line" : "Higher is better";
  return <Icon className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-label={label}><title>{label}</title></Icon>;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

function GhostButton({ icon: Icon, children, onClick, href }: { icon?: typeof Plus; children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";
  if (href) return <Link href={href} className={cls}>{Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}{children}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}{children}</button>;
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="os-chrome divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-raised">{children}</ul>;
}

function RecordRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[36px] grid-cols-[140px_1fr] items-center gap-3 py-1">
      <dt className="text-sm font-medium text-ink-2">{label}</dt>
      <dd className="min-w-0 text-row text-ink">{children}</dd>
    </div>
  );
}

function PersonLink({ person, size = 20 }: { person: PickPerson; size?: 20 | 24 | 28 }) {
  return (
    <Link href={`/people/${person.id}`} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
      <Avatar person={person} size={size} />
      <span className="truncate">{personName(person)}</span>
    </Link>
  );
}

/** Start (or reopen) a DM and jump into it. */
function MessageButton({ userId }: { userId: string }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/conversations", { method: "POST", json: { type: "DM", memberIds: [userId] } });
    setBusy(false);
    const id = r.ok ? r.data.id ?? r.data.data?.id : null;
    if (id) router.push(`/tlk/${id}`);
    else toast(r.ok ? "Couldn't open the conversation" : r.error || "Couldn't open the conversation", { tone: "danger" });
  };
  return (
    <button type="button" onClick={() => void go()} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60">
      <MessageCircle className="h-4 w-4" aria-hidden /> Message
    </button>
  );
}

/* ─────────────────────────── the record ─────────────────────────── */

export function PersonRecord({
  id,
  presentation,
  expanded = false,
  onMeta,
}: {
  id: string;
  presentation: "drawer" | "page";
  expanded?: boolean;
  /** The drawer host's header reads the name once the record loads. */
  onMeta?: (meta: { name: string; self: boolean }) => void;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const { rowVersion, bumpRowVersion } = useOsShell();
  const datePrefs = useDatePrefs();
  const { openSettings } = useSettingsNav();
  const [person, setPerson] = useState<Person | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [alignState, setAlignState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<Person>(`/api/users/${id}`, { cache: "no-store" });
    if (!r.ok) { setState(r.status === 404 ? "missing" : "error"); return; }
    setPerson(r.data);
    setState("ready");
  }, [id]);

  const loadAlignment = useCallback(async () => {
    setAlignState("loading");
    const r = await apiFetch<Alignment | { data: Alignment }>(`/api/people/${id}/alignment`, { cache: "no-store" });
    if (!r.ok) { setAlignState("error"); return; }
    setAlignment("data" in r.data ? r.data.data : r.data);
    setAlignState("ready");
  }, [id]);

  const peopleVersion = rowVersion("people");
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load, peopleVersion]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener(SKILLS_CHANGED, onFocus);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener(SKILLS_CHANGED, onFocus); };
  }, [load]);

  const peopleData = person?.access.peopleData ?? false;
  useEffect(() => {
    if (!peopleData) return;
    const t = setTimeout(() => { void loadAlignment(); }, 0);
    return () => clearTimeout(t);
  }, [peopleData, loadAlignment]);

  const self = person?.access.relation === "self";
  const guest = boot.viewer.orgRole === "GUEST";
  const tabs = useMemo<TabKey[]>(() => {
    if (!person) return ["overview"];
    const t: TabKey[] = ["overview"];
    if (person.access.peopleData) t.push("kras", "goals", "reviews");
    t.push("skills");
    if (!guest) t.push("kudos");
    if (person.access.peopleData) t.push("assets");
    if (person.directReports.length > 0) t.push("reports");
    return t;
  }, [person, guest]);

  const rawTab = sp?.get("tab") ?? "overview";
  const wanted = (TAB_ALIAS[rawTab] ?? rawTab) as TabKey;
  const tab: TabKey = tabs.includes(wanted) ? wanted : "overview";
  // A ?tab= the viewer cannot hold renders the default and is stripped (the
  // denial shape for a view of a page the viewer holds).
  useEffect(() => {
    if (state !== "ready" || !sp?.get("tab")) return;
    if (rawTab === tab) return;
    const qs = new URLSearchParams(sp.toString());
    if (tab === "overview") qs.delete("tab"); else qs.set("tab", tab);
    router.replace(`/people/${id}${qs.toString() ? `?${qs}` : ""}`, { scroll: false });
  }, [state, rawTab, tab, sp, router, id]);
  // ?edit=details and ?edit=remove (the Directory row menu's Edit details
  // and Remove) open the dialog once the record says the viewer holds it,
  // then leave the URL; a viewer who does not hold it just gets the record.
  const editParam = sp?.get("edit") ?? null;
  const [editHandled, setEditHandled] = useState<string | null>(null);
  const editKey = editParam ? `${id}:${editParam}` : null;
  if (state === "ready" && person && editKey && editHandled !== editKey) {
    // Render-phase derived state (the Picker pattern), never an effect.
    setEditHandled(editKey);
    if (editParam === "details" && !person.deletedAt && (person.access.editable.length > 0 || person.access.dottedLines)) setEditOpen(true);
    if (editParam === "remove" && person.access.remove) setRemoveOpen(true);
  }
  useEffect(() => {
    if (!editKey || editHandled !== editKey) return;
    const qs = new URLSearchParams(sp?.toString() ?? "");
    qs.delete("edit");
    router.replace(`/people/${id}${qs.toString() ? `?${qs}` : ""}`, { scroll: false });
  }, [editKey, editHandled, sp, router, id]);
  const setTab = (next: TabKey) => {
    const qs = new URLSearchParams(sp?.toString() ?? "");
    if (next === "overview") qs.delete("tab"); else qs.set("tab", next);
    router.replace(`/people/${id}${qs.toString() ? `?${qs}` : ""}`, { scroll: false });
  };
  // The tab strip keeps to one line: tabs that do not fit (the 520 drawer
  // holds about six) go into a "More" menu, and the active tab is always in
  // view. Measured with a callback ref, since the strip mounts after load.
  const [tabsW, setTabsW] = useState(0);
  const tabsObs = useRef<ResizeObserver | null>(null);
  const tabRef = useCallback((el: HTMLDivElement | null) => {
    tabsObs.current?.disconnect();
    tabsObs.current = null;
    if (!el) return;
    const read = () => setTabsW(Math.round(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    tabsObs.current = ro;
  }, []);
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);
  const moreTabsRef = useRef<HTMLButtonElement>(null);

  const name = person ? personName(person) : "";
  useEffect(() => { if (person) onMeta?.({ name: personName(person), self: person.access.relation === "self" }); }, [person, onMeta]);
  // Opened from My team (?from=team): the crumb and the back target name
  // the page the viewer came from, not the Directory.
  const origin = personOrigin(sp?.toString() ?? "");
  const crumb: BreadcrumbItem[] = self ? [{ label: "My profile" }] : [{ label: origin.label, href: origin.href }, { label: name || "Person" }];
  const talkOn = boot.launcherApps.includes("chat");

  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/people/${id}`); toast("Link copied"); }
    catch { toast("Couldn't copy the link", { tone: "danger" }); }
  }

  async function restore() {
    if (!person) return;
    const ok = await confirm({ title: `Restore ${name}?`, description: "They can sign in again, and their history picks up where it left off.", confirmLabel: "Restore" });
    if (!ok) return;
    const r = await apiFetch(`/api/users/${id}?restore=true`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't restore them", { tone: "danger" }); return; }
    toast(`Restored ${name}`);
    bumpRowVersion("people");
    void load();
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const r = await apiFetch<{ avatar?: string; data?: { avatar?: string } }>(`/api/users/${id}/avatar`, { method: "POST", body: form });
    setUploading(false);
    if (!r.ok) { toast(r.error || "Couldn't upload the photo", { tone: "danger" }); return; }
    toast("Photo updated");
    void load();
  }

  if (state === "missing") {
    return presentation === "page" ? <NotFoundView /> : <OsEmptyView title="This person isn't here." compact />;
  }
  if (state === "error") {
    return <OsEmptyView variant="error" title="Couldn't load this record" action={{ label: "Try again", onClick: () => { setState("loading"); void load(); } }} compact={presentation === "drawer"} />;
  }

  const editLabel = self ? "Edit profile" : "Edit details";
  const canEdit = !!person && !person.deletedAt && (self || person.access.editable.length > 0 || person.access.dottedLines);

  const titleSlot = person ? (
    <div className="flex min-w-0 items-center gap-2.5">
      {person.access.avatar ? (
        <label className="relative cursor-pointer" title={uploading ? "Uploading" : "Change photo"}>
          <PersonAvatar person={person} size={36} />
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); e.target.value = ""; }} />
        </label>
      ) : (
        <PersonAvatar person={person} size={36} />
      )}
      <h1 className="min-w-0 truncate text-title font-semibold text-ink">{name}</h1>
      {person.deletedAt ? <Chip>Removed {formatDate(person.deletedAt, datePrefs, "date")}</Chip> : person.status === "INACTIVE" ? <Chip>Deactivated</Chip> : null}
      {person.isAgent ? <Chip>Agent</Chip> : null}
    </div>
  ) : <SkeletonLines lines={1} />;

  const actions = person ? (
    <>
      {talkOn && !self && !person.deletedAt ? <MessageButton userId={person.id} /> : null}
      {self ? (
        <button type="button" onClick={() => openSettings("/account/profile")} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
          <Pencil className="h-4 w-4" aria-hidden /> {editLabel}
        </button>
      ) : canEdit ? (
        <button type="button" onClick={() => setEditOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
          <Pencil className="h-4 w-4" aria-hidden /> {editLabel}
        </button>
      ) : null}
      <button ref={menuRef} type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {menuOpen ? (
        <MorePortal anchorRef={menuRef} width={240} open placement="below" onClose={() => setMenuOpen(false)}>
          <MenuList aria-label="Person actions">
            <MenuItem icon={Link2} label="Copy link" onClick={() => { setMenuOpen(false); void copyLink(); }} />
            <MenuItem icon={Eye} label="Who can see this record" onClick={() => { setMenuOpen(false); setAccessOpen(true); }} />
            {person.access.manageMembers ? (
              <MenuItem icon={ExternalLink} label="Manage in Members" onClick={() => { setMenuOpen(false); openSettings(`/settings/members?open=${person.id}`); }} />
            ) : null}
            {person.access.remove || person.access.restore ? <MenuSeparator /> : null}
            {person.access.remove ? <MenuItem icon={UserMinus} destructive label="Remove from workspace" onClick={() => { setMenuOpen(false); setRemoveOpen(true); }} /> : null}
            {person.access.restore ? <MenuItem icon={RotateCcw} label="Restore" onClick={() => { setMenuOpen(false); void restore(); }} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}
    </>
  ) : null;

  const editEnabled = canEdit && !self;

  const body = (
    <div className={cn("flex flex-col gap-5", presentation === "page" || expanded ? "mx-auto w-full max-w-[720px] px-6 pb-10 pt-3" : "px-5 pb-8 pt-2")}>
      {state === "loading" || !person ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4"><SkeletonRows rows={6} rowHeight="36px" /></div>
      ) : (
        <>
          <RecordCard person={person} datePrefs={datePrefs} onEditPlacement={!person.deletedAt ? () => setEditOpen(true) : undefined} />
          {tabs.length > 1 ? (
            <div
              ref={tabRef}
              role="tablist"
              aria-label="Record sections"
              className="flex h-9 items-center gap-1 overflow-hidden"
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                const i = tabs.indexOf(tab);
                const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                setTab(next);
              }}
            >
              {(() => {
                const { shown, overflow } = fitTabs(tabs, tab, tabsW, (t) => TAB_LABEL[t].length + (t === "kudos" && person.kudosCount > 0 ? String(person.kudosCount).length + 1 : 0));
                return (
                  <>
                    {shown.map((t) => (
                      <ViewTab
                        key={t}
                        label={TAB_LABEL[t]}
                        active={tab === t}
                        onClick={() => setTab(t)}
                        trailing={t === "kudos" && person.kudosCount > 0 ? <span className="text-xs font-medium text-ink-2">{person.kudosCount}</span> : undefined}
                      />
                    ))}
                    {overflow.length ? (
                      <>
                        <button
                          ref={moreTabsRef}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={moreTabsOpen}
                          onClick={() => setMoreTabsOpen((v) => !v)}
                          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink"
                        >
                          More <span className="text-xs font-medium tabular-nums">{overflow.length}</span>
                        </button>
                        {moreTabsOpen ? (
                          <MorePortal anchorRef={moreTabsRef} width={200} open placement="below" onClose={() => setMoreTabsOpen(false)}>
                            <MenuList aria-label="More sections">
                              {overflow.map((t) => (
                                <MenuItem key={t} label={t === "kudos" && person.kudosCount > 0 ? `${TAB_LABEL[t]} ${person.kudosCount}` : TAB_LABEL[t]} onClick={() => { setMoreTabsOpen(false); setTab(t); }} />
                              ))}
                            </MenuList>
                          </MorePortal>
                        ) : null}
                      </>
                    ) : null}
                  </>
                );
              })()}
            </div>
          ) : null}
          <div role="tabpanel" aria-label={TAB_LABEL[tab]}>
            {tab === "overview" ? <OverviewTab person={person} /> : null}
            {tab === "kras" ? <KrasTab person={person} alignment={alignment} state={alignState} onRetry={() => void loadAlignment()} onChanged={() => { void loadAlignment(); void load(); }} datePrefs={datePrefs} /> : null}
            {tab === "goals" ? <GoalsTab person={person} alignment={alignment} state={alignState} onRetry={() => void loadAlignment()} /> : null}
            {tab === "reviews" ? <ReviewsTab person={person} /> : null}
            {tab === "skills" ? <SkillsTab person={person} onChanged={() => void load()} /> : null}
            {tab === "kudos" ? <KudosTab person={person} datePrefs={datePrefs} /> : null}
            {tab === "assets" ? <AssetsTab userId={person.id} /> : null}
            {tab === "reports" ? <ReportsTab person={person} /> : null}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <Breadcrumb items={crumb} />
      <EditShortcut enabled={editEnabled} onOpen={() => setEditOpen(true)} />
      {presentation === "page" ? (
        <>
          {/* back-map.md section 5: from /team the browser history gives the
              back; the fallback is always the Directory, which every viewer
              can open (a manager who lost their reports would land on the My
              team lock). */}
          <OsPageHeader title={name || "Person"} titleSlot={titleSlot} back={{ fallbackHref: "/people", label: "Directory" }} actions={actions} />
          {body}
        </>
      ) : (
        <div className="flex min-h-0 flex-col">
          <div className={cn("flex min-h-12 items-center gap-2 py-3", expanded ? "mx-auto w-full max-w-[720px] px-6" : "px-5")}>
            <div className="min-w-0 flex-1">{titleSlot}</div>
            <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
          </div>
          {body}
        </div>
      )}
      {editOpen && person ? (
        <EditDetailsDialog
          person={{
            ...person,
            role: person.role ? { id: person.role.id, title: person.role.title } : null,
            office: person.office ? { id: person.office.id, name: person.office.name } : null,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => { bumpRowVersion("people"); void load(); void loadAlignment(); }}
        />
      ) : null}
      {accessOpen && person ? <RecordAccessDialog userId={person.id} onClose={() => setAccessOpen(false)} /> : null}
      {removeOpen && person ? (
        <RemovePersonDialog
          userId={person.id}
          firstName={person.firstName}
          fullName={name}
          manager={person.manager}
          me={{ id: boot.viewer.id, firstName: boot.viewer.firstName, lastName: boot.viewer.lastName, avatar: boot.viewer.avatar, email: boot.viewer.email }}
          onClose={() => setRemoveOpen(false)}
          onRemoved={() => { setRemoveOpen(false); bumpRowVersion("people"); void load(); }}
        />
      ) : null}
    </>
  );
}

/** ⌘E / Ctrl+E opens Edit details while the record is on screen and it renders. */
function EditShortcut({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "e") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,[contenteditable='true']")) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onOpen]);
  return null;
}

/* ─────────────────────────── record card ─────────────────────────── */

/** Fields beyond the personal ones (names, phone, date of birth). */
const PLACEMENT_FIELDS = ["roleId", "departmentId", "officeId", "managerId", "weeklyCapacityHours", "workSchedule", "customFields"];

function RecordCard({ person, datePrefs, onEditPlacement }: { person: Person; datePrefs: ReturnType<typeof useDatePrefs>; onEditPlacement?: () => void }) {
  const { toast } = useOsToast();
  const self = person.access.relation === "self";
  // An Owner, Admin or manager-tier person holds their own placement writes
  // (yesterday's rule), so the "ask your manager" caption would be wrong.
  const selfPlacement = self && person.access.editable.some((f) => PLACEMENT_FIELDS.includes(f));
  const birthday = person.dateOfBirth
    ? person.dateOfBirth.startsWith("--")
      ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`2000-${person.dateOfBirth.slice(2)}T12:00:00Z`))
      : formatDate(`${person.dateOfBirth}T12:00:00Z`, datePrefs, "date")
    : null;
  return (
    <div className="rounded-lg border border-line bg-raised px-4 py-2">
      <dl className="flex flex-col">
        <RecordRow label="Job title">
          {person.role ? <Link href={`/people/roles/${person.role.id}`} className="hover:underline">{person.role.title}</Link> : <span className="text-ink-3">No job title yet</span>}
        </RecordRow>
        <RecordRow label="Department">
          {person.department ? <Link href={`/people?dept=${person.department.id}`} className="hover:underline">{person.department.name}</Link> : <span className="text-ink-3">No department</span>}
        </RecordRow>
        {person.office ? <RecordRow label="Office">{person.office.city ? `${person.office.name} · ${person.office.city}` : person.office.name}</RecordRow> : null}
        <RecordRow label="Reports to">
          {person.manager ? <PersonLink person={person.manager} /> : <span className="text-ink-3">Nobody</span>}
        </RecordRow>
        {person.dottedManagers.length > 0 ? (
          <RecordRow label="Dotted-line managers">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{person.dottedManagers.map((m) => <PersonLink key={m.id} person={m} />)}</span>
          </RecordRow>
        ) : null}
        <RecordRow label="Email">
          <button type="button" className="truncate text-start hover:underline" title="Copy email" onClick={() => { void navigator.clipboard.writeText(person.email).then(() => toast("Email copied"), () => toast("Couldn't copy the email", { tone: "danger" })); }}>{person.email}</button>
        </RecordRow>
        {person.access.peopleData && person.phone ? <RecordRow label="Phone">{person.phone}</RecordRow> : null}
        {person.access.peopleData && birthday ? <RecordRow label="Date of birth">{birthday}</RecordRow> : null}
        <RecordRow label="Joined">{formatDate(person.joinDate, datePrefs, "date")}</RecordRow>
        {person.access.peopleData ? (
          <RecordRow label="Weekly capacity">
            {person.weeklyCapacityHours != null ? (
              `${person.weeklyCapacityHours}h`
            ) : (
              <span className="text-ink-2">
                {person.workSchedule ? "From their schedule" : "Org default"}
                {person.defaultWeeklyHours != null ? ` (${person.defaultWeeklyHours}h)` : ""}
              </span>
            )}
          </RecordRow>
        ) : null}
        {person.access.peopleData && (person.workSchedule || person.orgSchedule) ? (
          <RecordRow label="Work schedule">
            {person.workSchedule ? (
              describeSchedule(person.workSchedule)
            ) : (
              <span className="text-ink-2">Org schedule{person.orgSchedule ? ` (${describeSchedule(person.orgSchedule)})` : ""}</span>
            )}
          </RecordRow>
        ) : null}
        {person.access.peopleData
          ? (person.profileFields ?? [])
              .filter((f) => f.value || person.access.editable.includes("customFields"))
              .map((f) => (
                <RecordRow key={f.key} label={f.label}>
                  {f.value ? <span className="whitespace-pre-wrap break-words">{f.value}</span> : <span className="text-ink-3">Not set</span>}
                </RecordRow>
              ))
          : null}
        {person.access.peopleData ? (
          <RecordRow label="Tags"><TagPicker entityType="USER" entityId={person.id} canEdit={person.access.tags} /></RecordRow>
        ) : null}
      </dl>
      {self && !selfPlacement ? <p className="pb-1 pt-2 text-sm text-ink-2">Ask your manager or the People team to change your job title, department, office or manager.</p> : null}
      {self && selfPlacement && onEditPlacement ? (
        <p className="pb-1 pt-2 text-sm text-ink-2">
          You can change your own placement.{" "}
          <button type="button" className="text-brand-deep hover:underline" onClick={onEditPlacement}>Edit details</button>
        </p>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── tabs ─────────────────────────── */

const SCORE_ROWS: Array<{ label: string; key: string; weightKey?: string }> = [
  { label: "KPIs", key: "kpiScore", weightKey: "kpi" },
  { label: "Manager review", key: "managerRating", weightKey: "manager" },
  { label: "Peer feedback", key: "peerRating", weightKey: "peer" },
  { label: "Self review", key: "selfRating", weightKey: "self" },
  { label: "SOP compliance", key: "sopCompliance", weightKey: "sopCompliance" },
  { label: "Goals", key: "okrScore" },
  { label: "Task delivery", key: "taskScore" },
];

function Bar({ value }: { value: number }) {
  return (
    // block: inside the Goals row's wrapper an inline span has no height,
    // so the bar never drew there (a grid cell blockifies it on its own).
    <span className="block h-1 w-full overflow-hidden rounded-full bg-hover">
      <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

/**
 * Is anything behind this score? A PerformanceScore row whose every input is
 * null (a brand new member, recalculated because a welcome kudos arrived) is
 * a 0 with nothing measured, and scoreBand(0) would call it "At risk". The
 * service no longer writes such a row; this guards the rows written before.
 */
function scoreHasInputs(breakdown: Record<string, unknown> | null): boolean {
  return !!breakdown && SCORE_ROWS.some((r) => typeof breakdown[r.key] === "number");
}

function OverviewTab({ person }: { person: Person }) {
  const breakdown = person.score?.breakdown ?? null;
  const weights = (breakdown?.weights ?? {}) as Record<string, number>;
  const measured = scoreHasInputs(breakdown);
  // The latest history month is the row person.score reads; when nothing
  // is behind it, its 0 is not a month to chart either.
  const history = measured ? person.scoreHistory ?? [] : (person.scoreHistory ?? []).slice(0, -1);
  return (
    <div className="flex flex-col gap-5">
      <Section title="About" action={person.role ? <GhostButton href={`/people/roles/${person.role.id}`}>Open job title</GhostButton> : undefined}>
        {person.role?.description ? (
          <p className="whitespace-pre-wrap text-row text-ink">{person.role.description}</p>
        ) : (
          <p className="text-row text-ink-2">{person.role ? "This job title has no description yet." : "No job title yet."}</p>
        )}
        {person.role?.seniority ? <p className="text-sm text-ink-2">Seniority: {seniorityLabel(person.role.seniority)}</p> : null}
      </Section>
      {/* The people who manage this person see what they are working on
          (My team's "+2" lands here). Not on your own record: that is My Work. */}
      {person.access.peopleData && person.access.relation !== "self" && !person.deletedAt ? <WorkingOnSection userId={person.id} /> : null}
      {person.access.peopleData && person.score ? (
        <Section title="Score">
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4">
            {!measured ? (
              <p className="text-row text-ink-2">No score yet. It appears once KPIs, reviews or SOP results are recorded.</p>
            ) : (<>
            <div className="flex items-center gap-2">
              <span className="text-title font-semibold tabular-nums text-ink">{Math.round(person.score.score)}</span>
              {person.score.band ? <ToneChip tone={person.score.band.tone} label={person.score.band.label} /> : null}
            </div>
            <ul className="flex flex-col gap-2">
              {SCORE_ROWS.map((r) => {
                const v = breakdown?.[r.key];
                if (typeof v !== "number") return null;
                const w = r.weightKey ? weights[r.weightKey] : undefined;
                return (
                  <li key={r.key} className="grid grid-cols-[140px_1fr_40px] items-center gap-3 text-sm">
                    <span className="text-ink-2">{r.label}{w != null ? ` · ${w}%` : ""}</span>
                    <Bar value={v} />
                    <span className="text-end tabular-nums text-ink">{Math.round(v)}</span>
                  </li>
                );
              })}
              {typeof breakdown?.kudosBonus === "number" && (breakdown.kudosBonus as number) > 0 ? (
                <li className="grid grid-cols-[140px_1fr_40px] items-center gap-3 text-sm">
                  <span className="text-ink-2">Kudos bonus</span><span /><span className="text-end tabular-nums text-ink">+{breakdown.kudosBonus as number}</span>
                </li>
              ) : null}
            </ul>
            </>)}
            {history.length > (measured ? 1 : 0) ? (
              <div className={`flex flex-col gap-1.5${measured ? " border-t border-line-soft pt-3" : ""}`}>
                <span className="text-sm font-medium text-ink-2">By month</span>
                {history.map((h) => (
                  <div key={h.period} className="grid grid-cols-[140px_1fr_40px] items-center gap-3 text-sm">
                    <span className="tabular-nums text-ink-2">{formatPeriodLabel(h.period)}</span>
                    <Bar value={h.score} />
                    <span className="text-end tabular-nums text-ink">{Math.round(h.score)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function KrasTab({ person, alignment, state, onRetry, onChanged, datePrefs }: {
  person: Person; alignment: Alignment | null; state: string; onRetry: () => void; onChanged: () => void; datePrefs: ReturnType<typeof useDatePrefs>;
}) {
  const self = person.access.relation === "self";
  // ?record=1 (My team's row "..." > Record numbers) opens with the recorder showing.
  const sp = useSearchParams();
  const [recorder, setRecorder] = useState(() => sp?.get("record") === "1");
  const [manage, setManage] = useState(false);
  const kras = alignment?.kras ?? [];
  const total = kras.reduce((s, k) => s + (k.weightage || 0), 0);
  const history = person.kpiHistory ?? [];
  void datePrefs;
  return (
    <div className="flex flex-col gap-5">
      <Section
        // The total lives in the warning chip alone (shown only when it is
        // not 100), so it is never printed twice and a person with no KRAs
        // never reads "Weights total 0%".
        title={alignment ? `KRAs & KPIs · ${formatPeriodLabel(alignment.currentPeriod)}` : "KRAs & KPIs"}
        action={
          <span className="flex items-center gap-1">
            {kras.length > 0 && total !== 100 ? <ToneChip tone="warning" label={`Weights total ${total}%`} /> : null}
            {person.access.manageAlignment && !person.deletedAt ? <GhostButton onClick={() => setManage(true)}>Manage alignment</GhostButton> : null}
            {kras.length > 0 && !person.deletedAt ? <GhostButton onClick={() => setRecorder((v) => !v)}>{recorder ? "Hide recorder" : self ? "Record my numbers" : "Record numbers"}</GhostButton> : null}
          </span>
        }
      >
        {recorder ? <MonthlyKpiRecorder userId={person.id} self={self} /> : null}
        {state === "error" ? (
          <OsEmptyView variant="error" title="Couldn't load the KRAs" action={{ label: "Try again", onClick: onRetry }} compact />
        ) : state !== "ready" ? (
          <SkeletonRows rows={3} />
        ) : kras.length === 0 ? (
          <p className="rounded-lg border border-line bg-raised px-4 py-3 text-row text-ink-2">
            No KRAs yet.{" "}
            {person.access.manageAlignment ? <button type="button" className="text-brand-deep hover:underline" onClick={() => setManage(true)}>Manage alignment</button> : self ? "Ask your manager to assign KRAs." : null}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {kras.map((k) => (
              <div key={k.assignmentId} className="overflow-hidden rounded-lg border border-line bg-raised">
                <div className="flex min-h-11 items-center gap-2 px-3">
                  <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{k.name}</span>
                  {k.role ? <Link href={`/people/roles/${k.role.id}`}><Chip>{k.role.title}</Chip></Link> : <Chip>Not from a job title</Chip>}
                  <span className="shrink-0 text-sm tabular-nums text-ink-2">{k.weightage}%</span>
                </div>
                {k.kpis.length === 0 ? (
                  <p className="border-t border-line-soft px-3 py-2 text-sm text-ink-2">No KPIs under this KRA yet.</p>
                ) : (
                  <ul className="divide-y divide-line-soft border-t border-line-soft">
                    {k.kpis.map((kpi) => {
                      const rec = RECORD_STATUS[kpi.currentRecord?.status ?? "PENDING"] ?? RECORD_STATUS.PENDING;
                      return (
                        <li key={kpi.id} className="flex min-h-11 items-center gap-2 px-3 text-sm">
                          {kpi.isNorthStar ? <Star className="h-3.5 w-3.5 shrink-0 text-ink" aria-label="North-star KPI" fill="currentColor" /> : <span className="w-3.5 shrink-0" />}
                          <span className="min-w-0 flex-1 truncate text-row text-ink">{kpi.name}</span>
                          <DirectionGlyph direction={kpi.direction} />
                          {kpi.ownership === "SHARED" ? <Chip>Shared</Chip> : null}
                          <span className="shrink-0 tabular-nums text-ink">
                            {kpi.latestValue != null ? `${kpi.latestValue}${kpi.unit ? ` ${kpi.unit}` : ""}` : "No reading"}
                            {kpi.latestPeriod ? <span className="text-ink-2"> · {formatPeriodLabel(kpi.latestPeriod)}</span> : null}
                          </span>
                          <span className="hidden shrink-0 tabular-nums text-ink-2 sm:inline">{kpi.targetValue != null ? `target ${kpi.targetValue}` : "No baseline yet"}</span>
                          <ToneChip tone={rec.tone} label={rec.label} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="History">
        {history.length === 0 ? (
          <p className="text-row text-ink-2">No KPI numbers recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-raised">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-[var(--os-table-head-bg)] text-ink-2">
                <tr className="h-9 text-start">
                  <th className="px-3 text-start font-medium">Period</th>
                  <th className="px-3 text-start font-medium">KPI</th>
                  <th className="px-3 text-end font-medium">Value</th>
                  <th className="px-3 text-start font-medium">Status</th>
                  <th className="px-3 text-start font-medium">Signed off by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {history.map((r) => {
                  const st = RECORD_STATUS[r.status] ?? RECORD_STATUS.PENDING;
                  return (
                    <tr key={r.id} className="h-9">
                      <td className="px-3 tabular-nums text-ink-2">{formatPeriodLabel(r.period)}</td>
                      <td className="max-w-[220px] truncate px-3 text-ink">{r.kpi.name}</td>
                      <td className="px-3 text-end tabular-nums text-ink">{r.actualValue ?? "·"}{r.kpi.unit && r.actualValue != null ? ` ${r.kpi.unit}` : ""}</td>
                      <td className="px-3"><ToneChip tone={st.tone} label={st.label} /></td>
                      <td className="px-3 text-ink-2">{r.reviewedBy ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(person.kpiHistoryTotal ?? 0) > history.length ? (
              <p className="border-t border-line-soft px-3 py-2 text-sm text-ink-2">
                Showing the latest {history.length} of {person.kpiHistoryTotal}.{" "}
                <Link href={self ? "/kra-kpi" : `/team/kpi-reviews?person=${person.id}`} className="text-brand-deep hover:underline">Show more</Link>
              </p>
            ) : null}
          </div>
        )}
      </Section>
      {manage ? <ManageAlignmentDialog open onOpenChange={(v) => { if (!v) setManage(false); }} userId={person.id} userName={personName(person)} onChanged={onChanged} /> : null}
    </div>
  );
}

function GoalsTab({ person, alignment, state, onRetry }: { person: Person; alignment: Alignment | null; state: string; onRetry: () => void }) {
  const relation = person.access.relation;
  const self = relation === "self";
  const okrs = alignment?.okrs ?? [];
  // The manager chain, the People team and Admin get this person's doors
  // (spec-teams-people section 2): All goals filtered to them, and Set a goal
  // with them as the owner. Set a goal also needs the tier the goal form
  // accepts an owner from (create-goal-modal.tsx mayAssign); without it the
  // goal would be created as the viewer's own, so the door is not offered.
  const manages = relation === "chain" || relation === "people-team" || relation === "admin" || relation === "org-wide";
  const mayAssign = useMayAssignGoalOwner();
  const mayCreateFor = relation === "chain" || relation === "people-team" || relation === "admin";
  return (
    <Section
      // The default window is every open goal (the same set /okrs lists), so
      // it can hold a goal due next quarter: the heading names no quarter
      // then, and each row carries its own due quarter as /okrs does.
      title={alignment?.window === "quarter" ? `Goals · ${alignment.quarter}` : "Goals"}
      action={
        <span className="flex items-center gap-1">
          {self
            ? <GhostButton href="/okrs">All goals</GhostButton>
            : manages
              ? <GhostButton href={`/okrs?view=team&owner=${encodeURIComponent(person.id)}`}>All goals</GhostButton>
              : relation !== "chain-view" ? <GhostButton href="/okrs?view=team">Team goals</GhostButton> : null}
          {self && !person.deletedAt ? <GhostButton icon={Plus} href="/okrs?new=1">Set a goal</GhostButton> : null}
          {!self && mayCreateFor && mayAssign && !person.deletedAt
            ? <GhostButton icon={Plus} href={`/okrs?view=team&new=1&owner=${encodeURIComponent(person.id)}`}>Set a goal</GhostButton>
            : null}
        </span>
      }
    >
      {state === "error" ? (
        <OsEmptyView variant="error" title="Couldn't load the goals" action={{ label: "Try again", onClick: onRetry }} compact />
      ) : state !== "ready" ? (
        <SkeletonRows rows={2} />
      ) : okrs.length === 0 ? (
        <p className="text-row text-ink-2">{alignment?.window === "quarter" ? "No goals this quarter." : "No open goals."}</p>
      ) : (
        <Rows>
          {okrs.map((o) => {
            // The computed verdict (person-alignment.ts), never the stored
            // status: the same word /okrs and the goal page show.
            const st = verdictChip(o.verdict ?? "not_measured");
            return (
              <li key={o.id}>
                <Link href={`/okrs/${o.id}`} className="flex min-h-11 items-center gap-3 px-3 hover:bg-hover">
                  <Trophy className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-row text-ink">{o.title}</span>
                  {o.quarterLabel ? <span className="hidden shrink-0 text-sm tabular-nums text-ink-2 sm:inline">{o.quarterLabel}</span> : null}
                  <ToneChip tone={st.tone} label={st.label} />
                  <span className="hidden w-24 sm:block"><Bar value={o.progress} /></span>
                  <span className="w-10 shrink-0 text-end text-sm tabular-nums text-ink">{o.progressSource === "NONE" ? "·" : `${o.progress}%`}</span>
                </Link>
              </li>
            );
          })}
        </Rows>
      )}
    </Section>
  );
}

function ReviewsTab({ person }: { person: Person }) {
  const self = person.access.relation === "self";
  const [all, setAll] = useState<ReviewRow[] | null>(null);
  const [allState, setAllState] = useState<"idle" | "loading" | "error">("idle");
  const reviews = all ?? person.reviews ?? [];
  const datePrefs = useDatePrefs();
  // Every cycle, in place: the same lens as the profile payload (GET
  // /api/reviews?subjectId= runs the subject's own rows through
  // subjectRowView). The old link went to Review cycles, which is the
  // in-shell 404 for a subject who holds no app:reviews.
  const showAll = async () => {
    setAllState("loading");
    const r = await apiFetch<{ data: Array<{ id: string; cycleId: string; cycleName: string; cycleStatus: string; cycleStartsAt: string; closesAt: string; status: string; outcome: string | null; overallScore: number | null; calibratedScore: number | null }> }>(
      `/api/reviews?subjectId=${encodeURIComponent(person.id)}`, { cache: "no-store" },
    );
    if (!r.ok) { setAllState("error"); return; }
    setAll(r.data.data.map((x) => ({
      id: x.id, cycleId: x.cycleId, status: x.status, outcome: x.outcome, overallScore: x.overallScore, calibratedScore: x.calibratedScore,
      cycle: { id: x.cycleId, name: x.cycleName, startDate: x.cycleStartsAt, endDate: x.closesAt, status: x.cycleStatus },
    })));
    setAllState("idle");
  };
  return (
    <Section title="Reviews">
      <Rows>
        {self ? (
          <li>
            <Link href="/me/weekly-review" className="flex min-h-11 items-center gap-3 px-3 hover:bg-hover">
              <CalendarCheck className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1 text-row text-ink">Weekly review</span>
            </Link>
          </li>
        ) : null}
        {reviews.map((r) => (
          <li key={r.id}>
            <Link href={`/reviews/${r.cycleId}`} className="flex min-h-11 items-center gap-3 px-3 hover:bg-hover">
              <span className="min-w-0 flex-1 truncate text-row text-ink">{r.cycle.name}</span>
              <span className="hidden shrink-0 text-sm text-ink-2 sm:inline">{formatDate(r.cycle.startDate, datePrefs, "date")} to {formatDate(r.cycle.endDate, datePrefs, "date")}</span>
              {r.outcome ? <ToneChip tone={r.outcome === "PROMOTION_ELIGIBLE" || r.outcome === "HIKE_ELIGIBLE" ? "success" : r.outcome === "STATUS_QUO" ? "neutral" : "warning"} label={OUTCOME_LABEL[r.outcome] ?? r.outcome} /> : <ToneChip tone={r.status === "COMPLETED" ? "success" : "info"} label={r.status === "COMPLETED" ? "Completed" : "In progress"} />}
              <span className="w-10 shrink-0 text-end text-sm tabular-nums text-ink">{r.calibratedScore ?? r.overallScore ?? ""}</span>
            </Link>
          </li>
        ))}
        {!self && reviews.length === 0 ? <li className="px-3 py-3 text-row text-ink-2">No reviews yet</li> : null}
      </Rows>
      {!all && (person.reviewsTotal ?? 0) > reviews.length ? (
        <p className="text-sm text-ink-2">
          Showing the latest {reviews.length} of {person.reviewsTotal}.{" "}
          <button type="button" className="text-brand-deep hover:underline disabled:opacity-60" disabled={allState === "loading"} onClick={() => void showAll()}>
            {allState === "loading" ? "Showing all" : `Show all ${person.reviewsTotal}`}
          </button>
          {allState === "error" ? <span role="alert" className="ms-2 text-danger-text">Couldn&apos;t load them. Try again.</span> : null}
        </p>
      ) : null}
      {self && reviews.length === 0 ? <p className="text-sm text-ink-2">No review cycles yet.</p> : null}
    </Section>
  );
}

function SkillsTab({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const self = person.access.relation === "self";
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [rating, setRating] = useState<{ skill: Skill; mode: "self" | "manager" } | null>(null);
  const [menu, setMenu] = useState<{ skill: Skill; anchor: HTMLElement } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const skills = person.skills;
  const canAdd = person.access.addSkills && !person.deletedAt;
  const rowActions = (s: Skill) => [
    ...(self ? [{ label: "Edit rating", onClick: () => setRating({ skill: s, mode: "self" }) }] : []),
    ...(person.access.rateSkills ? [{ label: "Rate", onClick: () => setRating({ skill: s, mode: "manager" }) }] : []),
    ...(person.access.removeSkills ? [{ label: "Remove", destructive: true, onClick: () => void remove(s) }] : []),
  ];
  async function remove(s: Skill) {
    const ok = await confirm({ title: `Remove ${s.name}?`, description: "Its ratings go with it.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/users/${person.id}/skills/${s.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't remove the skill", { tone: "danger" }); return; }
    toast(`Removed ${s.name}`);
    emitSkillsChanged();
    onChanged();
  }
  return (
    <Section
      title="Skills"
      action={
        <span className="flex items-center gap-1">
          <GhostButton href="/people/skills">All skills</GhostButton>
          {canAdd ? <GhostButton icon={Plus} onClick={() => setAdding(true)}>Add skill</GhostButton> : null}
        </span>
      }
    >
      {skills.length === 0 ? (
        <p className="text-row text-ink-2">
          No skills added yet.{" "}
          {self && canAdd ? <button type="button" className="text-brand-deep hover:underline" onClick={() => setAdding(true)}>Add a skill</button> : null}
        </p>
      ) : (
        <Rows>
          {skills.map((s) => {
            const acts = rowActions(s);
            return (
              <li key={s.id} className="flex min-h-11 items-center gap-3 px-3">
                <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{s.name}</span>
                {person.access.peopleData ? (
                  <>
                    <span className="shrink-0 text-sm tabular-nums text-ink-2">{ratingLabel(s.selfRating) ? `Self ${ratingLabel(s.selfRating)}` : "Self not rated"}</span>
                    <span className={cn("shrink-0 text-sm tabular-nums", s.managerRating ? "text-ink-2" : "text-ink-3")}>{ratingLabel(s.managerRating) ? `Manager ${ratingLabel(s.managerRating)}` : "Not rated"}</span>
                  </>
                ) : null}
                {acts.length > 0 ? (
                  <button type="button" aria-label={`Actions for ${s.name}`} aria-haspopup="menu" onClick={(e) => { anchorRef.current = e.currentTarget; setMenu({ skill: s, anchor: e.currentTarget }); }} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </Rows>
      )}
      {menu ? (
        <MorePortal anchorRef={anchorRef} width={200} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.skill.name}`}>
            {rowActions(menu.skill).map((a) => (
              <MenuItem key={a.label} label={a.label} destructive={"destructive" in a ? a.destructive : undefined} onClick={() => { setMenu(null); a.onClick(); }} />
            ))}
          </MenuList>
        </MorePortal>
      ) : null}
      {adding ? <AddSkillDialog userId={person.id} self={self} held={skills.map((s) => s.name)} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged(); }} /> : null}
      {rating ? <RateSkillDialog userId={person.id} skill={rating.skill} mode={rating.mode} onClose={() => setRating(null)} onRated={() => { setRating(null); onChanged(); }} /> : null}
    </Section>
  );
}

function KudosTab({ person, datePrefs }: { person: Person; datePrefs: ReturnType<typeof useDatePrefs> }) {
  const self = person.access.relation === "self";
  // The record carries the newest 20; the rest page in from /api/kudos, 20
  // at a time, until the list reaches the total the tab counts.
  const [older, setOlder] = useState<KudosRow[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const all = [...person.kudosReceived, ...older.filter((o) => !person.kudosReceived.some((k) => k.id === o.id))];
  async function showMore() {
    setLoadingMore(true);
    setMoreError(null);
    const next = page + 1;
    const r = await apiFetch<{ data: KudosRow[] }>(`/api/kudos?userId=${person.id}&page=${next}&limit=20`, { cache: "no-store" });
    setLoadingMore(false);
    if (!r.ok) { setMoreError(r.error || "Couldn't load more kudos"); return; }
    setOlder((cur) => [...cur, ...(r.data.data ?? [])]);
    setPage(next);
  }
  return (
    <Section title="Kudos" action={!self && !person.deletedAt ? <GhostButton icon={Heart} href={`/kudos?new=1&to=${person.id}`}>Give kudos</GhostButton> : undefined}>
      {all.length === 0 ? (
        <p className="text-row text-ink-2">No kudos yet.</p>
      ) : (
        <Rows>
          {all.map((k) => (
            <li key={k.id} className="flex gap-3 px-3 py-3">
              <Avatar person={k.giver} size={28} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  <Link href={`/people/${k.giver.id}`} className="font-medium text-ink hover:underline">{personName(k.giver)}</Link>
                  {k.companyValue ? <Chip>{k.companyValue}</Chip> : null}
                  <span>{formatDate(k.createdAt, datePrefs, "date")}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-row text-ink">{k.message}</p>
                <div className="mt-2"><KudosReactions kudosId={k.id} initialCounts={k.reactionCounts} initialMine={k.myReactions} compact /></div>
              </div>
            </li>
          ))}
        </Rows>
      )}
      {all.length < person.kudosCount ? (
        <div className="flex items-center gap-3">
          <button type="button" disabled={loadingMore} onClick={() => void showMore()} className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50">
            {loadingMore ? "Loading more kudos" : `Show more (${person.kudosCount - all.length})`}
          </button>
          {moreError ? <span role="alert" className="text-sm text-danger-text">{moreError}</span> : null}
        </div>
      ) : null}
    </Section>
  );
}

interface AssetRow { id: string; name?: string; type?: string; brand?: string | null; model?: string | null; serialNumber?: string | null; assignedAt?: string | null }

function AssetsTab({ userId }: { userId: string }) {
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { boot } = useBoot();
  const datePrefs = useDatePrefs();
  const canOpen = appAudienceAllows("assets", boot.viewer);
  const load = useCallback(async () => {
    const r = await apiFetch<{ assets?: AssetRow[] } | AssetRow[]>(`/api/assets?assignedToId=${encodeURIComponent(userId)}`, { cache: "no-store" });
    if (!r.ok) { setFailed(true); return; }
    setFailed(false);
    setAssets(Array.isArray(r.data) ? r.data : r.data.assets ?? []);
  }, [userId]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  if (failed) return <OsEmptyView variant="error" title="Couldn't load the assets" action={{ label: "Try again", onClick: () => void load() }} compact />;
  if (assets === null) return <SkeletonRows rows={3} />;
  return (
    <Section title="Assets">
      {assets.length === 0 ? (
        <p className="text-row text-ink-2">
          No kit assigned. {canOpen ? <Link href="/assets" className="text-brand-deep hover:underline">Assets can be assigned from the Assets page</Link> : null}
        </p>
      ) : (
        <Rows>
          {assets.map((a) => {
            const inner = (
              <>
                <EntityTile size="sm" icon={assetGlyph(a.type)} {...NEUTRAL_TILE} />
                <span className="min-w-0 flex-1 truncate text-row text-ink">{a.name}</span>
                <span className="hidden truncate text-sm text-ink-2 sm:inline">{a.serialNumber ? `S/N ${a.serialNumber}` : [a.brand, a.model].filter(Boolean).join(" ")}</span>
                {a.assignedAt ? <span className="shrink-0 text-sm text-ink-2">Since {formatDate(a.assignedAt, datePrefs, "date")}</span> : null}
              </>
            );
            return (
              <li key={a.id}>
                {canOpen ? <Link href={`/assets?asset=${a.id}`} className="flex min-h-11 items-center gap-3 px-3 hover:bg-hover">{inner}</Link> : <div className="flex min-h-11 items-center gap-3 px-3">{inner}</div>}
              </li>
            );
          })}
        </Rows>
      )}
    </Section>
  );
}

function ReportsTab({ person }: { person: Person }) {
  return (
    <Section title="Reports" action={<GhostButton icon={Network} href={`/organization?focus=${person.id}`}>Open in Org chart</GhostButton>}>
      <Rows>
        {person.directReports.map((r) => (
          <li key={r.id}>
            <Link href={`/people/${r.id}`} className="flex min-h-11 items-center gap-3 px-3 hover:bg-hover">
              <Avatar person={r} size={28} />
              <span className="min-w-0 flex-1 truncate text-row text-ink">{personName(r)}</span>
              <span className="hidden min-w-0 truncate text-sm text-ink-2 sm:inline">{r.role?.title ?? "No job title"}</span>
              <span className="hidden min-w-0 truncate text-sm text-ink-2 md:inline">{r.department?.name ?? ""}</span>
            </Link>
          </li>
        ))}
      </Rows>
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink-2"><Users className="h-3.5 w-3.5" aria-hidden /> Total reports {person.directReports.length}</p>
    </Section>
  );
}
