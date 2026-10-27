"use client";

/* Task system > Task types (the old /settings/task-types 308s to
 * /settings/tasks?tab=types). Manage the org's Item types (Task / Milestone /
 * custom). List active types, create custom types, and add from a
 * recommended library. Mirrors ClickUp's Task Types manager.
 *
 *  GET    /api/item-types          → { types, recommended, categories, usage }
 *  POST   /api/item-types          → create custom type
 *  PATCH  /api/item-types/[id]     → set default / edit
 *  DELETE /api/item-types/[id]     → remove custom type
 *
 * THE SHARED PARTS (settings-cleanup Phase 6, B3, B4, B9 and B10): the active
 * types are the tab's TableCard, named by the tab itself the way Members and
 * Structure name theirs (a table is never put inside a card), with "N of 20
 * custom types" in its footer, so a grey "New type" says why. The library is
 * one SettingsCard, "Recommended": its search at the right of the title, the
 * categories as the outlined toggle chips (the working days' look), and
 * each type a SettingsRow with its Add. A list that shows nothing says so in
 * one inline line with its action (task-system-ui.ts). While the read is out
 * the library shows skeleton rows, never "Nothing to add". A failed read is
 * told to the page (onUsage("error")), which greys the toolbar's New type
 * with "Try again first": a dialog opened then had no names to check a new
 * one against (Phase 6 review, M1). The server refuses a name in use in
 * any case, so a dialog opened before the first answer is safe too.
 *
 * Make default takes its own button away (the row is now the default), so
 * focus goes to that row's name, never to the page (Phase 6 review, L9).
 * Below 640px each library row's Add is a 32px "+" on the row's name line,
 * named "Add {type}", instead of a ghost button on a line of its own.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { CircleCheck, Plus, Search, Trash2 } from "lucide-react";
import { Dots } from "@/components/ui/dots";

import { useOsToast } from "@/components/layout/os/toast";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { returnFocusOnClose } from "@/components/ui/return-focus";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btn } from "@/components/settings/settings-form";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { TAG } from "@/components/account/account-ui";
import { toggleChipClass } from "@/components/layout/os/page-header/page-header";
import { useConfirm } from "@/components/ui/dialog-provider";
import { itemTypeIcon, ITEM_TYPE_ICON_NAMES } from "@/lib/item-type-icons";
import { customTypesLine, recommendedEmptyLine } from "./task-system-ui";

type ApiType = {
  id: string; singular: string; plural: string; icon: string;
  description: string | null; category: string | null; isDefault: boolean; builtIn: boolean;
};
type Recommended = { singular: string; plural: string; icon: string; description: string; category: string };

/**
 * Below 640px (a phone) a row's Make default and Delete fold into one "..."
 * menu, as Members > Pending's do (settings-cleanup Phase 4 review, L1): the
 * two buttons' 200px end column sat over the type's name on a 294px card.
 */
const PHONE_ROWS = "(width < 640px)";
function subscribePhoneRows(cb: () => void) {
  const mq = window.matchMedia(PHONE_ROWS);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readPhoneRows = () => window.matchMedia(PHONE_ROWS).matches;

/** A type's name cell, where focus lands after Make default. */
export const typeNameId = (id: string) => `task-type-name-${id}`;

/** Focus a type's name once the frame that draws the swap has run (the click's own render commits first). */
function focusTypeName(id: string) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => { document.getElementById(typeNameId(id))?.focus({ preventScroll: true }); });
}

/** The phone library's icon-only Add: 32px square, the ghost button's colours. */
const RECOMMENDED_ADD_ICON = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-focus)]";

