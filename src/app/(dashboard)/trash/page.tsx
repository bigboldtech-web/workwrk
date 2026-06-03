"use client";

/* Trash — archive list. Nothing is ever hard-deleted in WorkwrK; the
 * "Trash" route surfaces everything the user has archived (items,
 * boards, docs, …) so they can restore from one place.
 *
 * This is the shell page. Real listings get wired up as each module
 * exposes a /api/<module>/archived endpoint; until then we render a
 * grouped placeholder so the menu link from the profile dropdown
 * leads somewhere intentional rather than a 404. */

import { useState } from "react";
import { Trash2, RotateCcw, Search, LayoutGrid, ClipboardList, FileText, Folder, Boxes } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";

type Tab = { key: string; label: string; Icon: typeof LayoutGrid };
const TABS: Tab[] = [
  { key: "all",    label: "All",    Icon: Boxes },
  { key: "items",  label: "Items",  Icon: ClipboardList },
  { key: "boards", label: "Boards", Icon: LayoutGrid },
  { key: "docs",   label: "Docs",   Icon: FileText },
  { key: "spaces", label: "Spaces", Icon: Folder },
];

export default function TrashPage() {
  const [tab, setTab] = useState<string>("all");
  const [query, setQuery] = useState("");

  return (
    <div className="flex flex-col h-full">
      <OsTitleBar
        title="Trash"
        Icon={Trash2}
        iconGradient=""
        description="Archived items live here forever. Nothing is ever permanently deleted — restore anything you need."
        showInvite={false}
      />

      <div className="px-6 pt-2 pb-3 border-b border-zinc-200 flex items-center gap-2">
        <div className="flex items-center gap-0.5 bg-zinc-100 rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                tab === t.key
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <t.Icon className="w-3 h-3" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search trash"
            className="pl-7 pr-2.5 py-1 text-[12px] bg-zinc-50 border border-zinc-200 rounded-md w-[220px] focus:bg-white focus:border-zinc-300 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <EmptyArchive />
      </div>
    </div>
  );
}

function EmptyArchive() {
  return (
    <div className="max-w-[640px] mx-auto py-12 text-center">
      <div
        className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "var(--os-brand-soft)", color: "var(--os-brand-deep)" }}
      >
        <Trash2 className="w-6 h-6" />
      </div>
      <h2 className="text-[16px] font-semibold text-zinc-900 mb-1.5">No archived items yet</h2>
      <p className="text-[13px] text-zinc-600 leading-relaxed mb-5">
        When you archive a board, item, doc, or space, it lands here.
        Nothing gets permanently removed — every archived record stays restorable
        forever so you can roll back any decision.
      </p>
      <div className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500">
        <RotateCcw className="w-3 h-3" />
        <span>Restore any archived item with a single click</span>
      </div>
    </div>
  );
}
