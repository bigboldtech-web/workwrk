"use client";

/* Notetaker (spec-docs-knowledge section 2, /notetaker).
 *
 * Paste a meeting transcript, get a meeting note with decisions, action items
 * and attendees, check every field, save it as a Meeting and, when asked,
 * create a task for each action item in a List you can edit.
 *
 *   POST /api/notetaker/process { transcript }   -> { data | null, rawText, usage }
 *   POST /api/notetaker/save    { ..., listId }  -> { ok, meeting, items, counts }
 *   GET  /api/lists/pick?q=                      the Lists the viewer can write to
 *   GET  /api/meetings?limit=20&page=&mine=1     the Recent card
 *
 * One blue button at a time, tied to the step the person is on: Extract until
 * a result exists, then Save meeting note. Every field of the result is
 * editable before it is saved; nothing here is persisted until Save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { CalendarPlus, ChevronDown, Link2, Mic, Sparkles, UserPlus, X } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { useRetiredView } from "@/components/layout/os/use-retired-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dots } from "@/components/ui/dots";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { ViewTab } from "@/components/ui/view-tabs";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { AppOff } from "@/components/access/denial-views";
import { useViewer } from "@/lib/access/use-access";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { DraftRestoreStrip } from "@/components/ui/draft-restore-strip";
import { readNotetakerLastList } from "@/lib/docs-prefs";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { EntityTile } from "@/components/ui/entity-tile";
import { cn } from "@/lib/utils";

/* ───────────────────────────── types ───────────────────────────── */

type ActionItem = {
  key: string;
  title: string;
  assigneeName?: string;
  assigneeEmail?: string | null;
  assigneeId?: string | null;
  deadlineDays?: number | null;
  /** "YYYY-MM-DD" from the date field. */
  due?: string;
};
type Attendee = { key: string; name: string; email?: string | null; userId?: string | null };
type Extracted = {
  title: string;
  type: string;
  summary: string;
  decisions: { key: string; text: string }[];
  actionItems: ActionItem[];
  attendees: Attendee[];
};

type ApiMeeting = {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  attendees?: Array<{ userId?: string | null; user?: { id: string } | null }>;
  stats?: { decisionCount: number; actionItemsTotal: number; actionItemsDone: number; hasNotes: boolean };
};

type ListRow = { id: string; name: string; icon: string | null; color: string | null; spaceName: string | null; folderName: string | null };

const TYPE_LABELS: Record<string, string> = {
  DAILY_STANDUP: "Daily standup",
  WEEKLY_REVIEW: "Weekly review",
  ONE_ON_ONE: "1:1",
  QUARTERLY_REVIEW: "Quarterly",
  ANNUAL_PLANNING: "Annual planning",
  ADHOC: "Ad hoc",
};
const TYPE_OPTIONS: PickerOption[] = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));

const MIN_CHARS = 20;
const RECENT_PAGE = 20;

const EXAMPLE_TRANSCRIPT = `[10:02] Bigbold: Let's ship the new pricing page by Friday.
[10:03] Sarah:   I can take the copy. Who's doing engineering?
[10:03] Arjun:   I'll handle eng and can finish by Wednesday.
[10:04] Bigbold: Great. Sarah, can you also write a launch tweet?
[10:04] Sarah:   On it, Thursday EOD.
[10:05] Bigbold: We agreed to drop the "Free trial" badge for now and
                 lead with the new $19 starter price instead.`;

let seq = 0;
const k = () => `n${Date.now().toString(36)}${(seq += 1)}`;

function personName(p: PersonRef): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown";
}

/** Seed a picker owner from the extracted name: first name, then last name, then the email. */
function matchPerson(people: PersonRef[], name?: string, email?: string | null): PersonRef | null {
  if (email) {
    const byEmail = people.find((p) => (p.email ?? "").toLowerCase() === email.toLowerCase());
    if (byEmail) return byEmail;
  }
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const full = people.find((p) => personName(p).toLowerCase() === n);
  if (full) return full;
  const first = n.split(/\s+/)[0];
  const hits = people.filter((p) => (p.firstName ?? "").toLowerCase() === first);
  return hits.length === 1 ? hits[0] : null;
}

