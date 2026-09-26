"use client";

// The widget editor: ClickUp's Add card dialog. A live preview on the left,
// a ~300px settings column on the right (Title, Data source, the kind's own
// rows, Filter), and a footer with Cancel and the dialog's one blue "Add
// widget" or "Save".
//
// THE PREVIEW is POST /api/dashboards/widget-preview, the same
// redact-then-compute path as a saved card's data, under the editor, so a
// preview can never show more than the saved card would. It runs 400ms after
// the last change and only while the input is valid (widgetInputSchema). Its
// last answer is handed to the save as { key: previewKey(input), result }, and
// the canvas shows it only when the key matches the saved settings.
//
// THE TITLE follows the settings until the person types one. A card starts
// on defaultWidgetTitle ("Open tasks"), and while its title is untouched a
// change of scope, metric, group by, sort or source re-derives it, so a card
// can never be saved headed "Open tasks" while it counts completed ones.
// Who wrote a title is saved with it (titleEdited), because a typed title
// can look exactly like a default ("Tasks by Owner"): a typed one is never
// overwritten, and only a card saved before the flag existed is judged by
// its title's shape (widget-kinds.ts titleState). Clearing the field hands
// the title back to the settings at their next change. Until the chosen
// Lists' fields arrive, the Title field keeps the saved title rather than a
// default missing its field's name (titleLabels).
//
// SAVING. The primary is disabled until the input is valid and while its
// request is in flight. A failed save keeps the dialog open, with the input
// as it was and a Retry; nothing typed here is lost.
//
// A PARTIAL card (some of its Lists or filters are not shared with the
// editor) says so, and its kind of source stays as it is: the server appends
// the unseen Lists and rules to whatever is saved, and refuses a change of
// kind (source_locked).
//
// Every popover in here is an absolutely positioned DOM child (Picker),
// never a portal and never a fixed popover: ui/dialog centres itself with a
// transform, which breaks fixed children.
//
// The dialog is a shell layer (kind "dialog"), as the Customize panel is: the
// page's own blue primary gives way while it is open, and Esc goes to the
// LayerStack, so it closes an open Picker first and this dialog only after.
//
// DialogContent scrolls (85vh), which clips an absolutely positioned list
// that opens near its foot (a filter rule's field or value). While a Picker
// is open (the LayerStack's top is a popover) and the dialog's content fits
// without it, the dialog stops clipping so the list shows whole. When the
// content is taller than the dialog (a long filter), it keeps scrolling:
// switching then would throw away the scroll position under the pointer,
// and the open list extends the scroll area, so it can be scrolled to.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { OsShellContext, useLayer } from "@/components/layout/os/shell-context";
import { SkeletonLines } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { previewKey } from "@/lib/dashboards/dashboard-editor";
import {
  kindMeta,
  titleLabels,
  titleModeAfterSettingsChange,
  titleModeAfterTyping,
  titleModeFor,
  titleState,
  withEditorTitle,
  type TitleMode,
  type WidgetSurface,
} from "@/lib/dashboards/widget-kinds";
import { EMPTY_FILTER, widgetInputSchema, type WidgetFilter, type WidgetInput } from "@/lib/dashboards/widgets";
import type { WidgetResult } from "@/lib/dashboards/widget-data";
import type { StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { WidgetSourcePicker } from "./widget-source-picker";
import { WidgetFilterEditor } from "./widget-filter-editor";
import { registryFor, SettingsRow } from "./widget-registry";
import type { PreviewSeed } from "./use-dashboard";

export type EditorSaveResult = { ok: true } | { ok: false; message: string };

type DataInput = Exclude<WidgetInput, { kind: "notes" } | { kind: "passthrough" }>;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function isData(i: WidgetInput): i is DataInput {
  return i.kind === "stat" || i.kind === "chart" || i.kind === "list";
}

/** Each field's label, the first List to define a key naming it. */
function labelsOf(ids: readonly string[], fieldsBy: ReadonlyMap<string, FieldDef[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) for (const f of fieldsBy.get(id) ?? []) if (!out.has(f.key)) out.set(f.key, f.label);
  return out;
}

/**
 * The fields and statuses of the chosen Lists, read once per List, and the
 * field labels of the Lists the card was SAVED with (`savedIds`), which an
 * older card's title is judged against (widget-kinds.ts titleState).
 * `ready` and `savedReady` say every List's fields have arrived. A List
 * whose fields could not be read is left unread rather than taken as having
 * none, so a title that names one of its fields is not rewritten over a
 * failed request.
 */
function useListFacts(listIds: readonly string[], savedIds: readonly string[]) {
  const [fieldsBy, setFieldsBy] = useState<Map<string, FieldDef[]>>(new Map());
  const [statusesBy, setStatusesBy] = useState<Map<string, StatusOption[]>>(new Map());
  const key = listIds.join(",");
  const savedKey = savedIds.join(",");
  useEffect(() => {
    const missing = Array.from(new Set([...listIds, ...savedIds])).filter((id) => !fieldsBy.has(id));
    if (missing.length === 0) return;
    let live = true;
    void (async () => {
      const got = await Promise.all(
        missing.map(async (id) => {
          const [f, s] = await Promise.all([
            fetch(`/api/boards/${encodeURIComponent(id)}/fields`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch(`/api/boards/${encodeURIComponent(id)}/settings`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          ]);
          return { id, fields: f ? ((f.fields ?? []) as FieldDef[]) : null, statuses: (s?.statuses ?? []) as StatusOption[] };
        }),
      );
      if (!live) return;
      setFieldsBy((prev) => {
        const next = new Map(prev);
        for (const g of got) if (g.fields) next.set(g.id, g.fields);
        return next;
      });
      setStatusesBy((prev) => {
        const next = new Map(prev);
        for (const g of got) next.set(g.id, g.statuses);
        return next;
      });
    })();
    return () => {
      live = false;
    };
    // `key` and `savedKey` are the content of `listIds` and `savedIds`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, savedKey]);
  return useMemo(() => {
    const fields: FieldDef[] = [];
    const seenF = new Set<string>();
    const statuses: StatusOption[] = [];
    const seenS = new Set<string>();
    for (const id of listIds) {
      for (const f of fieldsBy.get(id) ?? []) if (!seenF.has(f.key)) {
        seenF.add(f.key);
        fields.push(f);
      }
      for (const s of statusesBy.get(id) ?? []) if (!seenS.has(s.value)) {
        seenS.add(s.value);
        statuses.push(s);
      }
    }
    return {
      fields,
      statuses,
      ready: listIds.every((id) => fieldsBy.has(id)),
      savedLabels: labelsOf(savedIds, fieldsBy),
      savedReady: savedIds.every((id) => fieldsBy.has(id)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, savedKey, fieldsBy, statusesBy]);
}

export function WidgetEditor({
  open,
  onOpenChange,
  surface,
  spaceId,
  mode,
  initial,
  partial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: WidgetSurface;
  /** The Overview's Space, on the space-overview surface. */
  spaceId?: string | null;
  mode: "add" | "edit";
  initial: WidgetInput;
  /** The card is only partly shared with the editor. */
  partial?: boolean;
  onSave: (input: WidgetInput, preview: PreviewSeed | null) => Promise<EditorSaveResult>;
}) {
  const [draft, setDraft] = useState<WidgetInput>(initial);
  // The four title modes are described in widget-kinds.ts (TitleMode). A
  // card saved with titleEdited opens as typed or auto; only an older card
  // opens as "saved", and is judged by its title's shape.
  const [titleMode, setTitleMode] = useState<TitleMode>(() => titleModeFor(mode, initial));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; state: "loading" } | { key: string; state: "ready"; result: WidgetResult } | { key: string; state: "failed" } | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const zone = useMemo(() => browserZone(), []);
  const meta = kindMeta(draft.kind);
  const entry = registryFor(draft.kind);

  // The Lists' fields come from the draft's source; the title can name one.
  const listIds = isData(draft) && draft.source.kind === "lists" ? draft.source.listIds : [];
  const savedIds = mode === "edit" && isData(initial) && initial.source.kind === "lists" ? initial.source.listIds : [];
  const facts = useListFacts(listIds, savedIds);
  const fieldLabels = useMemo(() => new Map(facts.fields.map((f) => [f.key, f.label])), [facts.fields]);
  const { follows, edited } = titleState(titleMode, initial, facts.savedLabels, facts.savedReady);
  const labels = useMemo(() => titleLabels(initial, fieldLabels, facts.ready), [initial, fieldLabels, facts.ready]);
  const input = useMemo<WidgetInput>(
    () => withEditorTitle(draft, { state: { follows, edited }, labels, labelsReady: facts.ready }),
    [draft, follows, edited, labels, facts.ready],
  );
  // Every settings change goes through here; the Title field does not.
  const setInput = (next: WidgetInput) => {
    setTitleMode(titleModeAfterSettingsChange(titleMode));
    setDraft(next);
  };

  // A shell layer while open; it refuses to close while its save is in
  // flight, so the answer always lands on the dialog that asked.
  const shell = useContext(OsShellContext);
  const closeRef = useRef(onOpenChange);
  const savingRef = useRef(false);
  useEffect(() => {
    closeRef.current = onOpenChange;
    savingRef.current = saving;
  });
  useLayer(open, { kind: "dialog", close: () => closeRef.current(false), canClose: () => !savingRef.current });

  // Measured only at rest: an open list adds its own height to the content.
  const contentRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  const popoverOpen = open && shell?.topLayerKind === "popover";
  useEffect(() => {
    if (popoverOpen) return;
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setFits(el.scrollHeight <= el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [popoverOpen]);
  const unclipped = popoverOpen && fits;

  const valid = useMemo(() => widgetInputSchema.safeParse(input).success, [input]);
  const key = useMemo(() => (isData(input) ? previewKey(input) : ""), [input]);

  // The live preview, debounced, only for a valid data card.
  const seq = useRef(0);
  useEffect(() => {
    if (!open || !isData(input) || !valid) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      setPreview({ key, state: "loading" });
      void (async () => {
        try {
          const res = await fetch("/api/dashboards/widget-preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ widget: input, tz: zone }),
          });
          const body = res.ok ? ((await res.json()) as { result?: WidgetResult }) : null;
          if (n !== seq.current) return;
          setPreview(body?.result ? { key, state: "ready", result: body.result } : { key, state: "failed" });
        } catch {
          if (n === seq.current) setPreview({ key, state: "failed" });
        }
      })();
    }, 400);
    return () => clearTimeout(t);
    // `key` captures everything the data depends on; the title does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, valid, previewNonce, zone]);

  const setFilter = (f: WidgetFilter) => {
    if (!isData(input)) return;
    setInput({ ...input, filter: f } as WidgetInput);
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    const seed = preview && preview.state === "ready" && isData(input) && preview.key === previewKey(input) ? { key: preview.key, result: preview.result } : null;
    const r = await onSave(input, seed);
    setSaving(false);
    if (r.ok) onOpenChange(false);
    else setSaveError(r.message);
  };

  const title = "title" in input ? input.title : "";
  const primaryLabel = mode === "add" ? "Add widget" : "Save";

  return (
    <Dialog open={open} onOpenChange={(o) => (!saving ? onOpenChange(o) : undefined)}>
      <DialogContent
        ref={contentRef}
        className={cn("max-w-[960px] gap-0 p-0 outline-none", unclipped && "overflow-visible")}
        onInteractOutside={(e) => e.preventDefault()}
        // Radix sees Esc first and would close the dialog under an open
        // Picker; the LayerStack closes only the top layer.
        onEscapeKeyDown={(e) => {
          if (!shell) return;
          e.preventDefault();
          shell.closeTopLayer();
        }}
      >
        <div className="flex h-12 items-center gap-2 border-b border-line px-5 pe-12">
          {/* "List widget", never a bare "List": the List kind shares its
              name with the Lists the card counts. */}
          <DialogTitle className="text-base">{mode === "add" ? `Add ${meta ? `${meta.label} widget` : "a widget"}` : `${meta ? `${meta.label} widget` : "Widget"} settings`}</DialogTitle>
          <DialogDescription className="sr-only">{meta?.description ?? "Widget settings"}</DialogDescription>
        </div>

        <div className="flex min-h-0 flex-col md:flex-row">
          {/* Preview */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 bg-subtle p-5">
            <span className="text-xs font-medium text-ink-2">Preview</span>
            {/* 400px: tall enough to read a chart, and it gives the settings
                column's Pickers (absolute DOM children, clipped by the
                dialog) room to open below their rows. */}
            <section className="flex h-[400px] flex-col overflow-hidden rounded-[var(--os-r-lg)] border border-line bg-raised">
              <div className="flex h-10 shrink-0 items-center px-3">
                <h3 className="m-0 min-w-0 truncate text-row font-medium text-ink">{title || "Untitled"}</h3>
              </div>
              <div className="min-h-0 flex-1 px-3 pb-3">
                {input.kind === "notes" ? (
                  input.text.trim() ? (
                    <div className="h-full overflow-y-auto whitespace-pre-wrap break-words text-base text-ink">{input.text}</div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-ink-3">Your text shows here</div>
                  )
                ) : !valid ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-2">Finish the settings to see a preview</div>
                ) : !preview || preview.key !== key || preview.state === "loading" ? (
                  <SkeletonLines lines={4} />
                ) : preview.state === "failed" ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
                    <p className="m-0 text-sm text-ink-2">Couldn&apos;t load the preview</p>
                    <button type="button" onClick={() => setPreviewNonce((x) => x + 1)} className="text-sm font-medium text-brand-deep hover:underline">
                      Retry
                    </button>
                  </div>
                ) : preview.result.kind === "empty" ? (
                  <div className="flex h-full items-center justify-center text-sm text-ink-2">None of its Lists are shared with you</div>
                ) : preview.result.kind === "error" ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
                    <p className="m-0 text-sm text-ink-2">Couldn&apos;t load the preview</p>
                    <button type="button" onClick={() => setPreviewNonce((x) => x + 1)} className="text-sm font-medium text-brand-deep hover:underline">
                      Retry
                    </button>
                  </div>
                ) : entry ? (
                  entry.Body({ widgetId: "preview", result: preview.result, canEdit: false })
                ) : null}
              </div>
            </section>
          </div>

          {/* Settings */}
          <div className="flex w-full shrink-0 flex-col gap-3 border-t border-line p-5 md:w-[340px] md:border-s md:border-t-0">
            <SettingsRow label="Title">
              <input
                value={title}
                maxLength={120}
                onChange={(e) => {
                  setTitleMode(titleModeAfterTyping(e.target.value));
                  setDraft({ ...input, title: e.target.value } as WidgetInput);
                }}
                aria-label="Title"
                placeholder="Name this widget"
                className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-[var(--os-focus)]"
              />
            </SettingsRow>

            {partial ? (
              <p className="m-0 flex items-start gap-2 rounded-md bg-subtle px-2.5 py-2 text-xs text-ink-2">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                Some of this card&apos;s Lists and filters aren&apos;t shared with you. They stay as they are.
              </p>
            ) : null}

            {isData(input) ? (
              <WidgetSourcePicker
                surface={surface}
                spaceId={spaceId}
                source={input.source}
                locked={partial}
                onChange={(source) => setInput({ ...input, source } as WidgetInput)}
              />
            ) : null}

            {entry ? entry.SettingsFields({
              input,
              onChange: setInput,
              fields: facts.fields,
              sourceKind: isData(input) ? input.source.kind : "all",
            }) : null}

            {isData(input) ? (
              <WidgetFilterEditor
                filter={input.filter ? { connector: input.filter.connector ?? "AND", rules: input.filter.rules ?? [], hideDone: input.filter.hideDone ?? false } : { ...EMPTY_FILTER, rules: [] }}
                onChange={setFilter}
                listsSource={input.source.kind === "lists"}
                fields={facts.fields}
                statuses={facts.statuses}
              />
            ) : null}
          </div>
        </div>

        <div className="flex min-h-14 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-2.5">
          {saveError ? (
            <p role="alert" className="m-0 me-auto min-w-0 flex-1 text-sm text-danger-text">
              {saveError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:text-ink-4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4"
          >
            {saving ? (
              <span className="os-pending" role="status" aria-label="Saving">
                <i /><i /><i /><i />
              </span>
            ) : null}
            {saveError ? "Retry" : primaryLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