export function TaskTypesTab({
  createOpen,
  onCreateOpenChange,
  onUsage,
}: {
  /** The page toolbar's "New type" button opens this (the tab's one primary). */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  /** What the list read said: its custom-type count, or "error" when it failed. */
  onUsage: (said: { used: number; limit: number } | "error") => void;
}) {
  const setCreateOpen = onCreateOpenChange;
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [types, setTypes] = useState<ApiType[] | null>(null);
  const [recommended, setRecommended] = useState<Recommended[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 20 });
  const [recSearch, setRecSearch] = useState("");
  const [recCat, setRecCat] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const phone = useSyncExternalStore(subscribePhoneRows, readPhoneRows, () => false);
  const [menu, setMenu] = useState<{ type: ApiType; anchor: RefObject<HTMLElement | null> } | null>(null);

  // A failed read renders ErrorState with Retry, never an empty list that
  // reads as "this workspace has no task types".
  const [loadError, setLoadError] = useState<string | null>(null);
  const onUsageRef = useRef(onUsage);
  onUsageRef.current = onUsage;
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/item-types", { cache: "no-store" });
      if (!res.ok) { setLoadError(`HTTP ${res.status}`); onUsageRef.current("error"); return; }
      const d = await res.json();
      setTypes(Array.isArray(d.types) ? d.types : []);
      setRecommended(Array.isArray(d.recommended) ? d.recommended : []);
      setUsage(d.usage ?? { used: 0, limit: 20 });
      onUsageRef.current(d.usage ?? { used: 0, limit: 20 });
    } catch (e) { setLoadError(e instanceof Error ? e.message : "Network error"); onUsageRef.current("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const existingNames = useMemo(() => new Set((types ?? []).map((t) => t.singular.toLowerCase())), [types]);

  const setDefault = useCallback(async (id: string) => {
    setTypes((prev) => (prev ?? []).map((t) => ({ ...t, isDefault: t.id === id })));
    // The button (or the phone menu's row "...", on a built-in) goes with
    // the swap: focus lands on the new default's name, after it is drawn.
    focusTypeName(id);
    try {
      const res = await fetch(`/api/item-types/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isDefault: true }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(typeof d?.error === "string" ? d.error : ""); }
      toast("Default type updated");
    } catch (e) {
      // The optimistic swap is undone by reloading the stored list.
      toast(e instanceof Error && e.message ? `Couldn't update default: ${e.message}` : "Couldn't update default");
      void load();
    }
  }, [load, toast]);

  const remove = useCallback(async (t: ApiType) => {
    if (!(await confirm({ title: "Delete task type", description: `Delete the "${t.singular}" type? Tasks of this type fall back to the default.`, destructive: true, confirmLabel: "Delete" }))) return;
    setTypes((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    try {
      const res = await fetch(`/api/item-types/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("Type deleted");
      void load();
    } catch { toast("Couldn't delete type"); void load(); }
  }, [load, toast, confirm]);

  const addRecommended = useCallback(async (r: Recommended) => {
    setAdding(r.singular);
    try {
      const res = await fetch("/api/item-types", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ singular: r.singular, plural: r.plural, icon: r.icon, description: r.description, category: r.category }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error); }
      toast(`Added "${r.singular}"`);
      void load();
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Couldn't add type"); }
    finally { setAdding(null); }
  }, [load, toast]);

  const recCats = useMemo(() => Array.from(new Set(recommended.map((r) => r.category))).sort(), [recommended]);
  const recFiltered = useMemo(() => {
    let list = recommended.filter((r) => !existingNames.has(r.singular.toLowerCase()));
    if (recCat) list = list.filter((r) => r.category === recCat);
    const q = recSearch.trim().toLowerCase();
    if (q) list = list.filter((r) => r.singular.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    return list;
  }, [recommended, existingNames, recCat, recSearch]);

  const createModal = (
    <CreateTypeModal
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      onCreated={() => { setCreateOpen(false); void load(); }}
      existingNames={existingNames}
    />
  );

  if (loadError) {
    return (
      <>
        <ErrorState what="task types" hint={loadError} onRetry={() => { void load(); }} />
        {createModal}
      </>
    );
  }

  const columns: TableColumn<ApiType>[] = [
    {
      key: "type", label: "Type", title: true, width: "minmax(240px,2fr)",
      render: (t) => {
        const Icon = itemTypeIcon(t.icon);
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2"><Icon className="h-4 w-4" strokeWidth={1.5} /></span>
            {/* Where focus lands after Make default (out of the Tab order). */}
            <span id={typeNameId(t.id)} tabIndex={-1} className="min-w-0 rounded-sm outline-none focus-visible:shadow-[0_0_0_3px_var(--os-focus-halo)]">
              <span className="block truncate">{t.singular}</span>
              <span className="block truncate text-sm font-normal text-ink-2">{t.description || t.plural}</span>
            </span>
          </span>
        );
      },
    },
    { key: "kind", label: "Built-in", width: "110px", render: (t) => (t.builtIn ? "Built-in" : "Custom") },
    // A label chip that only labels (TAG, design-system 5.9): never a button.
    { key: "default", label: "Default", width: "110px", render: (t) => (t.isDefault ? <span className={TAG}>Default</span> : "·") },
  ];

  const filtered = Boolean(recSearch.trim() || recCat);
  const recEmpty = recommendedEmptyLine(filtered);
  const full = usage.used >= usage.limit;

  return (
    <>
      <div className="flex flex-col gap-6">
        <TableCard
          ariaLabel="Task types"
          columns={columns}
          rows={types}
          rowKey={(t) => t.id}
          rowMenuAlwaysVisible
          rowMenuWidth={phone ? 44 : 200}
          rowMenu={(t) => phone ? (
            !t.isDefault || !t.builtIn ? (
              <RowMoreButton open={menu?.type.id === t.id} label={`Actions for ${t.singular}`} onClick={(e) => { const a = e.currentTarget; setMenu(menu?.type.id === t.id ? null : { type: t, anchor: { current: a } }); }} />
            ) : null
          ) : (
            <span className="flex items-center justify-end gap-1">
              {/* Named with the type, so a row's button is told apart from the next row's; the name starts with the words it shows. */}
              {!t.isDefault ? <button type="button" aria-label={`Make default: ${t.singular}`} className={btn.ghost} onClick={() => { void setDefault(t.id); }}>Make default</button> : null}
              {!t.builtIn ? <button type="button" aria-label={`Delete ${t.singular}`} className={btn.dangerGhost} onClick={() => { void remove(t); }}>Delete</button> : null}
            </span>
          )}
          empty={<span>No task types yet</span>}
          footer={types ? { total: types.length, noun: "types", from: types.length ? 1 : 0, to: types.length, hidePaging: true, trailing: customTypesLine(usage) } : undefined}
        />

        <SettingsCard
          title="Recommended"
          actions={
            <label className="flex h-9 w-[240px] max-w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
              <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
              <input value={recSearch} onChange={(e) => setRecSearch(e.target.value)} placeholder="Search types" aria-label="Search recommended types" className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none" />
            </label>
          }
        >
          {types === null ? (
            <SkeletonRows rows={4} />
          ) : (
            <>
              {recCats.length > 0 ? (
                // The categories are toggles read side by side: the outlined
                // toggle chip (Locale's working days), never a round pill of
                // its own and never a second blue fill beside the one primary.
                <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
                  <button type="button" aria-pressed={recCat === null} onClick={() => setRecCat(null)} className={toggleChipClass(recCat === null, { outlined: true })}>All</button>
                  {recCats.map((c) => (
                    <button key={c} type="button" aria-pressed={recCat === c} onClick={() => setRecCat(recCat === c ? null : c)} className={toggleChipClass(recCat === c, { outlined: true })}>{c}</button>
                  ))}
                </div>
              ) : null}
              {recFiltered.length === 0 ? (
                <p className="m-0 text-base text-ink-2">
                  {recEmpty.text}
                  {recEmpty.action ? (
                    <>
                      {" · "}
                      <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => { setRecSearch(""); setRecCat(null); }}>{recEmpty.action.label}</button>
                    </>
                  ) : null}
                </p>
              ) : (
                <div>
                  {recFiltered.map((r) => {
                    const busy = adding === r.singular;
                    const shared = { type: "button" as const, "aria-label": `Add ${r.singular}`, title: full ? `All ${usage.limit} custom types are in use` : undefined, onClick: () => { void addRecommended(r); }, disabled: busy || full };
                    return (
                      <SettingsRow
                        key={r.singular}
                        label={phone ? (
                          // A phone keeps the Add on the name's line, icon only: the stacked row put a 32px
                          // button on a line of its own under every type (13 lines). The negative margin keeps
                          // the line its text height.
                          <span className="flex items-center justify-between gap-2">
                            <span className="min-w-0">{r.singular}</span>
                            <button {...shared} title={shared.title ?? shared["aria-label"]} className={`${RECOMMENDED_ADD_ICON} -my-1.5`}>
                              {busy ? <Dots variant="pending" /> : <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                            </button>
                          </span>
                        ) : r.singular}
                        helper={r.description}
                        control={phone ? undefined : (
                          // Ghost, as the tag groups' Add is: thirteen bordered buttons down one card read as a wall of controls.
                          <button {...shared} className={btn.ghost}>
                            {busy ? <Dots variant="pending" /> : <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />} Add
                          </button>
                        )}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </SettingsCard>
      </div>

      {menu && phone ? (
        <MorePortal anchorRef={menu.anchor} width={200} open placement="below" onClose={() => { const a = menu.anchor.current; setMenu(null); returnFocusOnClose("dismiss", a, null); }}>
          <MenuList keyboard aria-label={`Actions for ${menu.type.singular}`}>
            {!menu.type.isDefault ? <MenuItem icon={CircleCheck} label="Make default" onClick={() => { const { type, anchor } = menu; setMenu(null); returnFocusOnClose("select", anchor.current, null); void setDefault(type.id); }} /> : null}
            {!menu.type.builtIn ? <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { const { type, anchor } = menu; setMenu(null); returnFocusOnClose("select", anchor.current, null); void remove(type); }} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}

      {createModal}
    </>
  );
}

function CreateTypeModal({ open, onClose, onCreated, existingNames }: { open: boolean; onClose: () => void; onCreated: () => void; existingNames: Set<string> }) {
  const { toast } = useOsToast();
  const [icon, setIcon] = useState("CircleDot");
  const [singular, setSingular] = useState("");
  const [plural, setPlural] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const dupe = singular.trim() && existingNames.has(singular.trim().toLowerCase());
  const canSave = singular.trim().length > 0 && !dupe && !busy;
  const close = () => { setSingular(""); setPlural(""); setDescription(""); setIcon("CircleDot"); onClose(); };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const res = await fetch("/api/item-types", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ singular: singular.trim(), plural: plural.trim() || undefined, icon, description: description.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error); }
      toast("Task type created");
      setSingular(""); setPlural(""); setDescription(""); setIcon("CircleDot");
      onCreated();
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Couldn't create type"); }
    finally { setBusy(false); }
  };

  const PreviewIcon = itemTypeIcon(icon);
  const input = "mt-1 h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]";
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New task type</DialogTitle>
          <DialogDescription>Pick an icon and name your type.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-hover text-ink-2"><PreviewIcon className="h-5 w-5" strokeWidth={1.5} /></span>
            <span className="text-base text-ink-2">{singular.trim() || "Your type"}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-ink">Icon</span>
            <div className="mt-1.5 grid max-h-[120px] grid-cols-9 gap-1 overflow-y-auto rounded-md border border-line p-2">
              {ITEM_TYPE_ICON_NAMES.map((name) => {
                const Ic = itemTypeIcon(name);
                return (
                  <button key={name} type="button" aria-label={name} aria-pressed={icon === name} onClick={() => setIcon(name)} className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${icon === name ? "bg-active text-ink ring-1 ring-ink" : "text-ink-2 hover:bg-hover hover:text-ink"}`}>
                    <Ic className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">Singular name</span>
              <input value={singular} onChange={(e) => setSingular(e.target.value.slice(0, 16))} maxLength={16} placeholder="Bug" className={input} autoFocus />
              {dupe ? <span role="alert" className="mt-1 block text-sm text-danger-text">A type with this name exists.</span> : null}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Plural name</span>
              <input value={plural} onChange={(e) => setPlural(e.target.value.slice(0, 16))} maxLength={16} placeholder="Bugs" className={input} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-ink">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 100))} maxLength={100} placeholder="A defect to fix" className={input} />
            <span className="mt-1 block text-end text-sm text-ink-3">{description.length}/100</span>
          </label>
        </div>
        <DialogFooter>
          <button type="button" onClick={close} className={btn.ghost}>Cancel</button>
          <button type="button" onClick={() => { void submit(); }} disabled={!canSave} className={btn.primary}>
            {busy ? <Dots variant="pending" /> : null} Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
