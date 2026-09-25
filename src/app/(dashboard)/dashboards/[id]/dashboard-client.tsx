"use client";

// /dashboards/[id], the canvas (decision 1; monday's dashboard screens are the
// visual reference).
//
//   title row  Back to Dashboards, the tile, the name (editors click it to
//              rename), a ghost "Schedule report" for every member, and "..."
//              (Copy link; Rename and Delete for editors)
//   strips     ConflictStrip after someone else saved, DraftRestoreStrip for
//              unsaved changes from an earlier visit, and the reason a save
//              stopped, with Retry
//   toolbar    "Refreshed <when>" with a refresh button (held until the save
//              queue is idle), the AutosaveIndicator, and for editors the one
//              blue "+ Add widget"
//   body       the grid of cards (DashboardGrid)
//
// A viewer gets the same page with no grip, no resize corner, no card menu and
// no Add widget. There is no "Edit layout" switch: an editor moves a card by
// its header whenever they like, and only a real move is saved.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleAlert, Link2, LayoutDashboard, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { HeaderAction, OsPageHeader, OsPageHeaderSkeleton, type HeaderMenuEntry } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { BackButton } from "@/components/ui/back-button";
import { ConflictStrip } from "@/components/ui/conflict-strip";
import { DraftRestoreStrip } from "@/components/ui/draft-restore-strip";
import { NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { SkeletonLines } from "@/components/ui/skeleton";
import { AddWidgetMenu } from "@/components/dashboards/add-widget-menu";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { WidgetCard } from "@/components/dashboards/widget-card";
import { WidgetEditor, type EditorSaveResult } from "@/components/dashboards/widget-editor";
import { useDashboard, type PreviewSeed } from "@/components/dashboards/use-dashboard";
import { ScheduleReportDialog } from "@/components/reports/schedule-report-dialog";
import { layoutsOf, placeNewWidget, toWidgetInputs } from "@/lib/dashboards/dashboard-editor";
import { isSpaceOverviewId } from "@/lib/dashboards/dashboard-access";
import { dashboardMessage } from "@/lib/dashboards/dashboard-messages";
import { kindMeta, newWidgetId, newWidgetInput, type WidgetKind } from "@/lib/dashboards/widget-kinds";
import type { EditorWidget, WidgetInput } from "@/lib/dashboards/widgets";
import { useFormat } from "@/lib/format/use-date-prefs";
import type { AutosaveStatus } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";

type EditorState = { mode: "add" | "edit"; widgetId: string; input: WidgetInput; partial: boolean } | null;

function NameEditor({ value, onSave, onCancel }: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  const [refused, setRefused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const t = draft.trim();
    if (!t) {
      setRefused(true);
      ref.current?.focus();
      return;
    }
    if (t !== value) onSave(t.slice(0, 160));
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={draft}
      maxLength={160}
      aria-label="Dashboard name"
      aria-invalid={refused || undefined}
      title={refused ? "A dashboard needs a name" : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        setRefused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (draft.trim()) commit();
        else onCancel();
      }}
      className={cn(
        "h-8 min-w-0 flex-1 rounded-md border bg-raised px-2 text-title font-semibold text-ink outline-none",
        refused ? "border-danger-solid" : "border-line-strong focus:border-[var(--os-focus)]",
      )}
    />
  );
}

