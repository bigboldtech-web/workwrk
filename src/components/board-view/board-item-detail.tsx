"use client";

// BoardItemDetail, the ONE task body. Three hosts, one prop.
//
// spec-task-detail section 3: `host: "drawer" | "page" | "panel"`. The drawer
// renders it in a 520 column, the page in a 760 centred one, the Inbox pane
// fills its width with no frame of its own. Nothing else differs, because the
// whole point of Phase 2 here is that four task UIs become one.
//
// The seven internal changes the spec's section 4 step 3 lists as (a) to (g),
// all approved, all in this file:
//
//   (a) the two-column field grid becomes a ONE-COLUMN 36px field strip with
//       four defaults (Status, Assignees, Due date, Priority) and a named
//       "+ Add field" door. The grid is what made the drawer need 1000px.
//   (b) the drawer's 400px right rail is gone: Comments and Activity are the
//       last section of this one body, in both hosts.
//   (c) the description is a LightEditor (bold, italic, lists, links,
//       @mentions) instead of a plain textarea.
//   (d) Related is sectioned rather than one flat list of links.
//   (e) empty sections hide behind the "Add to task" ghost rows.
//   (f) the status control loses its "›" advance segment and its
//       `onMouseLeave` close, the first advanced to an unpredictable status,
//       the second cannot be used with a keyboard or a trackpad at all.
//   (g) a "…" menu appears on the body chrome in both hosts, rendering the
//       17-row canon from src/lib/item-menu.ts.
//
// And the rules that are not negotiable anywhere in it: tokens only (no zinc,
// no hex, no taupe), no Loader2, every date through `home.locale`, every
// control has a handler, a control the role cannot use is ABSENT rather than
// disabled, and every partial write into the `metadata` JSON column goes
// through `metadataPatch` (a server-side merge over what is stored) rather
// than resending a cached copy of the whole blob.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban, CalendarDays, CalendarPlus, Check, ClipboardList, Clock, Eye, Flag, GitBranch,
  Hourglass, Link2, Paperclip, Play, Plus, Search, Square, Tag, Target, UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { RecurrenceRule } from "@/lib/recurrence";
import type { FieldDef } from "@/lib/field-catalog";
import type { ItemRole } from "@/lib/item-role";
import { rankOf } from "@/lib/item-role";
import {
  ITEM_FIELD_LABELS,
  addFieldRows,
  listFieldRows,
  resolveVisibleFields,
  resolveVisibleListFields,
  type ItemFieldKey,
} from "@/lib/item-fields";
import { formatMinutes, formatClock, formatTracked, parseEstimate } from "@/lib/estimate";
import { formatTaskDate, hasTimeOfDay, isOverdue, relativeTime, type LocalePrefs } from "@/lib/item-date";
import { Picker, PickerFooterRow, type PickerSectionDef } from "@/components/ui/picker";
import { Avatar, AvatarStack, personLabel, type AvatarPerson } from "@/components/ui/avatar-stack";
import { LightEditor } from "@/components/ui/light-editor";
import {
  initAutosave,
  onSent,
  onServerValue,
  onTyped,
  retryDelayMs,
  shouldCommit,
} from "@/lib/autosave-field";
import { Dots } from "@/components/ui/dots";
import { CommentThread } from "@/components/comments/comment-thread";
import { useItemFields } from "@/hooks/use-item-fields";
import { FieldValue } from "./field-value";
import { TagPicker } from "./tag-picker";
import { LinkedAttachments } from "./linked-attachments";
import { TimeTracker } from "./time-tracker";
import { ItemTypePicker } from "./item-type-picker";
import { ItemSubtasks } from "./item-subtasks";
import { ItemChecklist } from "./item-checklist";
import { DatePlanner } from "./date-planner";

export type DetailPatch = Partial<Pick<BoardItemRow, "title" | "status">> & {
  /** The WHOLE JSON column, replaced. Only a caller that owns all of it. */
  metadata?: Record<string, unknown>;
  /** Named keys only, merged server-side over what is stored; null deletes. */
  metadataPatch?: Record<string, unknown>;
  startAt?: string | null;
  dueAt?: string | null;
  ownerId?: string | null;
  assigneeIds?: string[];
  priority?: string | null;
  tagIds?: string[];
  itemTypeId?: string | null;
  recurRule?: RecurrenceRule | null;
  /** Phase 2, the two-list watcher rule, applied by the server. */
  watcherIds?: string[];
  /** Phase 2, "Move to list…". */
  boardId?: string;
};

/** Space-module gating for the item surfaces. Each false hides that capability. */
export type ItemModuleGating = { priority: boolean; tags: boolean; timeTracking: boolean; customFields: boolean };

export type DetailHost = "drawer" | "page" | "panel";

export interface ItemListContext {
  id: string;
  slug: string | null;
  name: string;
  /** False for an assignee-only viewer: the List name is a label, not a link. */
  readable: boolean;
}

