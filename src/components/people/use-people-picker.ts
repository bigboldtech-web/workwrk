"use client";

// One people source for every picker that needs the whole company: the first
// page, a debounced search that grows it, and the people the picker already
// shows looked up by id so each reads by name. Wire `setQuery` to a Picker's
// onSearchChange: the Picker then shows `people` as given (the search has
// already filtered them), and the moment a person is known they show for the
// words typed, before the server has answered.
//
// Reads GET /api/people/pick (src/lib/people-pick.ts has the why), never
// /api/users, whose team scope gave an Employee a picker that could only pick
// them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { chunkIds, matchPeople, mergePeople, pickPersonName, pickUrl, type PickPerson, type PickQuery } from "@/lib/people-pick";

export type PickNameState = "known" | "loading" | "failed" | "gone";

export interface PeoplePicker {
  /** The people to offer for the current search, in name order. */
  people: PickPerson[];
  query: string;
  /** Feed this the Picker's onSearchChange. */
  setQuery: (q: string) => void;
  /** The first page or a search is on its way. */
  loading: boolean;
  /** The last read failed: the picker says so (never "no one") and offers retry. */
  failed: boolean;
  retry: () => void;
  /** Anyone read so far, the people looked up by id included. */
  person: (id: string) => PickPerson | undefined;
  /** Whether an id the caller shows is known yet, still loading, failed to load, or no longer here. */
  nameState: (id: string) => PickNameState;
  /** The name to show for an id: the person's, "Loading", "Couldn't load this name", or `gone` (default "Someone no longer here"). */
  nameOf: (id: string, gone?: string) => string;
}

/** The read behind a picker's list (first page and search). */
function listUrl(source: "pick" | "team", o: PickQuery & { q?: string; limit: number }): string {
  if (source === "pick") return pickUrl(o);
  // "team": who the caller may give this work to, as /api/users answers it
  // (the caller and their report tree, everyone for an org-wide level), for
  // an action whose own rule is the report tree (a process run is read by its
  // assignee, their manager chain and org-wide roles).
  const sp = new URLSearchParams({ scope: "all", limit: String(o.limit) });
  if (o.q?.trim()) sp.set("search", o.q.trim());
  return `/api/users?${sp}`;
}

