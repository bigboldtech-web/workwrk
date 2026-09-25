"use client";

// AddToListPicker: "Add to another List…" (decision 7, ClickUp's model).
//
// The Lists offered are the ones the viewer may ADD to: GET
// /api/boards?readable=1&writable=1&targets=1 (src/lib/readable-lists.ts),
// search-driven, so a List is found by typing whatever page of results is
// loaded, and a Personal List (never a link target) is never offered. The
// task's own Lists come from GET /api/items/[id]/lists and are marked, not
// hidden: its home reads "Home" and each List it already appears in reads
// "Already here", both disabled, so the person sees where it already is.
//
// Choosing a List POSTs /api/boards/[target]/links { itemIds: [id] }. That
// route answers per task; a task that moved home between the read and the
// write answers `home_changed`, which is retried once, and every other refusal
// becomes a sentence (list-link-rows.ts addLinkReasonMessage). One add at a
// time: a second pick while one is on its way is ignored.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { useOsToast } from "@/components/layout/os/toast";
import { accessMessage } from "@/lib/access-message";
import { addLinkReasonMessage } from "@/lib/list-link-rows";
import { emitItemChanged } from "@/lib/realtime-events";
import { groupReadableLists, readableListsUrl, type ReadableListsResponse } from "@/lib/readable-lists";

/** GET /api/items/[id]/lists, as every Phase 5b task surface reads it. */
export interface TaskListsAnswer {
  home: { id: string; slug: string; name: string; readable: boolean } | { readable: false; id?: undefined; slug?: undefined; name?: undefined };
  linked: Array<{ boardId: string; slug: string; name: string; position: number; addedAt: string; canRemove: boolean }>;
  viaParentId: string | null;
  canShare: boolean;
  canUnshareAll: boolean;
}

type AddOutcome = { ok: true; created: boolean } | { ok: false; message: string; reason?: string };

/** One POST to the links route, with the one retry `home_changed` asks for. */
export async function addTaskToList(itemId: string, targetId: string): Promise<AddOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`/api/boards/${targetId}/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: [itemId] }),
      });
    } catch {
      return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
    }
    const body = (await res.json().catch(() => null)) as
      | { results?: Array<{ itemId: string; ok: boolean; created?: boolean; reason?: string }> }
      | Record<string, unknown>
      | null;
    if (!res.ok) return { ok: false, message: accessMessage(body, "Couldn't add this task to that List.") };
    const result = Array.isArray((body as { results?: unknown })?.results)
      ? (body as { results: Array<{ itemId: string; ok: boolean; created?: boolean; reason?: string }> }).results.find((r) => r.itemId === itemId)
      : undefined;
    if (!result) return { ok: false, message: "Couldn't add this task to that List." };
    if (result.ok) return { ok: true, created: result.created !== false };
    if (result.reason === "home_changed" && attempt === 0) continue;
    return { ok: false, message: addLinkReasonMessage(result.reason), reason: result.reason };
  }
  return { ok: false, message: addLinkReasonMessage("home_changed") };
}

export function AddToListPicker({
  open,
  onClose,
  itemId,
  homeBoardId = null,
  anchorPoint = null,
  align = "end",
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string;
  /** The task's home, when the host knows it, for the realtime event. */
  homeBoardId?: string | null;
  anchorPoint?: { top: number; left: number } | null;
  align?: "start" | "end";
  onAdded?: (list: { id: string; name: string }) => void;
}) {
  const { toast } = useOsToast();
  const [query, setQuery] = useState("");
  const [lists, setLists] = useState<ReadableListsResponse | null>(null);
  const [listsState, setListsState] = useState<"loading" | "ready" | "failed">("loading");
  const [task, setTask] = useState<TaskListsAnswer | null>(null);
  const busy = useRef(false);

  // Where the task already is, read fresh on every open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/items/${itemId}/lists`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TaskListsAnswer | null) => { if (alive) setTask(d); })
      .catch(() => { if (alive) setTask(null); });
    return () => { alive = false; };
  }, [open, itemId]);

  // The candidates, searched on the server as the person types.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      fetch(readableListsUrl({ writable: true, targets: true, q: query }), { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: ReadableListsResponse) => {
          if (!alive) return;
          setLists({ boards: Array.isArray(d?.boards) ? d.boards : [], spaces: Array.isArray(d?.spaces) ? d.spaces : [], truncated: !!d?.truncated });
          setListsState("ready");
        })
        .catch(() => { if (alive) setListsState("failed"); });
    }, query ? 200 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [open, query]);

  const homeId = task?.home.readable ? task.home.id : null;
  const linkedIds = useMemo(() => new Set((task?.linked ?? []).map((l) => l.boardId)), [task]);

  const sections: PickerSectionDef[] = useMemo(() => {
    if (!lists) return [];
    return groupReadableLists(lists).map((g) => ({
      label: g.label,
      options: g.lists.map((l) => {
        const isHome = l.id === homeId;
        const already = linkedIds.has(l.id);
        return {
          value: l.id,
          label: l.name,
          glyph: <ListChecks className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />,
          hint: isHome ? "Home" : already ? "Already here" : undefined,
          disabled: isHome || already,
        };
      }),
    }));
  }, [lists, homeId, linkedIds]);

  const notice = task?.viaParentId
    ? "This subtask appears wherever its parent does"
    : task && !task.canShare
      ? "You need edit access to this task's List to add it to another List"
      : null;

  const add = useCallback(async (targetId: string) => {
    if (busy.current) return;
    const target = lists?.boards.find((b) => b.id === targetId);
    if (!target) return;
    busy.current = true;
    try {
      const out = await addTaskToList(itemId, targetId);
      if (!out.ok) {
        toast(out.message, { tone: "danger" });
        return;
      }
      toast(out.created ? `Added to ${target.name}` : `It was already in ${target.name}`);
      // `listIds` is EVERY List it is in now, as far as this viewer knows (its
      // home and each List the answer above named, plus the new one): a List
      // page drops a linked row whose event leaves its List out, so naming
      // only the new List would pull the task out of the List it was added
      // from. With no answer to go on, the event names no Lists at all, and
      // every List page simply re-reads the task.
      const known = task
        ? Array.from(new Set([
            ...(homeId ? [homeId] : homeBoardId ? [homeBoardId] : []),
            ...task.linked.map((l) => l.boardId),
            targetId,
          ]))
        : null;
      emitItemChanged(itemId, homeBoardId, false, known ? { listIds: known } : undefined);
      onAdded?.({ id: target.id, name: target.name });
    } finally {
      busy.current = false;
    }
  }, [itemId, homeBoardId, homeId, lists, onAdded, task, toast]);

  return (
    <Picker
      open={open}
      onClose={onClose}
      sections={notice ? [] : sections}
      alwaysSearch={!notice}
      onSearchChange={setQuery}
      align={align}
      anchorPoint={anchorPoint}
      ariaLabel="Add to another List"
      searchPlaceholder="Search Lists…"
      loading={!notice && listsState === "loading" && !lists}
      emptyLabel={
        notice ??
        (listsState === "failed"
          ? "Couldn't load your Lists. Check your connection and try again."
          : listsState === "loading"
            ? "Finding Lists…"
            : query.trim()
              ? "No List you can add to matches that"
              : "No other List you can add tasks to")
      }
      onSelect={(id) => void add(id)}
      footer={
        lists?.truncated && !notice ? (
          <p className="px-2 py-1.5 text-xs text-ink-2">More Lists match. Type to narrow the search.</p>
        ) : undefined
      }
    />
  );
}
