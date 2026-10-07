"use client";

/* /automation/workflows/[id]: say, in one sentence, what should happen
 * automatically (spec-ai-automation /automation/workflows/[id]).
 *
 *   GET  /api/automation/workflows/[id]   the DRAFT, what is live, versions,
 *                                         the last 10 runs, `can`
 *   GET  /api/automation/triggers|actions the registries
 *   GET  /api/automation/places           Lists, Folders, Spaces the viewer
 *                                         can read, with fields and statuses
 *   PUT  .../[id]                         Save draft (explicit, never auto)
 *   POST .../publish | activate | deactivate | duplicate
 *   GET  .../versions   POST .../versions/[n]/restore
 *   DELETE .../[id]                       Archive
 *
 * Reads as a sentence: When (the trigger and its options), Only if (one
 * AND / OR group of typed conditions), Then ... and then (ordered actions,
 * drag the grip to reorder), Where it runs (Everywhere, or chosen Lists).
 * The Details panel sits beside the sentence at 1024 and wider and stacks
 * under it below, never hidden.
 *
 * Nothing saves silently. While there are unsaved changes the dirty guard is
 * armed: closing the tab asks the browser's question, and any in-app link,
 * the BackButton, the sidebar and the rail ask Keep editing / Discard /
 * Save. Cmd+S saves the draft. A failed save keeps the form dirty and the
 * guard armed. The live automation runs its PUBLISHED version, so a saved
 * draft changes nothing until Republish.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ChevronDown, Copy, GripVertical, History, Plus, ScrollText, Trash2, X } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useOsToast } from "@/components/layout/os/toast";
import { NotFoundView } from "@/components/access/not-found-view";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Picker, type PickerOption, type PickerSectionDef } from "@/components/ui/picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { SkeletonLines } from "@/components/ui/skeleton";
import { JsonBlock } from "@/components/ui/json-block";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { RunStatusDot } from "@/components/automation/run-status-chip";
import {
  BTN,
  CARD,
  FIELD,
  InlineRow,
  NeutralChip,
  WorkflowStatusChip,
  useAutomationCatalog,
  type CatalogAction,
  type CatalogActionParam,
  type CatalogTrigger,
} from "@/components/automation/automation-ui";
import { apiFetch } from "@/lib/api-fetch";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { confirmLeave, setLeaveConfirmer, type LeaveDecision } from "@/lib/dirty-guard";
import { useShortcut } from "@/lib/shortcuts";
import { OFFLINE_EVENT, ONLINE_EVENT } from "@/lib/session-expiry";
import { CONDITION_OPERATORS } from "@/lib/automation/conditions";
import { DEFAULT_STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import {
  draftSnapshot,
  hasProblems,
  moveItem,
  operatorsFor,
  publishProblems,
  readDraft,
  rowId,
  toSaveBody,
  valueKindFor,
  type ActionRow,
  type CondRow,
  type Draft,
  type DraftScope,
  type PublishProblems,
} from "@/lib/automation/builder-state";
import { dateArrivesWords, scheduleWords } from "@/lib/automation/schedule";
import { ALERT_LABEL, ALERT_LEVELS } from "@/lib/automation/workflow-list";
import { formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { cn } from "@/lib/utils";
import { AUTOMATION_TEAMMATE_COPY } from "@/lib/agents/teammate-copy";

/** The "Ask an AI teammate" action's key (registry-actions.ts; teammate-step.ts on the server). */
const TEAMMATE_STEP_KEY = "ask_teammate";

/* ───────────────────────────── types ───────────────────────────── */

interface ApiRun {
  id: string;
  status: string;
  triggerEventKey: string;
  errorMessage: string | null;
  createdAt: string;
}

interface ApiVersion {
  number: number;
  publishedAt: string;
  publishedBy: { id: string; name: string; gone?: boolean } | null;
  isLive: boolean;
  kind: "published" | "kept";
  restoredFrom: number | null;
}

interface ApiWorkflow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  severity: string;
  triggerEvent: string | null;
  liveTrigger: string | null;
  unpublishedChanges: boolean;
  publishedVersionId: string | null;
  publishedAt: string | null;
  lastRunAt: string | null;
  createdById: string | null;
  createdByName: string | null;
  /** The creator is no longer in the workspace. */
  creatorGone?: boolean;
  definition: unknown;
  /** Places this viewer cannot open are kept in the scope (never which or how many). */
  scopeHidden?: boolean;
  /** Why: some exist and this viewer cannot open them, some are in Trash or deleted. */
  scopeKept?: { cannotOpen: boolean; gone: boolean };
  /** The draft's fingerprint when it was read; a save sends it back so it never replaces someone else's newer save unasked. */
  revision?: string;
  versions: ApiVersion[];
  runs: ApiRun[];
  can: { edit: boolean; archive: boolean };
  /** The viewer made it: only they may add or change an AI teammate step (it works as them). */
  viewerIsCreator?: boolean;
  /** What runs holds an AI teammate step: only its creator may turn it back on. */
  liveHasTeammateStep?: boolean;
}

interface PlaceField { key: string; label: string; type: string; choices?: Array<{ value: string; label: string }> }
interface PlaceList { id: string; name: string; spaceId: string | null; folderId: string | null; fields?: PlaceField[]; statuses?: Array<{ value: string; label: string }> }
interface Places {
  spaces: Array<{ id: string; name: string }>;
  folders: Array<{ id: string; name: string; spaceId: string }>;
  lists: PlaceList[];
}

const BUILT_IN_FIELDS: PlaceField[] = [
  { key: "title", label: "Title", type: "TEXT" },
  { key: "priority", label: "Priority", type: "PRIORITY" },
  { key: "dueAt", label: "Due date", type: "DATE" },
  { key: "startAt", label: "Start date", type: "DATE" },
];

const USER_SPECIALS: Array<{ value: string; label: string; adminsOnly?: boolean }> = [
  { value: "assignee", label: "The assignee" },
  { value: "actor", label: "Whoever did it" },
  { value: "board_owner", label: "The List owner" },
  { value: "admins", label: "Every workspace admin", adminsOnly: true },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const OPERATOR_LABEL = new Map(CONDITION_OPERATORS.map((o) => [String(o.key), o.label]));

function personName(p: PersonRef): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";
}

/* ─────────────────────────── the token ─────────────────────────── */

/**
 * The 36px token button a slot is filled with, and its Picker. Read-only, it
 * is a plain chip with the same words.
 */
