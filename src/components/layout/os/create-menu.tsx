"use client";

// CreateMenu — the sidebar "+" popover, the OS-wide "create anything"
// control. Extracted from click-sidebar.tsx so the menu can grow real
// inline create flows without bloating the sidebar shell.
//
// Layout per docs/plans/plus-create-menu-plan.md §3:
//   AI input (describe → create)
//   Create:  Task (⌥T) · List · Space
//   AI:      Create with AI · Super Agent (Hot)
//   Build:   Doc · Form · Dashboard · Whiteboard · Database
//   Footer:  Customize sidebar · Import · Templates
//
// Build rows open an inline "New X" step (name + optional Space
// location) that POSTs the entity's real API and navigates to it —
// no more dead ?new=1 links.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Boxes,
  Brush,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileText,
  Import,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Rocket,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { MorePortal } from "./more-portal";
import { TAUPE, taupeButton } from "@/components/ui/accent";

const MENU_WIDTH = 312;

type BuildKind = "doc" | "form" | "dashboard" | "whiteboard" | "database";

// Default Database columns — same id scheme as /api/tables' defaultId.
// Gives a new database an immediately useful grid instead of a single
// bare "Name" column.
function defaultDatabaseColumns() {
  const id = () => Math.random().toString(36).slice(2, 10);
  return [
    { id: id(), type: "short_text", label: "Name" },
    { id: id(), type: "select", label: "Status", options: ["To do", "In progress", "Done"] },
    { id: id(), type: "date", label: "Due date" },
    { id: id(), type: "long_text", label: "Notes" },
  ];
}

// Per-entity create config: which API to call, how to shape the body,
// where the created id lives in the response, and where to land.
const BUILD_META: Record<BuildKind, {
  label: string;
  Icon: LucideIcon;
  iconClassName: string;
  placeholder: string;
  /** Forms are org-level (they target a board, not a Space). */
  hasLocation: boolean;
  endpoint: string;
  body: (name: string, spaceId: string | null) => Record<string, unknown>;
  idFrom: (data: unknown) => string | undefined;
  href: (id: string) => string;
}> = {
  doc: {
    label: "Doc",
    Icon: FileText,
    iconClassName: "text-blue-500",
    placeholder: "Doc title",
    hasLocation: true,
    endpoint: "/api/docs",
    body: (name, spaceId) => ({
      title: name,
      ...(spaceId ? { entityType: "SPACE", entityId: spaceId } : {}),
    }),
    idFrom: (data) => (data as { doc?: { id?: string } })?.doc?.id,
    href: (id) => `/docs/${id}`,
  },
  form: {
    label: "Form",
    Icon: ClipboardCheck,
    iconClassName: "text-violet-500",
    placeholder: "Form name",
    hasLocation: false,
    endpoint: "/api/forms",
    body: (name) => ({ name }),
    // /api/forms returns the form row directly (jsonSuccess).
    idFrom: (data) => (data as { id?: string })?.id,
    href: (id) => `/forms/${id}`,
  },
  dashboard: {
    label: "Dashboard",
    Icon: LayoutDashboard,
    iconClassName: "text-purple-500",
    placeholder: "Dashboard name",
    hasLocation: true,
    endpoint: "/api/dashboards",
    body: (name, spaceId) => ({ name, ...(spaceId ? { spaceId } : {}) }),
    idFrom: (data) => (data as { dashboard?: { id?: string } })?.dashboard?.id,
    href: (id) => `/dashboards/${id}`,
  },
  whiteboard: {
    label: "Whiteboard",
    Icon: Brush,
    iconClassName: "text-amber-500",
    placeholder: "Whiteboard name",
    hasLocation: true,
    endpoint: "/api/whiteboards",
    body: (name, spaceId) => ({ name, ...(spaceId ? { spaceId } : {}) }),
    idFrom: (data) => (data as { whiteboard?: { id?: string } })?.whiteboard?.id,
    href: (id) => `/whiteboards/${id}`,
  },
  database: {
    label: "Database",
    Icon: Database,
    iconClassName: "text-emerald-600",
    placeholder: "Database name",
    hasLocation: true,
    endpoint: "/api/tables",
    body: (name, spaceId) => ({
      name,
      columns: defaultDatabaseColumns(),
      ...(spaceId ? { spaceId } : {}),
    }),
    // /api/tables returns the table row directly (jsonSuccess).
    idFrom: (data) => (data as { id?: string })?.id,
    href: (id) => `/tables/${id}`,
  },
};

function MenuSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">
      {children}
    </div>
  );
}

// The one reusable row. 36px tall, 16px icon, optional description /
// shortcut / badge, and an aligned chevron for rows that open a
// follow-up step instead of firing immediately.
function MenuRow({
  Icon,
  label,
  description,
  shortcut,
  badge,
  chevron,
  active,
  iconClassName = "text-zinc-500",
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  description?: string;
  shortcut?: string;
  badge?: string;
  chevron?: boolean;
  active?: boolean;
  iconClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-zinc-900 ${
        active ? "bg-zinc-100" : "hover:bg-zinc-50"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {description ? (
          <span className="block truncate text-[12px] font-normal text-zinc-500">{description}</span>
        ) : null}
      </span>
      {badge ? (
        <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">
          {badge}
        </span>
      ) : null}
      {shortcut ? <span className="text-[12px] text-zinc-400">{shortcut}</span> : null}
      {chevron ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" /> : null}
    </button>
  );
}

interface CreateMenuProps {
  anchorRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  /** Space row action. Today this proxies the active app's new-action
   *  (same as the old menu); a global Space wizard hook is a
   *  lists-spaces-spec follow-up. */
  onCreateSpace: () => void;
}

export function CreateMenu({ anchorRef, open, onClose, onCreateSpace }: CreateMenuProps) {
  const { openCreateTask, openCreateList, openCustomize, openTemplateCenter } = useOsShell();
  const { toast } = useOsToast();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [buildKind, setBuildKind] = useState<BuildKind | null>(null);
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [spaces, setSpaces] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Lazy-load the Space list the first time a location-aware step opens.
  useEffect(() => {
    if (!buildKind || !BUILD_META[buildKind].hasLocation || spaces !== null) return;
    let cancelled = false;
    void fetch("/api/spaces")
      .then((res) => (res.ok ? res.json() : { spaces: [] }))
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.spaces) ? data.spaces : [];
        setSpaces(rows.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
      })
      .catch(() => { if (!cancelled) setSpaces([]); });
    return () => { cancelled = true; };
  }, [buildKind, spaces]);

  useEffect(() => {
    if (buildKind) setTimeout(() => nameRef.current?.focus(), 0);
  }, [buildKind]);

  if (!open) return null;

  const resetStep = () => {
    setBuildKind(null);
    setName("");
    setSpaceId("");
    setBusy(false);
  };

  const close = () => {
    resetStep();
    onClose();
  };

  const run = (action: () => void) => {
    close();
    action();
  };

  const submit = async () => {
    if (!buildKind) return;
    const meta = BUILD_META[buildKind];
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch(meta.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(meta.body(trimmed, meta.hasLocation && spaceId ? spaceId : null)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast((data as { error?: string })?.error ?? `Couldn't create ${meta.label.toLowerCase()}`);
        return;
      }
      const id = meta.idFrom(data);
      if (!id) {
        toast(`Couldn't create ${meta.label.toLowerCase()}`);
        return;
      }
      const href = meta.href(id);
      close();
      router.push(href);
    } catch {
      toast(`Couldn't create ${meta.label.toLowerCase()}`);
    } finally {
      setBusy(false);
    }
  };

  const step = buildKind ? BUILD_META[buildKind] : null;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={close} aria-hidden />
      <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={MENU_WIDTH} open={open} placement="below">
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_14px_34px_rgba(0,0,0,0.14)]">
          {step ? (
            <div className="p-2">
              <div className="mb-1 flex items-center gap-1.5 px-0.5">
                <button
                  type="button"
                  onClick={resetStep}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <step.Icon className={`h-4 w-4 ${step.iconClassName}`} />
                <span className="text-[13px] font-semibold text-zinc-900">New {step.label}</span>
              </div>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") resetStep();
                }}
                placeholder={step.placeholder}
                className="h-8 w-full rounded-lg border bg-white px-2.5 text-[13px] outline-none"
                style={{ borderColor: TAUPE.ring }}
              />
              {step.hasLocation ? (
                <select
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                  className="mt-2 h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700 outline-none focus:border-zinc-400"
                >
                  <option value="">No location · org-wide</option>
                  {(spaces ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!name.trim() || busy}
                className={`mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] text-white ${taupeButton}`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Create {step.label}
              </button>
            </div>
          ) : (
            <>
              <div className="p-2">
                <input
                  type="text"
                  className="h-8 w-full rounded-lg border bg-white px-2.5 text-[13px] outline-none"
                  style={{ borderColor: TAUPE.ring }}
                  placeholder="Describe anything to create"
                  onKeyDown={(event) => {
                    // v1: any description creates a Task. NLP intent routing
                    // (task vs doc vs list) is a fast-follow — plan §3.
                    if (event.key === "Enter") run(openCreateTask);
                    if (event.key === "Escape") close();
                  }}
                  autoFocus
                />
              </div>
              <div className="px-2 pb-2">
                <MenuSectionLabel>Create</MenuSectionLabel>
                <MenuRow
                  Icon={CheckCircle2}
                  label="Task"
                  shortcut="⌥T"
                  active
                  onClick={() => run(openCreateTask)}
                />
                <MenuRow
                  Icon={ListChecks}
                  label="List"
                  description="Track tasks, projects, people & more"
                  onClick={() => run(openCreateList)}
                />
                <MenuRow
                  Icon={Boxes}
                  label="Space"
                  description="Organize work by team or department"
                  onClick={() => run(onCreateSpace)}
                />
              </div>
              <div className="border-t border-zinc-100 px-2 pb-2 pt-1">
                <MenuSectionLabel>AI</MenuSectionLabel>
                <MenuRow
                  Icon={Sparkles}
                  label="Create with AI"
                  iconClassName="text-fuchsia-500"
                  onClick={() => run(() => router.push("/sidekick"))}
                />
                <MenuRow
                  Icon={Bot}
                  label="Super Agent"
                  badge="Hot"
                  iconClassName="text-blue-500"
                  onClick={() => run(() => router.push("/agents"))}
                />
              </div>
              <div className="border-t border-zinc-100 px-2 pb-2 pt-1">
                <MenuSectionLabel>Build</MenuSectionLabel>
                <MenuRow
                  Icon={FileText}
                  label="Doc"
                  iconClassName="text-blue-500"
                  chevron
                  onClick={() => setBuildKind("doc")}
                />
                <MenuRow
                  Icon={ClipboardCheck}
                  label="Form"
                  iconClassName="text-violet-500"
                  chevron
                  onClick={() => setBuildKind("form")}
                />
                <MenuRow
                  Icon={LayoutDashboard}
                  label="Dashboard"
                  iconClassName="text-purple-500"
                  chevron
                  onClick={() => setBuildKind("dashboard")}
                />
                <MenuRow
                  Icon={Brush}
                  label="Whiteboard"
                  iconClassName="text-amber-500"
                  chevron
                  onClick={() => setBuildKind("whiteboard")}
                />
                <MenuRow
                  Icon={Database}
                  label="Database"
                  description="Spreadsheet-style rows & columns"
                  iconClassName="text-emerald-600"
                  chevron
                  onClick={() => setBuildKind("database")}
                />
              </div>
              <div className="border-t border-zinc-100 px-2 py-2">
                <MenuRow
                  Icon={SlidersHorizontal}
                  label="Customize your sidebar"
                  onClick={() => run(openCustomize)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 p-2">
                <button
                  type="button"
                  onClick={() => run(() => router.push("/imports"))}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <Import className="h-4 w-4 text-zinc-500" />
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => run(() => openTemplateCenter())}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <Rocket className="h-4 w-4 text-zinc-500" />
                  Templates
                </button>
              </div>
            </>
          )}
        </div>
      </MorePortal>
    </>
  );
}
