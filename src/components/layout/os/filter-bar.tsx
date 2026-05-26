"use client";

import { Plus, Search, Users, Filter, ArrowUpDown, EyeOff, Group, MoreHorizontal, ChevronDown } from "lucide-react";

export function OsFilterBar({ newLabel = "New item", activeFilters = 0 }: { newLabel?: string; activeFilters?: number }) {
  return (
    <div className="os-filter">
      <div className="os-btn-new">
        <button type="button" className="os-btn-new__main">
          <Plus />
          <span>{newLabel}</span>
        </button>
        <button type="button" className="os-btn-new__chev" aria-label="More create options">
          <ChevronDown />
        </button>
      </div>
      <button type="button" className="os-filter-chip">
        <Search />
        <span>Search</span>
      </button>
      <button type="button" className="os-filter-chip">
        <Users />
        <span>Person</span>
      </button>
      <button type="button" className={`os-filter-chip ${activeFilters > 0 ? "is-on" : ""}`}>
        <Filter />
        <span>Filter</span>
        {activeFilters > 0 ? <span className="os-filter-chip__count">{activeFilters}</span> : null}
      </button>
      <button type="button" className="os-filter-chip">
        <ArrowUpDown />
        <span>Sort</span>
      </button>
      <button type="button" className="os-filter-chip">
        <EyeOff />
        <span>Hide</span>
      </button>
      <button type="button" className="os-filter-chip">
        <Group />
        <span>Group by</span>
      </button>
      <div className="os-filter__spacer" />
      <button type="button" className="os-filter-chip" aria-label="More options">
        <MoreHorizontal />
      </button>
    </div>
  );
}
