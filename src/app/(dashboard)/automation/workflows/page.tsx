"use client";

/* /automation/workflows — the Automation Hub's workflow list.
 *
 *  GET  /api/automation/workflows            → rows + run stats + creator
 *  GET  /api/automation/triggers             → trigger key → display name
 *  POST /api/automation/workflows            → "+ New automation" (DRAFT)
 *  POST .../[id]/activate | /deactivate      → row menu toggles
 *  DELETE .../[id]                           → delete (archives if it ran)
 *
 * ClickUp "Manage" tab parity: dense h-7 rows (name, status, trigger,
 * last run, success rate, created by) + a Monday-style "..." row menu.
 * Empty state points at Templates, per the plan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Copy,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  ScrollText,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import {
  AutomationHeader,
  DARK_PILL,
  StatusPill,
  WORKFLOW_STATUS_META,
  relTime,
} from "../shared";

interface ApiWorkflow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  severity: string;
  triggerEvent: string | null;
  publishedVersionId: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  totalRuns: number;
  successRate: number | null;
}

interface ApiTrigger {
  key: string;
  name: string;
  isEmitting: boolean;
}

const GRID =
  "grid grid-cols-[minmax(220px,2fr)_110px_minmax(150px,1.2fr)_100px_80px_140px_36px] items-center gap-2";

function RowMenu({
  workflow,
  onDuplicate,
  onSetActive,
  onDelete,
}: {
  workflow: ApiWorkflow;
  onDuplicate: () => void;
  onSetActive: (next: boolean) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const canActivate =
    workflow.status !== "ACTIVE" &&
    workflow.status !== "ARCHIVED" &&
    Boolean(workflow.publishedVersionId);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${workflow.name}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={btnRef} width={210} open={open} placement="below">
            <MenuList>
              <MenuItem
                icon={Pencil}
                label="Edit"
                href={`/automation/workflows/${workflow.id}`}
                onClick={() => setOpen(false)}
              />
              <MenuItem
                icon={Copy}
                label="Duplicate"
                onClick={() => {
                  setOpen(false);
                  onDuplicate();
                }}
              />
              {workflow.status === "ACTIVE" ? (
                <MenuItem
                  icon={Pause}
                  label="Deactivate"
                  onClick={() => {
                    setOpen(false);
                    onSetActive(false);
                  }}
                />
              ) : canActivate ? (
                <MenuItem
                  icon={Play}
                  label="Activate"
                  onClick={() => {
                    setOpen(false);
                    onSetActive(true);
                  }}
                />
              ) : null}
              <MenuItem
                icon={ScrollText}
                label="View logs"
                href={`/automation/logs?workflowId=${workflow.id}`}
                onClick={() => setOpen(false)}
              />
              <MenuSeparator />
              <MenuItem
                icon={Trash2}
                label="Delete"
                destructive
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              />
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </>
  );
}

export default function AutomationWorkflowsPage() {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [workflows, setWorkflows] = useState<ApiWorkflow[] | null>(null);
  const [triggers, setTriggers] = useState<Map<string, ApiTrigger>>(new Map());
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/workflows", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkflows(Array.isArray(data.workflows) ? data.workflows : []);
    } catch {
      setWorkflows([]);
      toast("Couldn't load automations");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    fetch("/api/automation/triggers")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !Array.isArray(data?.triggers)) return;
        setTriggers(new Map((data.triggers as ApiTrigger[]).map((t) => [t.key, t])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const createNew = useCallback(async () => {
    const name = await prompt({
      title: "New automation",
      description: "Name it after what it does — you'll pick the trigger and actions next.",
      placeholder: "e.g. Assign new tasks to the board owner",
      submitLabel: "Create",
      required: true,
    });
    const trimmed = name?.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await fetch("/api/automation/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't create automation");
        return;
      }
      router.push(`/automation/workflows/${data.workflow.id}`);
    } catch {
      toast("Couldn't create automation");
    } finally {
      setCreating(false);
    }
  }, [prompt, router, toast]);

  const duplicate = useCallback(
    async (w: ApiWorkflow) => {
      try {
        const detailRes = await fetch(`/api/automation/workflows/${w.id}`, { cache: "no-store" });
        if (!detailRes.ok) throw new Error();
        const detail = await detailRes.json();
        const src = detail.workflow;
        const res = await fetch("/api/automation/workflows", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: `${src.name} (copy)`,
            description: src.description ?? undefined,
            triggerEvent: src.triggerEvent ?? undefined,
            severity: src.severity,
            definition: src.definition ?? undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data?.error ?? "Couldn't duplicate automation");
          return;
        }
        toast("Duplicated as a draft");
        void load();
      } catch {
        toast("Couldn't duplicate automation");
      }
    },
    [load, toast],
  );

  const setActive = useCallback(
    async (w: ApiWorkflow, next: boolean) => {
      try {
        const res = await fetch(
          `/api/automation/workflows/${w.id}/${next ? "activate" : "deactivate"}`,
          { method: "POST" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data?.error ?? "Couldn't update automation");
          return;
        }
        toast(next ? "Automation activated" : "Automation deactivated");
        void load();
      } catch {
        toast("Couldn't update automation");
      }
    },
    [load, toast],
  );

  const remove = useCallback(
    async (w: ApiWorkflow) => {
      const ok = await confirm({
        title: `Delete "${w.name}"?`,
        description:
          w.totalRuns > 0
            ? "This automation has run history, so it will be archived and its logs stay auditable."
            : "This automation never ran and will be permanently removed.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      try {
        const res = await fetch(`/api/automation/workflows/${w.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data?.error ?? "Couldn't delete automation");
          return;
        }
        toast(data?.archived ? "Archived — run history preserved" : "Automation deleted");
        void load();
      } catch {
        toast("Couldn't delete automation");
      }
    },
    [confirm, load, toast],
  );

  const activeCount = workflows?.filter((w) => w.status === "ACTIVE").length ?? 0;

  return (
    <div className="flex h-full flex-col bg-white">
      <AutomationHeader
        Icon={Workflow}
        title="Workflows"
        meta={
          workflows && workflows.length > 0 ? (
            <span className="tabular-nums">
              {workflows.length} automation{workflows.length === 1 ? "" : "s"} · {activeCount} active
            </span>
          ) : undefined
        }
        actions={
          <button type="button" onClick={() => void createNew()} disabled={creating} className={DARK_PILL}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            New automation
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {workflows === null ? (
          <div className="flex items-center gap-2 p-6 text-[13px] text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center pt-20">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-zinc-50">
              <Zap className="h-5 w-5 text-zinc-500" />
            </span>
            <h2 className="mt-4 text-[16px] font-semibold text-zinc-900">
              Create your first automation
            </h2>
            <p className="mt-1 max-w-sm text-center text-[13px] text-zinc-500">
              When something happens in WorkwrK, check conditions and run actions automatically:
              assign people, change statuses, create tasks, send notifications.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button type="button" onClick={() => void createNew()} className={DARK_PILL}>
                <Plus className="h-3.5 w-3.5" />
                New automation
              </button>
              <Link
                href="/automation/templates"
                className="text-[12.5px] font-medium text-zinc-600 hover:text-zinc-900"
              >
                Browse templates →
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 py-2">
            <div className="min-w-[860px]">
              <div
                className={`${GRID} h-7 border-b border-zinc-100 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400`}
              >
                <span>Name</span>
                <span>Status</span>
                <span>Trigger</span>
                <span>Last run</span>
                <span>Success</span>
                <span>Created by</span>
                <span aria-hidden />
              </div>
              {workflows.map((w) => {
                const statusMeta = WORKFLOW_STATUS_META[w.status] ?? {
                  label: w.status,
                  color: "#A1A1AA",
                };
                const trigger = w.triggerEvent ? triggers.get(w.triggerEvent) : undefined;
                return (
                  <div
                    key={w.id}
                    className={`${GRID} h-7 border-b border-zinc-100 px-2 text-[12.5px] text-zinc-600 hover:bg-zinc-50`}
                  >
                    <Link
                      href={`/automation/workflows/${w.id}`}
                      title={w.description ?? undefined}
                      className="truncate font-medium text-zinc-900 hover:text-[#0073EA]"
                    >
                      {w.name}
                    </Link>
                    <span>
                      <StatusPill color={statusMeta.color} label={statusMeta.label} />
                    </span>
                    <span
                      className={`truncate ${trigger || w.triggerEvent ? "" : "text-zinc-400"}`}
                      title={trigger && !trigger.isEmitting ? "This event isn't emitting yet" : undefined}
                    >
                      {trigger?.name ?? w.triggerEvent ?? "No trigger"}
                      {trigger && !trigger.isEmitting ? (
                        <span className="ml-1 text-[10.5px] text-zinc-400">· not live</span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {w.lastRunAt ? relTime(w.lastRunAt) : "Never"}
                    </span>
                    <span className="tabular-nums" title={`${w.totalRuns} total runs`}>
                      {w.successRate !== null ? `${w.successRate}%` : "—"}
                    </span>
                    <span className="truncate text-zinc-500">{w.createdByName ?? "—"}</span>
                    <span className="flex justify-end">
                      <RowMenu
                        workflow={w}
                        onDuplicate={() => void duplicate(w)}
                        onSetActive={(next) => void setActive(w, next)}
                        onDelete={() => void remove(w)}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