interface BoardItemDetailProps {
  item: BoardItemRow;
  /** The one gate answer, from GET /api/items/[id]'s `decision`. */
  role: ItemRole;
  currentUserId: string | null;
  customFields: FieldDef[];
  statusOptions: StatusOption[];
  onPatch: (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => void;
  /** Three hosts, one prop (spec section 0, Cross-unit conflicts). */
  host?: DetailHost;
  /** `?comment=<updateId>`, anchor the thread on one comment. */
  deepLinkCommentId?: string | null;
  onDeepLinkResolved?: () => void;
  /** Clicking a subtask navigates; the host decides where. */
  onOpenItem?: (itemId: string) => void;
  moduleGating?: ItemModuleGating;
  listContext?: ItemListContext | null;
  /** From GET /api/items/[id]; drives the Watchers field. */
  watcherIds?: string[];
  /** The viewer's home.locale.*, so every date reads in their zone. */
  locale?: LocalePrefs | null;
  /** A Guest never sees KRA / KPI (access section 3.3). */
  isGuest?: boolean;
  /** Bumped by the host on an SSE item event. */
  refreshToken?: number;
  /** The author, for the meta line. Absent means the line omits the name. */
  createdBy?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  /** Lifted so the host can flush it on a session lapse (useTaskDraft). */
  titleDraft?: string | null;
  descriptionDraft?: string | null;
  commentDraft?: string;
  onDraftChange?: (patch: { title?: string; description?: string; comment?: string }) => void;
  /**
   * Phase 5b: the List the task is open in THROUGH A LINK, when it is. Its
   * subtasks are read and created through it.
   */
  linkedContextBoardId?: string | null;
  /**
   * Phase 5b: a Connect field's commit, which must hear the answer (the cell
   * keeps its selection and offers Retry on a failure).
   */
  onCommitField?: (key: string, next: unknown) => Promise<{ ok: true } | { ok: false; message: string }>;
}

function isEmptyValue(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Does one of the List's own fields carry a value on this task?
 *
 * Not every field keeps its value in `metadata`. A Mirror column is computed
 * at read time from the tasks the viewer can read and arrives in
 * `item.mirrors[key]`; it never has a metadata key at all. Reading metadata
 * alone made every mirror count as empty, so the drawer dropped it (and the
 * "N empty" count and the Add field hint were wrong about it) while the table
 * showed the same values. A mirror counts when at least one of its readable
 * values is non-empty. A Connect column keeps its ids in metadata, but the
 * resolved `connections[key]` is checked too, so a connected task the viewer
 * can read is never hidden if the two ever disagree.
 */
export function listFieldCarriesValue(
  item: Pick<BoardItemRow, "metadata" | "mirrors" | "connections">,
  key: string,
): boolean {
  if (!isEmptyValue(item.metadata?.[key])) return true;
  const mirrored = item.mirrors?.[key]?.values;
  if (Array.isArray(mirrored) && mirrored.some((v) => !isEmptyValue(v))) return true;
  return (item.connections?.[key]?.length ?? 0) > 0;
}

/**
 * One key of `metadata`, changed without touching the rest of it.
 *
 * The earlier version of this spread the CLIENT's cached blob and sent the
 * whole thing, because `PATCH /api/items/[id]` writes that column wholesale.
 * That made every cached copy a loaded gun: a drawer left open for an hour
 * reverted every metadata change anybody else had made the moment one field
 * was touched. `metadataPatch` is resolved against the stored blob inside the
 * request instead, so nothing here needs a fresh copy of it. An empty value
 * means "remove this key", which the server reads as `null`.
 */
function metadataPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) next[k] = v === undefined || v === "" ? null : v;
  return next;
}

