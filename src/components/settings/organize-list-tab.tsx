"use client";

// The Policy categories and Contract folders tabs of Organize (spec-process
// section 2 `/sops/manage`): 36px rows with a usage count, a "…" with Rename
// and Delete (blocked with a sentence while anything uses the name), one
// blue "New category" / "New folder" at the top right. The list lives in
// settings.process (PATCH /api/settings { section: "process" }); a rename
// also re-files the rows carrying the old name in one server call.

import { useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { RowMoreButton } from "@/components/ui/table-card";
import { EntityTile } from "@/components/ui/entity-tile";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { addListEntry, removeListEntry } from "@/lib/process-settings";

export function OrganizeListTab({ kind, items, counts, onChanged }: {
  kind: "policy-categories" | "contract-folders";
  items: string[] | null;
  counts: Record<string, number>;
  onChanged: () => void;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [menu, setMenu] = useState<{ name: string; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  const noun = kind === "policy-categories" ? "category" : "folder";
  const nounCap = kind === "policy-categories" ? "Category" : "Folder";
  const key = kind === "policy-categories" ? "policyCategories" : "contractFolders";
  const usedNoun = kind === "policy-categories" ? "policies" : "contracts";
  const usedOne = kind === "policy-categories" ? "policy" : "contract";

  const write = async (list: string[]): Promise<boolean> => {
    const r = await apiFetch("/api/settings", { method: "PATCH", json: { section: "process", data: { [key]: list } } });
    if (!r.ok) { toast(r.error || "Couldn't save", { tone: "danger" }); return false; }
    onChanged();
    return true;
  };
  const create = async () => {
    const name = await prompt({ title: `New ${noun}`, placeholder: kind === "policy-categories" ? "e.g. Security" : "e.g. NDA", submitLabel: "Create" });
    if (!name || !name.trim()) return;
    if (await write(addListEntry(items ?? [], name.trim()))) toast(`${nounCap} created`);
  };
  const rename = async (name: string) => {
    const next = await prompt({ title: `Rename ${noun}`, description: counts[name] ? `The ${counts[name]} ${usedNoun} filed under "${name}" move with it.` : undefined, defaultValue: name, submitLabel: "Save" });
    if (!next || next.trim() === name) return;
    const r = await apiFetch(kind === "policy-categories" ? "/api/policies/rename-category" : "/api/agreements/rename-folder", { method: "POST", json: { from: name, to: next.trim() } });
    if (!r.ok) { toast(r.error || "Couldn't rename", { tone: "danger" }); return; }
    toast(`${nounCap} renamed`); onChanged();
  };
  const remove = async (name: string) => {
    const used = counts[name] ?? 0;
    if (used > 0) { toast(`"${name}" is used by ${used} ${used === 1 ? usedOne : usedNoun}. Move ${used === 1 ? "it" : "them"} first.`, { tone: "danger" }); return; }
    const ok = await confirm({ title: `Delete "${name}"?`, description: `Nothing is filed under it, so nothing else changes.`, confirmLabel: `Delete ${noun}`, destructive: true });
    if (!ok) return;
    if (await write(removeListEntry(items ?? [], name))) toast(`${nounCap} deleted`);
  };

  return (
    <section className="rounded-lg border border-line bg-raised">
      <header className="flex h-12 items-center gap-2 border-b border-line px-4">
        <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">{kind === "policy-categories" ? "Policy categories" : "Contract folders"}</h2>
        <button type="button" onClick={() => void create()} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover"><Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> New {noun}</button>
      </header>
      {items === null ? (
        <div className="p-3"><SkeletonRows rows={4} rowHeight="36px" /></div>
      ) : items.length === 0 ? (
        <p className="flex h-9 items-center gap-2 px-4 text-base text-ink-2">No {usedNoun === "policies" ? "categories" : "folders"} yet · <button type="button" onClick={() => void create()} className="font-medium text-brand-deep hover:underline">New {noun}</button></p>
      ) : (
        <ul>
          {items.map((name) => (
            <li key={name} className="os-tc__row group/row flex h-9 items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover">
              <EntityTile size="sm" fallback="folder" name={name} />
              <span className="min-w-0 flex-1 truncate text-base text-ink">{name}</span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{counts[name] ?? 0} {counts[name] === 1 ? usedOne : usedNoun}</span>
              <span className="os-tc__more"><RowTrigger open={menu?.name === name} onOpen={(ref) => setMenu({ name, anchor: ref })} /></span>
            </li>
          ))}
        </ul>
      )}
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={200} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={Pencil} label="Rename" onClick={() => void rename(menu.name)} />
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" destructive onClick={() => void remove(menu.name)} />
          </MenuList>
        </MorePortal>
      ) : null}
    </section>
  );
}

function RowTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Actions" />;
}
