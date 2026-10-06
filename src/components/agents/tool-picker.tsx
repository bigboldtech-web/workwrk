"use client";

// The tool picker (docs/plans/ai-teammates.md 5.5): the new teammate
// dialog's Tools field and the settings drawer's Tools and approvals tab.
// The rows are teammate-setup.ts's (draftToolGroups, settingsToolGroups), in
// four groups: Look things up, Make and change your own work, Things other
// people will see, Always asks first. Each row: a checkbox (where the tools
// can be changed), the tool's label and one-line description, and what it
// does before acting:
//
//   reading            nothing (reading never asks)
//   own work, others'  a Picker, "Ask me first" / "Don't ask"
//   Post in Talk       "Ask me first", with the note that one conversation
//                      can go without asking, from an approval card
//   Invite people      "Always asks first"
//
// A tool whose module is off cannot be ticked and says why. On the tab, a
// workspace teammate's managers also get "Ask everyone first" on the own
// work rows, and each "Don't ask" the person chose on an approval card (one
// Talk conversation, or calls other people will see) is listed under its
// tool with a Remove. Nothing here ever sets one of those.
//
// The Pickers are absolute children of their row (never portalled), so they
// work inside the dialog's transformed box (the picker-in-dialog rule).

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { NEW_TEAMMATE_DIALOG, TEAMMATE_SETTINGS, approvalFor, askEveryoneFor, removeChoice } from "@/lib/agents/teammate-copy";
import { moduleNote, type ToolPickerGroup, type ToolPickerRow } from "@/lib/agents/teammate-setup";
import type { ApprovalChoice } from "@/lib/agents/tool-policy";
import type { ToolName } from "@/lib/agents/tool-names";
import { cn } from "@/lib/utils";

const CHECKBOX = "h-[18px] w-[18px] shrink-0 rounded border-line-strong accent-[var(--os-brand)] disabled:opacity-50";
const LINK = "whitespace-nowrap text-sm font-medium text-brand-deep hover:underline disabled:opacity-60";

const CHOICE_LABEL: Record<ApprovalChoice, string> = { ask: NEW_TEAMMATE_DIALOG.askMeFirst, always: NEW_TEAMMATE_DIALOG.dontAsk };

