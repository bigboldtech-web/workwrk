"use client";

// /dashboards, the list (decision 1): every dashboard the viewer can open,
// in the one page pattern.
//
//   title row  the Dashboards tile and title
//   views      All / Mine / Archived, over GET /api/dashboards, ?mine=1 and
//              ?archived=1 (Archived holds only what the viewer may restore)
//   toolbar    a name search (client-side) and the one blue "New dashboard"
//   body       TableCard: Name, Location, Owner, Widgets, Updated, and a row
//              "..." (Open; Rename and Delete for editors; Restore on
//              Archived rows)
//
// Every write is busy-locked until its answer lands (a double click makes one
// dashboard, one rename, one archive). A Space's Overview widgets never list
// here while their Space exists: they live on that Space's Overview tab.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ExternalLink, LayoutDashboard, LayoutGrid, Pencil, RotateCcw, Search, Trash2, User } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { Avatar } from "@/components/ui/avatar-stack";
import { useFormat } from "@/lib/format/use-date-prefs";
import { dashboardMessage } from "@/lib/dashboards/dashboard-messages";
import { newCreateRequestId } from "@/lib/create-request-id";
import { isSpaceOverviewId } from "@/lib/dashboards/dashboard-access";

type View = "all" | "mine" | "archived";

interface Row {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  owner: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  spaceId: string | null;
  space: { id: string; name: string; slug: string } | null;
  spaceMissing?: boolean;
  widgetCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  canEdit: boolean;
}

const VIEWS: Array<{ key: View; label: string; icon: typeof LayoutGrid }> = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "mine", label: "Mine", icon: User },
  { key: "archived", label: "Archived", icon: Archive },
];

