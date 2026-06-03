"use client";

// ClickTopbar — three separate rounded cards on the page background:
//   left card:   workspace switcher + calendar shortcut
//   center card: search bar (anchored center, max-w-[520px])
//   right card:  quick-access icons + avatar
//
// The cards float over the shell's outer page bg (zinc-100 in light mode),
// so the gaps between them read as the same surface as the gap between
// the rail and sidebar below. Matches the ClickUp screenshot pattern.
//
// Compact mode (2026-06-03): topbar shrunk from h-11 (44px) to h-8 (32px).
// Every child element resized to keep the bar visually balanced: K badge
// 24→20, avatar 28→24, icon paddings 6→4, search card py 4→2.

import { useRef, useState } from "react";
import Link from "next/link";
import { useOsShell } from "./shell-context";
import {
  ChevronDown, Search, Inbox, MessageSquare, Megaphone, ThumbsUp, FileSpreadsheet,
} from "lucide-react";
import { WorkspaceMenu } from "./workspace-menu";
import { AskAiButton } from "./ask-ai-button";
import { ProfileMenu } from "./profile-menu";
import { PROFILE_TOOL_MAP } from "./profile-tools";

export function ClickTopbar() {
  const { openPalette, openSidekick, profileToolPins, presenceStatus, mutedNotifications } = useOsShell();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const switcherRef = useRef<HTMLButtonElement>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const pinnedTools = profileToolPins
    .map((k) => PROFILE_TOOL_MAP[k])
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  return (
    <header className="relative h-8 flex-shrink-0 flex items-center gap-1.5">
      {/* Workspace card */}
      <div className="h-full flex items-center bg-white rounded-lg border border-zinc-200 px-1">
        <button
          ref={switcherRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-100"
          aria-label="Switch workspace"
          aria-expanded={menuOpen}
        >
          <span className="w-5 h-5 rounded-md bg-zinc-900 text-white flex items-center justify-center text-[10px] font-bold">
            K
          </span>
          <span className="text-[13px] font-medium text-zinc-900 leading-none">Cashkr Team</span>
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        </button>
        <WorkspaceMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={switcherRef} />
      </div>

      {/* Spacer pushes the search to its own slot */}
      <div className="flex-1" />

      {/* Search card — search trigger on the left, Ask AI pill on the right.
          Two distinct click targets inside one rounded card. */}
      <div className="h-full flex items-center bg-white rounded-lg border border-zinc-200 hover:border-zinc-300 hover:shadow-sm transition-all w-[520px] max-w-[44vw] pl-2.5 pr-0.5 py-0.5 gap-1.5">
        <button
          type="button"
          onClick={openPalette}
          className="flex-1 min-w-0 flex items-center gap-2 text-left group rounded-md px-1 hover:bg-zinc-50 h-full"
          aria-label="Search workspace"
        >
          <Search className="w-[13px] h-[13px] text-zinc-400 group-hover:text-zinc-600 transition-colors flex-shrink-0" />
          <span className="text-[12.5px] flex-1 text-zinc-500 truncate">
            Search tasks, docs, people, spaces…
          </span>
          <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 font-mono flex-shrink-0">⌘K</span>
        </button>
        <AskAiButton size="sm" onClick={() => openSidekick()} title="Ask the Brain (⌘J)" />
      </div>

      {/* Spacer balances the search to keep it visually centered */}
      <div className="flex-1" />

      {/* Right card: pinned personal-tool icons + workspace shortcuts +
          avatar. The pinned-tool icons are driven by profileToolPins
          (managed from the ProfileMenu dropdown). */}
      <div className="h-full flex items-center gap-0.5 bg-white rounded-lg border border-zinc-200 px-1">
        <div className="flex items-center gap-0.5">
          {pinnedTools.map((tool) => (
            <Link
              key={tool.key}
              href={tool.href ?? "#"}
              className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800"
              aria-label={tool.label}
              title={tool.tooltip ?? tool.label}
            >
              <tool.Icon className="w-[14px] h-[14px]" />
            </Link>
          ))}
          {pinnedTools.length > 0 ? (
            <span aria-hidden className="w-px h-3.5 bg-zinc-200 mx-0.5" />
          ) : null}
          <Link href="/inbox" className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800" aria-label="Inbox" title="Inbox">
            <Inbox className="w-[14px] h-[14px]" />
          </Link>
          <Link href="/candor" className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800" aria-label="Candor" title="Candor">
            <MessageSquare className="w-[14px] h-[14px]" />
          </Link>
          <Link href="/announcements" className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800" aria-label="Announcements" title="Announcements">
            <Megaphone className="w-[14px] h-[14px]" />
          </Link>
          <Link href="/kudos" className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800" aria-label="Kudos" title="Kudos">
            <ThumbsUp className="w-[14px] h-[14px]" />
          </Link>
          <Link href="/surveys" className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800" aria-label="Surveys" title="Surveys">
            <FileSpreadsheet className="w-[14px] h-[14px]" />
          </Link>
        </div>
        <div className="relative ml-1">
          <button
            ref={profileBtnRef}
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[10px] font-semibold"
            style={{ background: "var(--os-brand)" }}
            aria-label="Your profile"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            title={`${presenceStatus.label}${mutedNotifications ? " · muted" : ""}`}
          >
            IS
          </button>
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
          <ProfileMenu open={profileOpen} onClose={() => setProfileOpen(false)} anchorRef={profileBtnRef} />
        </div>
      </div>
    </header>
  );
}
