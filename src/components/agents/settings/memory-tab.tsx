"use client";

// The Memory tab of a teammate's settings (docs/plans/ai-teammates.md 3.8,
// 5.5): what it remembers for this person. Their own memories ("Only you",
// saved from the chat or here) and, on a workspace teammate, the ones its
// managers saved for everyone who uses it ("Everyone"); never another
// person's. Each row: the name (500), the fact, its scope chip, and a menu
// with Edit and Delete where this person may change it (their own always; a
// shared one only for its managers). "Add memory" saves one of their own, or,
// for a manager of a workspace teammate, one for everyone.
//
// GET and POST /api/agents/teammates/[slug]/memories, PATCH and DELETE
// /api/agents/memories/[id]. A removed teammate's memories can still be
// changed and deleted (they are the person's), not added to.

import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import type { MemoryScope, MemoryView } from "@/lib/agents/memory";
import { MEMORY_COPY, TEAMMATE_CHAT, actionsFor } from "@/lib/agents/teammate-copy";
import type { TeammateDetail } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { useTeammateData } from "./use-teammate-data";

const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";
const GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60";
const LINK = "font-medium text-brand-deep hover:underline";
const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none";

/** The route's limits (memory.ts MEMORY_LIMITS). */
const KEY_MAX = 80;
const VALUE_MAX = 500;

export function MemoryTab({ teammate: t, canManage }: { teammate: TeammateDetail; canManage: boolean }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { data, error, reload, setData } = useTeammateData<{ memories: MemoryView[] }>(`/api/agents/teammates/${encodeURIComponent(t.slug)}/memories`, t.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: { current: HTMLElement | null } } | null>(null);
  const shareable = canManage && t.visibility === "WORKSPACE";
  const removed = t.status === "ARCHIVED";

  const mayChange = (m: MemoryView) => m.scope === "person" || shareable;

  async function add(v: { key: string; value: string; scope: MemoryScope }): Promise<boolean> {
    const r = await apiFetch<{ memory: MemoryView }>(`/api/agents/teammates/${encodeURIComponent(t.slug)}/memories`, { method: "POST", json: v });
    if (!r.ok) {
      toast(r.code ? r.error : MEMORY_COPY.saveFailed, { tone: "danger" });
      return false;
    }
    setAdding(false);
    void reload();
    return true;
  }

  async function update(m: MemoryView, v: { key: string; value: string }): Promise<boolean> {
    const r = await apiFetch<{ memory: MemoryView }>(`/api/agents/memories/${encodeURIComponent(m.id)}`, { method: "PATCH", json: { key: v.key, value: v.value } });
    if (!r.ok) {
      toast(r.code ? r.error : MEMORY_COPY.saveFailed, { tone: "danger" });
      return false;
    }
    setEditing(null);
    // A new name that matched another memory replaced it: read the list again.
    void reload();
    return true;
  }

  async function remove(m: MemoryView) {
    const ok = await confirm({ title: MEMORY_COPY.deleteTitle, description: MEMORY_COPY.deleteBody, confirmLabel: MEMORY_COPY.delete, destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/agents/memories/${encodeURIComponent(m.id)}`, { method: "DELETE" });
    if (!r.ok) {
      toast(r.code ? r.error : MEMORY_COPY.deleteFailed, { tone: "danger" });
      return;
    }
    setData((d) => (d ? { memories: d.memories.filter((x) => x.id !== m.id) } : d));
  }

  const memories = data?.memories ?? null;
  const open = menu ? memories?.find((m) => m.id === menu.id) ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      {!removed ? (
        adding ? (
          <MemoryForm shareable={shareable} onSave={add} onCancel={() => setAdding(false)} />
        ) : (
          <div>
            <button type="button" className={SECONDARY} onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {MEMORY_COPY.add}
            </button>
          </div>
        )
      ) : null}

      {memories === null && error ? (
        <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
          {MEMORY_COPY.loadError} ·
          <button type="button" className={LINK} onClick={() => void reload()}>
            {TEAMMATE_CHAT.tryAgain}
          </button>
        </div>
      ) : memories === null ? (
        <SkeletonRows rows={3} />
      ) : memories.length === 0 ? (
        <div className="flex flex-col gap-1 py-2">
          <p className="m-0 text-base text-ink-2">{MEMORY_COPY.empty}</p>
          <p className="m-0 text-sm text-ink-3">{MEMORY_COPY.emptyHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col rounded-md border border-line">
          {memories.map((m) => (
            <li key={m.id} className="border-t border-line-soft px-3 py-2 first:border-t-0">
              {editing === m.id ? (
                <MemoryForm initial={m} shareable={false} onSave={(v) => update(m, v)} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 break-words text-base font-medium text-ink">{m.key}</p>
                    <p className="m-0 whitespace-pre-wrap break-words text-sm text-ink-2">{m.value}</p>
                  </div>
                  <StatusChip color={RUN_TONE_COLOR.neutral} label={m.scope === "agent" ? MEMORY_COPY.everyone : MEMORY_COPY.onlyYou} className="shrink-0" />
                  {mayChange(m) ? (
                    <button
                      type="button"
                      aria-label={actionsFor(m.key)}
                      title={actionsFor(m.key)}
                      aria-haspopup="menu"
                      aria-expanded={menu?.id === m.id}
                      onClick={(e) => setMenu(menu?.id === m.id ? null : { id: m.id, anchor: { current: e.currentTarget } })}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {menu && open ? (
        <MorePortal anchorRef={menu.anchor} width={180} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={actionsFor(open.key)}>
            <MenuItem
              icon={Pencil}
              label={MEMORY_COPY.edit}
              onClick={() => {
                setMenu(null);
                setEditing(open.id);
              }}
            />
            <MenuItem
              icon={Trash2}
              label={MEMORY_COPY.delete}
              destructive
              onClick={() => {
                setMenu(null);
                void remove(open);
              }}
            />
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}

/** Add or change one memory: its name and the fact, and for a new one on a workspace teammate's manager, who it is for. */
function MemoryForm({
  initial,
  shareable,
  onSave,
  onCancel,
}: {
  initial?: MemoryView;
  /** Offer "Everyone" (a new memory, by a manager of a workspace teammate). */
  shareable: boolean;
  onSave: (v: { key: string; value: string; scope: MemoryScope }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [scope, setScope] = useState<MemoryScope>(initial?.scope ?? "person");
  const [busy, setBusy] = useState(false);
  const ready = key.trim().length > 0 && value.trim().length > 0;

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    await onSave({ key: key.trim(), value: value.trim(), scope });
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-subtle p-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {MEMORY_COPY.keyLabel}
        <input
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value)}
          maxLength={KEY_MAX}
          placeholder={MEMORY_COPY.keyPlaceholder}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {MEMORY_COPY.valueLabel}
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={VALUE_MAX}
          rows={3}
          placeholder={MEMORY_COPY.valuePlaceholder}
          className="block w-full resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
        />
      </label>
      {shareable && !initial ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">{MEMORY_COPY.scopeLabel}</span>
          <SegmentedControl<MemoryScope>
            label={MEMORY_COPY.scopeLabel}
            value={scope}
            options={[
              { value: "person", label: MEMORY_COPY.onlyYou },
              { value: "agent", label: MEMORY_COPY.everyone },
            ]}
            onChange={setScope}
          />
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={GHOST} disabled={busy} onClick={onCancel}>
          {MEMORY_COPY.cancel}
        </button>
        <button type="button" className={SECONDARY} disabled={busy || !ready} onClick={() => void save()}>
          {MEMORY_COPY.save}
        </button>
      </div>
    </div>
  );
}
