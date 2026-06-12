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

import { useRef, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
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
  Rocket,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { MorePortal } from "./more-portal";
import { TAUPE } from "@/components/ui/accent";

const MENU_WIDTH = 312;

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
  const { openCreateTask, openCreateList, openCustomize } = useOsShell();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={MENU_WIDTH} open={open} placement="below">
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_14px_34px_rgba(0,0,0,0.14)]">
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
                if (event.key === "Escape") onClose();
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
              onClick={() => run(() => router.push("/docs?new=1"))}
            />
            <MenuRow
              Icon={ClipboardCheck}
              label="Form"
              iconClassName="text-violet-500"
              chevron
              onClick={() => run(() => router.push("/forms?new=1"))}
            />
            <MenuRow
              Icon={LayoutDashboard}
              label="Dashboard"
              iconClassName="text-purple-500"
              chevron
              onClick={() => run(() => router.push("/dashboard?new=1"))}
            />
            <MenuRow
              Icon={Brush}
              label="Whiteboard"
              iconClassName="text-amber-500"
              chevron
              onClick={() => run(() => router.push("/whiteboards?new=1"))}
            />
            <MenuRow
              Icon={Database}
              label="Database"
              description="Spreadsheet-style rows & columns"
              iconClassName="text-emerald-600"
              chevron
              onClick={() => run(() => router.push("/tables"))}
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
              onClick={() => run(() => router.push("/templates"))}
              className="flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Rocket className="h-4 w-4 text-zinc-500" />
              Templates
            </button>
          </div>
        </div>
      </MorePortal>
    </>
  );
}