export function BoardItemDetail({
  item,
  role,
  currentUserId,
  customFields,
  statusOptions,
  onPatch,
  host = "drawer",
  deepLinkCommentId = null,
  onDeepLinkResolved,
  onOpenItem,
  moduleGating,
  listContext = null,
  watcherIds = [],
  locale = null,
  isGuest = false,
  refreshToken = 0,
  createdBy = null,
  titleDraft = null,
  descriptionDraft = null,
  commentDraft,
  onDraftChange,
  linkedContextBoardId = null,
  onCommitField,
}: BoardItemDetailProps) {
  const canEdit = rankOf(role) >= rankOf("EDIT");
  const canComment = rankOf(role) >= rankOf("COMMENT");
  // The four booleans ARE the identity: the host re-reads the task every 30s
  // and hands a fresh object each time, so memoising on the object would
  // recompute the strip on every poll.
  const mp = moduleGating?.priority, mt = moduleGating?.tags;
  const mtt = moduleGating?.timeTracking, mcf = moduleGating?.customFields;
  const gating: ItemModuleGating = useMemo(
    () =>
      mp === undefined
        ? { priority: true, tags: true, timeTracking: true, customFields: true }
        : { priority: mp, tags: Boolean(mt), timeTracking: Boolean(mtt), customFields: Boolean(mcf) },
    [mp, mt, mtt, mcf],
  );

  const { stored, storedRaw, toggle, toggleListField } = useItemFields(listContext?.id ?? item.boardId ?? null);

  /** Does one of the List's own fields carry a value on this task? Mirrors included. */
  const listFieldHasValue = useCallback(
    (key: string) =>
      listFieldCarriesValue({ metadata: item.metadata, mirrors: item.mirrors, connections: item.connections }, key),
    [item.metadata, item.mirrors, item.connections],
  );

  const hasValue = useCallback(
    (key: ItemFieldKey): boolean => {
      switch (key) {
        case "status": return true;
        case "assignees": return (item.assigneeIds?.length ?? 0) > 0 || Boolean(item.ownerId);
        case "dueDate": return Boolean(item.dueAt);
        case "priority": return Boolean(item.priority);
        case "startDate": return Boolean(item.startAt);
        case "estimate": return typeof item.metadata?.timeEstimate === "number";
        case "timeTracked": return false;
        case "tags": return (item.tags?.length ?? 0) > 0;
        case "alignment": return Boolean(item.metadata?.kraId || item.metadata?.kpiId);
        case "watchers": return watcherIds.length > 0;
        default: return false;
      }
    },
    [item, watcherIds.length],
  );

  const visible = useMemo(
    () => resolveVisibleFields({ stored, hasValue, gating, hideAlignment: isGuest }),
    [stored, hasValue, gating, isGuest],
  );

  const creatorName =
    [createdBy?.firstName, createdBy?.lastName].filter(Boolean).join(" ").trim() || createdBy?.email || null;

  // Sections hide until they have content or the reader asks for them (e).
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [subtaskCount, setSubtaskCount] = useState<number | null>(null);
  const [attachCount, setAttachCount] = useState<number | null>(null);
  const reveal = (s: string) => setRevealed((prev) => new Set(prev).add(s));

  const checklistItems = Array.isArray(item.metadata?.checklist) ? (item.metadata!.checklist as unknown[]) : [];
  // The List's own fields are checked in the SAME "+ Add field" picker as the
  // built-ins, so an empty custom field is one click away instead of being
  // unreachable until somebody has already filled one in.
  const visibleListFields = resolveVisibleListFields({
    fields: customFields,
    stored: storedRaw,
    hasValue: listFieldHasValue,
    gating,
  });
  const shownListFields = customFields.filter((f) => visibleListFields.includes(f.key));
  // The section's own search box and "Hide / Show N empty" toggle (the old
  // Custom Fields header had both). Search narrows by label; the toggle folds
  // away the checked-but-empty fields, and the count says how many it hid.
  const [fieldQuery, setFieldQuery] = useState("");
  const [showEmptyFields, setShowEmptyFields] = useState(true);
  const emptyListFieldCount = shownListFields.filter((f) => !listFieldHasValue(f.key)).length;
  const listFieldRows = shownListFields.filter((f) => {
    if (!showEmptyFields && !listFieldHasValue(f.key)) return false;
    const q = fieldQuery.trim().toLowerCase();
    return !q || f.label.toLowerCase().includes(q);
  });
  const showSubtasks = revealed.has("subtasks") || (subtaskCount ?? 0) > 0;
  const showChecklist = revealed.has("checklist") || checklistItems.length > 0;
  const showRelated = revealed.has("related") || (attachCount ?? 0) > 0;

  const addRows = [
    !showSubtasks ? { key: "subtasks", icon: GitBranch, label: "Add subtask", onClick: () => reveal("subtasks") } : null,
    !showChecklist ? { key: "checklist", icon: ClipboardList, label: "Add checklist", onClick: () => reveal("checklist") } : null,
    !showRelated ? { key: "related", icon: Paperclip, label: "Attach file", onClick: () => reveal("related") } : null,
  ].filter((r): r is { key: string; icon: LucideIcon; label: string; onClick: () => void } => r !== null);

  // The column is applied by TaskDetailBody, which wraps this AND the three
  // banners, so both sit in the same 760 on the page host.
  return (
    <div className="w-full space-y-8">
      {/* 1, Type chip, then the title. The ONE title in all three hosts. */}
      <div className="space-y-2">
        <ItemTypePicker value={item.itemTypeId ?? null} canEdit={canEdit} onChange={(id) => onPatch({ itemTypeId: id })} />
        <TitleField
          item={item}
          canEdit={canEdit}
          draft={titleDraft}
          onDraftChange={(v) => onDraftChange?.({ title: v })}
          onSave={(t) => onPatch({ title: t })}
        />
      </div>

      {/* 2, the field strip (a) */}
      <div>
        <div className="space-y-0.5">
          {visible.map((key) => (
            <FieldRow key={key} icon={FIELD_ICON[key]} label={ITEM_FIELD_LABELS[key]}>
              <FieldControl
                fieldKey={key}
                item={item}
                canEdit={canEdit}
                onPatch={onPatch}
                statusOptions={statusOptions}
                listSlug={listContext?.slug ?? null}
                role={role}
                watcherIds={watcherIds}
                currentUserId={currentUserId}
                locale={locale}
              />
            </FieldRow>
          ))}
        </div>
        {canEdit ? (
          <AddFieldRow
            stored={stored}
            hasValue={hasValue}
            gating={gating}
            hideAlignment={isGuest}
            onToggle={toggle}
            customFields={gating.customFields ? customFields : []}
            storedRaw={storedRaw}
            listFieldHasValue={listFieldHasValue}
            onToggleListField={toggleListField}
            listSlug={listContext?.slug ?? null}
            canManageFields={role === "FULL"}
          />
        ) : null}
      </div>

      {/* 3, the meta line. The author is `createdBy`, resolved from the
          CREATED activity row by GET /api/items/[id]. It is NOT `item.owner`,
          which is the first assignee: naming the wrong person is worse than
          naming none, so the name is simply omitted when it cannot be
          resolved. */}
      <p className="text-xs font-medium text-ink-2">
        Created{creatorName ? ` by ${creatorName}` : ""} {formatTaskDate(item.createdAt, locale, { withWeekday: false })}
        <span className="mx-1 text-ink-3">·</span>
        Updated {relativeTime(item.updatedAt, locale)}
      </p>

      {/* 4, the description (c) */}
      <section>
        <h3 className="mb-1.5 text-sm font-medium text-ink">Description</h3>
        <DescriptionField
          item={item}
          canEdit={canEdit}
          draft={descriptionDraft}
          onDraftChange={(v) => onDraftChange?.({ description: v })}
          onSave={(desc) => onPatch({ metadataPatch: metadataPatch({ description: desc }) })}
        />
      </section>

      {/* List fields (custom), whichever ones the viewer has checked, plus any
          that carry a value (a value is never hidden). */}
      {shownListFields.length > 0 ? (
        <section className="space-y-0.5">
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="text-sm font-medium text-ink">List fields</h3>
            <span className="flex-1" />
            {shownListFields.length >= 4 ? (
              <label className="relative">
                <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
                <input
                  type="search"
                  value={fieldQuery}
                  onChange={(e) => setFieldQuery(e.target.value)}
                  placeholder="Search fields…"
                  aria-label="Search fields"
                  className="h-7 w-[160px] rounded-md border border-line bg-raised pe-2 ps-7 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </label>
            ) : null}
            {emptyListFieldCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowEmptyFields((v) => !v)}
                className="text-xs font-medium text-ink-2 hover:text-ink"
              >
                {showEmptyFields ? `Hide ${emptyListFieldCount} empty` : `Show ${emptyListFieldCount} empty`}
              </button>
            ) : null}
          </div>
          {listFieldRows.length === 0 ? (
            <p className="py-1 text-xs text-ink-3">No fields match</p>
          ) : null}
          {listFieldRows.map((f) => (
            <FieldRow key={f.key} label={f.label}>
              <FieldValue
                field={f}
                value={item.metadata?.[f.key]}
                mode="edit"
                disabled={!canEdit}
                currentUserId={currentUserId}
                // The List whose schema defines these fields (the body's own
                // board: its home, or the List it is open in through a link).
                // It scopes a USER / PEOPLE field and a Connect field's picker.
                boardId={listContext?.id ?? item.boardId ?? null}
                fieldListId={listContext?.id ?? item.boardId ?? null}
                itemId={item.id}
                connections={item.connections?.[f.key]}
                mirror={item.mirrors?.[f.key]}
                popover="absolute"
                onCommit={onCommitField ? (next) => onCommitField(f.key, next) : undefined}
                onChange={(next) => onPatch({ metadataPatch: metadataPatch({ [f.key]: next }) })}
              />
            </FieldRow>
          ))}
        </section>
      ) : null}

      {/* 5, subtasks (always mounted so it can report its count) */}
      <div className={showSubtasks ? "" : "hidden"}>
        <ItemSubtasks
          item={item}
          canEdit={canEdit}
          statuses={statusOptions}
          onOpenItem={onOpenItem}
          onCountChange={setSubtaskCount}
          autoFocus={revealed.has("subtasks")}
          contextBoardId={linkedContextBoardId}
        />
      </div>

      {/* 6, checklist */}
      {showChecklist ? (
        <ItemChecklist item={item} canEdit={canEdit} onSave={(checklist) => onPatch({ metadataPatch: metadataPatch({ checklist }) })} />
      ) : null}

      {/* 7 and 8, attachments and Related, sectioned by kind (d) */}
      <div className={showRelated ? "" : "hidden"}>
        <LinkedAttachments
          sourceType="BOARD_ITEM"
          sourceId={item.id}
          spaceId={item.spaceId ?? null}
          canEdit={canEdit}
          onCountChange={setAttachCount}
        />
      </div>

      {/* 9, "Add to task" (e) */}
      {canEdit && addRows.length > 0 ? (
        <div className="grid max-w-[420px] gap-0.5">
          {addRows.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={r.onClick}
              className="flex h-9 items-center gap-2 rounded-md px-2 text-start text-row text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <r.icon className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* 10, comments and activity, last, in every host (b) */}
      <CommentThread
        entityType="BOARD_ITEM"
        entityId={item.id}
        boardId={item.boardId ?? null}
        canComment={canComment}
        currentUserId={currentUserId}
        statuses={statusOptions}
        locale={locale}
        deepLinkId={deepLinkCommentId}
        onDeepLinkResolved={onDeepLinkResolved}
        draft={commentDraft}
        onDraftChange={(v) => onDraftChange?.({ comment: v })}
        refreshToken={refreshToken}
        /* The drawer pins its composer so a long thread cannot scroll it
           away; the page and the Inbox pane scroll normally. */
        stickyComposer={host === "drawer"}
      />
    </div>
  );
}

// ── the field strip ──────────────────────────────────────────────────

const FIELD_ICON: Record<ItemFieldKey, LucideIcon> = {
  status: Check,
  assignees: UserPlus,
  dueDate: CalendarPlus,
  priority: Flag,
  startDate: CalendarDays,
  estimate: Hourglass,
  timeTracked: Clock,
  tags: Tag,
  alignment: Target,
  watchers: Eye,
};

/** One 36px label/value row: 120px label column, value reads like text. */
function FieldRow({ icon: Icon, label, children }: { icon?: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <div className="flex w-[120px] shrink-0 items-center gap-2">
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="h-1 w-1 rounded-full bg-[var(--os-line-strong)]" />
          </span>
        )}
        <span className="truncate text-sm font-medium text-ink-2">{label}</span>
      </div>
      <div className="flex min-h-[30px] min-w-0 flex-1 items-center rounded-md px-2 py-1 transition-colors hover:bg-hover">
        {children}
      </div>
    </div>
  );
}