export function usePeoplePicker(opts: PickQuery & {
  /** Read only while true (the picker is open, the filter panel is showing). */
  enabled: boolean;
  /** Ids the caller already shows (a value, a filter, chips), looked up by id. */
  named?: readonly string[];
  /** "pick" (default): the whole workspace. "team": the caller's report tree, for actions bound to it. */
  source?: "pick" | "team";
}): PeoplePicker {
  const { reach, includeSelf, managersOnly, enabled } = opts;
  const source = opts.source ?? "pick";
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<Map<string, PickPerson>>(() => new Map());
  const [named, setNamed] = useState<Map<string, PickPerson>>(() => new Map());
  const [query, setQuery] = useState("");
  const [loadingFirst, setLoadingFirst] = useState(false);
  const [searching, setSearching] = useState(false);

  // Opening again starts from an empty search, as the Picker's own box does
  // (adjusted during render: an effect would show one frame of the old one).
  const [openedFor, setOpenedFor] = useState(enabled);
  if (openedFor !== enabled) {
    setOpenedFor(enabled);
    if (enabled) setQuery("");
  }

  // The first page, the first time the picker is used. A failed read is
  // asked again the next time it opens.
  const firstAsked = useRef(false);
  useEffect(() => {
    if (!enabled || firstAsked.current) return;
    const t = setTimeout(() => {
      firstAsked.current = true;
      setLoadingFirst(true);
      void apiFetch<{ people?: PickPerson[]; data?: PickPerson[] }>(listUrl(source, { reach, includeSelf, managersOnly, limit: 50 }), { cache: "no-store" }).then((r) => {
        setLoadingFirst(false);
        const got = r.ok ? rowsOf(r.data) : null;
        if (got) { setRead((m) => mergePeople(m, got)); setFailed(false); }
        else { firstAsked.current = false; setFailed(true); }
      });
    }, 0);
    return () => clearTimeout(t);
  }, [enabled, reach, includeSelf, managersOnly, source, attempt]);

  // Typing searches the whole company, and what it finds joins the rest.
  useEffect(() => {
    const q = query.trim();
    if (!enabled || !q) return;
    const t = setTimeout(() => {
      setSearching(true);
      void apiFetch<{ people?: PickPerson[]; data?: PickPerson[] }>(listUrl(source, { reach, includeSelf, managersOnly, q, limit: 30 }), { cache: "no-store" }).then((r) => {
        setSearching(false);
        const got = r.ok ? rowsOf(r.data) : null;
        if (got) { setRead((m) => mergePeople(m, got)); setFailed(false); }
        else setFailed(true);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [query, enabled, reach, includeSelf, managersOnly, source, attempt]);

  // The people the caller shows, by id, in chunks of 50. An id is done once a
  // lookup answered (found or not); a failed lookup is tried again, up to
  // three times, a little later each time. Labels only: a person found here
  // is never offered by a picker whose reach would not list them.
  const namedKey = [...new Set(opts.named ?? [])].filter(Boolean).sort().join(",");
  const inFlight = useRef(new Set<string>());
  const tries = useRef(new Map<string, number>());
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    // An id already read (from the list or a search) needs no lookup.
    const missing = namedKey.split(",").filter((x) => x && !read.has(x) && !answered.has(x) && !inFlight.current.has(x) && (tries.current.get(x) ?? 0) < 3);
    if (missing.length === 0) return;
    const t = setTimeout(() => {
      for (const x of missing) inFlight.current.add(x);
      setLoadingIds((s) => new Set([...s, ...missing]));
      for (const chunk of chunkIds(missing)) {
        void apiFetch<{ people: PickPerson[] }>(pickUrl({ ids: chunk, reach: reach === "all" ? "all" : undefined }), { cache: "no-store" }).then((r) => {
          for (const x of chunk) inFlight.current.delete(x);
          const ok = r.ok && Array.isArray(r.data.people);
          if (ok) {
            setNamed((m) => mergePeople(m, r.data.people));
            setAnswered((s) => new Set([...s, ...chunk]));
          } else {
            let wait = 0;
            for (const x of chunk) {
              const n = (tries.current.get(x) ?? 0) + 1;
              tries.current.set(x, n);
              wait = Math.max(wait, n * 2000);
            }
            setTimeout(() => setRetry((v) => v + 1), wait);
          }
          setLoadingIds((s) => new Set([...s].filter((x) => !chunk.includes(x))));
          setFailedIds((s) => (ok ? new Set([...s].filter((x) => !chunk.includes(x))) : new Set([...s, ...chunk])));
        });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [namedKey, retry, answered, read, reach]);

  const people = useMemo(() => matchPeople(read.values(), query), [read, query]);
  const person = useCallback((id: string) => read.get(id) ?? named.get(id), [read, named]);
  const nameState = useCallback((id: string): PickNameState => {
    if (read.has(id) || named.has(id)) return "known";
    if (failedIds.has(id) && !loadingIds.has(id)) return "failed";
    if (answered.has(id)) return "gone";
    return "loading";
  }, [read, named, failedIds, loadingIds, answered]);
  const nameOf = useCallback((id: string, gone = "Someone no longer here") => {
    const p = read.get(id) ?? named.get(id);
    if (p) return pickPersonName(p);
    const state = nameState(id);
    return state === "loading" ? "Loading" : state === "failed" ? "Couldn't load this name" : gone;
  }, [read, named, nameState]);

  const retryAll = useCallback(() => {
    setFailed(false);
    tries.current.clear();
    setAttempt((v) => v + 1);
    setRetry((v) => v + 1);
  }, []);

  return { people, query, setQuery, loading: loadingFirst || searching, failed, retry: retryAll, person, nameState, nameOf };
}

/** The rows of either read: the workspace picker answers { people }, /api/users { data }. */
function rowsOf(d: { people?: PickPerson[]; data?: PickPerson[] } | null | undefined): PickPerson[] | null {
  if (Array.isArray(d?.people)) return d.people;
  if (Array.isArray(d?.data)) return d.data;
  return null;
}
