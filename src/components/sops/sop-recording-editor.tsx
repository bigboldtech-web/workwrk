"use client";

// The Recording editor (spec-process section 2 `/sops/[id]`, Content tab in
// edit mode): step cards with the screenshot, inline caption editing and
// Move up / Move down / Delete in the card's "…" (the ▲▼ text buttons are
// gone). Adding a manual step is still possible. Recorded-step edits follow
// the page's one save model: this component only reports the next list.

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { RowMoreButton } from "@/components/ui/table-card";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";

export interface RecordedStep {
  order: number;
  action: string;
  description: string;
  url: string;
  screenshot: string | null;
  elementText?: string;
  elementTag?: string;
}

export function SopRecordingEditor({ steps, onChange }: { steps: RecordedStep[]; onChange: (next: RecordedStep[]) => void }) {
  const [menu, setMenu] = useState<{ index: number; anchor: React.RefObject<HTMLButtonElement | null> } | null>(null);
  const renumber = (list: RecordedStep[]) => list.map((s, i) => ({ ...s, order: i + 1 }));
  const swap = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= steps.length || b >= steps.length) return;
    const next = steps.slice();
    [next[a], next[b]] = [next[b], next[a]];
    onChange(renumber(next));
  };
  const remove = (i: number) => onChange(renumber(steps.filter((_, k) => k !== i)));
  const add = () => onChange(renumber([...steps, { order: steps.length + 1, action: "manual", description: "", url: "", screenshot: null, elementText: "", elementTag: "" }]));

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-line bg-raised">
          {step.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={step.screenshot} alt={`Step ${index + 1}`} loading="lazy" decoding="async" className="block w-full max-w-[720px] border-b border-line" />
          ) : null}
          <div className="flex items-start gap-3 px-3 py-3">
            <span className="mt-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-active px-1.5 text-xs font-medium tabular-nums text-ink">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <input
                value={step.description}
                onChange={(e) => onChange(steps.map((s, k) => (k === index ? { ...s, description: e.target.value } : s)))}
                placeholder={`Step ${index + 1}`}
                className="h-8 w-full rounded-md bg-transparent px-2 text-prose text-ink placeholder:text-ink-3 focus:bg-subtle focus:outline-none"
              />
              {step.url ? <p className="mt-0.5 truncate px-2 text-xs text-ink-3">{step.url}</p> : null}
            </div>
            <RecMenuButton open={menu?.index === index} onOpen={(anchor) => setMenu({ index, anchor })} />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} className="inline-flex h-11 items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">
        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add step
      </button>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={200} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem label="Move up" disabled={menu.index <= 0} onClick={() => swap(menu.index, menu.index - 1)} />
            <MenuItem label="Move down" disabled={menu.index >= steps.length - 1} onClick={() => swap(menu.index, menu.index + 1)} />
            <MenuSeparator />
            <MenuItem label="Delete" destructive onClick={() => remove(menu.index)} />
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}

function RecMenuButton({ open, onOpen }: { open: boolean; onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Step actions" />;
}