function FieldControl({
  fieldKey,
  item,
  canEdit,
  onPatch,
  statusOptions,
  listSlug,
  role,
  watcherIds,
  currentUserId,
  locale,
}: {
  fieldKey: ItemFieldKey;
  item: BoardItemRow;
  canEdit: boolean;
  onPatch: (b: DetailPatch, optimistic?: Partial<BoardItemRow>) => void;
  statusOptions: StatusOption[];
  listSlug: string | null;
  role: ItemRole;
  watcherIds: string[];
  currentUserId: string | null;
  locale: LocalePrefs | null;
}) {
  switch (fieldKey) {
    case "status":
      return <StatusField value={item.status} statuses={statusOptions} canEdit={canEdit} isFull={role === "FULL"} listSlug={listSlug} onChange={(v) => onPatch({ status: v })} />;
    case "assignees":
      return <AssigneesField item={item} canEdit={canEdit} currentUserId={currentUserId} onPatch={onPatch} />;
    case "dueDate":
      // A reader below Can edit gets the DATE, not a "Set date" button they
      // cannot press (access section 5.4: absent, never disabled).
      return canEdit ? (
        <DatePlanner item={item} canEdit onPatch={onPatch} statuses={statusOptions} />
      ) : (
        <DateLabel value={item.dueAt} locale={locale} overdue={isOverdue(item.dueAt, locale)} />
      );
    case "priority":
      return <PriorityField value={item.priority ?? null} canEdit={canEdit} onChange={(p) => onPatch({ priority: p })} />;
    case "startDate":
      return <DateLabel value={item.startAt} locale={locale} />;
    case "estimate":
      return <EstimateField item={item} canEdit={canEdit} onPatch={onPatch} />;
    case "timeTracked":
      return <TrackTimeField itemId={item.id} canEdit={canEdit} />;
    case "tags":
      if (!canEdit && (item.tags?.length ?? 0) === 0) return <span className="text-row text-ink-3">None</span>;
      return <TagPicker value={item.tags ?? []} canEdit={canEdit} onChange={(tags) => onPatch({ tagIds: tags.map((t) => t.id) }, { tags })} />;
    case "alignment":
      return <AlignmentField item={item} canEdit={canEdit} onPatch={onPatch} />;
    case "watchers":
      return <WatchersField watcherIds={watcherIds} boardId={item.boardId ?? null} currentUserId={currentUserId} onPatch={onPatch} />;
    default:
      return null;
  }
}

function AddFieldRow({
  stored,
  hasValue,
  gating,
  hideAlignment,
  onToggle,
  customFields,
  storedRaw,
  listFieldHasValue,
  onToggleListField,
  listSlug,
  canManageFields,
}: {
  stored: ItemFieldKey[];
  hasValue: (k: ItemFieldKey) => boolean;
  gating: ItemModuleGating;
  hideAlignment: boolean;
  onToggle: (k: ItemFieldKey) => void;
  /** The List's own fields, so they have a door even when all of them are empty. */
  customFields: FieldDef[];
  storedRaw: string[];
  listFieldHasValue: (key: string) => boolean;
  onToggleListField: (key: string) => void;
  listSlug: string | null;
  canManageFields: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rows = addFieldRows({ stored, hasValue, gating, hideAlignment });
  const listRows = listFieldRows({ fields: customFields, stored: storedRaw, hasValue: listFieldHasValue, gating });
  if (rows.length === 0 && listRows.length === 0) return null;
  const hint = (lockedByValue: boolean) => (lockedByValue ? "has a value" : undefined);
  const sections: PickerSectionDef[] = [
    {
      options: rows.map((r) => ({
        value: r.key,
        label: r.label,
        // A field shown only because it carries a value says so, rather than
        // offering an unchecking that would not take.
        hint: hint(r.lockedByValue),
      })),
    },
    // "then a section 'List fields' with every custom field of the List"
    // (spec-task-detail section 2, item 2).
    ...(listRows.length
      ? [{
          label: "List fields",
          options: listRows.map((r) => ({ value: `list:${r.key}`, label: r.label, hint: hint(r.lockedByValue) })),
        }]
      : []),
  ];
  const selected = [
    ...rows.filter((r) => r.checked).map((r) => r.key),
    ...listRows.filter((r) => r.checked).map((r) => `list:${r.key}`),
  ];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-0.5 flex h-9 items-center gap-2 rounded-md px-2 text-start text-row text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <Plus className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
        Add field
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={sections}
        multi
        selected={selected}
        ariaLabel="Add a field"
        onSelect={(v) => {
          if (v.startsWith("list:")) onToggleListField(v.slice(5));
          else onToggle(v as ItemFieldKey);
        }}
        footer={
          canManageFields && listSlug ? (
            <PickerFooterRow onClick={() => { window.location.href = `/boards/${listSlug}?panel=fields`; }}>
              Manage fields
            </PickerFooterRow>
          ) : null
        }
      />
    </div>
  );
}

