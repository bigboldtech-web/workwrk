"use client";

// The new teammate dialog (docs/plans/ai-teammates.md 5.5, 5.6), 640 wide,
// in two steps:
//
//   1. Templates: the six cards (the avatar in its hue, the name, the job)
//      and Start from scratch. A card fills the form; nothing is made yet.
//   2. The form: Name, Colour (eight swatches), One job, Instructions, Tools
//      (tool-picker.tsx: what it may use and what it asks first), and, for
//      the Owner and Admins only, Who can use it ("Just me" / "Everyone in
//      the workspace"). Footer: Back, Cancel and Create teammate, the
//      dialog's one primary.
//
// A template's tool this workspace cannot give now (Talk or Tables off) was
// left out of its card by the route; the form says so above the tools. A
// Google tool has a row only while its product is on here, saying what stands
// between it and the person's own Google (for one made for everyone, their
// allow); its link opens their Connections card in another tab, so nothing
// typed here is lost (docs/plans/ai-teammates-phase3.md step 5). The allow
// itself has no link: the card lists only teammates that exist, so the line
// says to allow it there once this one is made, and a Google tool whose
// product was turned off while the form was open is not sent (review of
// step 5). The
// checks are teammate-setup.ts draftProblems (the route's own limits), the
// request newTeammateBody. A refusal shows the server's sentence (the plan's
// limit names the plan); anything else, "Couldn't create the teammate. Try
// again." Made, it hands the new teammate to `onCreated`, which opens its
// chat.
//
// Closing, or picking another card, with something typed asks first. Esc
// goes through the shell's LayerStack, so an open Picker closes before the
// dialog does.

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { OsShellContext, useLayer } from "@/components/layout/os/shell-context";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/dialog-provider";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import type { TeammateVisibility } from "@/lib/agents/teammate-access";
import { NEW_TEAMMATE_DIALOG } from "@/lib/agents/teammate-copy";
import {
  TEAMMATE_FIELD_MAX,
  draftChanged,
  draftFromTemplate,
  draftProblems,
  draftToolGroups,
  moduleNote,
  newTeammateBody,
  type DraftField,
  type TeammateDraft,
} from "@/lib/agents/teammate-setup";
import type { TeammateListData } from "@/lib/agents/teammate-store";
import { NO_GOOGLE_ROWS, type TeammateRow } from "@/lib/agents/teammate-views";
import { NO_PRODUCTS } from "@/lib/connectors/products";
import type { TemplateCard } from "@/lib/agents/templates";
import { cn } from "@/lib/utils";
import { HuePicker } from "./hue-picker";
import { TeammateAvatar } from "./teammate-avatar";
import { ToolPicker } from "./tool-picker";

const PRIMARY = "inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4";
const GHOST = "inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink";
const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none";

export function NewTeammateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** GET /api/agents/teammates: the templates, the modules, and whether this person may make one for everyone. Null while it loads. */
  list: TeammateListData | null;
  onCreated: (teammate: TeammateRow) => void;
}) {
  // Mounted only while open, so every open starts at the templates.
  if (!props.open) return null;
  return <NewTeammateFlow {...props} />;
}