function ownerName(o: Row["owner"]): string {
  if (!o) return "";
  return `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || "Someone";
}

export function DashboardsClient({ openNew }: { openNew: boolean }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const fmt = useFormat();

  const [view, setView] = useState<View>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async (which: View = view) => {
    const qs = which === "mine" ? "?mine=1" : which === "archived" ? "?archived=1" : "";
    try {
      const res = await fetch(`/api/dashboards${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { dashboards: Row[] };
      setRows(body.dashboards);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [view]);

  useEffect(() => {
    const t = setTimeout(() => void load(view), 0);
    return () => clearTimeout(t);
  }, [view, load]);

  const lock = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // ── create ──
  // The ref is the lock (a second click in the same frame sees it at once);
  // the state only draws the busy primary.
  const creatingRef = useRef(false);
  // One id per New dashboard, kept across its Try again, so a create whose
  // answer was lost is answered with the dashboard it made (create-request-id).
  const createIdRef = useRef<string | null>(null);
  const createDashboard = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const requestId = (createIdRef.current ??= newCreateRequestId());
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled dashboard", requestId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.dashboard?.id) throw new Error(dashboardMessage(body, "Couldn't create the dashboard."));
      createIdRef.current = null;
      router.push(`/dashboards/${body.dashboard.id}?rename=1`);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Couldn't create the dashboard.", {
        tone: "danger",
        action: { label: "Try again", onClick: () => void createDashboardRef.current?.() },
      });
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [router, toast]);
  const createDashboardRef = useRef(createDashboard);
  useEffect(() => {
    createDashboardRef.current = createDashboard;
  });

  // ?new=1 runs New dashboard once, after the parameter is stripped, so a
  // refresh of the page it lands on can never make a second one.
  const newLatch = useRef(false);
  useEffect(() => {
    if (!openNew || newLatch.current) return;
    const t = setTimeout(() => {
      if (newLatch.current) return;
      newLatch.current = true;
      router.replace("/dashboards");
      void createDashboardRef.current();
    }, 0);
    return () => clearTimeout(t);
  }, [openNew, router]);

  // ── row actions ──
  // Every failure says so and offers a Try again that keeps what the person
  // gave: a failed rename reopens the prompt with the name they typed (read
  // against the row as it is now, so a 409 is answered at the new version),
  // and a failed delete or restore sends the same request again without
  // asking twice.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  const rename = useCallback(async (r: Row, typed?: string) => {
    if (busy.has(r.id)) return;
    const current = rowsRef.current?.find((x) => x.id === r.id) ?? r;
    const name = (await prompt({ title: "Rename dashboard", defaultValue: typed ?? current.name, submitLabel: "Rename", required: true }))?.trim();
    if (!name || name === current.name) return;
    const again = { label: "Try again", onClick: () => void rename(current, name) };
    lock(r.id, true);
    try {
      const res = await fetch(`/api/dashboards/${r.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: current.updatedAt, name: name.slice(0, 160) }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409) {
        await load();
        toast("This dashboard changed while you were renaming it.", { tone: "danger", action: again });
        return;
      }
      if (!res.ok) {
        toast(dashboardMessage(body, "Couldn't rename the dashboard."), { tone: "danger", action: again });
        return;
      }
      setRows((prev) => prev?.map((x) => (x.id === r.id ? { ...x, name, updatedAt: body?.dashboard?.updatedAt ?? x.updatedAt } : x)) ?? prev);
    } catch {
      toast("Couldn't reach the server, so the dashboard wasn't renamed.", { tone: "danger", action: again });
    } finally {
      lock(r.id, false);
    }
  }, [busy, prompt, load, toast]);

  const restore = useCallback(async (id: string, then?: () => void) => {
    if (busy.has(id)) return;
    const again = { label: "Try again", onClick: () => void restore(id, then) };
    lock(id, true);
    try {
      const res = await fetch(`/api/dashboards/${id}/restore`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(dashboardMessage(body, "Couldn't restore the dashboard."), { tone: "danger", action: again });
        return;
      }
      toast("Dashboard restored");
      then?.();
      await load();
    } catch {
      toast("Couldn't reach the server, so the dashboard wasn't restored.", { tone: "danger", action: again });
    } finally {
      lock(id, false);
    }
  }, [busy, load, toast]);

  // The request alone, so Try again does not ask the delete question twice.
  const sendArchive = useCallback(async (r: Row) => {
    if (busy.has(r.id)) return;
    const again = { label: "Try again", onClick: () => void sendArchive(r) };
    lock(r.id, true);
    try {
      const res = await fetch(`/api/dashboards/${r.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(dashboardMessage(body, "Couldn't delete the dashboard."), { tone: "danger", action: again });
        return;
      }
      setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? prev);
      toast("Dashboard moved to Archived", { onUndo: () => void restore(r.id) });
    } catch {
      toast("Couldn't reach the server, so the dashboard wasn't deleted.", { tone: "danger", action: again });
    } finally {
      lock(r.id, false);
    }
  }, [busy, restore, toast]);

  const archive = useCallback(async (r: Row) => {
    if (busy.has(r.id)) return;
    const ok = await confirm({
      title: `Delete ${r.name}?`,
      description: "It moves to Archived and can be restored; its email schedules pause until then.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await sendArchive(r);
  }, [busy, confirm, sendArchive]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!rows) return null;
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  const columns = useMemo<TableColumn<Row>[]>(
    () => [
      {
        key: "name",
        label: "Name",
        title: true,
        width: "minmax(220px,2fr)",
        render: (r) => (
          <span className="flex min-w-0 items-center gap-2">
            <EntityTile size="sm" icon={LayoutDashboard} name={r.name} {...NEUTRAL_TILE} />
            <span className="truncate">{r.name}</span>
          </span>
        ),
      },
      {
        key: "location",
        label: "Location",
        width: "minmax(120px,200px)",
        render: (r) =>
          r.space ? (
            <Link
              href={`/spaces/${r.space.slug}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-ink hover:underline"
              title={r.space.name}
            >
              {r.space.name}
            </Link>
          ) : r.spaceMissing ? (
            <span className="text-ink-2">Space removed</span>
          ) : (
            <span className="text-ink-2">Workspace</span>
          ),
      },
      {
        key: "owner",
        label: "Owner",
        width: "minmax(120px,180px)",
        render: (r) =>
          r.owner ? (
            <span className="inline-flex min-w-0 items-center gap-2">
              <Avatar person={r.owner} size={24} />
              <span className="truncate">{ownerName(r.owner)}</span>
            </span>
          ) : (
            <span className="text-ink-3">No owner</span>
          ),
      },
      { key: "widgets", label: "Widgets", numeric: true, width: "96px", render: (r) => <span className="tabular-nums">{fmt.count(r.widgetCount)}</span> },
      {
        key: "updated",
        label: "Updated",
        width: "minmax(110px,140px)",
        render: (r) => (
          <span className="tabular-nums text-ink-2" title={fmt.title(r.updatedAt)}>
            {fmt.relative(r.updatedAt)}
          </span>
        ),
      },
    ],
    [fmt],
  );

  const emptyText = q.trim() ? "No dashboards match" : view === "archived" ? "Nothing archived" : view === "mine" ? "You haven't made a dashboard yet" : "No dashboards yet";

  return (
    <>
      <OsPageHeader
        title="Dashboards"
        tile={{ icon: LayoutDashboard, name: "Dashboards", ...NEUTRAL_TILE }}
        views={VIEWS.map((v) => (
          <ViewTab key={v.key} icon={v.icon} label={v.label} active={view === v.key} onClick={() => { setRows(null); setView(v.key); }} />
        ))}
        toolbar={{
          left: (
            // The field shrinks with the toolbar's left cluster instead of
            // holding a fixed width. OsToolbar gives that cluster flex-1 and
            // min-w-0, so on a phone it narrows to whatever the primary button
            // leaves; a fixed 160px input spilled out of it and sat under
            // "New dashboard", with typed text running beneath the button.
            <label className="relative block min-w-0 max-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search dashboards"
                aria-label="Search dashboards"
                className="h-9 w-full rounded-md border border-line-strong bg-raised ps-8 pe-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand"
              />
            </label>
          ),
          primary: { label: "New dashboard", onClick: () => void createDashboard(), busy: creating },
        }}
      />
      <div className="os-chrome flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2">
        {loadError ? (
          <OsEmptyView variant="error" context="list" title="We couldn't load your dashboards." action={{ label: "Try again", onClick: () => void load() }} />
        ) : shown && shown.length === 0 && !q.trim() ? (
          <OsEmptyView context="list" title={emptyText} action={view === "all" || view === "mine" ? { label: "New dashboard", onClick: () => void createDashboard() } : undefined} />
        ) : (
          <TableCard<Row>
            ariaLabel="Dashboards"
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            rowHref={(r) => (r.archivedAt ? null : `/dashboards/${r.id}`)}
            rowMenu={(r) => (
              <RowMenu
                row={r}
                busy={busy.has(r.id)}
                onOpen={() => router.push(`/dashboards/${r.id}`)}
                onRename={() => void rename(r)}
                onDelete={() => void archive(r)}
                onRestore={() => void restore(r.id)}
              />
            )}
            empty={emptyText}
          />
        )}
      </div>
    </>
  );
}

function RowMenu({ row, busy, onOpen, onRename, onDelete, onRestore }: {
  row: Row;
  busy: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const archived = !!row.archivedAt;
  const deletable = row.canEdit && !isSpaceOverviewId(row.id);
  return (
    <>
      <RowMoreButton buttonRef={ref} open={open} onClick={() => setOpen((o) => !o)} label="Dashboard actions" />
      <MorePortal anchorRef={ref} width={200} open={open} placement="below" onClose={() => setOpen(false)}>
        <MenuList aria-label="Dashboard actions">
          {archived ? (
            <MenuItem icon={RotateCcw} label="Restore" busy={busy} onClick={() => { setOpen(false); onRestore(); }} />
          ) : (
            <>
              <MenuItem icon={ExternalLink} label="Open" onClick={() => { setOpen(false); onOpen(); }} />
              {row.canEdit ? <MenuItem icon={Pencil} label="Rename" busy={busy} onClick={() => { setOpen(false); onRename(); }} /> : null}
              {deletable ? (
                <>
                  <MenuSeparator />
                  <MenuItem icon={Trash2} label="Delete" destructive busy={busy} onClick={() => { setOpen(false); onDelete(); }} />
                </>
              ) : null}
            </>
          )}
        </MenuList>
      </MorePortal>
    </>
  );
}