// ── status (f) ───────────────────────────────────────────────────────

function StatusField({
  value,
  statuses,
  canEdit,
  isFull,
  listSlug,
  onChange,
}: {
  value: string | null;
  statuses: StatusOption[];
  canEdit: boolean;
  isFull: boolean;
  listSlug: string | null;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = value ? statuses.find((o) => o.value === value) ?? null : null;
  const done = statuses.find((o) => o.group === "DONE");
  const isDone = current?.group === "DONE";

  const chip = current ? (
    <span
      className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium"
      style={{ backgroundColor: `${current.color}1F`, color: current.color, border: `1px solid ${current.color}33` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: current.color }} />
      {current.label}
    </span>
  ) : (
    <span className="text-row text-ink-3">No status</span>
  );

  if (!canEdit) return chip;

  const grouped: PickerSectionDef[] = (["ACTIVE", "DONE", "CLOSED"] as const)
    .map((g) => ({
      label: g === "ACTIVE" ? "Active" : g === "DONE" ? "Done" : "Closed",
      options: statuses
        .filter((s) => s.group === g)
        .map((s) => ({
          value: s.value,
          label: s.label,
          glyph: <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />,
        })),
    }))
    .filter((s) => s.options.length > 0);

  return (
    <span className="relative inline-flex items-center gap-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        {chip}
      </button>
      {done ? (
        isDone ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text">
            <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Completed
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onChange(done.value)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Mark complete
          </button>
        )
      ) : null}
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={grouped}
        selected={value}
        ariaLabel="Status"
        onSelect={(v) => onChange(v)}
        footer={
          isFull && listSlug ? (
            <PickerFooterRow onClick={() => { window.location.href = `/boards/${listSlug}?panel=statuses`; }}>
              Manage statuses
            </PickerFooterRow>
          ) : null
        }
      />
    </span>
  );
}

// ── people ───────────────────────────────────────────────────────────

/** The people this task can be handed to, for the assignee and watcher
 *  pickers. With a board in scope we ask who can reach THAT list; /api/users
 *  is the fallback for a task with no board, and it is a narrow one: that
 *  endpoint silently clamps a non-exec caller to their own report tree, so a
 *  Space Admin with no reports gets a picker containing only himself.
 *
 *  THE SEARCH GOES TO THE SERVER. This used to fetch once, ever, and let the
 *  Picker filter what happened to be in memory, while the roster endpoint caps
 *  at 200 rows ordered by first name. On a List with more people than that,
 *  everybody past the 200th was simply unreachable and the box gave no sign of
 *  it: the same "a picker that truncates before you have typed anything is a
 *  picker that lies about who exists" the row picker was fixed for. */
function usePeople(open: boolean, boardId: string | null, query: string) {
  const [people, setPeople] = useState<AvatarPerson[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "200" });
      const q = query.trim();
      if (q) params.set("search", q);
      if (!boardId) params.set("scope", "all");
      const url = boardId
        ? `/api/boards/${encodeURIComponent(boardId)}/assignable?${params}`
        : `/api/users?${params}`;
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => { if (active) setPeople(Array.isArray(d?.data) ? d.data : []); })
        .catch(() => { if (active) setPeople([]); });
    }, query.trim() ? 250 : 0);
    return () => { active = false; clearTimeout(t); };
  }, [open, boardId, query]);
  return people;
}

