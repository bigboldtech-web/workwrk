"use client";

// The Skills tab of a teammate's settings (docs/plans/ai-teammates-phase5.md
// step 3, Decisions 10 to 14 and 25): the jobs this person showed this
// teammate once, their own only (nobody else, an Owner included, ever sees
// them). Built from the Routines and Memory tabs' own parts (Decision 13):
// the intro line, the bordered row list, StatusChip, the ••• menu
// (MorePortal, MenuList, MenuItem), the inline form, useConfirm,
// SegmentedControl and the browser card's picture lightbox. No new kind of
// surface, and every button is secondary, ghost or danger: one blue button
// per page.
//
//   Teach a skill   (secondary, only with availability.canTeach) the inline
//                   form: What it does, Where it starts (the start sites);
//                   "Ask it to open the site" closes the drawer and sends the
//                   person's Teach message (teammate-store.ts sendShowMe)
//   a row           the name, its steps and sites, each host not allowed
//                   now, its last run, the day it will be deleted when its
//                   person or teammate is gone, and its chip (Draft, Ready,
//                   Recording); its menu: Run in chat and Practice run (a
//                   ready skill while skills may be used with this teammate,
//                   step 4: the person's run message in the chat, which the
//                   drawer closes onto, teammate-store.ts sendSkillRun),
//                   Make a routine (the same, step 5: the Routines tab's
//                   form with When only, POST /api/teammate-skills/[id]/
//                   routine; a reminder in the chat at its time, at most
//                   once a day, that runs nothing by itself),
//                   Review steps (a draft) or Edit steps (ready), Rename,
//                   Delete (asks first). A recording has no menu: Done or
//                   Discard in the browser card end it.
//   the editor      in the row: each step's number, its title (120), what it
//                   does, its picture while kept (the lightbox) or
//                   pictureGone, for a step that types or chooses "Ask me
//                   each time" or "Always the same" with the words to use,
//                   "Remove the page's words", "Start on the site's home
//                   page" on the start step, Delete step on every step but
//                   the start; a step the person does themselves says so
//                   once, in what it does.
//                   Save skill (a draft, which turns it ready) or Save
//                   changes, and Cancel. A skill changed in another tab is
//                   loaded again (changedElsewhere); a value the server
//                   refused says why under its step.
//
// Its address: ?skill=<id> opens that skill's editor (a Review link in the
// chat, teammate-thread.ts skillReviewHref). Every write names the workspace
// the tab was read in, and one switched in another tab reloads the page.
// Nothing typed here is ever put into the page but the person's own fields.

import { useEffect, useRef, useState } from "react";
import { CalendarClock, FlaskConical, MoreHorizontal, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SkeletonLines, SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { BROWSER_PANEL_COPY, ROUTINE_COPY, SKILL_ROUTINE_COPY, SKILL_VALUE_WORDS, SKILLS_COPY as S, TEAMMATE_CHAT, actionsFor } from "@/lib/agents/teammate-copy";
import { sendShowMe, sendSkillRun, skillSendBlocked } from "@/lib/agents/teammate-store";
import type { RoutineView, TeammateDetail } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR, type RunTone } from "@/lib/automation/run-status";
import { shotSrc } from "@/lib/browser/views";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import type { SkillStatus, SkillValue } from "@/lib/skills/types";
import type { SkillListView, SkillStepView, SkillView } from "@/lib/skills/views";
import { Picture as PictureLightbox } from "../browser-card";
import { RoutineForm, useViewerZone } from "./routines-tab";
import { useTeammateData } from "./use-teammate-data";

const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";
const GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60";
const GHOST_ICON = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60";
const LINK = "font-medium text-brand-deep hover:underline";
const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none";

/** The route's limits (src/lib/skills/types.ts SKILL_LIMITS), as the fields hold them. */
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;
const STEP_TITLE_MAX = 120;
const FIXED_TEXT_MAX = 2000;
const FIXED_OPTION_MAX = 80;

const CHIP: Record<SkillStatus, { label: string; tone: RunTone }> = {
  draft: { label: S.draft, tone: "neutral" },
  ready: { label: S.ready, tone: "success" },
  // The browser card's Recording chip (danger, Phase 5 step 3).
  recording: { label: S.recording, tone: "danger" },
};