export function ToolPicker({
  groups,
  canTick,
  busy = false,
  onTick,
  onChoice,
  onAskEveryone,
  onRemoveRule,
}: {
  groups: readonly ToolPickerGroup[];
  /** The checkboxes show and can change: the dialog, and the tab for whoever manages the teammate. */
  canTick: boolean;
  /** A save is on its way: nothing changes until it lands. */
  busy?: boolean;
  onTick?: (name: ToolName, on: boolean) => void;
  onChoice: (name: ToolName, value: ApprovalChoice) => void;
  onAskEveryone?: (name: ToolName, on: boolean) => void;
  onRemoveRule?: (key: string) => void;
}) {
  // One approval Picker open at a time.
  const [open, setOpen] = useState<ToolName | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h4 className="mb-1 text-sm font-medium text-ink-2">{g.label}</h4>
          <ul className="flex flex-col rounded-md border border-line">
            {g.rows.map((r) => (
              <ToolRow
                key={r.name}
                row={r}
                canTick={canTick}
                busy={busy}
                open={open === r.name}
                onOpen={(on) => setOpen(on ? r.name : null)}
                onTick={onTick}
                onChoice={onChoice}
                onAskEveryone={onAskEveryone}
                onRemoveRule={onRemoveRule}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ToolRow({
  row: r,
  canTick,
  busy,
  open,
  onOpen,
  onTick,
  onChoice,
  onAskEveryone,
  onRemoveRule,
}: {
  row: ToolPickerRow;
  canTick: boolean;
  busy: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
  onTick?: (name: ToolName, on: boolean) => void;
  onChoice: (name: ToolName, value: ApprovalChoice) => void;
  onAskEveryone?: (name: ToolName, on: boolean) => void;
  onRemoveRule?: (key: string) => void;
}) {
  // Under the label: the checkbox's 18px and the 12px gap, when it shows.
  const indent = canTick ? "ps-[30px]" : "";
  const a = r.approval;
  return (
    <li className="flex flex-col gap-1 border-t border-line-soft px-3 py-2 first:border-t-0">
      <div className="flex min-h-8 items-start gap-3">
        {canTick ? (
          <input
            type="checkbox"
            checked={r.on}
            disabled={busy || r.unavailable !== null}
            onChange={(e) => onTick?.(r.name, e.target.checked)}
            aria-label={r.label}
            className={cn(CHECKBOX, "mt-[7px]")}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col justify-center py-1">
          <span className={cn("text-base", r.unavailable ? "text-ink-2" : "text-ink")}>{r.label}</span>
          {r.description ? <span className="text-sm text-ink-2">{r.description}</span> : null}
          {r.unavailable ? <span className="text-sm text-ink-2">{moduleNote(r.unavailable)}</span> : null}
          {a.kind === "per_conversation" ? <span className="text-sm text-ink-2">{NEW_TEAMMATE_DIALOG.talkNote}</span> : null}
          {a.kind === "choice" && a.held ? <span className="text-sm text-ink-2">{TEAMMATE_SETTINGS.askedByManagers}</span> : null}
        </div>
        {a.kind === "always_asks" ? (
          <span className="flex h-8 shrink-0 items-center text-sm text-ink-2">{NEW_TEAMMATE_DIALOG.alwaysAsksFirst}</span>
        ) : a.kind === "per_conversation" ? (
          <span className="flex h-8 shrink-0 items-center text-sm text-ink-2">{NEW_TEAMMATE_DIALOG.askMeFirst}</span>
        ) : a.kind === "choice" ? (
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={busy || a.held || !r.on}
              onClick={() => onOpen(!open)}
              aria-haspopup="listbox"
              aria-expanded={open}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-hover disabled:text-ink-2 disabled:hover:bg-transparent"
            >
              <span className="sr-only">{approvalFor(r.label)} </span>
              {CHOICE_LABEL[a.value]}
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            </button>
            <Picker
              open={open}
              onClose={() => onOpen(false)}
              ariaLabel={approvalFor(r.label)}
              width={200}
              align="end"
              selected={a.value}
              onSelect={(v) => {
                onOpen(false);
                if (v === "ask" || v === "always") {
                  if (v !== a.value) onChoice(r.name, v);
                }
              }}
              sections={[{ options: [{ value: "ask", label: CHOICE_LABEL.ask }, { value: "always", label: CHOICE_LABEL.always }] }]}
            />
          </div>
        ) : null}
      </div>
      {r.askEveryone.offered && onAskEveryone ? (
        <label className={cn("flex min-h-7 w-fit cursor-pointer items-center gap-2 text-sm text-ink-2", indent)}>
          <input
            type="checkbox"
            checked={r.askEveryone.on}
            disabled={busy}
            onChange={(e) => onAskEveryone(r.name, e.target.checked)}
            aria-label={askEveryoneFor(r.label)}
            className={CHECKBOX}
          />
          {TEAMMATE_SETTINGS.askEveryoneFirst}
        </label>
      ) : null}
      {r.rules.map((rule) => (
        <div key={rule.key} className={cn("flex min-h-7 items-center gap-3 text-sm text-ink-2", indent)}>
          <span className="min-w-0 flex-1 break-words">{rule.line}</span>
          {onRemoveRule ? (
            <button type="button" className={LINK} disabled={busy} aria-label={removeChoice(rule.line)} onClick={() => onRemoveRule(rule.key)}>
              {TEAMMATE_SETTINGS.remove}
            </button>
          ) : null}
        </div>
      ))}
    </li>
  );
}
