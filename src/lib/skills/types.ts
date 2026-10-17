// Learning by showing (docs/plans/ai-teammates-phase5.md): the words every
// part of src/lib/skills shares. A skill is one person's, for one teammate,
// in one workspace (Decision 10): a job they showed it once in its browser,
// reviewed, and followed as a guide, never a replay (Decision 15).
//
// WHAT A STEP KEEPS (Decision 7): a control's role, kind, input type and form
// host, the words on a button or link outside a list (kept only when they
// hold no email, phone number or run of 4 or more digits), the label of a
// field or list, the host and first path part it was on, and, only where the
// person typed one at review, the words to type each time. Never anything
// typed or chosen while recording, a field's value, an option's or a row's
// words, a link's address, or any other text of a page.
//
// The lists below are the ones prisma/sql/2026-10-17-ai-teammates-phase5.sql
// holds its CHECK to (types.test.ts reads the file), so a word the code
// writes is a word the database takes.
//
// Pure: types and constants only, safe on the client.

import type { ClickWarning, FieldHints } from "@/lib/browser/classes";
import type { FieldKind } from "@/lib/browser/types";

export type { FieldHints };

export type SkillStatus = "recording" | "draft" | "ready";

export const SKILL_STATUSES: readonly SkillStatus[] = ["recording", "draft", "ready"];

/** Why a recording ended (TeammateSkill.recordingEndReason). */
export type RecordingEnd = "done" | "time" | "ended" | "turned_off" | "skills_off";

export const RECORDING_ENDS: readonly RecordingEnd[] = ["done", "time", "ended", "turned_off", "skills_off"];

/** Why a step is the person's to do themselves each time (Decision 7's fold). */
export type YourselfReason = "sign_in" | "code" | "payment" | "frame";

export const YOURSELF_REASONS: readonly YourselfReason[] = ["sign_in", "code", "payment", "frame"];

/** What a step that types or chooses does on a run: asks each time (the default), or always the same words the person typed at review. */
export type SkillValue = { ask: true } | { fixed: string };

/** How a choice is made on a run: a native list (select_option or a fill card), a click on an option (its own card), or opening an item of a list. */
export type ChooseVia = "list" | "click" | "suggestion" | "item";

export const CHOOSE_VIAS: readonly ChooseVia[] = ["list", "click", "suggestion", "item"];

interface StepBase {
  /** "s1", "s2" and on, in recorded order, never reused in a skill. */
  id: string;
  title: string;
  /** The host the step was on. */
  site: string;
  /** Its host and first path part, any part that looks like an id or a token as "*" (steps.ts stepPage). */
  page: string;
  /** The picture of its page while it is kept (24 hours, Phase 4's sealed files), else null. */
  shotId: string | null;
}

export type SkillStep =
  | (StepBase & { kind: "start"; address: string })
  | (StepBase & { kind: "link"; name: string })
  | (StepBase & { kind: "click"; role: string; name: string; tag: string; type: string | null; formHost: string | null; warnings: ClickWarning[] })
  | (StepBase & { kind: "type"; name: string; fieldKind: FieldKind; pressEnter: boolean; value: SkillValue })
  | (StepBase & { kind: "choose"; via: ChooseVia; name: string; value: SkillValue })
  | (StepBase & { kind: "yourself"; reason: YourselfReason })
  /** Something the person did may be missing here (a back/forward cache restore, or a page whose recorder could not be read; Decision 7). Shown at review, never sent to the model as a step to do. */
  | (StepBase & { kind: "gap" });

export type SkillStepKind = SkillStep["kind"];

export const SKILL_STEP_KINDS: readonly SkillStepKind[] = ["start", "link", "click", "type", "choose", "yourself", "gap"];

/** The caps and windows of learning by showing (Decision 3), every plan. */
export const SKILL_LIMITS = {
  perTeammate: 20,
  perPerson: 50,
  recordedStepsMax: 100,
  stepsMax: 50,
  nameMax: 80,
  descriptionMax: 500,
  stepTitleMax: 120,
  fixedTextMax: 2000,
  fixedOptionMax: 80,
  recordingsPerDay: 10,
  fillFieldsMax: 10,
  minMinutesToRecord: 3,
  pollMs: 700,
  eventsMax: 400,
  formFieldsMax: 40,
  suggestionMs: 10_000,
  orphanDays: 30,
  /** The most hosts a skill lists (TeammateSkill.sites, the CHECK's cardinality; Phase 5 step 1). */
  sitesMax: 20,
} as const;

/** One input the recorder saw (page-recorder.ts): the person's own (Decision 7), never a value. Everything here is read to build steps and dropped; only SkillStep is kept. */
export interface RecordedEvent {
  type: "click" | "input" | "change" | "enter" | "frame_focus" | "gap";
  control: RecordedControl | null;
  at: number;
  /** The address of the page it happened on, read to name the step's site and page, never kept whole. */
  page: string;
}

export interface RecordedControl {
  tag: string;
  role: string;
  /**
   * Its visible name by the reader's own rules (page-reader.ts nameOf: for a
   * field, its labels' visible words, which never hold a list's options or
   * typed text). Read here only to class it (an action word, Decision 7's
   * rule 1) and to name it where a rule keeps words; a choice, a list item,
   * a suggestion and an opener never keep it (steps.ts stepsFromRecording).
   */
  name: string;
  type: string | null;
  formHost: string | null;
  /** Its form's index in the document, or null when it has no form element. */
  formKey: number | null;
  /** The label of its group, list, combobox or field (legend, group, listbox or combobox label, aria-labelledby, a field's label). */
  group: string | null;
  /** It is a choice: a radio, an option, a menu choice, a tree item, a grid cell, a grouped checkbox or switch, or inside a listbox, menu, grid, tree, date picker or combobox popup. */
  choice: boolean;
  /** It opens a popup (a combobox, aria-haspopup). */
  opener: boolean;
  /** It is inside a table row of data, a list item that is not navigation, or a grid row: that list's label, "" when it has none, else null. */
  inRow: string | null;
  /** It is inside navigation (nav, role navigation), a menu bar or a tab list. */
  inNav: boolean;
  /** It came into the page within suggestionMs after the person's counted typing, in a form or not. */
  suggestion: boolean;
  /** Its words, its value or its labels changed within suggestionMs after the person's counted typing (a button that echoes it). */
  wordsChanged: boolean;
  /** A link's address, read to class it (actingAddress) and dropped, never kept. */
  href: string | null;
  /**
   * The reader's hints, as a read gives them (kindOfElement): its `label` is
   * the reader's label hint, every word of the field's labels whether seen
   * or not (a wrapped select's options, a wrapped textarea's text). Read only
   * to class the field (fieldKindOf) and to fold, never kept and never a
   * step's name (review of Phase 5 step 1): a step is named by `name` and
   * `group`, the words a person sees.
   */
  hints: FieldHints;
  /** The hints of every field in its form, or on the page when it has none, at most formFieldsMax: read to fold a sign-in or payment, never kept. */
  formFields: FieldHints[];
}