/** One of the person's own skills, by its id (GET, PATCH and DELETE /api/teammate-skills/[id]). */
function skillUrl(id: string): string {
  return `/api/teammate-skills/${encodeURIComponent(id)}`;
}

/** GET /api/teammate-skills?agent=<slug>. */
interface SkillsList {
  skills: SkillListView[];
  availability: { offered: boolean; on: boolean; canTeach: boolean; reason: string | null };
  startSites: Array<{ site: string; address: string }>;
}

export function SkillsTab({ teammate: t, openSkill, onSent }: { teammate: TeammateDetail; openSkill: string | null; onSent: () => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const { data, error, reload, setData } = useTeammateData<SkillsList>(`/api/teammate-skills?agent=${encodeURIComponent(t.slug)}`, t.id);
  const [teaching, setTeaching] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Make a routine (step 5): the skill whose When form is open.
  const [routining, setRoutining] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: { current: HTMLElement | null } } | null>(null);
  const removed = t.status === "ARCHIVED";
  const viewerZone = useViewerZone();

  // ?skill=<id>: that skill's editor, once, when the list holds it (a Review link).
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!openSkill || opened.current === openSkill || !data) return;
    const s = data.skills.find((x) => x.id === openSkill);
    if (!s) return;
    const timer = setTimeout(() => {
      opened.current = openSkill;
      // A recording has no editor: Done or Discard in the browser card end it.
      if (s.status !== "recording") setEditing(openSkill);
    }, 0);
    return () => clearTimeout(timer);
  }, [openSkill, data]);

  /** A refusal's sentence; a session switched to another workspace reloads the page. */
  function refused(r: { error: string; code?: string }, fallback: string) {
    toast(r.error || fallback, { tone: "danger" });
    if (r.code === "workspace_changed") window.location.reload();
  }

  async function remove(s: SkillListView) {
    const ok = await confirm({ title: S.deleteTitle, description: S.deleteBody, confirmLabel: S.delete, destructive: true });
    if (!ok) return;
    const at = skillUrl(s.id);
    const r = await apiFetch<{ deleted: boolean }>(at, { method: "DELETE", json: { organizationId: s.organizationId } });
    if (!r.ok) {
      refused(r, S.deleteFailed);
      void reload();
      return;
    }
    setData((d) => (d ? { ...d, skills: d.skills.filter((x) => x.id !== s.id) } : d));
    toast(S.deleted);
  }

  async function rename(s: SkillListView, v: { name: string; description: string }): Promise<boolean> {
    const body: Record<string, unknown> = { version: s.version };
    if (v.name !== s.name) body.name = v.name;
    if (v.description !== s.description) body.description = v.description;
    if (!("name" in body) && !("description" in body)) {
      setRenaming(null);
      return true;
    }
    const at = skillUrl(s.id);
    const r = await apiFetch<SkillView>(at, { method: "PATCH", json: { ...body, organizationId: s.organizationId } });
    if (!r.ok) {
      refused(r, S.saveFailed);
      if (r.code === "skill_changed") void reload();
      return false;
    }
    setRenaming(null);
    toast(S.saved);
    void reload();
    return true;
  }

  /** Run in chat or Practice run (step 4): the person's run message in the chat, which the drawer closes onto. */
  /** Make a routine (step 5): a reminder of this skill at its time, in the chat; the Routines tab lists it. */
  async function makeRoutine(s: SkillListView, schedule: string): Promise<boolean> {
    const at = `${skillUrl(s.id)}/routine`;
    const r = await apiFetch<{ routine: RoutineView }>(at, { method: "POST", json: { organizationId: s.organizationId, schedule } });
    if (!r.ok) {
      refused(r, ROUTINE_COPY.saveFailed);
      return false;
    }
    setRoutining(null);
    toast(SKILL_ROUTINE_COPY.made(r.data.routine.when));
    return true;
  }

  /** Why a message could not be sent, truly (review of step 4): an answer still arriving, or the person's own chat not open here. */
  function notSent(): void {
    toast(skillSendBlocked(t.slug) === "busy" ? S.teachFailed : S.chatNotOpen, { tone: "danger" });
  }

  function run(s: SkillListView, practice: boolean): void {
    if (!sendSkillRun(t.slug, s.id, s.name, { practice })) {
      notSent();
      return;
    }
    onSent();
  }

  function teach(v: { name: string; site: string; address: string }): boolean {
    if (!sendShowMe(t.slug, v.name, v.site, v.address)) {
      notSent();
      return false;
    }
    setTeaching(false);
    // The drawer closes, and the chat shows the message and the teammate's answer.
    onSent();
    return true;
  }

  const skills = data?.skills ?? null;
  const open = menu ? skills?.find((s) => s.id === menu.id) ?? null : null;
  const avail = data?.availability ?? null;

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-ink-2">{S.intro}</p>
      {!removed && avail?.offered && avail.reason ? <p className="m-0 text-sm text-ink-3">{avail.reason}</p> : null}

      {!removed && avail?.canTeach && data ? (
        teaching ? (
          <TeachForm sites={data.startSites} onSend={teach} onCancel={() => setTeaching(false)} />
        ) : (
          <div>
            <button type="button" className={SECONDARY} onClick={() => setTeaching(true)}>
              <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {S.teach}
            </button>
          </div>
        )
      ) : null}

      {skills === null && error ? (
        <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
          {S.loadError} ·
          <button type="button" className={LINK} onClick={() => void reload()}>
            {TEAMMATE_CHAT.tryAgain}
          </button>
        </div>
      ) : skills === null ? (
        <SkeletonRows rows={3} />
      ) : skills.length === 0 ? (
        <div className="flex flex-col gap-1 py-2">
          <p className="m-0 text-base text-ink-2">{S.empty}</p>
          <p className="m-0 text-sm text-ink-3">{S.emptyHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col rounded-md border border-line">
          {skills.map((s) => (
            <li key={s.id} className="border-t border-line-soft px-3 py-2 first:border-t-0">
              {editing === s.id ? (
                <StepEditor
                  skill={s}
                  onDone={() => {
                    setEditing(null);
                    void reload();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : renaming === s.id ? (
                <RenameForm skill={s} onSave={(v) => rename(s, v)} onCancel={() => setRenaming(null)} />
              ) : routining === s.id ? (
                <RoutineForm viewerZone={viewerZone} fields="when" onSave={(v) => makeRoutine(s, v.schedule)} onCancel={() => setRoutining(null)} />
              ) : (
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 break-words text-base font-medium text-ink">{s.name}</p>
                    {s.description ? <p className="m-0 break-words text-sm text-ink-2">{s.description}</p> : null}
                    <p className="m-0 break-words text-sm text-ink-2">{S.stepsLine(s.stepCount, s.sites.join(", "))}</p>
                    {s.notAllowed.map((h) => (
                      <p key={h} className="m-0 break-words text-sm text-danger-text">{S.notAllowedNow(h)}</p>
                    ))}
                    {s.status === "ready" ? (
                      <p className="m-0 text-sm text-ink-3" title={s.lastRunAt ? formatDateTitle(s.lastRunAt, datePrefs) : undefined}>
                        {s.lastRunAt ? S.lastRun(formatDate(s.lastRunAt, datePrefs, "datetime")) : S.neverRun}
                      </p>
                    ) : null}
                    {s.deletesOn ? <p className="m-0 text-sm text-ink-2">{S.deletesOnLine(formatDate(s.deletesOn, datePrefs, "date"))}</p> : null}
                  </div>
                  <StatusChip color={RUN_TONE_COLOR[CHIP[s.status].tone]} label={CHIP[s.status].label} className="shrink-0" />
                  {s.status !== "recording" ? (
                    <button
                      type="button"
                      aria-label={actionsFor(s.name)}
                      title={actionsFor(s.name)}
                      aria-haspopup="menu"
                      aria-expanded={menu?.id === s.id}
                      onClick={(e) => setMenu(menu?.id === s.id ? null : { id: s.id, anchor: { current: e.currentTarget } })}
                      className={GHOST_ICON}
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {menu && open ? (
        <MorePortal anchorRef={menu.anchor} width={200} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={actionsFor(open.name)}>
            {/* Run in chat and Practice run (step 4): a ready skill, while skills may be used with this teammate. */}
            {open.status === "ready" && !removed && avail?.on ? (
              <>
                <MenuItem
                  icon={Play}
                  label={S.run}
                  onClick={() => {
                    setMenu(null);
                    run(open, false);
                  }}
                />
                <MenuItem
                  icon={FlaskConical}
                  label={S.practice}
                  onClick={() => {
                    setMenu(null);
                    run(open, true);
                  }}
                />
                {/* Make a routine (step 5): a reminder that starts with the person, never a run by itself. */}
                <MenuItem
                  icon={CalendarClock}
                  label={S.makeRoutine}
                  onClick={() => {
                    setMenu(null);
                    setEditing(null);
                    setRenaming(null);
                    setRoutining(open.id);
                  }}
                />
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem
              icon={Pencil}
              label={open.status === "draft" ? S.review : S.edit}
              onClick={() => {
                setMenu(null);
                setRenaming(null);
                setRoutining(null);
                setEditing(open.id);
              }}
            />
            <MenuItem
              icon={Pencil}
              label={S.rename}
              onClick={() => {
                setMenu(null);
                setEditing(null);
                setRoutining(null);
                setRenaming(open.id);
              }}
            />
            <MenuSeparator />
            <MenuItem
              icon={Trash2}
              label={S.delete}
              destructive
              onClick={() => {
                setMenu(null);
                void remove(open);
              }}
            />
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}

/** Teach a skill: What it does and Where it starts, then the person's message asking the teammate to open the site. */
function TeachForm({ sites, onSend, onCancel }: { sites: SkillsList["startSites"]; onSend: (v: { name: string; site: string; address: string }) => boolean; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [site, setSite] = useState(sites[0]?.site ?? "");
  const chosen = sites.find((x) => x.site === site) ?? null;
  const ready = name.trim().length > 0 && chosen !== null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-subtle p-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {S.teachWhat}
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} placeholder={S.teachWhatPlaceholder} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {S.teachWhere}
        <select value={site} onChange={(e) => setSite(e.target.value)} className={INPUT}>
          {sites.map((x) => (
            <option key={x.site} value={x.site}>
              {x.site}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={GHOST} onClick={onCancel}>
          {S.cancel}
        </button>
        <button type="button" className={SECONDARY} disabled={!ready} onClick={() => chosen && onSend({ name: name.replace(/\s+/g, " ").trim(), site: chosen.site, address: chosen.address })}>
          {S.teachSend}
        </button>
      </div>
    </div>
  );
}

/** Rename: the skill's name and what it is for. */
function RenameForm({ skill, onSave, onCancel }: { skill: SkillListView; onSave: (v: { name: string; description: string }) => Promise<boolean>; onCancel: () => void }) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0;
  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    await onSave({ name: name.replace(/\s+/g, " ").trim(), description: description.replace(/\s+/g, " ").trim() });
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-subtle p-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {S.nameLabel}
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {S.descriptionLabel}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          placeholder={S.descriptionPlaceholder}
          className="block w-full resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={GHOST} disabled={busy} onClick={onCancel}>
          {S.cancel}
        </button>
        <button type="button" className={SECONDARY} disabled={busy || !ready} onClick={() => void save()}>
          {S.saveChanges}
        </button>
      </div>
    </div>
  );
}

/** One step as the editor holds it while the person reviews. */
interface EditStep {
  view: SkillStepView;
  title: string;
  /** The person changed its title. */
  titled: boolean;
  mode: "ask" | "fixed";
  fixed: string;
  /** Its page's words are to be removed (forgetName). */
  forget: boolean;
}

function editStepOf(v: SkillStepView): EditStep {
  const fixed = v.value && "fixed" in v.value ? v.value.fixed : "";
  return { view: v, title: v.title, titled: false, mode: v.value && "fixed" in v.value ? "fixed" : "ask", fixed, forget: false };
}

function sameValue(a: SkillValue | null, b: SkillValue): boolean {
  if (!a) return false;
  return "fixed" in a ? "fixed" in b && a.fixed === b.fixed : "ask" in b;
}

/** Whether a start address is already its site's home (origin and "/"). */
function atHome(address: string | null): boolean {
  if (!address) return true;
  try {
    const u = new URL(address);
    return u.pathname === "/" && !u.search && !u.hash;
  } catch {
    return true;
  }
}

/** A start address's site home, as startHome will keep it. */
function homeOf(address: string): string {
  try {
    return `${new URL(address).origin}/`;
  } catch {
    return address;
  }
}

/**
 * The step editor (Decision 11), in the row as the Routines tab's form sits
 * in its row. Only what a review may change is sent: each kept step's id in
 * its stored order, its title when changed, its value, forgetName, and
 * startHome; the server rebuilds every other field from the stored step.
 */
function StepEditor({ skill, onDone, onCancel }: { skill: SkillListView; onDone: () => void; onCancel: () => void }) {
  const { toast } = useOsToast();
  const [view, setView] = useState<SkillView | null>(null);
  const [failed, setFailed] = useState(false);
  const [steps, setSteps] = useState<EditStep[]>([]);
  const [startHome, setStartHome] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);

  const url = skillUrl(skill.id);
  async function load() {
    const r = await apiFetch<SkillView>(url, { cache: "no-store" });
    if (!r.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setView(r.data);
    setSteps(r.data.steps.map(editStepOf));
    setStartHome(false);
    setProblems({});
  }
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
    // Read once when the editor opens; a skill changed elsewhere is read again by its 409.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  function change(id: string, patch: Partial<EditStep>) {
    setSteps((list) => list.map((s) => (s.view.id === id ? { ...s, ...patch } : s)));
    setProblems((p) => {
      if (!(id in p)) return p;
      const next = { ...p };
      delete next[id];
      return next;
    });
  }

  async function save() {
    if (!view || busy) return;
    // What each step types or chooses, checked here first as the server checks it.
    const local: Record<string, string> = {};
    for (const s of steps) if (s.mode === "fixed" && !s.fixed.trim() && (s.view.kind === "type" || s.view.kind === "choose")) local[s.view.id] = SKILL_VALUE_WORDS.empty;
    if (Object.keys(local).length > 0) {
      setProblems(local);
      return;
    }
    const body = {
      version: view.version,
      steps: steps.map((s) => {
        const value: SkillValue | null = s.view.kind === "type" || s.view.kind === "choose" ? (s.mode === "fixed" ? { fixed: s.fixed } : { ask: true }) : null;
        return {
          id: s.view.id,
          ...(s.titled && s.title.trim() !== s.view.title ? { title: s.title.trim() } : {}),
          ...(value && !sameValue(s.view.value, value) ? { value } : {}),
          ...(s.forget ? { forgetName: true as const } : {}),
        };
      }),
      ...(startHome ? { startHome: true as const } : {}),
      ...(view.status === "draft" ? { ready: true as const } : {}),
    };
    setBusy(true);
    const r = await apiFetch<SkillView>(url, { method: "PATCH", json: { ...body, organizationId: view.organizationId } });
    setBusy(false);
    if (!r.ok) {
      const issues = (r.issues ?? {}) as { stepId?: unknown; problem?: unknown };
      const stepId = typeof issues.stepId === "string" ? issues.stepId : null;
      if (r.code === "workspace_changed") {
        toast(r.error, { tone: "danger" });
        window.location.reload();
        return;
      }
      if (r.code === "skill_changed") {
        toast(S.changedElsewhere, { tone: "danger" });
        await load();
        return;
      }
      if ((r.code === "bad_value" || r.code === "bad_title") && stepId) {
        const problem = typeof issues.problem === "string" && Object.prototype.hasOwnProperty.call(SKILL_VALUE_WORDS, issues.problem) ? SKILL_VALUE_WORDS[issues.problem as keyof typeof SKILL_VALUE_WORDS] : r.error;
        setProblems({ [stepId]: r.code === "bad_value" ? problem : r.error });
        return;
      }
      toast(r.error || S.saveFailed, { tone: "danger" });
      return;
    }
    toast(S.saved);
    onDone();
  }

  if (failed && !view) {
    return (
      <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
        {S.loadError} ·
        <button type="button" className={LINK} onClick={() => void load()}>
          {TEAMMATE_CHAT.tryAgain}
        </button>
      </div>
    );
  }
  if (!view) return <SkeletonLines lines={4} />;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-subtle p-3">
      <p className="m-0 break-words text-base font-medium text-ink">{view.name}</p>
      <p className="m-0 text-sm text-ink-2">{S.reviewHint}</p>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((s, i) => {
          const n = i + 1;
          const v = s.view;
          const src = v.shot ? shotSrc(v.shot.id) : null;
          const choosing = v.kind === "choose";
          return (
            <li key={v.id} className="flex flex-col gap-1.5 rounded-md border border-line bg-raised p-2">
              <div className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-end text-sm tabular-nums text-ink-2">{n}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    value={s.title}
                    onChange={(e) => change(v.id, { title: e.target.value, titled: true })}
                    maxLength={STEP_TITLE_MAX}
                    aria-label={S.stepLabel(n)}
                    className={INPUT}
                  />
                  {/* What it does, once: a step the person does themselves says so here (FACTS.yourself), never twice (review of step 3). */}
                  <p className="m-0 break-words text-sm text-ink-2">{v.kind === "start" && startHome && v.address ? S.FACTS.start(homeOf(v.address)) : v.facts}</p>
                  {s.forget ? <p className="m-0 text-sm text-ink-2">{S.forgotName}</p> : null}
                </div>
                {src ? (
                  <button type="button" className="shrink-0 rounded-md" aria-label={BROWSER_PANEL_COPY.openPicture} onClick={() => setPicture(v.shot?.id ?? null)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" loading="lazy" className="h-10 w-auto max-w-[96px] rounded border border-line object-cover" />
                  </button>
                ) : null}
                {v.kind !== "start" ? (
                  <button
                    type="button"
                    className={GHOST_ICON}
                    aria-label={S.deleteStep}
                    title={S.deleteStep}
                    onClick={() => setSteps((list) => list.filter((x) => x.view.id !== v.id))}
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                  </button>
                ) : null}
              </div>
              {!src && v.pictureGone ? <p className="m-0 ps-7 text-sm text-ink-3">{BROWSER_PANEL_COPY.pictureGone}</p> : null}
              {v.kind === "type" || v.kind === "choose" ? (
                <div className="flex flex-col gap-1 ps-7">
                  <SegmentedControl<"ask" | "fixed">
                    label={S.valueLabel(n)}
                    value={s.mode}
                    options={[
                      { value: "ask", label: S.askEachTime },
                      { value: "fixed", label: S.alwaysSame },
                    ]}
                    onChange={(mode) => change(v.id, { mode })}
                    size="sm"
                  />
                  {s.mode === "fixed" ? (
                    <>
                      <input
                        value={s.fixed}
                        onChange={(e) => change(v.id, { fixed: e.target.value })}
                        maxLength={choosing ? FIXED_OPTION_MAX : FIXED_TEXT_MAX}
                        placeholder={choosing ? S.fixedChoicePlaceholder : S.fixedPlaceholder}
                        aria-label={S.valueLabel(n)}
                        autoComplete="off"
                        className={INPUT}
                      />
                      <p className="m-0 text-sm text-ink-3">{S.fixedHint}</p>
                    </>
                  ) : null}
                </div>
              ) : null}
              {(v.hasName && !s.forget) || (v.kind === "start" && !startHome && !atHome(v.address)) ? (
                <div className="flex flex-wrap gap-2 ps-7">
                  {v.hasName && !s.forget ? (
                    <button type="button" className={GHOST} onClick={() => change(v.id, { forget: true, title: s.titled ? s.title : (v.plainTitle ?? s.title) })}>
                      {S.forgetName}
                    </button>
                  ) : null}
                  {v.kind === "start" && !startHome && !atHome(v.address) ? (
                    <button type="button" className={GHOST} onClick={() => setStartHome(true)}>
                      {S.startHome}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {problems[v.id] ? (
                <p role="alert" className="m-0 ps-7 text-sm text-danger-text">
                  {problems[v.id]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex justify-end gap-2">
        <button type="button" className={GHOST} disabled={busy} onClick={onCancel}>
          {S.cancel}
        </button>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => void save()}>
          {view.status === "draft" ? S.saveSkill : S.saveChanges}
        </button>
      </div>
      <PictureLightbox id={picture} onClose={() => setPicture(null)} />
    </div>
  );
}
