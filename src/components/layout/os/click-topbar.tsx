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
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useOsShell } from "./shell-context";
import { ChevronDown, Search } from "lucide-react";
import { WorkspaceMenu } from "./workspace-menu";
import { ToolGlyph, hasToolGlyph } from "@/components/brand/app-glyphs";
import { AskAiButton } from "./ask-ai-button";
import { ProfileMenu } from "./profile-menu";
import { PROFILE_TOOL_MAP, type ToolAction } from "./profile-tools";
import { useOsToast } from "./toast";
import { ActiveTimerPill } from "./active-timer-pill";

// Initials for the active workspace badge, e.g. "Test 2" -> "T2".
function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// Colorful, slightly 3D calendar icon (flat fills + a soft drop shadow, no
// gradients). Red header with binder rings, white body, YBRG event dots.
function CalendarGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ filter: "drop-shadow(0 1px 1.5px rgba(20,24,40,0.28))" }}>
      <rect x="3" y="5.5" width="18" height="15.5" rx="3.2" fill="#FFFFFF" stroke="#E2E5EC" strokeWidth="1" />
      <path d="M3 9.2a3.2 3.2 0 0 1 3.2-3.2h11.6A3.2 3.2 0 0 1 21 9.2v.6H3z" fill="#FF3D57" />
      <rect x="7.3" y="3" width="2.1" height="4.4" rx="1.05" fill="#0B1324" />
      <rect x="14.6" y="3" width="2.1" height="4.4" rx="1.05" fill="#0B1324" />
      <rect x="6.4" y="12" width="3.1" height="3.1" rx="0.9" fill="#0073EA" />
      <rect x="10.9" y="12" width="3.1" height="3.1" rx="0.9" fill="#FFCB00" />
      <rect x="15.4" y="12" width="2.4" height="3.1" rx="0.9" fill="#00C875" />
      <rect x="6.4" y="16.4" width="3.1" height="2.6" rx="0.9" fill="#E6E9EF" />
      <rect x="10.9" y="16.4" width="3.1" height="2.6" rx="0.9" fill="#0073EA" />
    </svg>
  );
}

export function ClickTopbar() {
  const { openPalette, openSidekick, openCreateTask, profileToolPins, presenceStatus, mutedNotifications } = useOsShell();
  const { toast } = useOsToast();
  const router = useRouter();
  const { data: session } = useSession();
  const orgName = session?.user?.organizationName ?? "Workspace";
  const [menuOpen, setMenuOpen] = useState(false);

  async function createQuickDoc() {
    try {
      const res = await fetch("/api/docs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled doc", content: { type: "doc", content: [{ type: "paragraph" }] } }),
      });
      if (!res.ok) { toast("Couldn't create doc"); return; }
      const d = await res.json();
      router.push(`/docs/${d.doc.id}`);
    } catch { toast("Couldn't create doc"); }
  }

  function runTool(action: ToolAction) {
    switch (action) {
      case "create-task": openCreateTask(); break;
      case "my-work": window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "my-work" })); break;
      case "notepad": window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "notepad" })); break;
      case "reminder": window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "reminder" })); break;
      case "doc": void createQuickDoc(); break;
      case "voice": toast("Voice to text is coming soon"); break;
    }
  }
  const [profileOpen, setProfileOpen] = useState(false);
  const switcherRef = useRef<HTMLButtonElement>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const pinnedTools = profileToolPins
    .map((k) => PROFILE_TOOL_MAP[k])
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  return (
    <header className="relative h-8 flex-shrink-0 flex items-center gap-2">
      {/* Workspace card */}
      <div className="h-full flex items-center gap-1">
        <button
          ref={switcherRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 h-7 px-2 rounded-lg bg-zinc-100 hover:bg-zinc-200/80"
          aria-label="Switch workspace"
          aria-expanded={menuOpen}
        >
          <span className="w-5 h-5 rounded-md bg-zinc-900 text-white flex items-center justify-center text-[10px] font-bold">
            {orgInitials(orgName)}
          </span>
          <span className="text-[13px] font-medium text-zinc-900 leading-none max-w-[160px] truncate">{orgName}</span>
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        </button>
        <Link
          href="/calendar"
          aria-label="Calendar"
          title="Calendar"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-zinc-100"
        >
          <CalendarGlyph size={18} />
        </Link>
        <WorkspaceMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={switcherRef} />
      </div>

      {/* Spacer pushes the search to its own slot */}
      <div className="flex-1" />

      {/* Search card — search trigger on the left, Ask AI pill on the right.
          Two distinct click targets inside one rounded card. */}
      <div className="h-full flex items-center bg-white rounded-full border border-zinc-200 hover:border-zinc-300 hover:shadow-sm transition-all w-[520px] max-w-[44vw] pl-3 pr-1 py-0.5 gap-1.5">
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
        <ActiveTimerPill />
        <div className="flex items-center gap-0.5">
          {pinnedTools.map((tool) => {
            const inner = hasToolGlyph(tool.key) ? <ToolGlyph toolKey={tool.key} size={17} /> : <tool.Icon className="w-[14px] h-[14px]" />;
            const cls = "p-1 rounded-md hover:bg-zinc-100 inline-flex items-center justify-center";
            if (tool.action) {
              return (
                <button key={tool.key} type="button" onClick={() => runTool(tool.action!)} className={cls} aria-label={tool.label} title={tool.tooltip ?? tool.label}>
                  {inner}
                </button>
              );
            }
            return (
              <Link key={tool.key} href={tool.href ?? "#"} className={`${cls} text-zinc-500 hover:text-zinc-800`} aria-label={tool.label} title={tool.tooltip ?? tool.label}>
                {inner}
              </Link>
            );
          })}
          {pinnedTools.length > 0 ? (
            <span aria-hidden className="w-px h-3.5 bg-zinc-200 mx-0.5" />
          ) : null}
          <Link
            href="/inbox"
            aria-label="Inbox"
            title="Inbox"
            className="p-1 rounded-md hover:bg-zinc-100 inline-flex items-center justify-center"
          >
            <ToolGlyph toolKey="inbox" size={17} />
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
