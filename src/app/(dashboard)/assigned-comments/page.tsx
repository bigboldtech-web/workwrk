"use client";

// Assigned Comments — ClickUp parity (Phase A, 2026-06-05).
// Tabs: Assigned to me · Delegated by me. Filter toolbar with Resolved
// toggle + date filter + search. Empty state matches ClickUp's
// "No results found" with Clear filters button.
//
// Comment-assignment schema does not exist yet — both tabs render the
// empty state. Real data lands when ItemUpdate gains an `assigneeId`.

import { useState, type CSSProperties } from "react";
import { ListFilter, Check, Calendar, Search, MessageSquare } from "lucide-react";

type Tab = "assigned" | "delegated";

// Brand-tinted fill — soft uses the workspace brand at low alpha for a
// cream chip; solid uses the brand at full strength for the pressed state.
function brandTintStyle(strength: number, kind: "soft" | "solid"): CSSProperties {
  if (kind === "solid") {
    return { background: "var(--os-brand-rail)" };
  }
  const pct = Math.round(strength * 100);
  return {
    background: `color-mix(in srgb, var(--os-brand-rail) ${pct}%, white)`,
    color: "var(--os-brand-rail)",
    borderColor: `color-mix(in srgb, var(--os-brand-rail) ${Math.min(pct + 8, 100)}%, transparent)`,
  };
}

export default function AssignedCommentsPage() {
  const [tab, setTab] = useState<Tab>("assigned");
  const [resolved, setResolved] = useState(false);
  const [dateRange, setDateRange] = useState("Last 90 Days");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const clearFilters = () => {
    setResolved(false);
    setDateRange("Last 90 Days");
    setQuery("");
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Top bar */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-200 bg-white !px-4 z-10">
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-normal leading-5 text-zinc-500">
          <h1 className="truncate font-semibold text-zinc-900" style={{ fontSize: "13px" }}>Assigned Comments</h1>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-100 !px-4 py-2">
        <TabButton active={tab === "assigned"} onClick={() => setTab("assigned")}>
          Assigned to me
        </TabButton>
        <TabButton active={tab === "delegated"} onClick={() => setTab("delegated")}>
          Delegated by me
        </TabButton>

        <span aria-hidden className="w-px h-5 bg-zinc-200 mx-1" />

        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 bg-white !px-3 text-[13px] text-zinc-600 hover:bg-zinc-50"
        >
          <ListFilter className="w-3.5 h-3.5" />
          Filter
        </button>
        <span aria-hidden className="w-px h-5 bg-zinc-200 mx-1" />
        <button
          type="button"
          onClick={() => setResolved((v) => !v)}
          aria-pressed={resolved}
          className={`inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 !px-3 text-[13px] transition-colors ${
            resolved
              ? "font-medium"
              : "text-zinc-600 hover:bg-zinc-50 bg-white"
          }`}
          style={resolved ? brandTintStyle(0.14, "soft") : undefined}
        >
          <Check className="w-3.5 h-3.5" />
          Resolved
        </button>
        <DateRangeDropdown value={dateRange} onChange={setDateRange} />
        <div className="flex-1" />
        {searchOpen ? (
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => { if (!query) setSearchOpen(false); }}
              placeholder="Search"
              className="h-8 w-[180px] rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-[12.5px] focus:border-zinc-400 focus:outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md !px-2.5 text-[13px] text-zinc-500 hover:bg-zinc-100"
          >
            <Search className="w-3.5 h-3.5" />
            Search
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50">
          <MessageSquare className="h-8 w-8 text-zinc-400" />
        </span>
        <p className="mb-5 text-[20px] font-semibold text-zinc-900">No results found</p>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-md border border-zinc-200 bg-white !px-4 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50"
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 !px-3 text-[13px] transition-colors ${
        active
          ? "font-medium"
          : "text-zinc-600 hover:bg-zinc-50 bg-white"
      }`}
      style={active ? brandTintStyle(0.14, "soft") : undefined}
    >
      {children}
    </button>
  );
}

function DateRangeDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = ["Today", "Last 7 Days", "Last 30 Days", "Last 90 Days", "All time"];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border !px-3 text-[13px]"
        style={brandTintStyle(0.12, "soft")}
      >
        <Calendar className="w-3.5 h-3.5" />
        {value}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute left-0 top-full mt-1 z-20 w-44 rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
            {options.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={`w-full text-left !px-3 py-1.5 text-[12.5px] hover:bg-zinc-50 ${
                    value === opt ? "text-zinc-900 font-medium" : "text-zinc-700"
                  }`}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
