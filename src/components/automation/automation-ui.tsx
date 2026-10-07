"use client";

// The Automation hub's shared client pieces (spec-ai-automation section 3).
// They replace the deleted src/app/(dashboard)/automation/shared.tsx and its
// hex maps, dark pill and hand-rolled header: every page here now uses the
// design system's header stack, TableCard, FilterPanel and Picker, and these
// few helpers on top.
//
//   useAutomationRights  what this viewer may change (GET /api/automation/me)
//   useAutomationCatalog the trigger and action registries, read once
//   WorkflowStatusChip   a workflow's pale status chip (not a run's)
//   InlineRow            the one 44px sentence row for errors and empties
//   NameDialog           the 400px "Name this automation" modal
//   BTN                  the button recipes (one blue primary per page)

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StatusChip } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { WORKFLOW_STATUS_VIEW } from "@/lib/automation/workflow-list";
import { cn } from "@/lib/utils";

export const BTN = {
  primary:
    "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50",
  secondary:
    "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:opacity-50",
  secondarySm:
    "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50",
  ghost:
    "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50",
  danger:
    "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-base font-medium text-danger-text hover:bg-danger-bg disabled:opacity-50",
  icon:
    "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink",
  link: "font-medium text-brand-deep hover:underline underline-offset-4",
} as const;

export const FIELD =
  "h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand disabled:opacity-60";

export const CARD = "rounded-lg border border-line bg-raised";

export interface AutomationRights {
  /** Create a draft, duplicate, use a template: every Member. */
  canCreate: boolean;
  /** Edit, publish, activate, deactivate, retry ANY workflow (a creator's own ride on the row). */
  canManage: boolean;
  /** Owner or Admin: archive, connections, per-person usage. */
  isAdmin: boolean;
  /** The viewer's id, so a page can tell their own workflows apart. */
  userId: string | null;
  /** The answer has arrived (until then the viewer is read-only). */
  ready: boolean;
}

/**
 * What this viewer may change, the same facts every write route checks. Until
 * it answers, and when it fails, the viewer is read-only, so a control that
 * could only fail with a 403 is never on screen.
 */
export function useAutomationRights(): AutomationRights {
  const [rights, setRights] = useState<AutomationRights>({ canCreate: false, canManage: false, isAdmin: false, userId: null, ready: false });
  useEffect(() => {
    let alive = true;
    void apiFetch<{ canCreate?: boolean; canManage?: boolean; isAdmin?: boolean; userId?: string }>("/api/automation/me", { cache: "no-store" }).then((r) => {
      if (!alive) return;
      setRights({
        canCreate: r.ok && r.data.canCreate === true,
        canManage: r.ok && r.data.canManage === true,
        isAdmin: r.ok && r.data.isAdmin === true,
        userId: r.ok && typeof r.data.userId === "string" ? r.data.userId : null,
        ready: true,
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  return rights;
}

export interface CatalogTriggerField {
  key: string;
  label: string;
  type: string;
  legacy?: boolean;
}

export interface CatalogTrigger {
  key: string;
  name: string;
  phrase: string;
  category: string;
  description: string;
  isEmitting: boolean;
  hidden?: boolean;
  fields: CatalogTriggerField[];
}

export interface CatalogActionParam {
  key: string;
  label: string;
  type: "string" | "text" | "user" | "board" | "status" | "number" | "field" | "teammate";
  required: boolean;
  help?: string;
}

export interface CatalogAction {
  key: string;
  name: string;
  category: string;
  description: string;
  safeToRetry: boolean;
  available: boolean;
  requiresConnection: string | null;
  params: CatalogActionParam[];
}

export interface AutomationCatalog {
  triggers: CatalogTrigger[];
  actions: CatalogAction[];
  serverZone: string | null;
  loaded: boolean;
  failed: boolean;
}

/** The trigger and action registries. A failure leaves both empty and says so. */
export function useAutomationCatalog(opts: { actions?: boolean } = {}): AutomationCatalog & { reload: () => void } {
  const wantActions = opts.actions ?? false;
  const [state, setState] = useState<AutomationCatalog>({ triggers: [], actions: [], serverZone: null, loaded: false, failed: false });
  const load = useCallback(async () => {
    const [t, a] = await Promise.all([
      apiFetch<{ triggers: CatalogTrigger[]; serverZone?: string }>("/api/automation/triggers", { cache: "no-store" }),
      wantActions ? apiFetch<{ actions: CatalogAction[] }>("/api/automation/actions") : Promise.resolve(null),
    ]);
    setState({
      triggers: t.ok && Array.isArray(t.data.triggers) ? t.data.triggers : [],
      actions: a && a.ok && Array.isArray(a.data.actions) ? a.data.actions : [],
      serverZone: t.ok ? (t.data.serverZone ?? null) : null,
      loaded: true,
      failed: !t.ok || (a !== null && !a.ok),
    });
  }, [wantActions]);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);
  return { ...state, reload: () => void load() };
}

/** A workflow's pale status chip: Active, Draft, Paused, Error, Archived. */
export function WorkflowStatusChip({ status }: { status: string }) {
  const v = WORKFLOW_STATUS_VIEW[status] ?? { label: status.charAt(0) + status.slice(1).toLowerCase(), tone: "neutral" as const };
  return <StatusChip disabled color={RUN_TONE_COLOR[v.tone]} label={v.label} />;
}

/** A 24px neutral chip that only labels ("Not live yet", a category). */
export function NeutralChip({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-line bg-subtle px-1.5 text-xs font-medium text-ink-2", className)}>
      {children}
    </span>
  );
}

/** The 44px sentence row: "Couldn't load runs · Try again", "No runs match · Clear filters". */
export function InlineRow({ children, action, className }: { children: ReactNode; action?: { label: string; onClick: () => void }; className?: string }) {
  return (
    <div className={cn("flex h-11 items-center gap-1.5 text-row text-ink-2", className)}>
      <span>{children}</span>
      {action ? (
        <>
          <span aria-hidden>·</span>
          <button type="button" onClick={action.onClick} className={BTN.link}>
            {action.label}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** The 400px one-input modal: create ("Name this automation") and rename. */
export function NameDialog({
  open,
  title,
  initial = "",
  submitLabel,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: string;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setValue(initial);
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [open, initial]);
  const trimmed = value.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="os-chrome max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="sr-only">One name, in plain words, for what it does.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed && !busy) onSubmit(trimmed);
          }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor="automation-name" className="text-sm font-medium text-ink-2">
            Name this automation
          </label>
          <input
            id="automation-name"
            ref={inputRef}
            value={value}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Assign new tasks to the List owner"
            className={FIELD}
          />
          {error ? <p className="m-0 text-sm text-danger-text">{error}</p> : null}
          <DialogFooter className="mt-3">
            <button type="button" onClick={onClose} className={BTN.ghost}>
              Cancel
            </button>
            <button type="submit" disabled={!trimmed || busy} className={BTN.primary}>
              {submitLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
