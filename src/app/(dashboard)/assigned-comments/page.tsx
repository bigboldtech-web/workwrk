"use client";

// Assigned Comments — ClickUp parity (Phase A, 2026-06-05).
// Tabs: Assigned to me · Delegated by me. Filter toolbar with Resolved
// toggle + date filter + search. Empty state matches ClickUp's
// "No results found" with Clear filters button.
//
// Comment-assignment schema does not exist yet — both tabs render the
// empty state. Real data lands when ItemUpdate gains an `assigneeId`.

import { useState } from "react";
import { ListFilter, Check, Calendar, Search, MessageSquare } from "lucide-react";

type Tab = "assigned" | "delegated";

export default function AssignedCommentsPage() {
  const [tab, setTab] = useState<Tab>("assigned");
  const [resolved, setResolved] = useState(false);
  const [dateRange, setDateRange] = useState("Last 90 Days");
  const [query, setQuery] = useState("");

  const filtersActive = resolved || dateRange !== "Last 90 Days" || query.length > 0;
  const clearFilters = () => {
    setResolved(false);
    setDateRange("Last 90 Days");
    setQuery("");
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-6 pt-4">
        <h1 className="text-base font-semibold text-zinc-900 mb-3">Assigned Comments</h1>
        <div className="flex items-center gap-4 border-b border-zinc-100">
          <TabButton active={tab === "assigned"} onClick={() => setTab("assigned")}>
            Assigned to me
          </TabButton>
          <TabButton active={tab === "delegated"} onClick={() => setTab("delegated")}>
            Delegated by me
          </TabButton>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-2 flex items-center gap-2 border-b border-zinc-100">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-zinc-700 hover:bg-zinc-50"
        >
          <ListFilter className="w-3.5 h-3.5" />
          Filter
        </button>
        <button
          type="button"
          onClick={() => setResolved((v) => !v)}
          aria-pressed={resolved}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] ${
            resolved
              ? "bg-zinc-900 text-white"
              : "text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          Resolved
        </button>
        <DateRangeDropdown value={dateRange} onChange={setDateRange} />
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="pl-7 pr-2 py-1 text-[12px] border border-zinc-200 rounded w-[160px] focus:outline-none focus:border-zinc-400"
          />
        </div>
      </div>

      {/* Body — empty state */}
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl border border-zinc-200 mb-3">
          <MessageSquare className="w-5 h-5 text-zinc-400" />
        </span>
        <p className="text-sm font-medium text-zinc-800 mb-3">No results found</p>
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-[12.5px] px-3 py-1.5 rounded border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
          >
            Clear filters
          </button>
        ) : (
          <p className="text-[12px] text-zinc-500 max-w-[320px]">
            {tab === "assigned"
              ? "Comments assigned to you will appear here."
              : "Comments you've delegated to others will appear here."}
          </p>
        )}
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
      className={`py-2 text-[13px] border-b-2 -mb-px transition-colors ${
        active
          ? "border-zinc-900 text-zinc-900 font-medium"
          : "border-transparent text-zinc-500 hover:text-zinc-900"
      }`}
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
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-zinc-700 hover:bg-zinc-50 border border-zinc-200"
      >
        <Calendar className="w-3.5 h-3.5" />
        {value}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute left-0 top-full mt-1 z-20 w-44 bg-white border border-zinc-200 rounded-md shadow-lg py-1">
            {options.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-zinc-50 ${
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
