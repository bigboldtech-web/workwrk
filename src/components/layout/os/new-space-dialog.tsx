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
import { Info, Users } from "lucide-react";
import { useOsShell } from "./shell-context";
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

type Permission = "FULL_EDIT" | "EDIT" | "COMMENT" | "VIEW";

const PERMISSION_LABELS: Record<Permission, string> = {
  FULL_EDIT: "Full edit",
  EDIT: "Edit",
  COMMENT: "Comment",
  VIEW: "View",
};

interface WizardState {
  step: 1 | 2;
  subScreen: Step2SubScreen;
  iconName: string | null;
  color: string;
  name: string;
  description: string;
  defaultPermission: Permission;
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
  defaultPermission: "FULL_EDIT",
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
          settings: {
            defaultPermission: state.defaultPermission,
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
  const { openTemplateCenter } = useOsShell();
  const showNameError = error === "Space name is required";

  return (
    <>
      <div className="px-6 pt-6 pb-3">
        <DialogTitle className="text-[15px] font-semibold">Create a Space</DialogTitle>
        <DialogDescription className="mt-1">
          A Space represents teams, departments, or groups, each with its own Lists,
          workflows, and settings.
        </DialogDescription>
      </div>

      <div className="px-6 pb-2 space-y-5">
        <div>
          <label className="text-[12.5px] font-medium block mb-2">Icon &amp; name</label>
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
                className={`w-full h-8 px-3 rounded-md border bg-surface text-[13px] focus:outline-none transition-colors ${
                  showNameError
                    ? "border-red-500/70 focus:border-red-500"
                    : "border-border focus:border-[color:var(--accent)]"
                }`}
                autoFocus
              />
              {showNameError ? (
                <div className="mt-1 text-[12px] text-red-500">Space name is required</div>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <label className="text-[12.5px] font-medium block mb-2">
            Description <span className="text-muted">(optional)</span>
          </label>
          <textarea
            value={state.description}
            onChange={(e) => onChange("description", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-md border border-border bg-surface text-[13px] resize-none focus:outline-none focus:border-[color:var(--accent)]"
          />
        </div>

        <div className="border-t border-border pt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted" />
            <span className="text-[12.5px] font-medium">Default permission</span>
            <Info className="h-3.5 w-3.5 text-muted-2" />
          </div>
          <PermissionSelect
            value={state.defaultPermission}
            onChange={(v) => onChange("defaultPermission", v)}
          />
        </div>

        <div className="border-t border-border pt-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-[12.5px] font-medium">Make Private</div>
              <div className="text-[12px] text-muted">Only you and invited members have access</div>
            </div>
            <Toggle
              value={state.isPrivate}
              onChange={(v) => onChange("isPrivate", v)}
              accent={state.color}
            />
          </label>
        </div>

        {error && error !== "Space name is required" ? (
          <div className="text-[12px] text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div>
        ) : null}
      </div>

      <div className="px-6 py-4 mt-2 border-t border-border flex items-center justify-between">
        <button
          type="button"
          onClick={() => { onCancel(); openTemplateCenter({ kind: "SPACE" }); }}
          className="text-[12.5px] text-muted hover:text-foreground transition-colors"
        >
          Use Templates
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-[12.5px] text-muted hover:text-foreground px-3 h-8 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="px-4 h-8 rounded-md text-[12.5px] font-medium text-white transition hover:opacity-90"
            style={{ backgroundColor: state.color }}
          >
            Continue
          </button>
        </div>
      </div>
    </>
  );
}

function PermissionSelect({
  value,
  onChange,
}: {
  value: Permission;
  onChange: (v: Permission) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Permission)}
      className="h-8 px-2.5 pr-7 rounded-md border border-border bg-surface text-[12.5px] focus:outline-none focus:border-[color:var(--accent)]"
    >
      {(Object.keys(PERMISSION_LABELS) as Permission[]).map((k) => (
        <option key={k} value={k}>
          {PERMISSION_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  value,
  onChange,
  accent,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  accent: string;
}) {
  return (
    <span
      role="switch"
      aria-checked={value}
      tabIndex={0}
      onClick={() => onChange(!value)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!value);
        }
      }}
      className="relative inline-flex w-7 h-4 rounded-full transition-colors cursor-pointer"
      style={{ backgroundColor: value ? accent : "#d4d4d8" }}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
          value ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}