export function DashboardClient({ id, startRename }: { id: string; startRename: boolean }) {
  const router = useRouter();
  const d = useDashboard(id);
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();

  const [renaming, setRenaming] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [emptyAddOpen, setEmptyAddOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const addAnchor = useRef<HTMLSpanElement>(null);
  // The menu hangs from the "+ Add widget" button itself. OsToolbar renders
  // the primary straight after the `right` slot, so the button is the marker
  // span's next sibling. Anchoring to the button (not the marker) also makes
  // a second click on it close the menu: a press on the anchor is not an
  // outside press, so the toggle is the only thing that runs.
  const addButton = useMemo(
    () => ({
      get current(): HTMLElement | null {
        const next = addAnchor.current?.nextElementSibling;
        return next instanceof HTMLElement ? next : addAnchor.current;
      },
    }),
    [],
  );
  const emptyAnchor = useRef<HTMLButtonElement>(null);

  const canEdit = d.meta?.canEdit === true;
  const name = d.name || "Dashboard";
  const overviewRow = isSpaceOverviewId(id);

  // ?rename=1 (a new dashboard) opens the name field once and is stripped.
  const renameLatch = useRef(false);
  useEffect(() => {
    if (!startRename || renameLatch.current || d.load.kind !== "ready" || !canEdit) return;
    renameLatch.current = true;
    const t = setTimeout(() => {
      setRenaming(true);
      router.replace(`/dashboards/${id}`);
    }, 0);
    return () => clearTimeout(t);
  }, [startRename, d.load.kind, canEdit, router, id]);

  const autosave: AutosaveStatus = useMemo(() => {
    switch (d.save.status) {
      case "saving":
        return "saving";
      case "saved":
        return "saved";
      case "retrying":
      case "error":
      case "stopped":
        return "error";
      case "conflict":
        return "dirty";
      default:
        return "idle";
    }
  }, [d.save.status]);

  // ── adding and editing cards ──
  const openAdd = (kind: WidgetKind) => {
    const meta = kindMeta(kind);
    const layout = placeNewWidget(Object.values(layoutsOf(d.widgets)), meta?.defaultSize ?? { w: 4, h: 4 });
    const widgetId = newWidgetId();
    setEditor({ mode: "add", widgetId, input: newWidgetInput(kind, { id: widgetId, layout }), partial: false });
  };

  const openSettings = (w: EditorWidget) => {
    if (w.kind === "hidden" || w.kind === "passthrough") return;
    const [input] = toWidgetInputs([w]);
    setEditor({ mode: "edit", widgetId: w.id, input, partial: "partial" in w && w.partial === true });
  };

  const saveFromEditor = async (input: WidgetInput, preview: PreviewSeed | null): Promise<EditorSaveResult> => {
    if (!editor) return { ok: false, message: "Nothing to save." };
    if (editor.mode === "add") {
      if (!d.actions.addWidget(input, preview)) return { ok: false, message: "This widget isn't complete yet." };
      setScrollToId(input.id);
    } else {
      d.actions.updateWidget(editor.widgetId, input, preview);
    }
    const s = d.queue.getState().status;
    if (s === "stopped" || s === "error") d.queue.retry();
    const r = await d.queue.settle();
    // A conflict keeps the change on screen and in the draft, and the strip
    // above the canvas takes it from there.
    if (!r.ok && r.conflict) return { ok: true };
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  };

  const deleteCard = async (w: EditorWidget) => {
    const ok = await confirm({
      title: "Delete this widget?",
      description: "Everyone who opens this dashboard loses it.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const removed = d.actions.removeWidget(w.id);
    if (!removed) return;
    toast("Widget deleted", { onUndo: () => d.actions.undoRemove(removed.card, removed.index) });
  };

  // ── the dashboard itself ──
  const copyLink = () => {
    const url = `${window.location.origin}/dashboards/${id}`;
    void navigator.clipboard?.writeText(url).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy the link", { tone: "danger" }),
    );
  };

  const restoreDashboard = async (then: () => void) => {
    if (restoring) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/dashboards/${id}/restore`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(dashboardMessage(body, "Couldn't restore this dashboard."), { tone: "danger", action: { label: "Try again", onClick: () => void restoreDashboard(then) } });
        return;
      }
      then();
    } finally {
      setRestoring(false);
    }
  };

  const deleteDashboard = async () => {
    if (deleting) return;
    const ok = await confirm({
      title: `Delete ${name}?`,
      description: "It moves to Archived and can be restored; its email schedules pause until then.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(dashboardMessage(body, "Couldn't delete this dashboard."), { tone: "danger", action: { label: "Try again", onClick: () => void deleteDashboard() } });
        return;
      }
      router.push("/dashboards");
      toast("Dashboard moved to Archived", {
        onUndo: () =>
          void (async () => {
            const r = await fetch(`/api/dashboards/${id}/restore`, { method: "POST" });
            if (r.ok) router.push(`/dashboards/${id}`);
            else toast("Couldn't restore the dashboard.", { tone: "danger" });
          })(),
      });
    } finally {
      setDeleting(false);
    }
  };

  // ── states ──
  if (d.load.kind === "loading") {
    return (
      <>
        <OsPageHeaderSkeleton toolbar />
        <div className="grid grid-cols-1 gap-4 px-6 pb-6 pt-2 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 rounded-[var(--os-r-lg)] border border-line bg-raised p-3">
              <SkeletonLines lines={3} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (d.load.kind === "notfound") {
    const archived = d.load.archived;
    return (
      <>
        <Breadcrumb items={[{ label: "Dashboards", href: "/dashboards" }]} />
        <div className="os-chrome flex h-10 items-center px-6">
          <BackButton fallbackHref="/dashboards" label="Dashboards" />
        </div>
        <OsEmptyView
          context="list"
          title={archived ? "This dashboard is in Archived." : "We couldn't find that dashboard"}
          hint={archived ? "Restore it to open it again; its email schedules resume with it." : "It may have been deleted, or it isn't shared with you."}
          action={archived ? { label: restoring ? "Restoring" : "Restore", onClick: () => void restoreDashboard(() => void d.actions.reload()) } : undefined}
        />
      </>
    );
  }

  if (d.load.kind === "error") {
    return (
      <>
        <Breadcrumb items={[{ label: "Dashboards", href: "/dashboards" }]} />
        <div className="os-chrome flex h-10 items-center px-6">
          <BackButton fallbackHref="/dashboards" label="Dashboards" />
        </div>
        <OsEmptyView variant="error" context="list" title="We couldn't load this dashboard." action={{ label: "Try again", onClick: () => void d.actions.reload() }} />
      </>
    );
  }

  const more: HeaderMenuEntry[] = [
    { label: "Copy link", icon: Link2, onClick: copyLink },
    ...(canEdit ? [{ label: "Rename", icon: Pencil, onClick: () => setRenaming(true) }] : []),
    ...(canEdit && !overviewRow ? [{ separator: true as const }, { label: "Delete", icon: Trash2, destructive: true, disabled: deleting, onClick: () => void deleteDashboard() }] : []),
  ];

  const stopped = d.save.status === "stopped" || d.save.status === "error";
  const refreshedLabel = d.computedAt ? `Refreshed ${fmt.relative(d.computedAt)}` : d.dataLoading ? "Refreshing" : "";

  return (
    <>
      <Breadcrumb items={[{ label: "Dashboards", href: "/dashboards" }, { label: name }]} />
      <OsPageHeader
        title={name}
        tile={{ icon: LayoutDashboard, name, ...NEUTRAL_TILE }}
        back={{ fallbackHref: "/dashboards", label: "Dashboards" }}
        titleSlot={
          renaming && canEdit ? (
            <NameEditor
              value={d.name}
              onSave={(v) => {
                setRenaming(false);
                d.actions.rename(v);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : canEdit ? (
            <button type="button" onClick={() => setRenaming(true)} title="Rename" className="min-w-0 truncate rounded-md px-1 text-start text-title font-semibold text-ink hover:bg-hover">
              {name}
            </button>
          ) : undefined
        }
        // On a phone the label gives way to the glyph (still read out), so the
        // dashboard's name keeps the room and "..." stays on screen.
        actions={
          <HeaderAction
            label={<span className="max-md:sr-only">Schedule report</span>}
            title="Schedule report"
            icon={CalendarClock}
            onClick={() => setScheduleOpen(true)}
          />
        }
        more={more}
        toolbar={{
          left: (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              {refreshedLabel ? <span title={d.computedAt ? fmt.title(d.computedAt) : undefined}>{refreshedLabel}</span> : null}
              <button
                type="button"
                onClick={d.actions.refresh}
                aria-label={d.refreshPending ? "Refresh after saving" : "Refresh"}
                title={d.refreshPending ? "Refreshes once your changes are saved" : "Refresh"}
                aria-busy={d.refreshPending || d.dataLoading || undefined}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", (d.refreshPending || d.dataLoading) && "opacity-50")} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          ),
          right: (
            <>
              <AutosaveIndicator status={autosave} lastSavedAt={d.save.lastSavedAt} onRetry={d.save.status === "error" || d.save.status === "stopped" ? d.actions.retry : undefined} />
              {/* Marks the spot just before the primary, so addButton can find
                  it; -ms-2 takes back the gap the empty marker would add. */}
              <span ref={addAnchor} aria-hidden className="-ms-2 inline-block h-9 w-0" />
            </>
          ),
          primary: canEdit ? { label: "Add widget", onClick: () => setAddOpen((o) => !o) } : undefined,
        }}
      />

      {d.save.status === "conflict" ? (
        <ConflictStrip noun="dashboard" onReload={() => void d.actions.reloadLive()} onDismiss={() => void d.actions.keepMine()} />
      ) : null}
      <DraftRestoreStrip draft={d.draft} onRestore={d.actions.restoreDraft} />
      {stopped && d.save.message ? (
        <div role="alert" className="os-chrome flex min-h-11 items-center gap-3 border-b border-line bg-danger-bg px-4 text-base text-ink">
          <CircleAlert className="h-4 w-4 shrink-0 text-danger-text" strokeWidth={1.5} aria-hidden />
          <span className="min-w-0 flex-1">{d.save.message}</span>
          <button type="button" onClick={d.actions.retry} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
            Retry
          </button>
        </div>
      ) : null}

      <div className="os-chrome min-h-0 flex-1 px-6 pb-8 pt-3">
        {d.widgets.length === 0 ? (
          <OsEmptyView context="list" title="No widgets yet" hint={canEdit ? undefined : "The owner hasn't added any widgets."}>
            {canEdit ? (
              <button
                ref={emptyAnchor}
                type="button"
                onClick={() => setEmptyAddOpen((o) => !o)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover"
              >
                <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                Add widget
              </button>
            ) : null}
          </OsEmptyView>
        ) : (
          <DashboardGrid
            widgets={d.widgets}
            canEdit={canEdit}
            scrollToId={scrollToId}
            onLayouts={d.actions.moveLayouts}
            renderCard={(w, o) => (
              <WidgetCard
                widget={w}
                data={d.data[w.id]}
                chrome="dashboard"
                canEdit={canEdit}
                movable={o.movable}
                saved={d.queue.isCardSaved(w.id)}
                onSettings={canEdit ? () => openSettings(w) : undefined}
                onRename={canEdit ? (t) => d.actions.renameWidget(w.id, t) : undefined}
                onDelete={canEdit ? () => void deleteCard(w) : undefined}
                onRetryData={() => d.actions.refetchCard(w.id)}
                onTextChange={canEdit ? (t) => d.actions.setNotesText(w.id, t) : undefined}
              />
            )}
          />
        )}
      </div>

      <AddWidgetMenu open={addOpen} anchorRef={addButton} surface="dashboard" onClose={() => setAddOpen(false)} onPick={openAdd} />
      <AddWidgetMenu open={emptyAddOpen} anchorRef={emptyAnchor} surface="dashboard" onClose={() => setEmptyAddOpen(false)} onPick={openAdd} />

      {editor ? (
        <WidgetEditor
          key={`${editor.mode}:${editor.widgetId}`}
          open
          onOpenChange={(o) => {
            if (!o) setEditor(null);
          }}
          surface="dashboard"
          mode={editor.mode}
          initial={editor.input}
          partial={editor.partial}
          onSave={saveFromEditor}
        />
      ) : null}

      <ScheduleReportDialog open={scheduleOpen} onOpenChange={setScheduleOpen} target={{ kind: "dashboard", id, name }} />
    </>
  );
}