function AssigneesField({
  item,
  canEdit,
  currentUserId,
  onPatch,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  currentUserId: string | null;
  onPatch: (b: DetailPatch, optimistic?: Partial<BoardItemRow>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const people = usePeople(open, item.boardId ?? null, query);
  const current: AvatarPerson[] = item.assignees?.length
    ? item.assignees
    : item.owner
      ? [item.owner]
      : [];
  const ids = current.map((p) => p.id);

  const stack = <AvatarStack people={current} size={24} max={3} empty={<span className="text-row text-ink-3">{canEdit ? "Assign" : "Unassigned"}</span>} />;
  if (!canEdit) return stack;

  const me = people.find((p) => p.id === currentUserId);
  const rest = people.filter((p) => p.id !== currentUserId);
  const sections: PickerSectionDef[] = [
    ...(me ? [{ options: [{ value: me.id, label: "Me", glyph: <Avatar person={me} size={20} /> }] }] : []),
    {
      label: "Everyone",
      options: rest.map((p) => ({
        value: p.id,
        label: personLabel(p),
        keywords: p.email ?? "",
        glyph: <Avatar person={p} size={20} />,
      })),
    },
  ];

  const commit = (nextIds: string[]) => {
    const next = nextIds
      .map((id) => people.find((p) => p.id === id) ?? current.find((p) => p.id === id))
      .filter((p): p is AvatarPerson => Boolean(p));
    onPatch(
      { assigneeIds: nextIds },
      {
        assigneeIds: nextIds,
        assignees: next.map((p) => ({ id: p.id, firstName: p.firstName ?? "", lastName: p.lastName ?? "", avatar: p.avatar ?? null })),
        owner: next[0] ? { id: next[0].id, firstName: next[0].firstName ?? "", lastName: next[0].lastName ?? "", avatar: next[0].avatar ?? null } : null,
      } as Partial<BoardItemRow>,
    );
  };

  return (
    <span className="relative inline-flex items-center">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center">
        {stack}
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={sections}
        multi
        selected={ids}
        ariaLabel="Assignees"
        searchPlaceholder="Search people…"
        alwaysSearch
        onSearchChange={setQuery}
        emptyLabel="Nobody matches"
        onSelect={(id) => commit(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])}
        footer={
          ids.length ? (
            <PickerFooterRow onClick={() => { commit([]); setOpen(false); }}>Unassign all</PickerFooterRow>
          ) : null
        }
      />
      {/* The caption access rule 9 requires: assigning is granting. */}
      {open ? <span className="sr-only">Assigning gives them access to this task</span> : null}
    </span>
  );
}

function WatchersField({
  watcherIds,
  boardId,
  currentUserId,
  onPatch,
}: {
  watcherIds: string[];
  boardId: string | null;
  currentUserId: string | null;
  onPatch: (b: DetailPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Resolve as soon as there is somebody to name. The search only narrows the
  // PICKER, so the unfiltered roster is refetched whenever the box is closed,
  // which is what keeps the avatar stack above able to name everybody.
  const people = usePeople(open || watcherIds.length > 0, boardId, open ? query : "");
  // Only the watchers this viewer can actually NAME become avatars. A "?"
  // circle is a person the reader cannot identify, so the rest are a count:
  // "and 2 more" says exactly as much and claims nothing.
  const named = watcherIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is AvatarPerson => Boolean(p));
  const unnamed = watcherIds.length - named.length;
  const watching = Boolean(currentUserId && watcherIds.includes(currentUserId));

  const stack = (
    <span className="inline-flex items-center gap-1.5">
      <AvatarStack
        people={named}
        size={24}
        max={3}
        empty={unnamed === 0 ? <span className="text-row text-ink-3">Nobody yet</span> : null}
      />
      {unnamed > 0 ? (
        <span className="text-xs font-medium text-ink-2">
          {named.length > 0 ? `and ${unnamed} more` : `${unnamed} watching`}
        </span>
      ) : null}
    </span>
  );

  const sections: PickerSectionDef[] = [
    {
      options: people.map((p) => ({
        value: p.id,
        label: p.id === currentUserId ? "You" : personLabel(p),
        keywords: p.email ?? "",
        glyph: <Avatar person={p} size={20} />,
      })),
    },
  ];

  return (
    <span className="relative inline-flex items-center gap-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center">
        {stack}
      </button>
      {currentUserId ? (
        <button
          type="button"
          onClick={() =>
            onPatch({
              watcherIds: watching ? watcherIds.filter((id) => id !== currentUserId) : [...watcherIds, currentUserId],
            })
          }
          className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
        >
          {watching ? "Unwatch" : "Watch"}
        </button>
      ) : null}
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={sections}
        multi
        selected={watcherIds}
        ariaLabel="Watchers"
        searchPlaceholder="Search people…"
        alwaysSearch
        onSearchChange={setQuery}
        emptyLabel="Nobody matches"
        onSelect={(id) =>
          onPatch({ watcherIds: watcherIds.includes(id) ? watcherIds.filter((x) => x !== id) : [...watcherIds, id] })
        }
      />
    </span>
  );
}

// ── priority ─────────────────────────────────────────────────────────

const PRIORITY_ROWS = [
  { value: "URGENT", label: "Urgent", cls: "text-danger-text" },
  { value: "HIGH", label: "High", cls: "text-ink" },
  { value: "NORMAL", label: "Normal", cls: "text-ink-2" },
  { value: "LOW", label: "Low", cls: "text-ink-3" },
  { value: "", label: "None", cls: "text-ink-3" },
] as const;

function PriorityField({ value, canEdit, onChange }: { value: string | null; canEdit: boolean; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const row = PRIORITY_ROWS.find((r) => r.value === (value ?? "")) ?? PRIORITY_ROWS[4];
  const filled = row.value === "URGENT" || row.value === "HIGH";
  const label = (
    <span className={`inline-flex items-center gap-1.5 text-row ${value ? row.cls : "text-ink-3"}`}>
      <Flag className="h-4 w-4 shrink-0" strokeWidth={1.5} fill={filled ? "currentColor" : "none"} aria-hidden="true" />
      {value ? row.label : "Set priority"}
    </span>
  );
  if (!canEdit) {
    return value ? label : <span className="text-row text-ink-3">None</span>;
  }
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen((v) => !v)}>{label}</button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={[{ options: PRIORITY_ROWS.map((r) => ({ value: r.value || "NONE", label: r.label, glyph: <Flag className={`h-4 w-4 ${r.cls}`} strokeWidth={1.5} /> })) }]}
        selected={value ?? "NONE"}
        ariaLabel="Priority"
        onSelect={(v) => onChange(v === "NONE" ? null : v)}
      />
    </span>
  );
}

/** A date as a reader sees it: the date, or "None". Overdue and not done is
 *  the one date that carries a colour. */
function DateLabel({ value, locale, overdue = false }: { value: string | Date | null | undefined; locale: LocalePrefs | null; overdue?: boolean }) {
  if (!value) return <span className="text-row text-ink-3">None</span>;
  return (
    <span className={`text-row ${overdue ? "text-danger-text" : "text-ink"}`}>
      {formatTaskDate(value, locale, { withTime: hasTimeOfDay(value, locale) })}
    </span>
  );
}

// ── estimate and tracked time ────────────────────────────────────────

function EstimateField({ item, canEdit, onPatch }: { item: BoardItemRow; canEdit: boolean; onPatch: (b: DetailPatch) => void }) {
  const raw = item.metadata?.timeEstimate;
  const minutes = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const next = parseEstimate(draft);
    setEditing(false);
    if (next === minutes) return;
    onPatch({ metadataPatch: metadataPatch({ timeEstimate: next ?? null }) });
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        aria-label="Estimate"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
        }}
        placeholder="2h 30m"
        className="h-8 w-[120px] rounded-md border border-brand bg-raised px-2 text-row text-ink outline-none placeholder:text-ink-3"
      />
    );
  }
  if (!canEdit) {
    return minutes ? <span className="text-row tabular-nums text-ink">{formatMinutes(minutes)}</span> : <span className="text-row text-ink-3">Not set</span>;
  }
  return (
    <button type="button" onClick={() => { setDraft(minutes ? formatMinutes(minutes) : ""); setEditing(true); }} className="text-start text-row">
      {minutes ? <span className="tabular-nums text-ink">{formatMinutes(minutes)}</span> : <span className="text-ink-3">Set estimate</span>}
    </button>
  );
}

