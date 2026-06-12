"use client";

// ItemTypePicker — choose an Item's Task Type in the detail view. Reads
// the org's types from the shared cache (use-item-types) and stores the
// id; null = the org's default type.

import { useState, createElement } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useItemTypes } from "./use-item-types";
import { itemTypeIcon } from "@/lib/item-type-icons";

export function ItemTypePicker({ value, canEdit, onChange }: { value: string | null; canEdit: boolean; onChange: (id: string | null) => void }) {
  const { list, byId, default: def } = useItemTypes();
  const [open, setOpen] = useState(false);
  const current = value ? byId.get(value) ?? null : def;

  const chip = current ? (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-zinc-700">
      {createElement(itemTypeIcon(current.icon), { className: "w-3.5 h-3.5 text-zinc-400" })}
      {current.singular}
    </span>
  ) : (
    <span className="text-xs text-zinc-500">—</span>
  );

  if (!canEdit) return chip;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5">{chip}<ChevronDown className="w-3 h-3 text-zinc-500" /></button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[200px] max-h-[280px] overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg py-1" onMouseLeave={() => setOpen(false)}>
          {list.map((t) => (
            <button key={t.id} type="button" onClick={() => { onChange(t.id); setOpen(false); }} className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50">
              {createElement(itemTypeIcon(t.icon), { className: "w-3.5 h-3.5 text-zinc-500 shrink-0" })}
              <span className="flex-1 truncate">{t.singular}{t.isDefault ? <span className="ml-1.5 text-[10px] text-zinc-400">(default)</span> : null}</span>
              {(value ?? def?.id) === t.id ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