function dueFromDays(days: number | null | undefined): string {
  if (days == null) return "";
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const inputCls = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand";
const ghost28 = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50";
const primary36 = "inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-active disabled:text-ink-4";
const secondary36 = "inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:opacity-50";

/* ───────────────────────────── page ───────────────────────────── */

export default function NotetakerPage() {
  // ClipsSidebar's "My Clips" row linked /notetaker?mine=1 at a page that
  // never read the parameter. The row is gone and the parameter is ?view=my,
  // which the Recent card reads. Same path, so it is a page normalisation and
  // not a next.config redirect (a config row would loop on its own query).
  useRetiredView();
  const params = useSearchParams();
  const view = params?.get("view") === "my" ? "my" : "all";
  const router = useRouter();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const viewer = useViewer();
  const { rowVersion, railApps, prefs, patchPrefs } = useOsShell();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();

  // The AI gate (change request A2): the Extract action needs the AI hub the
  // way Ask AI does. With it hidden the page renders the denial, not a form
  // whose one button fails.
  const aiOn = railApps.some((a) => a.key === "ai");

  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [result, setResult] = useState<Extracted | null>(null);
  const [saving, setSaving] = useState(false);
  const [spawnTasks, setSpawnTasks] = useState(true);
  const [listId, setListId] = useState<string | null>(null);
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The transcript survives a reload or a session expiry (mirrored to
  // localStorage until saved or cleared). The epoch server time means any
  // draft counts; there is no server row to be newer than.
  const draft = useLocalDraft<{ transcript: string }>("notetaker", "transcript", "1970-01-01T00:00:00.000Z");
  useEffect(() => {
    if (transcript.trim()) draft.write({ transcript });
    else draft.clear();
  }, [transcript, draft]);

  /* ── the Lists the viewer can write to, and the remembered one ── */
  useEffect(() => {
    if (!aiOn) return;
    let live = true;
    void (async () => {
      const r = await apiFetch<{ data: ListRow[] }>("/api/lists/pick?limit=100", { cache: "no-store" });
      if (!live) return;
      const rows = r.ok ? r.data.data : [];
      setLists(rows);
      const remembered = readNotetakerLastList(prefs.home);
      // Re-validated on every read, never trusted from preferences.
      setListId(remembered && rows.some((l) => l.id === remembered) ? remembered : null);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn]);

  useEffect(() => {
    if (!aiOn) return;
    let live = true;
    void (async () => {
      const r = await apiFetch<{ data: PersonRef[] }>("/api/users?scope=all&limit=200", { cache: "no-store" });
      if (live && r.ok) setPeople(Array.isArray(r.data?.data) ? r.data.data : []);
    })();
    return () => { live = false; };
  }, [aiOn]);

  /* ── Recent meeting notes ── */
  const [recent, setRecent] = useState<ApiMeeting[] | null>(null);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentPage, setRecentPage] = useState(1);
  const [recentError, setRecentError] = useState(false);
  const loadRecents = useCallback(async () => {
    setRecentError(false);
    const qs = new URLSearchParams({ limit: String(RECENT_PAGE), page: String(recentPage) });
    if (view === "my") qs.set("mine", "1");
    const r = await apiFetch<{ data?: ApiMeeting[] | { data: ApiMeeting[]; pagination?: { total: number } }; pagination?: { total: number } }>(`/api/meetings?${qs}`, { cache: "no-store" });
    if (!r.ok) { setRecentError(true); return; }
    const body = r.data;
    const inner = body?.data;
    const list: ApiMeeting[] = Array.isArray(inner) ? inner : Array.isArray((inner as { data?: ApiMeeting[] })?.data) ? (inner as { data: ApiMeeting[] }).data : [];
    const total = (body?.pagination?.total ?? (inner as { pagination?: { total: number } })?.pagination?.total ?? list.length) as number;
    setRecent(list);
    setRecentTotal(total);
  }, [view, recentPage]);
  useEffect(() => { void loadRecents(); }, [loadRecents]);
  const rv = rowVersion("notetaker");
  useEffect(() => { if (rv > 0) void loadRecents(); }, [rv, loadRecents]);
  useEffect(() => { setRecentPage(1); }, [view]);

  /* ── Extract ── */
  const ready = transcript.trim().length >= MIN_CHARS;
  const extract = useCallback(async () => {
    if (!ready || extracting) return;
    setExtracting(true);
    setExtractError(null);
    setRawText(null);
    const r = await apiFetch<{ data: {
      title?: string; type?: string; summary?: string; decisions?: string[];
      actionItems?: { title: string; assigneeName?: string; assigneeEmail?: string | null; deadlineDays?: number | null }[];
      attendees?: { name: string; email?: string | null }[];
    } | null; rawText: string | null }>("/api/notetaker/process", { method: "POST", json: { transcript } });
    setExtracting(false);
    if (!r.ok) { setExtractError(r.error || "Couldn't structure this transcript"); return; }
    const d = r.data.data;
    if (!d) { setRawText(r.data.rawText ?? ""); setResult(null); return; }
    setResult({
      title: d.title ?? "",
      type: d.type && TYPE_LABELS[d.type] ? d.type : "ADHOC",
      summary: d.summary ?? "",
      decisions: (d.decisions ?? []).map((text) => ({ key: k(), text })),
      actionItems: (d.actionItems ?? []).map((a) => {
        const m = matchPerson(people, a.assigneeName, a.assigneeEmail);
        return { key: k(), title: a.title, assigneeName: a.assigneeName, assigneeEmail: a.assigneeEmail ?? null, assigneeId: m?.id ?? null, deadlineDays: a.deadlineDays ?? null, due: dueFromDays(a.deadlineDays) };
      }),
      attendees: (d.attendees ?? []).map((a) => {
        const m = matchPerson(people, a.name, a.email);
        return { key: k(), name: a.name, email: a.email ?? null, userId: m?.id ?? null };
      }),
    });
  }, [ready, extracting, transcript, people]);

  /* ── Save ── */
  const canSave = !!result && result.title.trim().length > 0 && !saving;
  const save = useCallback(async () => {
    if (!result || !canSave) return;
    setSaving(true);
    const r = await apiFetch<{ ok: boolean; meeting: { id: string; title: string }; counts: { tasksSpawned: number } }>("/api/notetaker/save", {
      method: "POST",
      json: {
        title: result.title.trim(),
        type: result.type,
        summary: result.summary,
        decisions: result.decisions.map((d) => d.text).filter((t) => t.trim()),
        attendees: result.attendees.map((a) => ({ name: a.name, email: a.email ?? null, userId: a.userId ?? null })),
        actionItems: result.actionItems.filter((a) => a.title.trim()).map((a) => ({
          title: a.title.trim(),
          assigneeName: a.assigneeName,
          assigneeEmail: a.assigneeEmail ?? null,
          assigneeId: a.assigneeId ?? null,
          deadlineDays: a.deadlineDays ?? null,
          dueAt: a.due ? new Date(`${a.due}T00:00:00`).toISOString() : null,
        })),
        transcript,
        spawnTasks: spawnTasks && (lists?.length ?? 0) > 0,
        listId: spawnTasks ? listId : null,
      },
    });
    setSaving(false);
    if (!r.ok) {
      toast(r.status === 403 ? r.error : "Couldn't save", { tone: "danger", action: { label: "Retry", onClick: () => void save() } });
      return;
    }
    const n = r.data.counts?.tasksSpawned ?? 0;
    const id = r.data.meeting?.id;
    toast(`Saved "${r.data.meeting?.title ?? result.title}"${n ? `, ${n} task${n === 1 ? "" : "s"} created` : ""}`, {
      tone: "success",
      action: id ? { label: "Open", onClick: () => router.push(`/meetings/${id}`) } : undefined,
    });
    if (spawnTasks && listId) void patchPrefs({ home: { notetaker: { lastListId: listId } } });
    setTranscript("");
    setResult(null);
    setRawText(null);
    draft.clear();
    void loadRecents();
  }, [result, canSave, transcript, spawnTasks, lists, listId, toast, router, patchPrefs, draft, loadRecents]);

  const clearAll = useCallback(async () => {
    if (!transcript && !result && !rawText) return;
    if (result || rawText) {
      const ok = await confirm({ title: "Clear transcript?", description: "The transcript and the meeting note you have not saved will be cleared.", destructive: true, confirmLabel: "Clear" });
      if (!ok) return;
    }
    setTranscript("");
    setResult(null);
    setRawText(null);
    setExtractError(null);
    draft.clear();
  }, [transcript, result, rawText, confirm, draft]);

  // cmd+Enter in the textarea = Extract; cmd+S = Save when a result exists.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "s" || e.key === "S") {
        if (result) { e.preventDefault(); void save(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, save]);

  /* ── the Recent card columns ── */
  const recentCols = useMemo<TableColumn<ApiMeeting>[]>(() => [
    { key: "title", label: "Title", title: true, width: "minmax(220px,2fr)", render: (m) => <span className="truncate">{m.title}</span> },
    { key: "type", label: "Type", width: "150px", render: (m) => <span className="inline-flex h-6 items-center rounded-md bg-hover px-2 text-xs font-medium text-ink">{TYPE_LABELS[m.type] ?? m.type}</span> },
    { key: "decisions", label: "Decisions", width: "110px", numeric: true, render: (m) => <span>{fmt.count(m.stats?.decisionCount ?? 0)}</span> },
    { key: "actions", label: "Action items", width: "130px", render: (m) => <span className="text-ink-2">{m.stats?.actionItemsTotal ? `${m.stats.actionItemsDone} of ${m.stats.actionItemsTotal} done` : "None"}</span> },
    { key: "when", label: "When", width: "120px", render: (m) => <span className="text-ink-2" title={fmt.title(m.scheduledAt)}>{fmt.date(m.scheduledAt)}</span> },
  ], [fmt]);

  if (!aiOn) {
    return (
      <>
        <OsPageHeader title="Notetaker" />
        <AppOff label="Notetaker" isAdmin={viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN"} back={{ fallbackHref: "/docs", label: "Docs" }} />
      </>
    );
  }

  const hasLists = (lists?.length ?? 0) > 0;
  const chosenList = lists?.find((l) => l.id === listId) ?? null;
  const from = recentTotal === 0 ? 0 : (recentPage - 1) * RECENT_PAGE + 1;
  const to = Math.min(recentTotal, recentPage * RECENT_PAGE);

  return (
    <>
      <OsPageHeader title="Notetaker" />

      <div className="os-chrome flex flex-col gap-6 px-6 pb-16 pt-2">
        <DraftRestoreStrip draft={draft} onRestore={(p) => setTranscript(p.transcript)} className="-mx-6 border-t" />

        {/* ── Two panes ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Transcript */}
          <section className="flex min-w-0 flex-col rounded-lg border border-line bg-raised" aria-labelledby="ntk-transcript">
            <header className="flex h-12 items-center gap-3 border-b border-line px-4">
              <h2 id="ntk-transcript" className="min-w-0 flex-1 text-lg font-semibold text-ink">Transcript</h2>
              <span className="text-xs font-medium tabular-nums text-ink-2">{fmt.count(transcript.length)} characters</span>
            </header>
            <div className="flex flex-col gap-3 p-4">
              <UpcomingOnly>
                <ComingSoonRow label="Upload a recording" icon={Mic} className="-mt-1" />
              </UpcomingOnly>
              <textarea
                ref={textareaRef}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void extract(); } }}
                rows={12}
                placeholder="Paste your meeting transcript. Zoom, Google Meet, Otter, raw notes, anything works."
                className="min-h-[288px] w-full resize-y rounded-md border border-line-strong bg-raised p-3 text-base leading-6 text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand"
              />
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink-2">{ready ? "Ready" : `At least ${MIN_CHARS} characters`}</span>
                <button type="button" onClick={() => { setTranscript(EXAMPLE_TRANSCRIPT); setResult(null); setRawText(null); }} className="text-sm font-medium text-brand-deep hover:underline">
                  Try an example
                </button>
                <span className="flex-1" />
                <button type="button" onClick={() => void clearAll()} disabled={!transcript && !result && !rawText} className={ghost28}>
                  Clear
                </button>
                <button type="button" onClick={() => void extract()} disabled={!ready || extracting} className={result ? secondary36 : primary36} aria-busy={extracting}>
                  {extracting ? <Dots variant="pending" /> : <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                  Extract
                </button>
              </div>
            </div>
          </section>

          {/* Meeting note */}
          <section className="flex min-w-0 flex-col rounded-lg border border-line bg-raised" aria-labelledby="ntk-note">
            <header className="flex h-12 items-center gap-3 border-b border-line px-4">
              <h2 id="ntk-note" className="min-w-0 flex-1 text-lg font-semibold text-ink">Meeting note</h2>
              {result ? <span className="text-xs font-medium text-ink-2">Check every field before you save</span> : null}
            </header>

            {extracting ? (
              <div className="p-4">
                <SkeletonRows rows={4} rowHeight="36px" />
                <p className="mt-2 text-sm text-ink-2">Reading the transcript</p>
              </div>
            ) : extractError ? (
              <OsEmptyView variant="error" compact title="Couldn't structure this transcript" action={{ label: "Retry", onClick: () => void extract() }} />
            ) : rawText !== null ? (
              <div className="flex flex-col gap-3 p-4">
                <p className="text-base text-ink">The model did not return a meeting note. This is what came back:</p>
                <pre className="max-h-72 overflow-auto rounded-md border border-line bg-subtle p-3 font-mono text-sm text-ink-2 whitespace-pre-wrap">{rawText || "(nothing)"}</pre>
                <div><button type="button" onClick={() => void extract()} className={secondary36}>Try again</button></div>
              </div>
            ) : !result ? (
              <p className="p-4 text-base text-ink-2">Your decisions, action items and attendees will land here.</p>
            ) : (
              <ResultEditor
                result={result}
                setResult={setResult}
                people={people}
                typeOpen={typeOpen}
                setTypeOpen={setTypeOpen}
              />
            )}

            {result && !extracting ? (
              <footer className="flex min-h-11 flex-wrap items-center gap-3 border-t border-line px-4 py-2">
                {hasLists ? (
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <Switch checked={spawnTasks} onChange={setSpawnTasks} aria-label="Create a task for each action item" />
                    Create a task for each action item
                  </label>
                ) : null}
                {hasLists && spawnTasks ? (
                  <span className="relative inline-flex items-center gap-1 text-sm text-ink-2">
                    in
                    <button type="button" onClick={() => setListOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={listOpen} className={cn(ghost28, "gap-1 text-ink")}>
                      {chosenList ? (
                        <>
                          <EntityTile size="xs" icon={chosenList.icon} color={chosenList.color} name={chosenList.name} fallback="list" />
                          <span className="max-w-[180px] truncate">{chosenList.name}</span>
                        </>
                      ) : (
                        <span className="text-ink-3">Choose a list</span>
                      )}
                      <ChevronDown className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.5} aria-hidden />
                    </button>
                    <Picker
                      open={listOpen}
                      onClose={() => setListOpen(false)}
                      ariaLabel="Choose a list"
                      searchPlaceholder="Find a list"
                      selected={listId}
                      onSelect={(v) => { setListId(v); setListOpen(false); }}
                      sections={[{ options: (lists ?? []).map((l) => ({ value: l.id, label: l.name, description: [l.spaceName, l.folderName].filter(Boolean).join(" › ") || undefined, glyph: <EntityTile size="xs" icon={l.icon} color={l.color} name={l.name} fallback="list" /> })) }]}
                    />
                  </span>
                ) : null}
                <span className="flex-1" />
                <button type="button" onClick={() => void save()} disabled={!canSave || (spawnTasks && hasLists && !listId)} className={primary36} aria-busy={saving} title={spawnTasks && hasLists && !listId ? "Choose a list first" : undefined}>
                  {saving ? <Dots variant="pending" /> : null}
                  Save meeting note
                </button>
              </footer>
            ) : null}
          </section>
        </div>

        {/* ── Recent meeting notes ── */}
        <section className="flex min-w-0 flex-col rounded-lg border border-line bg-raised" aria-labelledby="ntk-recent">
          <header className="flex h-12 items-center gap-3 border-b border-line px-4">
            <h2 id="ntk-recent" className="min-w-0 flex-1 text-lg font-semibold text-ink">Recent meeting notes</h2>
            <div role="tablist" aria-label="Recent views" className="flex items-center gap-1">
              <ViewTab label="All" href="/notetaker" active={view === "all"} dense />
              <ViewTab label="Mine" href="/notetaker?view=my" active={view === "my"} dense />
            </div>
          </header>
          {recentError ? (
            <OsEmptyView variant="error" compact title="Couldn't load meeting notes" action={{ label: "Retry", onClick: () => void loadRecents() }} />
          ) : (
            <TableCard<ApiMeeting>
              className="rounded-none border-0"
              ariaLabel="Recent meeting notes"
              columns={recentCols}
              rows={recent}
              rowKey={(m) => m.id}
              rowHref={(m) => `/meetings/${m.id}`}
              rowMenu={(m) => <RecentRowMenu meeting={m} />}
              empty={view === "my" ? "No meeting notes with you in them yet" : "No meeting notes yet"}
              footer={{
                total: recentTotal,
                noun: "notes",
                from,
                to,
                onPrev: recentPage > 1 ? () => setRecentPage((p) => p - 1) : undefined,
                onNext: to < recentTotal ? () => setRecentPage((p) => p + 1) : undefined,
              }}
            />
          )}
        </section>
      </div>
      {/* meId is read by the Mine view server-side; keep the client aware for future filters. */}
      <span hidden data-me={meId ?? undefined} />
    </>
  );
}

/* ───────────────────────────── the editable result ───────────────────────────── */

function ResultEditor({ result, setResult, people, typeOpen, setTypeOpen }: {
  result: Extracted;
  setResult: (next: Extracted) => void;
  people: PersonRef[];
  typeOpen: boolean;
  setTypeOpen: (v: boolean) => void;
}) {
  const [ownerFor, setOwnerFor] = useState<string | null>(null);
  const [attendeeFor, setAttendeeFor] = useState<string | null>(null);
  const peopleOptions = useMemo<PickerOption[]>(
    () => people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} />, keywords: p.email ?? undefined })),
    [people],
  );
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const patch = (next: Partial<Extracted>) => setResult({ ...result, ...next });
  const patchAction = (key: string, next: Partial<ActionItem>) => patch({ actionItems: result.actionItems.map((a) => (a.key === key ? { ...a, ...next } : a)) });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Title</span>
          <input value={result.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Untitled meeting" className={inputCls} />
        </label>
        <div className="relative flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Type</span>
          <button type="button" onClick={() => setTypeOpen(!typeOpen)} aria-haspopup="listbox" aria-expanded={typeOpen} className={cn(secondary36, "min-w-[160px] justify-between")}>
            {TYPE_LABELS[result.type] ?? "Ad hoc"}
            <ChevronDown className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />
          </button>
          <Picker open={typeOpen} onClose={() => setTypeOpen(false)} ariaLabel="Meeting type" selected={result.type} onSelect={(v) => { patch({ type: v }); setTypeOpen(false); }} sections={[{ options: TYPE_OPTIONS }]} align="end" width={240} />
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink">Summary</span>
        <textarea value={result.summary} onChange={(e) => patch({ summary: e.target.value })} rows={3} placeholder="A short recap" className="w-full resize-y rounded-md border border-line-strong bg-raised p-3 text-base leading-6 text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
      </label>

      {/* Decisions */}
      <div>
        <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink">Decisions <span className="text-xs font-medium text-ink-2">{result.decisions.length}</span></h3>
        <ul className="flex flex-col">
          {result.decisions.map((d) => (
            <li key={d.key} className="flex h-9 items-center gap-2">
              <input value={d.text} onChange={(e) => patch({ decisions: result.decisions.map((x) => (x.key === d.key ? { ...x, text: e.target.value } : x)) })} className={cn(inputCls, "h-8")} placeholder="What was decided" />
              <button type="button" onClick={() => patch({ decisions: result.decisions.filter((x) => x.key !== d.key) })} aria-label="Remove decision" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => patch({ decisions: [...result.decisions, { key: k(), text: "" }] })} className="flex h-9 items-center gap-1.5 rounded-md px-2 text-row text-ink-2 hover:bg-hover hover:text-ink">+ Add decision</button>
          </li>
        </ul>
      </div>

      {/* Action items */}
      <div>
        <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink">Action items <span className="text-xs font-medium text-ink-2">{result.actionItems.length}</span></h3>
        <ul className="flex flex-col">
          {result.actionItems.map((a) => {
            const owner = a.assigneeId ? byId.get(a.assigneeId) ?? null : null;
            return (
              <li key={a.key} className="flex min-h-9 flex-wrap items-center gap-2 py-0.5">
                <input value={a.title} onChange={(e) => patchAction(a.key, { title: e.target.value })} className={cn(inputCls, "h-8 min-w-[160px] flex-1")} placeholder="What needs doing" />
                <span className="relative">
                  <button type="button" onClick={() => setOwnerFor(ownerFor === a.key ? null : a.key)} aria-haspopup="listbox" aria-expanded={ownerFor === a.key} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium", owner ? "bg-hover text-ink" : "bg-hover text-ink-2")} title={owner ? "Change owner" : "Match to a person"}>
                    {owner ? <PersonAvatar person={owner} size={20} /> : <UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                    <span className="max-w-[140px] truncate">{owner ? personName(owner) : a.assigneeName ? `${a.assigneeName} (not matched)` : "Owner"}</span>
                  </button>
                  <Picker
                    open={ownerFor === a.key}
                    onClose={() => setOwnerFor(null)}
                    ariaLabel="Owner"
                    searchPlaceholder="Find a person"
                    selected={a.assigneeId ?? null}
                    onSelect={(v) => { patchAction(a.key, { assigneeId: v }); setOwnerFor(null); }}
                    sections={[{ options: peopleOptions }]}
                    align="end"
                  />
                </span>
                <label className="inline-flex h-8 items-center gap-1 rounded-md bg-hover px-2 text-sm text-ink-2" title="Due date">
                  <CalendarPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                  <input type="date" value={a.due ?? ""} onChange={(e) => patchAction(a.key, { due: e.target.value })} className="bg-transparent text-sm text-ink outline-none" aria-label="Due date" />
                </label>
                <button type="button" onClick={() => patch({ actionItems: result.actionItems.filter((x) => x.key !== a.key) })} aria-label="Remove action item" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                  <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => patch({ actionItems: [...result.actionItems, { key: k(), title: "", assigneeId: null, due: "" }] })} className="flex h-9 items-center gap-1.5 rounded-md px-2 text-row text-ink-2 hover:bg-hover hover:text-ink">+ Add action item</button>
          </li>
        </ul>
      </div>

      {/* Attendees */}
      <div>
        <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink">Attendees <span className="text-xs font-medium text-ink-2">{result.attendees.length}</span></h3>
        <div className="flex flex-wrap items-center gap-2">
          {result.attendees.map((a) => {
            const person = a.userId ? byId.get(a.userId) ?? null : null;
            return (
              <span key={a.key} className="relative inline-flex h-7 items-center gap-1 rounded-md bg-hover ps-1 pe-1 text-sm text-ink">
                <button type="button" onClick={() => setAttendeeFor(attendeeFor === a.key ? null : a.key)} aria-haspopup="listbox" aria-expanded={attendeeFor === a.key} className="inline-flex items-center gap-1.5 rounded px-1 hover:bg-active" title={person ? "Change person" : "Match to a person"}>
                  {person ? <PersonAvatar person={person} size={20} /> : null}
                  <span className="max-w-[160px] truncate">{person ? personName(person) : `${a.name} (not matched)`}</span>
                </button>
                <button type="button" onClick={() => patch({ attendees: result.attendees.filter((x) => x.key !== a.key) })} aria-label={`Remove ${a.name}`} className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:bg-active hover:text-ink">
                  <X className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                </button>
                <Picker
                  open={attendeeFor === a.key}
                  onClose={() => setAttendeeFor(null)}
                  ariaLabel="Attendee"
                  searchPlaceholder="Find a person"
                  selected={a.userId ?? null}
                  onSelect={(v) => { const p = byId.get(v); patch({ attendees: result.attendees.map((x) => (x.key === a.key ? { ...x, userId: v, name: p ? personName(p) : x.name, email: p?.email ?? x.email } : x)) }); setAttendeeFor(null); }}
                  sections={[{ options: peopleOptions }]}
                />
              </span>
            );
          })}
          <button type="button" onClick={() => patch({ attendees: [...result.attendees, { key: k(), name: "", userId: null }] })} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">+ Add attendee</button>
        </div>
      </div>
    </div>
  );
}

function RecentRowMenu({ meeting }: { meeting: ApiMeeting }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { toast } = useOsToast();
  return (
    <>
      <RowMoreButton buttonRef={ref} open={open} onClick={() => setOpen((o) => !o)} label="Meeting note actions" />
      <MorePortal anchorRef={ref} width={200} open={open} placement="below">
        <MenuList onMouseLeave={() => setOpen(false)}>
          <MenuItem label="Open" onClick={() => { setOpen(false); router.push(`/meetings/${meeting.id}`); }} />
          <MenuItem icon={Link2} label="Copy link" onClick={() => { setOpen(false); void navigator.clipboard?.writeText(`${window.location.origin}/meetings/${meeting.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy link")); }} />
        </MenuList>
      </MorePortal>
    </>
  );
}