interface TimerState {
  active: { id: string; startedAt: string } | null;
  totalMs: number;
  sessions: { id: string; stoppedAt: string | null; durationMs: number }[];
}

function TrackTimeField({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const [state, setState] = useState<TimerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const load = useCallback(() => {
    fetch(`/api/timers?entityType=BOARD_ITEM&entityId=${itemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TimerState | null) => { if (d) setState(d); })
      .catch(() => {});
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!state?.active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state?.active]);

  const toggle = async () => {
    setBusy(true);
    try {
      await fetch(state?.active ? "/api/timers/stop" : "/api/timers/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType: "BOARD_ITEM", entityId: itemId }),
      });
      load();
    } finally {
      setBusy(false);
    }
  };

  const running = Boolean(state?.active);
  const elapsed = state?.active ? Math.max(0, now - new Date(state.active.startedAt).getTime()) : 0;
  const total = (state?.totalMs ?? 0) + elapsed;

  return (
    <span className="relative inline-flex items-center gap-2">
      {canEdit ? (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          title={running ? "Stop timer" : "Start timer"}
          aria-label={running ? "Stop timer" : "Start timer"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line-strong text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          {busy ? <Dots variant="pending" /> : running ? <Square className="h-3 w-3 fill-current" strokeWidth={1.5} /> : <Play className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />}
        </button>
      ) : null}
      {running ? (
        <span className="inline-flex items-center gap-1.5">
          <Dots variant="live" />
          <span className="font-[family-name:var(--os-f-mono)] text-row tabular-nums text-ink">{formatClock(elapsed)}</span>
        </span>
      ) : null}
      <button type="button" onClick={() => { setOpen((v) => !v); if (open) load(); }} className="text-start text-row tabular-nums">
        {total > 0 ? <span className="text-ink">{formatTracked(total)}</span> : <span className="text-ink-3">Add time</span>}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => { setOpen(false); load(); }} aria-hidden="true" />
          <div className="absolute end-0 top-full z-[61] mt-1 w-[340px] rounded-lg border border-line bg-raised p-3 shadow-[var(--os-shadow-pop)]">
            <TimeTracker entityType="BOARD_ITEM" entityId={itemId} canEdit={canEdit} />
          </div>
        </>
      ) : null}
    </span>
  );
}

// ── KRA / KPI ────────────────────────────────────────────────────────

type KraLite = { id: string; name: string; category?: string | null };
type KpiLite = { id: string; name: string; kra: { id: string; name: string } | null };

function AlignmentField({ item, canEdit, onPatch }: { item: BoardItemRow; canEdit: boolean; onPatch: (b: DetailPatch) => void }) {
  const kraId = typeof item.metadata?.kraId === "string" ? (item.metadata.kraId as string) : null;
  const kpiId = typeof item.metadata?.kpiId === "string" ? (item.metadata.kpiId as string) : null;
  const [open, setOpen] = useState(false);
  const [kras, setKras] = useState<KraLite[]>([]);
  const [kpis, setKpis] = useState<KpiLite[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || (!open && !kraId && !kpiId)) return;
    loaded.current = true;
    void Promise.all([
      fetch("/api/kras?scope=all&limit=200").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/kpis").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([kr, kp]) => {
      setKras(Array.isArray(kr?.data) ? kr.data : Array.isArray(kr) ? kr : []);
      setKpis(Array.isArray(kp) ? kp : Array.isArray(kp?.data) ? kp.data : []);
    });
  }, [open, kraId, kpiId]);

  const kpiName = kpiId ? kpis.find((k) => k.id === kpiId)?.name ?? null : null;
  const kraName = kraId ? kras.find((k) => k.id === kraId)?.name ?? null : null;

  // The taupe chip (#a78b8022 / #8e7165) is deleted: a neutral Chip, as every
  // other label chip in the product now is.
  const summary = (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {kpiId ? <NeutralChip icon={Target} label={`KPI · ${kpiName ?? "KPI"}`} /> : null}
      {kraId ? <NeutralChip icon={Flag} label={`KRA · ${kraName ?? "KRA"}`} /> : null}
      {!kraId && !kpiId ? <span className="text-row text-ink-3">{canEdit ? "Link a KRA or KPI" : "Not linked"}</span> : null}
    </span>
  );
  if (!canEdit) return summary;

  const commit = (nextKra: string | null, nextKpi: string | null) => {
    onPatch({ metadataPatch: metadataPatch({ kraId: nextKra, kpiId: nextKpi }) });
    setOpen(false);
  };

  const sections: PickerSectionDef[] = [
    {
      label: "KPIs",
      options: kpis.map((k) => ({
        value: `kpi:${k.id}`,
        label: k.name,
        description: k.kra ? `KRA · ${k.kra.name}` : undefined,
        glyph: <Target className="h-4 w-4" strokeWidth={1.5} />,
      })),
    },
    {
      label: "KRAs",
      options: kras.map((k) => ({
        value: `kra:${k.id}`,
        label: k.name,
        description: k.category ?? undefined,
        glyph: <Flag className="h-4 w-4" strokeWidth={1.5} />,
      })),
    },
  ].filter((s) => s.options.length > 0);

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen((v) => !v)}>{summary}</button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={sections}
        selected={kpiId ? `kpi:${kpiId}` : kraId ? `kra:${kraId}` : null}
        ariaLabel="KRA or KPI"
        searchPlaceholder="Search KPIs or KRAs…"
        emptyLabel="No KRAs or KPIs yet"
        onSelect={(v) => {
          if (v.startsWith("kpi:")) {
            const kpi = kpis.find((k) => k.id === v.slice(4));
            commit(kpi?.kra?.id ?? null, kpi?.id ?? null);
          } else {
            commit(v.slice(4), null);
          }
        }}
        footer={
          kraId || kpiId ? (
            <PickerFooterRow icon={<Ban className="h-4 w-4" strokeWidth={1.5} />} onClick={() => commit(null, null)}>
              Clear
            </PickerFooterRow>
          ) : null
        }
      />
    </span>
  );
}

function NeutralChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md bg-hover px-2 text-xs font-medium text-ink">
      <Icon className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      {label}
    </span>
  );
}

// ── title and description ────────────────────────────────────────────

function TitleField({
  item,
  canEdit,
  draft,
  onDraftChange,
  onSave,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  draft: string | null;
  onDraftChange: (v: string) => void;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(item.title);
  const [synced, setSynced] = useState(item.title);
  // Follow the server unless the person is typing: a realtime refresh must not
  // overwrite a title mid-edit.
  if (!editing && synced !== item.title) {
    setSynced(item.title);
    setLocal(item.title);
  }
  const value = draft ?? local;

  const commit = useCallback(() => {
    const trimmed = value.trim();
    setEditing(false);
    if (!trimmed) {
      setLocal(item.title);
      onDraftChange("");
      return;
    }
    if (trimmed !== item.title) onSave(trimmed);
    onDraftChange("");
  }, [value, item.title, onSave, onDraftChange]);

  // Closing the host mid-rename saves the rename instead of dropping it.
  const commitRef = useRef(commit);
  const editingRef = useRef(editing);
  useEffect(() => {
    commitRef.current = commit;
    editingRef.current = editing;
  });
  useEffect(() => () => { if (editingRef.current) commitRef.current(); }, []);

  if (!canEdit) {
    return <h1 className="cursor-default text-xl font-semibold leading-snug text-ink">{item.title}</h1>;
  }
  if (!editing) {
    return (
      <button
        type="button"
        data-task-title
        onClick={() => setEditing(true)}
        className="w-full text-start text-xl font-semibold leading-snug text-ink"
      >
        {value || item.title}
      </button>
    );
  }
  return (
    <textarea
      autoFocus
      rows={1}
      value={value}
      aria-label="Task name"
      onChange={(e) => {
        setLocal(e.target.value);
        onDraftChange(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        // A title is one line: Shift+Enter never inserts a newline.
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setLocal(item.title);
          onDraftChange("");
          setEditing(false);
        }
      }}
      className="w-full resize-none border-b border-brand bg-transparent text-xl font-semibold leading-snug text-ink outline-none"
    />
  );
}

function DescriptionField({
  item,
  canEdit,
  draft,
  onDraftChange,
  onSave,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  draft: string | null;
  onDraftChange: (v: string) => void;
  onSave: (description: string) => void;
}) {
  const stored = typeof item.metadata?.description === "string" ? (item.metadata.description as string) : "";
  const [editing, setEditing] = useState(false);
  // ONE piece of state, and the rule that moves it lives in
  // src/lib/autosave-field.ts so it can be tested without a DOM. See that
  // module's header for the data-loss bug it encodes: this field used to mark
  // itself clean and delete its localStorage draft the instant it CALLED
  // onSave, so a refused or dropped PATCH let the server's old value overwrite
  // the words the person had just typed, in a box that said "Not saved,
  // retrying" while nothing retried.
  const [save, setSave] = useState(() => initAutosave(stored));
  // Reconcile with the server during render rather than in an effect: an
  // effect paints one frame with the previous value still in the box. This is
  // also where a save is CONFIRMED, by the server echoing back what was sent.
  const reconciled = onServerValue(save, stored);
  if (reconciled !== save) setSave(reconciled);
  const dirty = reconciled.dirty;
  const value = draft ?? reconciled.local;

  // The draft store is told to forget the words only once they are confirmed.
  const confirmed = save.sent !== null && reconciled.sent === null;
  useEffect(() => {
    if (confirmed) onDraftChange("");
  }, [confirmed, onDraftChange]);

  const commit = useCallback(() => {
    if (!shouldCommit(reconciled, value, stored)) return;
    setSave((s) => onSent(s, value));
    onSave(value);
  }, [reconciled, value, stored, onSave]);

  // Autosave 2s after the last keystroke, and on blur (design-system 5.17),
  // then RETRY with a backoff, because the indicator promises one. `attempt`
  // in the deps is what re-arms the timer after a save that did not land;
  // retryDelayMs returns null once it should stop, and the words then simply
  // stay dirty, in the box and in the draft store.
  const attempt = reconciled.attempt;
  useEffect(() => {
    if (!dirty || value === stored) return;
    const delay = retryDelayMs(attempt);
    if (delay === null) return;
    const t = setTimeout(() => { commit(); }, delay);
    return () => clearTimeout(t);
  }, [dirty, value, stored, commit, attempt]);

  // And on the way out. Esc, the drawer's X, a click on the list and browser
  // Back all unmount this inside the 2s window, and the cleanup above only
  // cancels the timer. A separate unmount-only effect, reading the latest
  // `commit` through a ref, is what makes those four doors safe; `commit`
  // itself is a no-op when nothing is dirty.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => () => { commitRef.current(); }, []);

  if (!canEdit) return <LightEditor value={stored} onChange={() => {}} readOnly />;

  // CLICK TO EDIT, the same shape the title above uses.
  //
  // Before this, an editor saw the raw textarea and nothing else, ever: the
  // markdown render lived on the readOnly branch, which only people who
  // CANNOT edit ever reached. So the person who typed "- a" kept looking at
  // "- a" and reported, correctly, that bullets did not work. Now the field
  // rests as the rendered body and becomes a textarea when it is asked to.
  //
  // It rests only when there is something to render. An empty description
  // shows the editor, because a blank rounded box with a toolbar is the
  // invitation to write one.
  if (!editing && value.trim()) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Description, press Enter to edit"
        onClick={(e) => {
          // A link inside the body is a link. Only a click on the prose
          // itself opens the editor.
          if ((e.target as HTMLElement).closest("a")) return;
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className="w-full cursor-text rounded-md border border-transparent px-3 py-2 text-start outline-none transition-colors hover:border-line hover:bg-hover focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_var(--os-focus-halo)]"
      >
        <LightEditor value={value} onChange={() => {}} readOnly />
      </div>
    );
  }

  return (
    <div
      onKeyDown={(e) => {
        // Esc leaves the field without closing the whole drawer, and it
        // COMMITS rather than reverts: words a person typed are theirs.
        if (e.key === "Escape") {
          e.stopPropagation();
          commit();
          setEditing(false);
        }
      }}
    >
      <LightEditor
        value={value}
        mentions
        boardId={item.boardId ?? null}
        minRows={3}
        maxRows={12}
        autoFocus={editing}
        onChange={(next) => {
          setSave((s) => onTyped(s, next));
          onDraftChange(next);
        }}
        onBlur={() => {
          // Save first, then rest. Nothing in flight is dropped.
          commit();
          setEditing(false);
        }}
      />
    </div>
  );
}

// Re-exported so the two hosts and the row menus can share one search glyph
// convention without importing lucide twice.
export { Search as DetailSearchIcon, Link2 as DetailLinkIcon };
