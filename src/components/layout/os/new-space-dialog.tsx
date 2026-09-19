"use client";

// NewSpaceDialog — two-step Space creation wizard.
//
// Step 1 — Basics: icon + name + description + default permission + privacy.
// Step 2 — Define your workflow: preset, owner, views, statuses, modules.
// (Alignment — KRA/KPI — is tagged per-task, not per-Space.)
//
// Posts to POST /api/spaces with the assembled payload. On success it
// calls onCreated(space) so the caller can refresh the sidebar tree.

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SpaceIconPicker } from "./space-icon-picker";
import { SPACE_COLOR_PALETTE } from "./space-icon-catalog";
import { SpaceWizardStep2, type Step2SubScreen, type UserOption } from "./space-wizard-step2";
import { workflowFromPreset } from "./space-wizard-presets";
import type { WorkflowConfig } from "./space-wizard-types";
import type { Visibility } from "@/generated/prisma";

interface SpaceLike {
  id: string;
  slug: string;
  name: string;
  visibility: Visibility;
}

// `settings.defaultPermission` is gone from this file entirely. The select
// that asked for it was deleted, nothing in src reads the stored value, and
// the POST kept writing a hardcoded "FULL_EDIT" on every new Space, which is
// a fabricated answer for the access migration to pick up. Existing stored
// values are untouched; the access spec's step 4 migrates them onto the
// Everyone grant, which is the rule that is actually enforced.

interface WizardState {
  step: 1 | 2;
  subScreen: Step2SubScreen;
  iconName: string | null;
  color: string;
  name: string;
  description: string;
  isPrivate: boolean;
  workflow: WorkflowConfig;
}

const INITIAL: WizardState = {
  step: 1,
  subScreen: null,
  iconName: null,
  color: SPACE_COLOR_PALETTE[0].hex,
  name: "",
  description: "",
  isPrivate: false,
  workflow: workflowFromPreset("starter"),
};

export function NewSpaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (s: SpaceLike) => void;
}) {
  const [state, setState] = useState<WizardState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  // Loading flag defaults to true so the very first paint of Step 2
  // shows the loading state without a synchronous setState in the effect.
  const [loadingUsers, setLoadingUsers] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (state.step !== 2 || fetchedRef.current) return;
    fetchedRef.current = true;
    let active = true;
    fetch("/api/users?scope=all&limit=200")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const rows: UserOption[] = Array.isArray(data?.data) ? data.data : [];
        setUsers(rows);
      })
      .catch(() => { if (active) setUsers([]); })
      .finally(() => { if (active) setLoadingUsers(false); });
    return () => { active = false; };
  }, [state.step]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const reset = () => {
    setState(INITIAL);
    setError(null);
    setSubmitting(false);
    setLoadingUsers(true);
    setUsers([]);
    fetchedRef.current = false;
  };

  const handleOpen = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canAdvance = state.name.trim().length > 0;

  const handleContinue = () => {
    if (!canAdvance) {
      setError("Space name is required");
      return;
    }
    setError(null);
    set("step", 2);
    set("subScreen", null);
  };

  const submit = async () => {
    setError(null);
    const trimmed = state.name.trim();
    if (!trimmed) {
      set("step", 1);
      setError("Space name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: state.description.trim() || undefined,
          visibility: state.isPrivate ? "PRIVATE" : "WORKSPACE",
          icon: state.iconName ?? undefined,
          color: state.color,
          ownerId: state.workflow.ownerId ?? undefined,
          // `settings.defaultPermission` is NOT written any more. The select
          // that asked for it is gone, nothing in src reads the stored value,
          // and writing a hardcoded FULL_EDIT on every new Space would hand
          // the access migration a fabricated answer to a question nobody was
          // asked. Who can do what is the Share dialog's "Everyone" row.
          settings: {
            workflow: state.workflow,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to create Space");
        setSubmitting(false);
        return;
      }
      onCreated?.(data.space as SpaceLike);
      handleOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create Space");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[560px] p-0 gap-0">
        {state.step === 1 ? (
          <Step1
            state={state}
            error={error}
            onChange={set}
            onCancel={() => handleOpen(false)}
            onContinue={handleContinue}
          />
        ) : (
          <SpaceWizardStep2
            workflow={state.workflow}
            subScreen={state.subScreen}
            accent={state.color}
            error={error}
            submitting={submitting}
            users={users}
            loadingUsers={loadingUsers}
            onChange={(w) => set("workflow", w)}
            onSubScreen={(s) => set("subScreen", s)}
            onBack={() => set("step", 1)}
            onCreate={submit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Step1({
  state,
  error,
  onChange,
  onCancel,
  onContinue,
}: {
  state: WizardState;
  error: string | null;
  onChange: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const showNameError = error === "Space name is required";

  return (
    <>
      <div className="px-6 pt-6 pb-3">
        <DialogTitle className="text-base font-semibold">Create a Space</DialogTitle>
        <DialogDescription className="mt-1">
          A Space represents teams, departments, or groups, each with its own Lists,
          workflows, and settings.
        </DialogDescription>
      </div>

      <div className="px-6 pb-2 space-y-5">
        <div>
          <label className="text-base font-medium block mb-2">Icon &amp; name</label>
          <div className="flex items-start gap-3">
            <SpaceIconPicker
              iconName={state.iconName}
              color={state.color}
              fallbackInitial={state.name.trim()[0]?.toUpperCase() ?? "S"}
              onChange={({ iconName, color }) => {
                onChange("iconName", iconName);
                onChange("color", color);
              }}
            />
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={state.name}
                onChange={(e) => onChange("name", e.target.value)}
                placeholder="e.g. Marketing, Engineering, HR"
                className={`w-full h-8 px-3 rounded-md border bg-surface text-base focus:outline-none transition-colors ${
                  showNameError
                    ? "border-red-500/70 focus:border-red-500"
                    : "border-border focus:border-[color:var(--accent)]"
                }`}
                autoFocus
              />
              {showNameError ? (
                <div className="mt-1 text-sm text-red-500">Space name is required</div>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <label className="text-base font-medium block mb-2">
            Description
          </label>
          <textarea
            value={state.description}
            onChange={(e) => onChange("description", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-md border border-border bg-surface text-base resize-none focus:outline-none focus:border-[color:var(--accent)]"
          />
        </div>

        {/* The "Default permission" select is gone (spec-spaces-lists section
            4 step 3: "the default-permission select stops rendering", audit
            Medium #16 and critic #7). It wrote `settings.defaultPermission`,
            and grep finds no runtime reader anywhere in src: the four choices
            were stored and never enforced, so the dialog was asking a question
            whose answer nothing acted on. Who can do what in a Space is the
            Share dialog's "Everyone at {org}" row, which is enforced. */}

        <div className="border-t border-border pt-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-base font-medium">Restricted</div>
              <div className="text-sm text-muted">
                Only you and the people you share it with can open it. Change this later in Share.
              </div>
            </div>
            <Switch
              checked={state.isPrivate}
              onChange={(v) => onChange("isPrivate", v)}
              aria-label="Restrict this Space"
            />
          </label>
        </div>

        {error && error !== "Space name is required" ? (
          <div className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div>
        ) : null}
      </div>

      {/* ClickUp's Space modal footer: Cancel + fixed dark Continue pill,
          right-aligned (templates enter via the "+" menu, not here). */}
      <div className="px-6 py-4 mt-2 border-t border-border flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-base text-muted hover:text-foreground px-3 h-8 rounded-md"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="px-4 h-8 rounded-md text-base font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors"
        >
          Continue
        </button>
      </div>
    </>
  );
}