function Token({
  label,
  placeholder,
  ariaLabel,
  readOnly,
  sections,
  selected,
  onSelect,
  width = 280,
  multi,
  alwaysSearch,
  onSearchChange,
  className,
  invalid,
}: {
  label: string | null;
  placeholder: string;
  ariaLabel: string;
  readOnly: boolean;
  sections: PickerSectionDef[];
  selected?: string | string[] | null;
  onSelect: (v: string) => void;
  width?: number;
  multi?: boolean;
  alwaysSearch?: boolean;
  onSearchChange?: (q: string) => void;
  className?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (readOnly) {
    return <NeutralChip className={cn("h-8 px-2 text-sm", !label && "text-ink-3")}>{label ?? placeholder}</NeutralChip>;
  }
  return (
    <div className={cn("relative inline-flex min-w-0", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-raised px-2.5 text-base hover:bg-hover",
          invalid ? "border-danger-solid" : "border-line-strong",
          label ? "text-ink" : "text-ink-3",
        )}
      >
        <span className="truncate">{label ?? placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-2" aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={ariaLabel}
        width={width}
        sections={sections}
        selected={selected ?? null}
        multi={multi}
        alwaysSearch={alwaysSearch}
        onSearchChange={onSearchChange}
        onSelect={(v) => {
          onSelect(v);
          if (!multi) setOpen(false);
        }}
      />
    </div>
  );
}

/**
 * A status slot: the statuses of the Lists the editor can read, plus the
 * defaults, and a "Custom…" escape for one typed by hand (a status of a List
 * the editor cannot open, or one that does not exist yet). A value already
 * saved that no List offers shows under "Typed".
 */
const CUSTOM_STATUS = "__custom__";

function StatusToken({
  value,
  options,
  ariaLabel,
  onChange,
  invalid,
}: {
  value: string;
  options: PickerOption[];
  ariaLabel: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const [typing, setTyping] = useState(false);
  const known = options.some((o) => o.value === value);
  if (typing) {
    return (
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <input
          autoFocus
          aria-label={`${ariaLabel}, typed`}
          value={value}
          maxLength={80}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type the status"
          className={cn(FIELD, "min-w-[160px] max-w-[240px] flex-1", invalid && "border-danger-solid")}
        />
        <button type="button" onClick={() => setTyping(false)} className={cn("text-sm", BTN.link)}>Back to the statuses</button>
      </span>
    );
  }
  return (
    <Token
      label={value ? (options.find((o) => o.value === value)?.label ?? value) : null}
      placeholder="Pick a status"
      ariaLabel={ariaLabel}
      readOnly={false}
      sections={[
        { options },
        ...(!known && value ? [{ label: "Typed", options: [{ value, label: value }] }] : []),
        { options: [{ value: CUSTOM_STATUS, label: "Custom…", description: "Type a status by hand" }] },
      ]}
      selected={value}
      onSelect={(v) => {
        if (v === CUSTOM_STATUS) setTyping(true);
        else onChange(v);
      }}
      invalid={invalid}
    />
  );
}

/* ─────────────────────── people, statuses, lists ─────────────────────── */

function peopleSections(people: PersonRef[], query: string, withSpecials: boolean, allowAdmins: boolean, allowEmail: boolean): PickerSectionDef[] {
  const out: PickerSectionDef[] = [];
  if (withSpecials) {
    out.push({
      label: "From the trigger",
      options: USER_SPECIALS.filter((s) => allowAdmins || !s.adminsOnly).map((s) => ({ value: s.value, label: s.label })),
    });
  }
  const q = query.trim();
  if (allowEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) {
    out.push({ label: "Email address", options: [{ value: q, label: `Send to ${q}` }] });
  }
  out.push({
    label: "People",
    options: people.map((p) => ({ value: p.id, label: personName(p), keywords: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> })),
  });
  return out;
}

function userLabel(value: string, people: PersonRef[]): string | null {
  if (!value) return null;
  const special = USER_SPECIALS.find((s) => s.value === value);
  if (special) return special.label;
  const p = people.find((x) => x.id === value);
  if (p) return personName(p);
  if (value.includes("@")) return value;
  return "Someone no longer here";
}

/* ─────────────────────────── the leave dialog ─────────────────────────── */

function LeaveDialog({ open, onDecide }: { open: boolean; onDecide: (d: LeaveDecision) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDecide("stay"); }}>
      <DialogContent className="os-chrome max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Save your changes?</DialogTitle>
          <DialogDescription>This automation has changes you have not saved.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <button type="button" onClick={() => onDecide("stay")} className={BTN.ghost}>Keep editing</button>
          <button type="button" onClick={() => onDecide("discard")} className={BTN.danger}>Discard</button>
          <button type="button" onClick={() => onDecide("save")} className={BTN.primary}>Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── version history ─────────────────────────── */

function VersionHistory({
  open,
  versions,
  canRestore,
  onClose,
  onRestore,
}: {
  open: boolean;
  versions: ApiVersion[] | null;
  canRestore: boolean;
  onClose: () => void;
  onRestore: (n: number) => void;
}) {
  const datePrefs = useDatePrefs();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="os-chrome max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Version history</DialogTitle>
          <DialogDescription>Restoring a version makes it the draft. What is live keeps running until you republish.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[420px] overflow-y-auto">
          {versions === null ? (
            <SkeletonLines lines={4} />
          ) : versions.length === 0 ? (
            <InlineRow>No versions yet. Publishing makes the first one.</InlineRow>
          ) : (
            versions.map((v) => (
              <div key={v.number} className="flex min-h-11 items-center gap-3 border-b border-line-soft py-1.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-row text-ink">
                    <span className="font-medium">Version {v.number}</span>
                    {v.isLive ? <NeutralChip className="border-success-text/30 bg-success-bg text-success-text">Live</NeutralChip> : null}
                  </div>
                  <div className="truncate text-sm text-ink-2" title={formatDate(v.publishedAt, datePrefs, "datetime")}>
                    {v.kind === "kept"
                      ? `Kept before version ${v.restoredFrom} was restored, ${formatRelative(v.publishedAt, datePrefs)}`
                      : `Published by ${v.publishedBy?.name ?? "someone"}, ${formatRelative(v.publishedAt, datePrefs)}`}
                  </div>
                </div>
                {canRestore ? (
                  <button type="button" onClick={() => onRestore(v.number)} className={BTN.secondarySm}>Restore</button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── a section card ─────────────────────────── */

function Section({ title, children, error, id }: { title: string; children: ReactNode; error?: string; id: string }) {
  return (
    <section aria-labelledby={id} className={cn(CARD, "p-4", error && "border-danger-solid")}>
      <h2 id={id} className="m-0 mb-3 text-base font-semibold text-ink">{title}</h2>
      {children}
      {error ? <p className="m-0 mt-2 text-sm text-danger-text" role="alert">{error}</p> : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-[120px] shrink-0 text-sm text-ink-2">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/* ─────────────────────────────── page ─────────────────────────────── */

export default function AutomationBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const showUpcoming = useShowUpcoming();
  const catalog = useAutomationCatalog({ actions: true });

  const [wf, setWf] = useState<ApiWorkflow | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  // Two lists to choose from, and the people the draft already names. A
  // recipient (a notification, an email, an assignee) must be ACTIVE: the
  // engine delivers to nobody else (registry-actions resolveUser), so the
  // action pickers offer only them. A condition's person can be anyone who
  // can sign in: a task can be assigned to someone on leave or on probation.
  const [recipients, setRecipients] = useState<PersonRef[]>([]);
  const [signIn, setSignIn] = useState<PersonRef[]>([]);
  const [named, setNamed] = useState<PersonRef[]>([]);
  const [recipientQuery, setRecipientQuery] = useState("");
  // The creator's own AI teammates, for an "Ask an AI teammate" step.
  const [teammates, setTeammates] = useState<Array<{ value: string; label: string; paused: boolean }>>([]);
  // Until the creator's teammates are read, a saved step's teammate is not
  // called unusable; a read that failed says so, with Try again (review round 6).
  const [teammatesRead, setTeammatesRead] = useState<"loading" | "ready" | "failed">("loading");
  const [teammatesTick, setTeammatesTick] = useState(0);
  const [conditionQuery, setConditionQuery] = useState("");
  // Each list grows from its first page and its searches, merged by id and
  // kept in name order.
  const mergeInto = useCallback((set: Dispatch<SetStateAction<PersonRef[]>>) => (got: PersonRef[]) => {
    set((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const p of got) byId.set(p.id, p);
      return [...byId.values()].sort((a, b) => personName(a).localeCompare(personName(b)));
    });
  }, []);
  // Every person read, for names on chips and pickers.
  const people = useMemo(() => {
    const byId = new Map<string, PersonRef>();
    for (const p of [...signIn, ...recipients, ...named]) byId.set(p.id, p);
    return [...byId.values()];
  }, [signIn, recipients, named]);
  // Ids whose lookup has not answered yet, and ids whose lookup failed: their
  // chips say so, never that the person is gone.
  const [peopleLoading, setPeopleLoading] = useState<ReadonlySet<string>>(() => new Set());
  const [peopleFailed, setPeopleFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [places, setPlaces] = useState<Places | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [problems, setProblems] = useState<PublishProblems | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<ApiVersion[] | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolve = useRef<((d: LeaveDecision) => void) | null>(null);
  const [offline, setOffline] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const nameAtFocus = useRef("");
  const saveAgain = useRef<() => void>(() => {});
  // The sections a save refusal marked, so the next save that lands clears only those.
  const saveRefused = useRef(new Set<"when" | "where">());
  // "Only in chosen Lists" picked with no List yet: the scope is still
  // Everywhere until one is chosen, and the section says so.
  const [listsMode, setListsMode] = useState(false);

  const hydrate = useCallback((w: ApiWorkflow) => {
    setWf(w);
    const d = readDraft(w);
    setDraft(d);
    setBaseline(draftSnapshot(d));
    setProblems(null);
    saveRefused.current.clear();
    setListsMode(false);
  }, []);

  const load = useCallback(async () => {
    const r = await apiFetch<{ workflow: ApiWorkflow }>(`/api/automation/workflows/${id}`, { cache: "no-store" });
    if (!r.ok) {
      setLoadState(r.status === 404 ? "missing" : "error");
      return;
    }
    hydrate(r.data.workflow);
    setLoadState("ready");
  }, [id, hydrate]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // The creator's teammates, only for the creator (nobody else may pick one).
  const viewerIsCreator = Boolean(wf?.viewerIsCreator);
  useEffect(() => {
    if (!viewerIsCreator) return;
    let alive = true;
    void apiFetch<{ teammates: Array<{ slug: string; name: string; status: string }> }>("/api/agents/teammates", { cache: "no-store" }).then((r) => {
      if (!alive) return;
      if (r.ok && Array.isArray(r.data.teammates)) {
        // Paused ones too: a step that asks one reads it by name, marked paused,
        // never "a teammate you can't use" (review round 3). Only ENABLED ones are offered.
        setTeammates(r.data.teammates.filter((t) => t.status === "ENABLED" || t.status === "DISABLED").map((t) => ({ value: t.slug, label: t.name, paused: t.status !== "ENABLED" })));
        setTeammatesRead("ready");
      } else {
        setTeammatesRead("failed");
      }
    });
    return () => {
      alive = false;
    };
  }, [viewerIsCreator, teammatesTick]);

  // Picker sources, non-blocking.
  useEffect(() => {
    let alive = true;
    // The whole company, as every people picker reads it (/api/people/pick),
    // not /api/users, which answers anybody below an org-wide level with their
    // own report tree: a Member could pick only themselves as a recipient, and
    // every colleague already chosen read as "Someone no longer here".
    void apiFetch<{ people: PersonRef[] }>("/api/people/pick?includeSelf=1&limit=50", { cache: "no-store" }).then((r) => {
      if (alive && r.ok && Array.isArray(r.data.people)) mergeInto(setRecipients)(r.data.people);
    });
    void apiFetch<{ people: PersonRef[] }>("/api/people/pick?includeSelf=1&limit=50&reach=signin", { cache: "no-store" }).then((r) => {
      if (alive && r.ok && Array.isArray(r.data.people)) mergeInto(setSignIn)(r.data.people);
    });
    void apiFetch<Places>("/api/automation/places", { cache: "no-store" }).then((r) => {
      if (alive && r.ok) setPlaces(r.data);
    });
    void apiFetch<{ canCreate?: boolean; isAdmin?: boolean }>("/api/automation/me", { cache: "no-store" }).then((r) => {
      if (!alive || !r.ok) return;
      setCanCreate(r.data.canCreate === true);
      setIsAdmin(r.data.isAdmin === true);
    });
    return () => {
      alive = false;
    };
  }, [mergeInto]);

  // This page never autosaves, so the shell's offline strip must not say it will.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.saveMode = "explicit";
    return () => { delete root.dataset.saveMode; };
  }, []);

  // The shell's offline strip says why; Save and Publish wait for the network.
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener(OFFLINE_EVENT, off);
    window.addEventListener(ONLINE_EVENT, on);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener(OFFLINE_EVENT, off);
      window.removeEventListener(ONLINE_EVENT, on);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);

  const canEdit = Boolean(wf?.can.edit);
  // An AI teammate step works as the creator, so anyone else reads the
  // automation (the server refuses their save); its on/off switch stays theirs.
  const teammateLocked = Boolean(wf && !wf.viewerIsCreator && draft?.actions.some((a) => a.key === TEAMMATE_STEP_KEY));
  const readOnly = !canEdit || teammateLocked;
  // Turning it back on is the creator's when what RUNS holds the step (the activate route's rule).
  const onLocked = Boolean(wf && !wf.viewerIsCreator && wf.liveHasTeammateStep);
  const dirty = Boolean(draft && canEdit && draftSnapshot(draft) !== baseline);

  const triggerByKey = useMemo(() => new Map(catalog.triggers.map((t) => [t.key, t])), [catalog.triggers]);
  const actionByKey = useMemo(() => new Map(catalog.actions.map((a) => [a.key, a])), [catalog.actions]);
  const trigger: CatalogTrigger | undefined = draft?.trigger ? triggerByKey.get(draft.trigger) : undefined;

  // The people the draft already names (a recipient, a condition's person),
  // looked up by id once each, so one outside the first page reads by name.
  // An id the lookup does not return is someone no longer here.
  const chosenPeopleKey = useMemo(() => {
    if (!draft) return "";
    const ids = new Set<string>();
    const isPerson = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !v.includes("@") && !USER_SPECIALS.some((x) => x.value === v);
    for (const a of draft.actions) {
      for (const p of (a.key ? actionByKey.get(a.key)?.params : undefined) ?? []) if (p.type === "user" && isPerson(a.params[p.key])) ids.add(a.params[p.key] as string);
    }
    for (const c of draft.conditions) {
      const f = (trigger?.fields ?? []).find((x) => x.key === c.field);
      if (valueKindFor(f?.type, c.operator) === "user" && isPerson(c.value)) ids.add(c.value);
    }
    return [...ids].sort().join(",");
  }, [draft, actionByKey, trigger]);
  // Looked up in chunks of 50. An id is done once a lookup answered (found
  // or not); a failed lookup is tried again, up to three times, a little
  // later each time.
  const [peopleAnswered, setPeopleAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const peopleInFlight = useRef(new Set<string>());
  const peopleTries = useRef(new Map<string, number>());
  const [peopleRetry, setPeopleRetry] = useState(0);
  useEffect(() => {
    const missing = chosenPeopleKey.split(",").filter((x) => x && !peopleAnswered.has(x) && !peopleInFlight.current.has(x) && (peopleTries.current.get(x) ?? 0) < 3);
    if (missing.length === 0) return;
    // Marked in flight only when the lookup really starts: a cancelled
    // timer leaves nothing marked, so the next pass asks again.
    const t = setTimeout(() => {
      for (const x of missing) peopleInFlight.current.add(x);
      setPeopleLoading((prev) => new Set([...prev, ...missing]));
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        void apiFetch<{ people: PersonRef[] }>(`/api/people/pick?ids=${chunk.map(encodeURIComponent).join(",")}`, { cache: "no-store" }).then((r) => {
          for (const x of chunk) peopleInFlight.current.delete(x);
          const ok = r.ok && Array.isArray(r.data.people);
          if (ok) {
            setPeopleAnswered((prev) => new Set([...prev, ...chunk]));
            setNamed((prev) => [...prev.filter((p) => !chunk.includes(p.id)), ...r.data.people]);
          } else {
            let wait = 0;
            for (const x of chunk) {
              const n = (peopleTries.current.get(x) ?? 0) + 1;
              peopleTries.current.set(x, n);
              wait = Math.max(wait, n * 2000);
            }
            setTimeout(() => setPeopleRetry((v) => v + 1), wait);
          }
          setPeopleLoading((prev) => new Set([...prev].filter((x) => !chunk.includes(x))));
          setPeopleFailed((prev) => (ok ? new Set([...prev].filter((x) => !chunk.includes(x))) : new Set([...prev, ...chunk])));
        });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [chosenPeopleKey, peopleRetry, peopleAnswered]);
  // A lookup that gave up is asked again when the window comes back or the
  // connection returns, never left failed until a reload.
  useEffect(() => {
    const again = () => {
      peopleTries.current.clear();
      setPeopleRetry((v) => v + 1);
    };
    window.addEventListener("online", again);
    window.addEventListener("focus", again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("focus", again);
    };
  }, []);

  // Typing in a person picker searches the whole company, not only the
  // first page already loaded: everyone who can sign in for a condition,
  // the people a run can deliver to for an action.
  useEffect(() => {
    const q = recipientQuery.trim();
    if (!q) return;
    const t = setTimeout(() => {
      void apiFetch<{ people: PersonRef[] }>(`/api/people/pick?includeSelf=1&limit=20&q=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) => {
        if (r.ok && Array.isArray(r.data.people)) mergeInto(setRecipients)(r.data.people);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [recipientQuery, mergeInto]);
  useEffect(() => {
    const q = conditionQuery.trim();
    if (!q) return;
    const t = setTimeout(() => {
      void apiFetch<{ people: PersonRef[] }>(`/api/people/pick?includeSelf=1&limit=20&reach=signin&q=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) => {
        if (r.ok && Array.isArray(r.data.people)) mergeInto(setSignIn)(r.data.people);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [conditionQuery, mergeInto]);
  // A colleague is named, still Loading, or Couldn't load; "Someone no longer
  // here" only once a lookup answered without them.
  const personLabel = (value: string): string | null => {
    if (!value || value.includes("@") || USER_SPECIALS.some((x) => x.value === value) || people.some((p) => p.id === value)) return userLabel(value, people);
    if (peopleFailed.has(value) && !peopleLoading.has(value)) return "Couldn't load this name";
    if (peopleAnswered.has(value)) return userLabel(value, people);
    return "Loading";
  };

  const update = useCallback((patch: Partial<Draft> | ((d: Draft) => Draft)) => {
    setDraft((d) => (d ? (typeof patch === "function" ? patch(d) : { ...d, ...patch }) : d));
  }, []);

  const numericParams = useCallback((key: string) => new Set((actionByKey.get(key)?.params ?? []).filter((p) => p.type === "number").map((p) => p.key)), [actionByKey]);

  /* ── save, publish, and the rest ── */

  const save = useCallback(async (opts: { quiet?: boolean } = {}): Promise<boolean> => {
    if (!draft || !wf) return false;
    if (!draft.name.trim()) {
      toast("Give the automation a name first", { tone: "danger" });
      return false;
    }
    setSaving(true);
    const put = (overwrite: boolean) => apiFetch<{ workflow: Partial<ApiWorkflow> }>(`/api/automation/workflows/${wf.id}`, {
      method: "PUT",
      json: { ...toSaveBody(draft, numericParams), ...(wf.revision && !overwrite ? { baseRevision: wf.revision } : {}) },
    });
    let r = await put(false);
    // Someone else saved it after this page loaded: their work is never
    // replaced silently. The person chooses to save theirs over it, or keeps
    // editing and reloads to see the newer version.
    if (!r.ok && r.status === 409 && r.code === "stale_draft") {
      setSaving(false);
      const over = await confirm({
        title: "Someone else saved this automation",
        description: "They saved it after you opened it. Save yours over theirs, or keep editing and reload to see their version (your changes here would be lost).",
        confirmLabel: "Save mine over theirs",
        destructive: true,
      });
      if (!over) {
        toast("Not saved. Reload to see their version.", { tone: "danger", action: { label: "Reload", onClick: () => void load() } });
        return false;
      }
      setSaving(true);
      r = await put(true);
    }
    setSaving(false);
    if (!r.ok) {
      // The form stays dirty and the guard stays armed. A refusal the server
      // explains for one section (where it runs, what starts it) is shown in
      // that section; repeating the same save would be refused again, so it
      // offers no Try again. Neither does any other refusal with a reason; a
      // dropped connection, a timeout or a server error does.
      const section = r.issues && typeof r.issues === "object" ? (r.issues as { section?: unknown }).section : undefined;
      if (r.status === 400 && (section === "where" || section === "when")) {
        saveRefused.current.add(section);
        setProblems((p) => ({ conditions: {}, actions: {}, ...(p ?? {}), [section]: r.error }));
        toast("Not saved. See what is marked.", { tone: "danger" });
        return false;
      }
      const retryable = r.status === 0 || r.status === 401 || r.status === 408 || r.status === 429 || r.status >= 500;
      toast(r.status === 401 ? "Not saved. Sign in again; your changes are still here." : retryable ? "Not saved" : `Not saved. ${r.error}`, {
        tone: "danger",
        ...(retryable ? { action: { label: "Try again", onClick: () => saveAgain.current() } } : {}),
      });
      return false;
    }
    // A refusal an earlier save showed no longer holds once a save lands; a
    // publish check's own marks stay until the next publish.
    if (saveRefused.current.size) {
      const cleared = new Set(saveRefused.current);
      saveRefused.current.clear();
      setProblems((p) => (p ? { ...p, ...(cleared.has("where") ? { where: undefined } : {}), ...(cleared.has("when") ? { when: undefined } : {}) } : p));
    }
    setBaseline(draftSnapshot(draft));
    // scopeHidden follows the save (choosing Everywhere lets the hidden places go).
    const saved = r.data.workflow;
    setWf((prev) => (prev ? { ...prev, name: draft.name.trim(), description: draft.description.trim() || null, severity: draft.severity, unpublishedChanges: Boolean(prev.publishedVersionId), scopeHidden: saved?.scopeHidden ?? prev.scopeHidden, scopeKept: saved?.scopeKept ?? prev.scopeKept, revision: saved?.revision ?? prev.revision } : prev));
    notifyAiChatsChanged();
    if (!opts.quiet) toast("Draft saved");
    return true;
  }, [draft, wf, numericParams, toast, confirm, load]);

  // "Try again" on a failed save calls the latest save through a ref.
  useEffect(() => {
    saveAgain.current = () => void save();
  }, [save]);

  useDirtyGuard(dirty, { onSave: () => save({ quiet: true }), id: `automation-builder-${id}` });

  // In-app navigation asks too: the 400px Keep editing / Discard / Save.
  useEffect(() => {
    setLeaveConfirmer(() => new Promise<LeaveDecision>((resolve) => {
      leaveResolve.current = resolve;
      setLeaveOpen(true);
    }));
    return () => setLeaveConfirmer(null);
  }, []);
  const decideLeave = (d: LeaveDecision) => {
    setLeaveOpen(false);
    const r = leaveResolve.current;
    leaveResolve.current = null;
    r?.(d);
  };
  // A plain link click anywhere (the sidebar, the rail, the breadcrumb) goes
  // through the guard while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void confirmLeave().then((ok) => { if (ok) router.push(url.pathname + url.search + url.hash); });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, router]);

  useShortcut({
    id: "automation.save-draft",
    keys: "mod+s",
    label: "Save draft",
    scope: "page",
    group: "On this page",
    inInputs: true,
    when: () => canEdit && !teammateLocked,
    run: (e) => {
      e.preventDefault();
      if (!saving && !publishing && !offline) void save();
    },
  });

  const publish = useCallback(async () => {
    if (!draft || !wf) return;
    const p = publishProblems(draft, catalog);
    // Publish sets the marks from here on: none is a save's refusal any more.
    saveRefused.current.clear();
    if (hasProblems(p)) {
      setProblems(p);
      toast("Not published. Fix what is marked.", { tone: "danger" });
      return;
    }
    setProblems(null);
    setPublishing(true);
    const saved = dirty || wf.unpublishedChanges || !wf.publishedVersionId ? await save({ quiet: true }) : true;
    if (!saved) {
      setPublishing(false);
      return;
    }
    const r = await apiFetch<unknown>(`/api/automation/workflows/${wf.id}/publish`, { method: "POST" });
    setPublishing(false);
    if (!r.ok) {
      const body = (r.issues && typeof r.issues === "object" ? r.issues : null) as { section?: string; index?: number } | null;
      const section = body?.section;
      // The server indexes the saved rules, which skip rows the draft still
      // holds but toSaveBody drops (no field or operator), so count as it does.
      const savedConds = draft.conditions.filter((c) => c.opaque !== undefined || (c.field && c.operator));
      if (section === "when") setProblems({ when: r.error, conditions: {}, actions: {} });
      else if (section === "only_if" && typeof body?.index === "number" && savedConds[body.index]) setProblems({ conditions: { [savedConds[body.index].id]: r.error }, actions: {} });
      else if (section === "then" && typeof body?.index === "number" && draft.actions[body.index]) setProblems({ conditions: {}, actions: { [draft.actions[body.index].id]: r.error } });
      else setProblems({ then: r.error || "Couldn't publish", conditions: {}, actions: {} });
      toast("Not published", { tone: "danger" });
      return;
    }
    toast(wf.publishedVersionId ? "Republished. The new version is live." : "Published. The automation is live.");
    notifyAiChatsChanged();
    void load();
  }, [draft, wf, catalog, dirty, save, toast, load]);

  const setActive = useCallback(async (on: boolean) => {
    if (!wf) return;
    setToggling(true);
    const r = await apiFetch<{ workflow: Partial<ApiWorkflow> }>(`/api/automation/workflows/${wf.id}/${on ? "activate" : "deactivate"}`, { method: "POST" });
    setToggling(false);
    if (!r.ok) {
      toast(r.error || "Couldn't change it", { tone: "danger" });
      return;
    }
    setWf((prev) => (prev ? { ...prev, status: r.data.workflow.status ?? prev.status } : prev));
    toast(on ? "Activated" : "Deactivated");
    notifyAiChatsChanged();
  }, [wf, toast]);

  // An archived automation comes back from its own page too, paused, so an
  // Admin who arrives from Logs or Usage is not sent hunting for Show archived.
  const unarchive = useCallback(async () => {
    if (!wf) return;
    const r = await apiFetch(`/api/automation/workflows/${wf.id}/unarchive`, { method: "POST" });
    if (!r.ok) {
      toast(r.error || "Couldn't bring it back", { tone: "danger" });
      return;
    }
    toast("Back from the archive, paused");
    notifyAiChatsChanged();
    await load();
  }, [wf, toast, load]);

  const duplicate = useCallback(async () => {
    if (!wf) return;
    const r = await apiFetch<{ id: string }>(`/api/automation/workflows/${wf.id}/duplicate`, { method: "POST", json: {} });
    if (!r.ok) {
      toast(r.error || "Couldn't duplicate it", { tone: "danger" });
      return;
    }
    toast("Duplicated as a draft", { action: { label: "Open it", onClick: () => router.push(`/automation/workflows/${r.data.id}`) } });
    notifyAiChatsChanged();
  }, [wf, router, toast]);

  const archive = useCallback(async () => {
    if (!wf) return;
    const ok = await confirm({
      title: `Archive "${wf.name}"?`,
      description: "It stops running. Its run history is kept.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/automation/workflows/${wf.id}`, { method: "DELETE" });
    if (!r.ok) {
      toast(r.error || "Couldn't archive it", { tone: "danger" });
      return;
    }
    // Archived work is not unsaved work: nothing to guard any more.
    setBaseline(draft ? draftSnapshot(draft) : baseline);
    toast("Archived. Its run history is kept.");
    notifyAiChatsChanged();
    router.push("/automation/workflows");
  }, [wf, draft, baseline, confirm, router, toast]);

  const openHistory = useCallback(async () => {
    if (!wf) return;
    setHistoryOpen(true);
    setVersions(null);
    const r = await apiFetch<{ versions: ApiVersion[] }>(`/api/automation/workflows/${wf.id}/versions`, { cache: "no-store" });
    setVersions(r.ok ? r.data.versions : []);
  }, [wf]);

  const restore = useCallback(async (n: number) => {
    if (!wf) return;
    const ok = await confirm({
      title: `Restore version ${n}?`,
      description: dirty
        ? "It replaces the draft, including the changes you have not saved. What is live keeps running until you republish."
        : "It becomes the draft. If your draft has changes no version holds, they are kept as a version first. What is live keeps running until you republish.",
      confirmLabel: "Restore",
      destructive: false,
    });
    if (!ok) return;
    const r = await apiFetch<{ keptVersion: number | null }>(`/api/automation/workflows/${wf.id}/versions/${n}/restore`, { method: "POST", json: {} });
    if (!r.ok) {
      toast(r.error || "Couldn't restore it", { tone: "danger" });
      return;
    }
    setHistoryOpen(false);
    toast(r.data.keptVersion ? `Version ${n} is the draft. Your previous draft is kept as version ${r.data.keptVersion}.` : `Version ${n} is the draft.`);
    await load();
  }, [wf, dirty, confirm, toast, load]);

  /* ── the sections' options ── */

  const scopedLists = useMemo<PlaceList[]>(() => {
    const all = places?.lists ?? [];
    if (!draft) return all;
    const s = draft.scope;
    if (s.listIds.length + s.folderIds.length + s.spaceIds.length === 0) return all;
    return all.filter((l) => s.listIds.includes(l.id) || (l.folderId && s.folderIds.includes(l.folderId)) || (l.spaceId && s.spaceIds.includes(l.spaceId)));
  }, [places, draft]);

  const listFieldOptions = useMemo<PickerOption[]>(() => {
    const seen = new Map<string, PickerOption>();
    for (const l of scopedLists) {
      for (const f of l.fields ?? []) {
        if (!seen.has(f.key)) seen.set(f.key, { value: f.key, label: f.label, description: `In ${l.name}` });
      }
    }
    return [...seen.values()];
  }, [scopedLists]);

  const statusOptions = useMemo<PickerOption[]>(() => {
    const seen = new Map<string, PickerOption>();
    for (const l of scopedLists) for (const st of l.statuses ?? []) if (!seen.has(st.value)) seen.set(st.value, { value: st.value, label: st.label });
    for (const st of DEFAULT_STATUS_OPTIONS) if (!seen.has(st.value)) seen.set(st.value, { value: st.value, label: st.label });
    return [...seen.values()];
  }, [scopedLists]);

  const listLabel = useCallback((lid: string) => places?.lists.find((l) => l.id === lid)?.name ?? null, [places]);
  const spaceName = useCallback((sid: string | null) => (sid ? places?.spaces.find((s) => s.id === sid)?.name : undefined), [places]);
  const listOptions = useMemo<PickerOption[]>(() => (places?.lists ?? []).map((l) => ({ value: l.id, label: l.name, description: spaceName(l.spaceId) ?? undefined, keywords: spaceName(l.spaceId) ?? undefined })), [places, spaceName]);

  /* ── render ── */

  if (loadState === "missing") return <NotFoundView back={{ fallbackHref: "/automation/workflows", label: "Workflows" }} />;
  if (loadState === "error") {
    return (
      <>
        <OsPageHeader title="Automation" back={{ fallbackHref: "/automation/workflows", label: "Workflows" }} />
        <div className="flex justify-center px-6"><InlineRow action={{ label: "Try again", onClick: () => { setLoadState("loading"); void load(); } }}>Couldn&apos;t load this automation</InlineRow></div>
      </>
    );
  }
  if (!wf || !draft) {
    return (
      <>
        <OsPageHeader title="Automation" back={{ fallbackHref: "/automation/workflows", label: "Workflows" }} />
        <div className="flex flex-col gap-4 px-6 pt-2 min-[1024px]:flex-row" aria-busy="true" aria-label="Loading automation">
          <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className={`${CARD} p-4`}><SkeletonLines lines={2} /></div>)}
          </div>
          <div className={`${CARD} p-4 min-[1024px]:w-[360px]`}><SkeletonLines lines={5} /></div>
        </div>
      </>
    );
  }

  const published = Boolean(wf.publishedVersionId);
  const archived = wf.status === "ARCHIVED";
  // The live version's publisher caps where it runs (author-reach.ts,
  // runReach): said here, or an automation an Admin made and a manager
  // republished just stops running in the Admin's private Lists with
  // nothing to show why.
  const liveVersion = wf.versions.find((v) => v.isLive);
  const publisher = liveVersion?.publishedBy ?? null;
  const creatorName = wf.createdByName || "its creator";
  const cappedNote = !published || archived
    ? null
    : wf.creatorGone
      ? `Its creator is no longer in the workspace, so it no longer runs on tasks in any List.${canCreate ? " Make a copy to run it as yours." : " Someone who can create automations can make a copy to run it again."}`
      : publisher?.gone
        ? `Its live version was published by someone no longer in the workspace, so it no longer runs on tasks in any List.${canEdit ? " Republish it to run it again." : " Someone who can edit it can republish it to run it again."}`
        : publisher && !wf.createdById
          ? `Published by ${publisher.name}, so it runs only where ${publisher.name} can open and change things.`
          : publisher && publisher.id !== wf.createdById
            ? `Published by ${publisher.name}, so it runs only where both ${publisher.name} and ${creatorName} can open and change things. When ${creatorName} republishes it, it runs with their own reach.`
            : null;
  const busy = saving || publishing;
  const offlineTitle = offline ? "You're offline. Save and Publish wait for the network." : undefined;

  /* When */
  const triggerSections: PickerSectionDef[] = (() => {
    const byCat = new Map<string, PickerOption[]>();
    for (const t of catalog.triggers) {
      if (t.hidden && t.key !== draft.trigger) continue;
      const list = byCat.get(t.category) ?? [];
      list.push({ value: t.key, label: t.name, description: t.description, hint: t.isEmitting ? undefined : "Not live yet" });
      byCat.set(t.category, list);
    }
    return [...byCat.entries()].map(([label, options]) => ({ label, options }));
  })();

  const whenOptions = (() => {
    if (!trigger) return null;
    const w = draft.when;
    if (trigger.key === "task.field_changed") {
      const field = typeof w.field === "string" ? w.field : "";
      const opts: PickerSectionDef[] = [
        { options: [{ value: "", label: "Any field" }] },
        { label: "Task", options: BUILT_IN_FIELDS.map((f) => ({ value: f.key, label: f.label })) },
        ...(listFieldOptions.length ? [{ label: "List fields", options: listFieldOptions }] : []),
      ];
      const label = !field ? "Any field" : BUILT_IN_FIELDS.find((f) => f.key === field)?.label ?? listFieldOptions.find((o) => o.value === field)?.label ?? "A field that was removed";
      return (
        <Row label="Which field">
          <Token label={label} placeholder="Any field" ariaLabel="Which field changes" readOnly={readOnly} sections={opts} selected={field} onSelect={(v) => update({ when: { ...w, field: v || undefined } })} />
        </Row>
      );
    }
    if (trigger.key === "task.date_arrives") {
      const dateField = w.dateField === "startAt" ? "startAt" : "dueAt";
      const offset = Number.isInteger(Number(w.offsetDays)) ? Number(w.offsetDays) : 0;
      const dir = offset < 0 ? "before" : offset > 0 ? "after" : "on";
      return (
        <div className="flex flex-col gap-1">
          <Row label="Which date">
            <Token label={dateField === "startAt" ? "Start date" : "Due date"} placeholder="Due date" ariaLabel="Which date" readOnly={readOnly}
              sections={[{ options: [{ value: "dueAt", label: "Due date" }, { value: "startAt", label: "Start date" }] }]} selected={dateField}
              onSelect={(v) => update({ when: { ...w, dateField: v } })} />
          </Row>
          <Row label="When">
            {readOnly ? <NeutralChip className="h-8 px-2 text-sm">{dateArrivesWords(w)}</NeutralChip> : (
              <>
                {dir !== "on" ? (
                  <input type="number" min={1} max={30} aria-label="Days" value={Math.abs(offset)} onChange={(e) => { const n = Math.max(1, Math.min(30, Number(e.target.value) || 1)); update({ when: { ...w, offsetDays: dir === "before" ? -n : n } }); }} className={cn(FIELD, "w-20")} />
                ) : null}
                <SegmentedControl<"before" | "on" | "after">
                  label="Before, on or after the date"
                  value={dir}
                  options={[{ value: "before", label: "Days before" }, { value: "on", label: "On the day" }, { value: "after", label: "Days after" }]}
                  onChange={(v) => update({ when: { ...w, offsetDays: v === "on" ? 0 : (v === "before" ? -1 : 1) * Math.max(1, Math.abs(offset) || 1) } })}
                />
              </>
            )}
          </Row>
          <Row label="Finished tasks">
            {readOnly ? (
              <span className="text-base text-ink-2">{w.includeDone === true ? "Included" : "Left out"}</span>
            ) : (
              <label className="flex items-center gap-2 text-base text-ink">
                <Switch checked={w.includeDone === true} onChange={(v) => update({ when: { ...w, includeDone: v || undefined } })} aria-label="Also run for finished tasks" />
                <span>{w.includeDone === true ? "Also runs for tasks already done" : "Skips tasks already done"}</span>
              </label>
            )}
          </Row>
        </div>
      );
    }
    if (trigger.key === "schedule.every") {
      const every = w.every === "weekday" || w.every === "week" || w.every === "month" ? w.every : "day";
      const at = typeof w.at === "string" ? w.at : "09:00";
      return (
        <div className="flex flex-col gap-1">
          <Row label="How often">
            <Token label={{ day: "Every day", weekday: "Every weekday", week: "Every week", month: "Every month" }[every]} placeholder="Every day" ariaLabel="How often" readOnly={readOnly}
              sections={[{ options: [{ value: "day", label: "Every day" }, { value: "weekday", label: "Every weekday" }, { value: "week", label: "Every week" }, { value: "month", label: "Every month" }] }]}
              selected={every} onSelect={(v) => update({ when: { ...w, every: v } })} />
            {every === "week" ? (
              <Token label={WEEKDAYS[Number.isInteger(Number(w.weekday)) ? Number(w.weekday) : 1]} placeholder="Monday" ariaLabel="Which day" readOnly={readOnly}
                sections={[{ options: WEEKDAYS.map((d, i) => ({ value: String(i), label: d })) }]} selected={String(Number.isInteger(Number(w.weekday)) ? Number(w.weekday) : 1)}
                onSelect={(v) => update({ when: { ...w, weekday: Number(v) } })} />
            ) : null}
            {every === "month" ? (
              <Token label={`On the ${Number(w.monthDay) || 1}`} placeholder="On the 1" ariaLabel="Which day of the month" readOnly={readOnly} width={200}
                sections={[{ options: Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `On the ${i + 1}` })) }]} selected={String(Number(w.monthDay) || 1)}
                onSelect={(v) => update({ when: { ...w, monthDay: Number(v) } })} />
            ) : null}
          </Row>
          <Row label="At">
            {readOnly ? <NeutralChip className="h-8 px-2 text-sm">{at}</NeutralChip> : (
              <input type="time" aria-label="Time" value={at} onChange={(e) => update({ when: { ...w, at: e.target.value || "09:00" } })} className={cn(FIELD, "w-32")} />
            )}
            {catalog.serverZone ? <span className="text-sm text-ink-2">{catalog.serverZone} time</span> : null}
          </Row>
          <p className="m-0 text-sm text-ink-2">{scheduleWords(w)}.</p>
        </div>
      );
    }
    return null;
  })();

  /* Only if */
  const conditionFields = (trigger?.fields ?? []);
  const setCond = (rid: string, patch: Partial<CondRow>) => update((d) => ({ ...d, conditions: d.conditions.map((c) => (c.id === rid ? { ...c, ...patch } : c)) }));
  const removeCond = (rid: string) => update((d) => ({ ...d, conditions: d.conditions.filter((c) => c.id !== rid) }));
  const addCond = () => {
    const first = conditionFields.find((f) => !f.legacy);
    const op = first ? operatorsFor(first.type)[0] : "eq";
    update((d) => ({ ...d, conditions: [...d.conditions, { id: rowId(), field: first?.key ?? "", operator: op, value: "" }] }));
  };

  const valueControl = (row: CondRow) => {
    const f = conditionFields.find((x) => x.key === row.field);
    const kind = valueKindFor(f?.type, row.operator);
    const set = (value: string) => setCond(row.id, { value });
    // Red until a value is picked, the same marking a required action param gets.
    const invalid = Boolean(problems?.conditions[row.id]) && !row.value.trim();
    if (kind === "none") return null;
    if (readOnly) {
      const shown =
        kind === "user" ? personLabel(row.value)
        : kind === "status" ? statusOptions.find((o) => o.value === row.value)?.label ?? row.value
        : kind === "priority" ? PRIORITY_OPTIONS.find((o) => o.value === row.value)?.label ?? row.value
        : kind === "list" ? listLabel(row.value) ?? "A List you can't open"
        : row.value;
      return <NeutralChip className="h-8 px-2 text-sm">{shown || "Nothing"}</NeutralChip>;
    }
    if (kind === "user") {
      return <Token label={personLabel(row.value)} placeholder="Pick a person" ariaLabel="Condition person" readOnly={false} alwaysSearch onSearchChange={setConditionQuery}
        sections={peopleSections(signIn, conditionQuery, false, false, false)} selected={row.value} onSelect={set} invalid={invalid} />;
    }
    if (kind === "status") {
      return <StatusToken value={row.value} options={statusOptions} ariaLabel="Condition status" onChange={set} invalid={invalid} />;
    }
    if (kind === "priority") {
      return <Token label={PRIORITY_OPTIONS.find((o) => o.value === row.value)?.label ?? null} placeholder="Pick a priority" ariaLabel="Condition priority" readOnly={false}
        sections={[{ options: PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label })) }]} selected={row.value} onSelect={set} invalid={invalid} />;
    }
    if (kind === "list") {
      return <Token label={row.value ? listLabel(row.value) ?? "A List you can't open" : null} placeholder="Pick a List" ariaLabel="Condition List" readOnly={false}
        sections={[{ options: listOptions }]} selected={row.value} onSelect={set} invalid={invalid} />;
    }
    if (kind === "boolean") {
      return <Token label={row.value === "true" ? "Yes" : row.value === "false" ? "No" : null} placeholder="Yes or no" ariaLabel="Condition yes or no" readOnly={false}
        sections={[{ options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] }]} selected={row.value} onSelect={set} invalid={invalid} />;
    }
    if (kind === "date") return <input type="date" aria-label="Condition date" value={row.value} onChange={(e) => set(e.target.value)} className={cn(FIELD, "w-40", invalid && "border-danger-solid")} />;
    if (kind === "number") return <input type="number" aria-label="Condition number" value={row.value} onChange={(e) => set(e.target.value)} className={cn(FIELD, "w-28", invalid && "border-danger-solid")} />;
    return <input aria-label="Condition value" value={row.value} onChange={(e) => set(e.target.value)} placeholder="Value" className={cn(FIELD, "min-w-[140px] flex-1", invalid && "border-danger-solid")} />;
  };

  /* Then */
  const actionSections: PickerSectionDef[] = (() => {
    const byCat = new Map<string, PickerOption[]>();
    for (const a of catalog.actions) {
      if (!a.available && !showUpcoming) continue;
      if (a.key === TEAMMATE_STEP_KEY && !wf?.viewerIsCreator) continue;
      const list = byCat.get(a.category) ?? [];
      list.push({ value: a.key, label: a.name, description: a.description, disabled: !a.available, hint: a.available ? undefined : a.unavailableReason === "ai_off" ? AUTOMATION_TEAMMATE_COPY.aiOffHint : "Coming soon" });
      byCat.set(a.category, list);
    }
    return [...byCat.entries()].map(([label, options]) => ({ label, options }));
  })();

  const setAction = (rid: string, patch: Partial<ActionRow>) => update((d) => ({ ...d, actions: d.actions.map((a) => (a.id === rid ? { ...a, ...patch } : a)) }));
  const setParam = (rid: string, key: string, value: string) => update((d) => ({ ...d, actions: d.actions.map((a) => (a.id === rid ? { ...a, params: { ...a.params, [key]: value } } : a)) }));
  const removeAction = (rid: string) => update((d) => ({ ...d, actions: d.actions.filter((a) => a.id !== rid) }));
  const addAction = () => update((d) => ({ ...d, actions: [...d.actions, { id: rowId(), key: null, params: {} }] }));

  const tokenHelp = trigger ? trigger.fields.filter((f) => !f.legacy && f.type !== "user" && f.type !== "list").slice(0, 6).map((f) => `{{${f.key}}}`).join(", ") : "";

  const paramControl = (action: CatalogAction, p: CatalogActionParam, row: ActionRow) => {
    const value = row.params[p.key] ?? "";
    const set = (v: string) => setParam(row.id, p.key, v);
    if (p.key === "itemId") return null; // The triggering task: the builder never asks for an id.
    if (readOnly) {
      const shown =
        p.type === "user" ? personLabel(value)
        : p.type === "board" ? (value ? listLabel(value) ?? "A List you can't open" : null)
        : p.type === "status" ? statusOptions.find((o) => o.value === value)?.label ?? value
        : p.type === "field" ? (value === "priority" ? "Priority" : listFieldOptions.find((o) => o.value === value)?.label ?? value)
        : p.key === "priority" ? PRIORITY_OPTIONS.find((o) => o.value === value)?.label ?? value
        : p.type === "teammate" ? (teammates.find((t) => t.value === value)?.label ?? (value || !wf?.viewerIsCreator ? `One of ${wf?.createdByName ?? "its creator"}'s AI teammates` : null))
        : value;
      return <span className="min-w-0 whitespace-pre-wrap break-words text-base text-ink">{shown || <span className="text-ink-3">Not set</span>}</span>;
    }
    if (p.type === "user") {
      const allowAdmins = action.key === "create_notification" && p.key === "userId";
      return <Token label={personLabel(value)} placeholder="Pick a person" ariaLabel={p.label} readOnly={false} alwaysSearch onSearchChange={setRecipientQuery}
        sections={peopleSections(recipients, recipientQuery, true, allowAdmins, action.key === "send_email")} selected={value} onSelect={set} invalid={Boolean(problems?.actions[row.id]) && p.required && !value} />;
    }
    if (p.type === "teammate") {
      const chosen = value ? teammates.find((t) => t.value === value) : undefined;
      const unread = teammatesRead === "loading" ? AUTOMATION_TEAMMATE_COPY.teammatesLoading : teammatesRead === "failed" ? AUTOMATION_TEAMMATE_COPY.teammatesFailed : AUTOMATION_TEAMMATE_COPY.teammateNotFound;
      return (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <Token label={value ? (chosen ? (chosen.paused ? AUTOMATION_TEAMMATE_COPY.pausedLabel(chosen.label) : chosen.label) : unread) : null} placeholder="Pick a teammate" ariaLabel={p.label} readOnly={false}
            sections={[{ options: teammates.filter((t) => !t.paused).map((t) => ({ value: t.value, label: t.label })) }]} selected={value} onSelect={set} invalid={Boolean(problems?.actions[row.id]) && p.required && !value} />
          {teammatesRead === "failed" ? (
            <button
              type="button"
              className={BTN.link}
              onClick={() => {
                setTeammatesRead("loading");
                setTeammatesTick((n) => n + 1);
              }}
            >
              {AUTOMATION_TEAMMATE_COPY.teammatesFailed} Try again
            </button>
          ) : null}
        </span>
      );
    }
    if (p.type === "board") {
      return <Token label={value ? listLabel(value) ?? "A List you can't open" : null} placeholder="Pick a List" ariaLabel={p.label} readOnly={false}
        sections={[{ options: listOptions }]} selected={value} onSelect={set} invalid={Boolean(problems?.actions[row.id]) && p.required && !value} />;
    }
    if (p.type === "status") {
      return <StatusToken value={value} options={statusOptions} ariaLabel={p.label} onChange={set} invalid={Boolean(problems?.actions[row.id]) && p.required && !value} />;
    }
    if (p.type === "field") {
      return <Token label={value === "priority" ? "Priority" : value ? listFieldOptions.find((o) => o.value === value)?.label ?? "A field that was removed" : null} placeholder="Pick a field" ariaLabel={p.label} readOnly={false}
        sections={[{ label: "Task", options: [{ value: "priority", label: "Priority" }] }, ...(listFieldOptions.length ? [{ label: "List fields", options: listFieldOptions }] : [])]} selected={value} onSelect={set} invalid={Boolean(problems?.actions[row.id]) && !value} />;
    }
    if (p.key === "priority" || (action.key === "set_field" && p.key === "value" && row.params.field === "priority")) {
      return <Token label={PRIORITY_OPTIONS.find((o) => o.value === value)?.label ?? null} placeholder="No priority" ariaLabel={p.label} readOnly={false}
        sections={[{ options: [{ value: "", label: "No priority" }, ...PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))] }]} selected={value} onSelect={set} />;
    }
    if (action.key === "set_field" && p.key === "value") {
      const field = scopedLists.flatMap((l) => l.fields ?? []).find((f) => f.key === row.params.field);
      if (field?.choices?.length) {
        return <Token label={field.choices.find((c) => c.value === value)?.label ?? (value || null)} placeholder="Pick an option" ariaLabel="Value" readOnly={false}
          sections={[{ options: [{ value: "", label: "Clear the field" }, ...field.choices.map((c) => ({ value: c.value, label: c.label }))] }]} selected={value} onSelect={set} />;
      }
    }
    if (p.type === "number") return <input type="number" aria-label={p.label} value={value} onChange={(e) => set(e.target.value)} className={cn(FIELD, "w-28")} />;
    if (p.type === "text") return <textarea aria-label={p.label} value={value} onChange={(e) => set(e.target.value)} rows={3} className="w-full rounded-md border border-line-strong bg-raised px-2.5 py-2 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand" />;
    return <input aria-label={p.label} value={value} onChange={(e) => set(e.target.value)} className={cn(FIELD, "min-w-[160px] flex-1")} />;
  };

  const paramHelp = (action: CatalogAction, p: CatalogActionParam, row: ActionRow): string | null => {
    if (action.key === "set_field" && p.key === "value") {
      const f = row.params.field;
      if (!f || f === "priority" || scopedLists.some((l) => (l.fields ?? []).some((x) => x.key === f && x.choices?.length))) return null;
    }
    if (p.type === "user" || p.type === "board" || p.type === "field" || p.type === "status" || p.type === "teammate") return null;
    // A teammate's request: its values are read as information, never as instructions.
    if (action.key === TEAMMATE_STEP_KEY && p.key === "request") {
      return tokenHelp ? `Use ${tokenHelp} to put in what the trigger carries. ${AUTOMATION_TEAMMATE_COPY.valuesNote}` : AUTOMATION_TEAMMATE_COPY.valuesNote;
    }
    if ((p.type === "text" || p.type === "string") && p.help?.includes("{{field}}")) return tokenHelp ? `Use ${tokenHelp} to put in what the trigger carries.` : null;
    return p.help ?? null;
  };

  /* Where */
  // Places this editor cannot open stay in the scope unless they choose
  // Everywhere; they are never listed, named, counted or removable here.
  const keptHidden = Boolean(wf?.scopeHidden) && !draft.everywhere;
  const shownEmpty = draft.scope.listIds.length + draft.scope.folderIds.length + draft.scope.spaceIds.length === 0;
  const everywhere = draft.everywhere || (shownEmpty && !keptHidden);
  const whereMode: "everywhere" | "lists" = everywhere && !listsMode ? "everywhere" : "lists";
  // A place added or removed restates the choice to match what the section
  // shows: with every place gone and none kept that this editor cannot open,
  // it is Everywhere (so undoing an edit by hand leaves nothing unsaved).
  const withScope = (d: Draft, scope: DraftScope): Draft => ({
    ...d,
    scope,
    everywhere: scope.listIds.length + scope.folderIds.length + scope.spaceIds.length === 0 ? !wf?.scopeHidden : false,
  });

  const header = (
    <OsPageHeader
      title={draft.name || "Automation"}
      back={{ fallbackHref: "/automation/workflows", label: "Workflows" }}
      titleSlot={
        readOnly ? (
          <h1 className="m-0 min-w-0 truncate text-title font-semibold text-ink">{wf.name}</h1>
        ) : (
          <input
            aria-label="Automation name"
            value={draft.name}
            maxLength={200}
            onFocus={() => { nameAtFocus.current = draft.name; }}
            onChange={(e) => update({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Escape") { e.preventDefault(); update({ name: nameAtFocus.current }); (e.target as HTMLInputElement).blur(); }
            }}
            onBlur={() => { if (!draft.name.trim()) update({ name: nameAtFocus.current || wf.name }); }}
            className="h-8 w-full min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-title font-semibold text-ink outline-none hover:border-line focus:border-brand"
          />
        )
      }
      more={[
        ...(canCreate && !archived ? [{ label: "Duplicate", icon: Copy, onClick: () => void duplicate() }] : []),
        { label: "View logs", icon: ScrollText, href: `/automation/logs?workflowId=${wf.id}` },
        ...(wf.versions.length > 0 ? [{ label: "Version history", icon: History, onClick: () => void openHistory() }] : []),
        ...(wf.can.archive && !archived ? [{ separator: true as const }, { label: "Archive", icon: Archive, destructive: true, onClick: () => void archive() }] : []),
        ...(wf.can.archive && archived ? [{ separator: true as const }, { label: "Bring back", icon: ArchiveRestore, onClick: () => void unarchive() }] : []),
      ]}
      toolbar={{
        left: (
          <span className="flex items-center gap-2 text-sm text-ink-2">
            <WorkflowStatusChip status={wf.status} />
            {dirty ? <span>· Unsaved changes</span> : wf.unpublishedChanges && canEdit ? <span>· Saved, not published yet</span> : null}
          </span>
        ),
        // Nothing a locked view could only have refused (review round 1).
        right: canEdit && !archived && !teammateLocked ? (
          <button type="button" onClick={() => void save()} disabled={busy || !dirty || offline} title={offlineTitle} className={BTN.secondary}>
            {saving && !publishing ? "Saving" : "Save draft"}
          </button>
        ) : undefined,
        primary: canEdit && !archived && !teammateLocked ? {
          label: published ? "Republish" : "Publish",
          icon: null,
          onClick: () => void publish(),
          busy: publishing,
          // The server refuses a new version over a live teammate step from anyone but its creator (review round 4).
          disabled: busy || offline || onLocked || (published && !dirty && !wf.unpublishedChanges),
          title: offlineTitle ?? (onLocked ? AUTOMATION_TEAMMATE_COPY.creatorOnlyPublish(wf.createdByName ?? null) : published ? "The live automation keeps running the old version until you republish." : "Publishing checks the sentence and turns the automation on."),
        } : undefined,
      }}
    />
  );

  const details = (
    <aside aria-label="Details" className={cn(CARD, "flex max-w-[720px] flex-col gap-5 p-4 min-[1024px]:max-w-none min-[1024px]:sticky min-[1024px]:top-4 min-[1024px]:w-[360px] min-[1024px]:shrink-0")}>
      <h2 className="m-0 text-base font-semibold text-ink min-[1024px]:sr-only">Details</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="wf-description" className="text-sm font-medium text-ink">Description</label>
        {readOnly ? (
          <p className="m-0 whitespace-pre-wrap text-base text-ink-2">{draft.description || "No description"}</p>
        ) : (
          <textarea
            id="wf-description"
            value={draft.description}
            maxLength={2000}
            onChange={(e) => update({ description: e.target.value })}
            rows={Math.max(3, Math.min(12, draft.description.split("\n").length + 1))}
            placeholder="What is this for?"
            className="w-full resize-none rounded-md border border-line-strong bg-raised px-2.5 py-2 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand"
          />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Alert level</span>
        {readOnly ? (
          <span className="text-base text-ink-2">{ALERT_LABEL[draft.severity]}</span>
        ) : (
          <SegmentedControl label="Alert level" value={draft.severity} options={ALERT_LEVELS.map((a) => ({ value: a, label: ALERT_LABEL[a] }))} onChange={(v) => update({ severity: v })} />
        )}
        <p className="m-0 text-sm text-ink-2">Groups failures on the Health page.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Turn it on</span>
        {!published ? (
          <p className="m-0 text-sm text-ink-2">Publish this automation to turn it on.</p>
        ) : archived ? (
          <p className="m-0 text-sm text-ink-2">Archived automations do not run.</p>
        ) : canEdit ? (
          <label className="flex items-center justify-between gap-3 text-base text-ink">
            <span>{wf.status === "ACTIVE" ? "On, running the published version" : "Paused"}</span>
            {/* A locked view can pause it, never turn it back on (the server refuses that; review round 2). */}
            <Switch
              checked={wf.status === "ACTIVE"}
              disabled={toggling || offline || (onLocked && wf.status !== "ACTIVE")}
              title={onLocked && wf.status !== "ACTIVE" ? AUTOMATION_TEAMMATE_COPY.creatorOnlyOn : undefined}
              onChange={(v) => void setActive(v)}
              aria-label="Turn the automation on"
            />
          </label>
        ) : (
          <p className="m-0 text-base text-ink-2">{wf.status === "ACTIVE" ? "On" : "Paused"}</p>
        )}
        {cappedNote ? <p className="m-0 text-sm text-ink-2">{cappedNote}</p> : null}
      </div>
      <dl className="m-0 flex flex-col">
        <div className="flex h-9 items-center justify-between text-sm">
          <dt className="text-ink-2">Published</dt>
          <dd className="m-0 text-ink" title={wf.publishedAt ? formatDate(wf.publishedAt, datePrefs, "datetime") : undefined}>{wf.publishedAt ? formatRelative(wf.publishedAt, datePrefs) : "Not published"}</dd>
        </div>
        <div className="flex h-9 items-center justify-between text-sm">
          <dt className="text-ink-2">Last run</dt>
          <dd className="m-0 text-ink" title={wf.lastRunAt ? formatDate(wf.lastRunAt, datePrefs, "datetime") : undefined}>{wf.lastRunAt ? formatRelative(wf.lastRunAt, datePrefs) : "Never"}</dd>
        </div>
        <div className="flex h-9 items-center justify-between text-sm">
          <dt className="text-ink-2">Versions</dt>
          <dd className="m-0 flex items-center gap-2 text-ink">
            {wf.versions.length === 0 ? (
              // Publishing makes the first version; until then there is no history to open.
              <span className="text-ink-2">None until you publish</span>
            ) : (
              <>
                {wf.versions.length} version{wf.versions.length === 1 ? "" : "s"}
                <button type="button" onClick={() => void openHistory()} className={BTN.link}>View history</button>
              </>
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col">
        <span className="mb-1 text-sm font-medium text-ink">Recent runs</span>
        {wf.runs.length === 0 ? (
          <p className="m-0 text-sm text-ink-2">No runs yet. They show here within seconds of the first real trigger.</p>
        ) : (
          wf.runs.map((r) => (
            <Link key={r.id} href={`/automation/logs?runId=${r.id}`} className="flex h-9 items-center gap-2 rounded-md px-1 text-sm hover:bg-hover" title={r.errorMessage ?? undefined}>
              <RunStatusDot status={r.status} />
              <span className="min-w-0 flex-1 truncate text-ink">{triggerByKey.get(r.triggerEventKey) ? `When ${triggerByKey.get(r.triggerEventKey)!.phrase}` : "A trigger that no longer exists"}</span>
              <span className="shrink-0 text-ink-2">{formatRelative(r.createdAt, datePrefs)}</span>
            </Link>
          ))
        )}
        <Link href={`/automation/logs?workflowId=${wf.id}`} className={cn("mt-1 text-sm", BTN.link)}>See all runs</Link>
      </div>
    </aside>
  );

  return (
    <>
      <Breadcrumb items={[{ label: "Automation", href: "/automation/workflows" }, { label: "Workflows", href: "/automation/workflows" }, { label: wf.name }]} />
      {header}
      {readOnly && !archived ? (
        <div className="px-6">
          <div className="os-chrome mb-2 flex h-11 items-center gap-2 rounded-lg bg-subtle px-3 text-row text-ink-2" role="status">
            {/* Edit rights are the creator's, a manager's or an Admin's, and no
                per-automation grant exists yet, so asking would reach someone
                with nothing to give. What every Member can do is copy it. */}
            <span className="min-w-0 truncate">
              {teammateLocked && canEdit
                ? `View only. Its AI teammate step works as ${wf.createdByName ?? "its creator"}, so only they can change it${wf.status === "ACTIVE" ? ". You can still pause it." : onLocked ? " or turn it back on." : "."}`
                : `View only. ${wf.createdByName ? `${wf.createdByName} made this one.` : ""} You can change the automations you make.`}
            </span>
            {canCreate ? (
              <button type="button" onClick={() => void duplicate()} className={cn("shrink-0", BTN.link)}>Duplicate it to make your own</button>
            ) : null}
          </div>
        </div>
      ) : onLocked && canEdit && !archived ? (
        <div className="px-6">
          <div className="os-chrome mb-2 flex min-h-11 items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-row text-ink-2" role="status">
            <span className="min-w-0">{AUTOMATION_TEAMMATE_COPY.creatorOnlyPublish(wf.createdByName ?? null)}</span>
          </div>
        </div>
      ) : null}
      {archived ? (
        <div className="px-6">
          <div className="os-chrome mb-2 flex h-11 items-center gap-2 rounded-lg bg-subtle px-3 text-row text-ink-2" role="status">
            <span>Archived. It does not run, and its run history is kept.</span>
            {wf.can.archive ? <button type="button" onClick={() => void unarchive()} className={BTN.link}>Bring it back</button> : null}
          </div>
        </div>
      ) : null}

      <div className="px-6 pb-16 pt-2">
        <div className="os-chrome flex flex-col gap-4 min-[1024px]:flex-row min-[1024px]:items-start">
          <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-4">
            <Section title="When" id="sec-when" error={problems?.when}>
              <div className="flex flex-wrap items-center gap-2">
                <Token
                  label={trigger ? trigger.name : draft.trigger ? "A trigger that no longer exists" : null}
                  placeholder="Choose what starts this"
                  ariaLabel="What starts this automation"
                  readOnly={readOnly}
                  sections={triggerSections}
                  selected={draft.trigger}
                  onSelect={(v) => update((d) => ({ ...d, trigger: v, when: {} }))}
                  width={320}
                  invalid={Boolean(problems?.when)}
                />
                {trigger && !trigger.isEmitting ? <NeutralChip title="This trigger does not fire yet">Not live yet</NeutralChip> : null}
              </div>
              {trigger ? <p className="m-0 mt-2 text-sm text-ink-2">{trigger.description}</p> : null}
              {trigger && !trigger.isEmitting ? <p className="m-0 mt-1 text-sm text-ink-2">This does not fire yet. The automation will start working when it does.</p> : null}
              {wf.liveTrigger && draft.trigger !== wf.liveTrigger && published ? (
                <p className="m-0 mt-1 text-sm text-warning-text">The live version still starts on &ldquo;{triggerByKey.get(wf.liveTrigger)?.name ?? "its old trigger"}&rdquo; until you republish.</p>
              ) : null}
              {whenOptions ? <div className="mt-3 flex flex-col gap-1">{whenOptions}</div> : null}
            </Section>

            <Section title="Only if" id="sec-if">
              {draft.conditions.length === 0 ? (
                <p className="m-0 text-sm text-ink-2">{readOnly ? "No conditions: it runs every time." : "No conditions: it runs every time. Add one to narrow it."}</p>
              ) : null}
              {draft.conditions.length > 1 ? (
                <div className="mb-2">
                  {readOnly ? <span className="text-sm text-ink-2">{draft.logic === "AND" ? "All of these" : "Any of these"}</span> : (
                    <SegmentedControl<"AND" | "OR"> label="Match" value={draft.logic} options={[{ value: "AND", label: "All of these" }, { value: "OR", label: "Any of these" }]} onChange={(v) => update({ logic: v })} />
                  )}
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                {draft.conditions.map((row) => {
                  if (row.opaque !== undefined) {
                    return (
                      <div key={row.id} className="flex flex-col gap-1">
                        <div className="flex h-9 items-center gap-2 rounded-md border border-dashed border-line-strong px-2.5 text-sm text-ink-2">
                          <span className="flex-1">A grouped condition, kept exactly as it was made. Remove it to use simple conditions here.</span>
                          {!readOnly ? <button type="button" aria-label="Remove condition" onClick={() => removeCond(row.id)} className={BTN.icon}><Trash2 className="size-4" /></button> : null}
                        </div>
                        <JsonBlock label="What it checks" value={row.opaque} />
                      </div>
                    );
                  }
                  const f = conditionFields.find((x) => x.key === row.field);
                  const ops = operatorsFor(f?.type);
                  const fieldOptions: PickerOption[] = conditionFields.filter((x) => !x.legacy || x.key === row.field).map((x) => ({ value: x.key, label: x.label }));
                  const condErr = problems?.conditions[row.id];
                  return (
                    <div key={row.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Token label={f?.label ?? (row.field || null)} placeholder="Pick a field" ariaLabel="Condition field" readOnly={readOnly} width={240}
                          sections={[{ options: fieldOptions }]} selected={row.field}
                          onSelect={(v) => { const nf = conditionFields.find((x) => x.key === v); const nops = operatorsFor(nf?.type); setCond(row.id, { field: v, operator: nops.includes(row.operator) ? row.operator : nops[0], value: "" }); }} />
                        <Token label={OPERATOR_LABEL.get(row.operator) ?? row.operator} placeholder="Pick how" ariaLabel="Condition operator" readOnly={readOnly} width={240}
                          sections={[{ options: ops.map((o) => ({ value: o, label: OPERATOR_LABEL.get(o) ?? o })) }]} selected={row.operator}
                          onSelect={(v) => setCond(row.id, { operator: v, value: valueKindFor(f?.type, v) === valueKindFor(f?.type, row.operator) ? row.value : "" })} />
                        {valueControl(row)}
                        {!readOnly ? <button type="button" aria-label="Remove condition" onClick={() => removeCond(row.id)} className={BTN.icon}><Trash2 className="size-4" /></button> : null}
                      </div>
                      {condErr ? <p className="m-0 text-sm text-danger-text" role="alert">{condErr}</p> : null}
                    </div>
                  );
                })}
              </div>
              {!readOnly ? (
                <button type="button" onClick={addCond} disabled={!trigger} title={trigger ? undefined : "Choose what starts this first"} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50">
                  <Plus className="size-4" aria-hidden /> Add condition
                </button>
              ) : null}
            </Section>

            <Section title="Then" id="sec-then" error={problems?.then}>
              <div className="flex flex-col gap-3">
                {draft.actions.map((row, index) => {
                  const action = row.key ? actionByKey.get(row.key) : undefined;
                  const err = problems?.actions[row.id];
                  return (
                    <div
                      key={row.id}
                      onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setDragIndex(index); } }}
                      onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) update((d) => ({ ...d, actions: moveItem(d.actions, dragFrom, index) })); setDragFrom(null); setDragIndex(null); }}
                      className={cn("rounded-md border bg-raised p-3", err ? "border-danger-solid" : "border-line", dragIndex === index && dragFrom !== null && dragFrom !== index && "border-brand")}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {!readOnly && draft.actions.length > 1 ? (
                          <span
                            draggable
                            onDragStart={(e) => { setDragFrom(index); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", row.id); }}
                            onDragEnd={() => { setDragFrom(null); setDragIndex(null); }}
                            role="button"
                            tabIndex={0}
                            aria-label={`Move step ${index + 1}. Arrow up or down to move it.`}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); update((d) => ({ ...d, actions: moveItem(d.actions, index, index - 1) })); }
                              if (e.key === "ArrowDown" && index < draft.actions.length - 1) { e.preventDefault(); update((d) => ({ ...d, actions: moveItem(d.actions, index, index + 1) })); }
                            }}
                            className="inline-flex size-7 cursor-grab items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
                          >
                            <GripVertical className="size-4" aria-hidden />
                          </span>
                        ) : null}
                        <span className="text-sm font-medium text-ink-2">{index === 0 ? "Then" : "and then"}</span>
                        <Token
                          label={action ? action.name : row.key ? "An action that no longer exists" : null}
                          placeholder="Choose what happens"
                          ariaLabel={`Step ${index + 1}: what happens`}
                          readOnly={readOnly}
                          sections={actionSections}
                          selected={row.key}
                          width={300}
                          onSelect={(v) => setAction(row.id, { key: v, params: {} })}
                          invalid={Boolean(err) && !row.key}
                        />
                        <span className="flex-1" />
                        {!readOnly ? <button type="button" aria-label={`Remove step ${index + 1}`} onClick={() => removeAction(row.id)} className={BTN.icon}><Trash2 className="size-4" /></button> : null}
                      </div>
                      {action ? (
                        <div className="mt-2 flex flex-col gap-1.5">
                          {action.requiresConnection === "WEBHOOK" ? (
                            <p className="m-0 text-sm text-ink-2">
                              Sends to the webhook an Owner or Admin connected.
                              {/* Connections are Owner and Admin only, so for
                                  anyone else the link would open a locked page. */}
                              {isAdmin && !readOnly ? <>{" "}<Link href="/automation/connections" className={BTN.link}>Set up a connection</Link></> : null}
                            </p>
                          ) : null}
                          {action.key === "add_comment" ? <p className="m-0 text-sm text-ink-2">Posted as {wf.createdByName ?? "the person who made this automation"}.</p> : null}
                          {action.key === TEAMMATE_STEP_KEY ? (
                            <p className="m-0 text-sm text-ink-2">
                              {wf.viewerIsCreator ? AUTOMATION_TEAMMATE_COPY.creatorOnlyPicker : AUTOMATION_TEAMMATE_COPY.creatorOnly} {AUTOMATION_TEAMMATE_COPY.answerHelp}
                            </p>
                          ) : null}
                          {action.params.filter((p) => p.key !== "itemId").map((p) => {
                            const help = paramHelp(action, p, row);
                            return (
                              <div key={p.key} className="flex flex-col gap-1">
                                <Row label={`${p.label}${p.required ? "" : " (optional)"}`}>{paramControl(action, p, row)}</Row>
                                {help && !readOnly ? <p className="m-0 ps-[132px] text-sm text-ink-3 max-[640px]:ps-0">{help}</p> : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {err ? <p className="m-0 mt-2 text-sm text-danger-text" role="alert">{err}</p> : null}
                    </div>
                  );
                })}
              </div>
              {!readOnly ? (
                <button type="button" onClick={addAction} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                  <Plus className="size-4" aria-hidden /> {draft.actions.length === 0 ? "Add an action" : "Add another action"}
                </button>
              ) : draft.actions.length === 0 ? <p className="m-0 text-sm text-ink-2">No actions yet.</p> : null}
            </Section>

            <Section title="Where it runs" id="sec-where" error={problems?.where}>
              {draft.trigger === "schedule.every" ? (
                // A schedule fires for the workspace, not for a task, so it
                // has no List to match: offering the choice would let someone
                // publish an automation that never runs.
                <p className="m-0 text-sm text-ink-2">On a schedule, it runs once for the whole workspace each time, not for a task, so it is not limited to Lists.</p>
              ) : (<>
              {readOnly ? (
                <p className="m-0 text-base text-ink">{everywhere ? "Everywhere" : "Only in chosen places"}</p>
              ) : (
                <SegmentedControl<"everywhere" | "lists">
                  label="Where it runs"
                  value={whereMode}
                  options={[{ value: "everywhere", label: "Everywhere" }, { value: "lists", label: "Only in chosen Lists" }]}
                  onChange={(v) => {
                    if (v === "everywhere") {
                      setListsMode(false);
                      update({ everywhere: true, scope: { listIds: [], folderIds: [], spaceIds: [] } });
                    } else {
                      setListsMode(true);
                      // With places this editor cannot open, "only in chosen" keeps them.
                      if (wf?.scopeHidden) update({ everywhere: false });
                    }
                  }}
                />
              )}
              {whereMode === "lists" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {draft.scope.spaceIds.map((sid) => (
                    <NeutralChip key={sid} className="h-8 px-2 text-sm">
                      Space: {places?.spaces.find((s) => s.id === sid)?.name ?? "one you can't open"}
                      {!readOnly ? <button type="button" aria-label="Remove this Space" onClick={() => update((d) => withScope(d, { ...d.scope, spaceIds: d.scope.spaceIds.filter((x) => x !== sid) }))} className="inline-flex size-5 items-center justify-center rounded hover:bg-hover"><X className="size-3.5" /></button> : null}
                    </NeutralChip>
                  ))}
                  {draft.scope.folderIds.map((fid) => (
                    <NeutralChip key={fid} className="h-8 px-2 text-sm">
                      Folder: {places?.folders.find((f) => f.id === fid)?.name ?? "one you can't open"}
                      {!readOnly ? <button type="button" aria-label="Remove this Folder" onClick={() => update((d) => withScope(d, { ...d.scope, folderIds: d.scope.folderIds.filter((x) => x !== fid) }))} className="inline-flex size-5 items-center justify-center rounded hover:bg-hover"><X className="size-3.5" /></button> : null}
                    </NeutralChip>
                  ))}
                  {draft.scope.listIds.map((lid) => (
                    <NeutralChip key={lid} className="h-8 px-2 text-sm">
                      {listLabel(lid) ?? "A List you can't open"}
                      {!readOnly ? <button type="button" aria-label="Remove this List" onClick={() => update((d) => withScope(d, { ...d.scope, listIds: d.scope.listIds.filter((x) => x !== lid) }))} className="inline-flex size-5 items-center justify-center rounded hover:bg-hover"><X className="size-3.5" /></button> : null}
                    </NeutralChip>
                  ))}
                  {!readOnly ? (
                    <Token label="Add Lists" placeholder="Add Lists" ariaLabel="Choose Lists" readOnly={false} multi width={300}
                      sections={[{ options: listOptions }]} selected={draft.scope.listIds}
                      onSelect={(v) => update((d) => withScope(d, { ...d.scope, listIds: d.scope.listIds.includes(v) ? d.scope.listIds.filter((x) => x !== v) : [...d.scope.listIds, v] }))} />
                  ) : null}
                </div>
              ) : null}
              {whereMode === "lists" && keptHidden && (wf.scopeKept?.cannotOpen ?? true) ? (
                <p className="m-0 mt-2 text-sm text-ink-2">
                  {shownEmpty
                    ? readOnly ? "It runs only in places you can't open." : "It runs only in places you can't open. They are kept."
                    : readOnly ? "It also runs in places you can't open." : "Some places you can't open are kept."}
                </p>
              ) : null}
              {whereMode === "lists" && keptHidden && wf.scopeKept?.gone ? (
                <p className="m-0 mt-2 text-sm text-ink-2">Some places it runs in are in Trash or were deleted, so it does not run there now.</p>
              ) : null}
              <p className="m-0 mt-2 text-sm text-ink-2">
                {everywhere && listsMode
                  ? "Pick at least one List. With none picked, it runs everywhere."
                  : everywhere
                    ? "It runs for every task in the workspace that matches."
                    : shownEmpty
                      ? "Events with no List, like a KPI reading, never run it."
                      : "It runs only for tasks in these places. Events with no List, like a KPI reading, never run it."}
              </p>
              </>)}
            </Section>
          </div>
          {details}
        </div>
      </div>

      <VersionHistory open={historyOpen} versions={versions} canRestore={canEdit && !archived && !teammateLocked} onClose={() => setHistoryOpen(false)} onRestore={(n) => void restore(n)} />
      <LeaveDialog open={leaveOpen} onDecide={decideLeave} />
    </>
  );
}
