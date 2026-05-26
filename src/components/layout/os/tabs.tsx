"use client";

import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";

export type TabDef = {
  id: string;
  label: string;
  Icon: LucideIcon;
};

export function OsTabs({
  tabs,
  active,
  onSelect,
  canAdd = true,
}: {
  tabs: TabDef[];
  active: string;
  onSelect?: (id: string) => void;
  canAdd?: boolean;
}) {
  return (
    <div className="os-tabs">
      {tabs.map((t) => {
        const Icon = t.Icon;
        return (
          <button
            key={t.id}
            type="button"
            className={`os-tab ${active === t.id ? "is-active" : ""}`}
            onClick={() => onSelect?.(t.id)}
          >
            <Icon />
            <span>{t.label}</span>
          </button>
        );
      })}
      {canAdd ? (
        <button type="button" className="os-tab os-tab--add">
          <Plus />
          <span>Add view</span>
        </button>
      ) : null}
    </div>
  );
}