function NewTeammateFlow({
  onOpenChange,
  list,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  list: TeammateListData | null;
  onCreated: (teammate: TeammateRow) => void;
}) {
  const confirm = useConfirm();
  const shell = useContext(OsShellContext);
  const modules = { talkOn: list?.talkOn ?? true, tablesOn: list?.tablesOn ?? true };
  // The Google rows (Phase 3 step 5): only for the products on here, as the
  // list read them for this person. None until the list answers, and none
  // from an older server.
  const googleRows = { connectors: list?.connectors ?? NO_PRODUCTS, google: list?.google ?? NO_GOOGLE_ROWS };
  const canCreateWorkspace = list?.canCreateWorkspace === true;
  const cards = list?.templates ?? [];

  const [step, setStep] = useState<"templates" | "form">("templates");
  // What the form started from (a card, or scratch), to know what closing loses.
  const [start, setStart] = useState<{ card: TemplateCard | null; draft: TeammateDraft } | null>(null);
  const [draft, setDraft] = useState<TeammateDraft | null>(null);
  const [problems, setProblems] = useState<Partial<Record<DraftField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<HTMLInputElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);

  const dirty = Boolean(start && draft && draftChanged(start.draft, draft));

  async function discardOk(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({
      title: NEW_TEAMMATE_DIALOG.discardTitle,
      description: NEW_TEAMMATE_DIALOG.discardBody,
      confirmLabel: NEW_TEAMMATE_DIALOG.discard,
      destructive: true,
    });
  }

  async function tryClose() {
    if (saving) return;
    if (await discardOk()) onOpenChange(false);
  }

  // A shell layer while open: Esc closes an open Picker first, then this
  // (asking first when something was typed), never while it saves.
  const closeRef = useRef(tryClose);
  const savingRef = useRef(saving);
  useEffect(() => {
    closeRef.current = tryClose;
    savingRef.current = saving;
  });
  useLayer(true, { kind: "dialog", close: () => void closeRef.current(), canClose: () => !savingRef.current });

  async function choose(card: TemplateCard | null) {
    // Back, then the same card again, keeps what was typed.
    if (draft && start && start.card?.key === card?.key) {
      setStep("form");
      return;
    }
    if (!(await discardOk())) return;
    const next = draftFromTemplate(card, modules);
    setStart({ card, draft: next });
    setDraft(next);
    setProblems({});
    setError(null);
    setStep("form");
  }

  useEffect(() => {
    if (step === "form") requestAnimationFrame(() => nameRef.current?.focus());
  }, [step]);

  function patch(p: Partial<TeammateDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setError(null);
    // A field's problem clears as it is fixed.
    setProblems((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(p)) delete next[k as DraftField];
      return next;
    });
  }

  async function create() {
    if (!draft || saving) return;
    const found = draftProblems(draft);
    setProblems(found);
    const first = found.name ? nameRef.current : found.job ? jobRef.current : found.instructions ? instructionsRef.current : null;
    if (first) {
      first.focus();
      return;
    }
    setSaving(true);
    setError(null);
    const r = await apiFetch<{ teammate: TeammateRow }>("/api/agents/teammates", {
      method: "POST",
      json: newTeammateBody(draft, { canCreateWorkspace, ...modules, connectors: googleRows.connectors }),
    });
    setSaving(false);
    if (!r.ok) {
      // The route words its refusals (the plan's limit, Owner or Admin only).
      setError(r.code ? r.error : NEW_TEAMMATE_DIALOG.createFailed);
      return;
    }
    onCreated(r.data.teammate);
  }

  // What the chosen template left out, once per reason.
  const leftOut = [...new Set((start?.card?.dropped ?? []).map((d) => d.why))].map((why) => (why === "excluded" ? NEW_TEAMMATE_DIALOG.toolsExcluded : moduleNote(why)));

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : void tryClose())}>
      <DialogContent
        className="os-chrome flex max-h-[85vh] max-w-[640px] flex-col gap-0 overflow-hidden border-line bg-raised p-0 text-ink"
        onEscapeKeyDown={(e) => {
          if (!shell) return;
          e.preventDefault();
          shell.closeTopLayer();
        }}
      >
        <div className="flex shrink-0 flex-col gap-1 px-5 pb-3 pt-5 pe-12">
          <DialogTitle className="text-lg font-semibold text-ink">{NEW_TEAMMATE_DIALOG.title}</DialogTitle>
          <DialogDescription className="m-0 text-sm text-ink-2">{NEW_TEAMMATE_DIALOG.intro}</DialogDescription>
        </div>

        {step === "templates" || !draft ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">
              {list === null ? <SkeletonRows rows={3} rowHeight="72px" className="mb-2" /> : null}
              <ul aria-label={NEW_TEAMMATE_DIALOG.templatesLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {cards.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => void choose(c)}
                      className="flex h-full w-full min-w-0 items-start gap-3 rounded-lg border border-line bg-raised p-3 text-start hover:bg-hover"
                    >
                      <TeammateAvatar name={c.persona} hue={c.hue} avatar={c.avatar} size="lg" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-row font-medium text-ink">{c.name}</span>
                        <span className="mt-0.5 text-sm text-ink-2">{c.job}</span>
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => void choose(null)}
                    className="flex h-full w-full min-w-0 items-start gap-3 rounded-lg border border-dashed border-line-strong bg-raised p-3 text-start hover:bg-hover"
                  >
                    <EntityTile size="lg" icon={Plus} {...NEUTRAL_TILE} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-row font-medium text-ink">{NEW_TEAMMATE_DIALOG.scratch}</span>
                      <span className="mt-0.5 text-sm text-ink-2">{NEW_TEAMMATE_DIALOG.scratchHint}</span>
                    </span>
                  </button>
                </li>
              </ul>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
              <button type="button" className={GHOST} onClick={() => void tryClose()}>
                {NEW_TEAMMATE_DIALOG.cancel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">
              <div className="flex flex-col gap-4">
                <Field label={NEW_TEAMMATE_DIALOG.name} problem={problems.name} htmlFor="new-teammate-name">
                  <input
                    id="new-teammate-name"
                    ref={nameRef}
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    maxLength={TEAMMATE_FIELD_MAX.name}
                    placeholder={NEW_TEAMMATE_DIALOG.namePlaceholder}
                    aria-invalid={problems.name ? true : undefined}
                    className={INPUT}
                  />
                </Field>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink">{NEW_TEAMMATE_DIALOG.colour}</span>
                  <HuePicker value={draft.hue} onChange={(hue) => patch({ hue })} label={NEW_TEAMMATE_DIALOG.colour} />
                </div>

                <Field label={NEW_TEAMMATE_DIALOG.job} problem={problems.job} htmlFor="new-teammate-job">
                  <input
                    id="new-teammate-job"
                    ref={jobRef}
                    value={draft.job}
                    onChange={(e) => patch({ job: e.target.value })}
                    maxLength={TEAMMATE_FIELD_MAX.job}
                    placeholder={NEW_TEAMMATE_DIALOG.jobPlaceholder}
                    aria-invalid={problems.job ? true : undefined}
                    className={INPUT}
                  />
                </Field>

                <Field label={NEW_TEAMMATE_DIALOG.instructions} helper={NEW_TEAMMATE_DIALOG.instructionsHelper} problem={problems.instructions} htmlFor="new-teammate-instructions">
                  <textarea
                    id="new-teammate-instructions"
                    ref={instructionsRef}
                    value={draft.instructions}
                    onChange={(e) => patch({ instructions: e.target.value })}
                    maxLength={TEAMMATE_FIELD_MAX.instructions}
                    rows={6}
                    aria-invalid={problems.instructions ? true : undefined}
                    className="block w-full resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink focus:border-brand focus:outline-none"
                  />
                </Field>

                <section aria-label={NEW_TEAMMATE_DIALOG.tools} className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink">{NEW_TEAMMATE_DIALOG.tools}</span>
                  <span className="text-sm text-ink-2">{NEW_TEAMMATE_DIALOG.toolsHelper}</span>
                  {leftOut.map((line) => (
                    <span key={line} className="text-sm text-ink-2">
                      {line}
                    </span>
                  ))}
                  <div className="mt-1">
                    <ToolPicker
                      groups={draftToolGroups(draft, { ...modules, ...googleRows })}
                      canTick
                      busy={saving}
                      // What is typed here is not saved yet: a Google row's link opens its card in another tab.
                      linksInNewTab
                      onTick={(name, on) => patch({ tools: on ? [...draft.tools.filter((t) => t !== name), name] : draft.tools.filter((t) => t !== name) })}
                      onChoice={(name, value) => patch({ choices: { ...draft.choices, [name]: value } })}
                    />
                  </div>
                </section>

                {canCreateWorkspace ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink">{NEW_TEAMMATE_DIALOG.whoCanUse}</span>
                    <SegmentedControl<TeammateVisibility>
                      label={NEW_TEAMMATE_DIALOG.whoCanUse}
                      value={draft.visibility}
                      options={[
                        { value: "PRIVATE", label: NEW_TEAMMATE_DIALOG.justMe },
                        { value: "WORKSPACE", label: NEW_TEAMMATE_DIALOG.everyone },
                      ]}
                      onChange={(visibility) => patch({ visibility })}
                    />
                    <span className="text-sm text-ink-2">{NEW_TEAMMATE_DIALOG.everyoneHelper}</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 py-3">
              {error ? (
                <p role="alert" className="m-0 text-sm text-danger-text">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={cn(GHOST, "-ms-3")} disabled={saving} onClick={() => setStep("templates")}>
                  {NEW_TEAMMATE_DIALOG.back}
                </button>
                <span className="min-w-0 flex-1" />
                <button type="button" className={GHOST} disabled={saving} onClick={() => void tryClose()}>
                  {NEW_TEAMMATE_DIALOG.cancel}
                </button>
                <button type="button" className={PRIMARY} disabled={saving} onClick={() => void create()}>
                  {NEW_TEAMMATE_DIALOG.create}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  helper,
  problem,
  htmlFor,
  children,
}: {
  label: string;
  helper?: string;
  problem?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {problem ? <span className="text-sm text-danger-text">{problem}</span> : helper ? <span className="text-sm text-ink-2">{helper}</span> : null}
    </div>
  );
}
