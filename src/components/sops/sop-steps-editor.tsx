"use client";

// The Step-by-step editor (spec-process section 2 `/sops/[id]`, Content tab
// in edit mode): numbered step cards with a 44px header row (grip, number
// pill, title input, "…" with Move up / Move down / Duplicate / Delete), a
// body with the step's rich text and optional image (StepImageEditor), an
// "+ Add step" ghost row, and drag to reorder. The flow layout renders the
// same steps through ProcessFlowBuilder (with branches). The "Show as flow"
// display option lives on the Content tab's "…" in the page; this component
// only renders whichever layout it is handed.
//
// Everything a person could do to a step before is here: add, edit title
// and rich description, attach an image by upload or URL, reorder by drag
// or by the menu, duplicate, delete.

import { useRef, useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import { RichEditor } from "@/components/ui/rich-editor";
import { RowMoreButton } from "@/components/ui/table-card";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { usePrompt } from "@/components/ui/dialog-provider";
import { ProcessFlowBuilder, type ProcessFlow } from "@/components/process-flow-builder";
import { cn } from "@/lib/utils";

export interface EditStep {
  id: string;
  title: string;
  description?: string;
  image?: string;
}

export function newStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The lossy conversions between the two layouts (branches do not survive the list). */
export function flowFromSteps(steps: EditStep[]): ProcessFlow {
  return { type: "process_flow", steps: steps.map((s) => ({ id: s.id, title: s.title || "Untitled", description: s.description, type: "action" as const })) };
}
export function stepsFromFlow(flow: ProcessFlow | null | undefined): EditStep[] {
  return (flow?.steps ?? []).map((s) => ({ id: s.id, title: s.title, description: s.description }));
}

function StepImageEditor({ image, onChange }: { image?: string; onChange: (img: string) => void }) {
  const prompt = usePrompt();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const src = reader.result as string; if (src) onChange(src); };
    reader.readAsDataURL(file);
  }
  async function handleUrl() {
    const url = await prompt({ title: "Paste image URL", description: "Leave blank to remove the current image.", defaultValue: image || "", placeholder: "https://", submitLabel: image ? "Save" : "Add image", required: false });
    if (url === null) return;
    onChange(url);
  }

  if (image) {
    return (
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="max-h-48 rounded-lg border border-line" />
        <div className="absolute end-1 top-1 flex gap-1">
          <button type="button" onClick={() => void handleUrl()} className="rounded bg-inverse px-1.5 py-0.5 text-xs text-inverse-fg">Replace</button>
          <button type="button" onClick={() => onChange("")} aria-label="Remove image" className="rounded bg-inverse px-1.5 py-0.5 text-xs text-inverse-fg">Remove</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={handleFile} />
      <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex h-7 items-center rounded-md border border-dashed border-line-strong px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">Upload image</button>
      <button type="button" onClick={() => void handleUrl()} className="inline-flex h-7 items-center rounded-md px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">or paste a URL</button>
    </div>
  );
}

export function SopStepsEditor({ layout, steps, flow, onStepsChange, onFlowChange }: {
  layout: "list" | "flow";
  steps: EditStep[];
  flow: ProcessFlow;
  onStepsChange: (next: EditStep[]) => void;
  onFlowChange: (next: ProcessFlow) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: React.RefObject<HTMLButtonElement | null> } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  if (layout === "flow") {
    return <ProcessFlowBuilder flow={flow} onChange={onFlowChange} editing />;
  }

  const update = (id: string, patch: Partial<EditStep>) => onStepsChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return;
    const next = steps.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onStepsChange(next);
  };
  const add = () => {
    const s: EditStep = { id: newStepId(), title: "", description: "" };
    onStepsChange([...steps, s]);
    setOpenId(s.id);
  };
  const duplicate = (i: number) => {
    const src = steps[i];
    const copy: EditStep = { ...src, id: newStepId() };
    const next = steps.slice();
    next.splice(i + 1, 0, copy);
    onStepsChange(next);
  };
  const remove = (id: string) => {
    onStepsChange(steps.filter((s) => s.id !== id));
    if (openId === id) setOpenId(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const open = openId === step.id;
        return (
          <div
            key={step.id}
            draggable={!open}
            onDragStart={(e) => { setDragId(step.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", step.id); }}
            onDragOver={(e) => { if (!dragId || dragId === step.id) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overId !== step.id) setOverId(step.id); }}
            onDragLeave={() => { if (overId === step.id) setOverId(null); }}
            onDrop={(e) => { e.preventDefault(); const from = steps.findIndex((s) => s.id === (dragId || e.dataTransfer.getData("text/plain"))); if (from >= 0) move(from, index); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            className={cn("rounded-lg border bg-raised", dragId === step.id ? "opacity-40" : "", overId === step.id && dragId && dragId !== step.id ? "border-brand" : "border-line")}
          >
            <div className="flex h-11 items-center gap-2 px-2">
              <span className="inline-flex h-7 w-7 cursor-grab items-center justify-center text-ink-3 active:cursor-grabbing" aria-label="Drag to reorder" title="Drag to reorder">
                <GripVertical className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </span>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-active px-1.5 text-xs font-medium tabular-nums text-ink">{index + 1}</span>
              <input
                value={step.title}
                onChange={(e) => update(step.id, { title: e.target.value })}
                onFocus={() => setOpenId(step.id)}
                placeholder="Step title"
                className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-row font-medium text-ink placeholder:text-ink-3 focus:bg-subtle focus:outline-none"
              />
              <button type="button" onClick={() => setOpenId(open ? null : step.id)} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                {open ? "Done" : "Edit"}
              </button>
              <StepMenuButton id={step.id} open={menu?.id === step.id} onOpen={(anchor) => setMenu({ id: step.id, anchor })} />
            </div>
            {open ? (
              <div className="flex flex-col gap-3 px-4 pb-4 ps-12">
                <RichEditor
                  content={step.description || ""}
                  onChange={(html) => update(step.id, { description: html })}
                  placeholder="Add details, links, lists or formatting. Press / for commands."
                  editable
                  compact
                  minHeight="80px"
                />
                <StepImageEditor image={step.image} onChange={(img) => update(step.id, { image: img })} />
              </div>
            ) : step.description || step.image ? (
              <button type="button" onClick={() => setOpenId(step.id)} className="block w-full px-4 pb-3 ps-12 text-start">
                {step.description ? <span className="line-clamp-2 text-sm text-ink-2">{step.description.replace(/<[^>]+>/g, " ").trim()}</span> : null}
                {step.image ? <span className="block text-xs text-ink-3">Has an image</span> : null}
              </button>
            ) : null}
          </div>
        );
      })}
      <button type="button" onClick={add} className="inline-flex h-11 items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">
        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add step
      </button>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={200} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            {(() => {
              const i = steps.findIndex((s) => s.id === menu.id);
              return (
                <>
                  <MenuItem label="Move up" disabled={i <= 0} onClick={() => move(i, i - 1)} />
                  <MenuItem label="Move down" disabled={i >= steps.length - 1} onClick={() => move(i, i + 1)} />
                  <MenuItem label="Duplicate" onClick={() => duplicate(i)} />
                  <MenuSeparator />
                  <MenuItem label="Delete" destructive onClick={() => remove(menu.id)} />
                </>
              );
            })()}
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}

function StepMenuButton({ id, open, onOpen }: { id: string; open: boolean; onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  void id;
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Step actions" />;
}
