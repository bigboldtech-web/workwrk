"use client";

// Search (Cmd+K) in the Staff console (spec-admin-backoffice section 2.8).
// The product palette's anatomy (command-palette.tsx) on the console's own
// data: a Radix Dialog 640 wide at 12vh (the palette's width; the design
// system never added --os-modal-search, and the shipped palette hardcodes
// 640), one 44px input, 11/600 section labels, 36px rows, a 36px footer of
// real hints. It cannot reuse OsCommandPalette itself: that component reads
// the product shell and boot contexts, which the admin host never serves.
//
// Empty query: RECENT (the last five companies this staff member opened,
// server-stored) and GO TO (the sidebar destinations). Two characters or
// more, 180ms debounce: COMPANIES, STAFF and CODES, eight rows each with a
// "See all" row when there are more. No customer content, ever.
//
// It is a LayerStack layer: Esc closes it before anything under it. It
// closes itself before it opens anything, so nothing ever stacks on it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowRight, KeyRound, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { leaveThen } from "@/lib/dirty-guard";
import { shippedConsoleNav } from "@/lib/admin/console-nav";
import { SEARCH_MIN_CHARS, companySecondary } from "@/lib/admin/search";
import type { RecentCompany } from "@/lib/admin/console-me";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { useLayer } from "@/components/layout/os/shell-context";
import { cn } from "@/lib/utils";
import { CONSOLE_NAV_ICONS } from "./console-icons";

export const STAFF_SEARCH_PLACEHOLDER = "Search companies, staff or a code…";
const DEBOUNCE_MS = 180;

interface SearchPayload {
  q: string | null;
  companies: { id: string; name: string; slug: string; plan: string; status: string }[];
  staff: { email: string; name: string | null }[];
  codes: { code: string; status: string; companyId: string | null; companyName: string | null; label: string }[];
  counts: { companies: number; staff: number; codes: number };
}

interface Row {
  id: string;
  glyph: React.ReactNode;
  label: string;
  secondary?: string;
  mono?: boolean;
  quiet?: boolean;
  href: string;
}

interface Section {
  key: string;
  label: string;
  rows: Row[];
}

/** One answer, kept with the query and attempt it answered. */
type Answer =
  | { q: string; attempt: number; status: "ok"; data: SearchPayload }
  | { q: string; attempt: number; status: "failed"; offline: boolean };

function PersonGlyph({ name }: { name: string }) {
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .map((s) => s[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-active text-[10px] font-medium text-ink-strong" aria-hidden>
      {initials}
    </span>
  );
}

function companyTile(name: string) {
  return <EntityTile size="xs" name={name} {...NEUTRAL_TILE} />;
}

export function StaffSearch({
  open,
  onOpenChange,
  recents,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recents: RecentCompany[];
  /** Where focus lands on close: the top bar's search field. */
  returnFocusTo?: () => HTMLElement | null;
}) {
  useLayer(open, { id: "staff-search", kind: "palette", close: () => onOpenChange(false) });
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[var(--os-scrim)]" />
        {open ? <SearchBody onClose={() => onOpenChange(false)} recents={recents} returnFocusTo={returnFocusTo} /> : null}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SearchBody({
  onClose,
  recents,
  returnFocusTo,
}: {
  onClose: () => void;
  recents: RecentCompany[];
  returnFocusTo?: () => HTMLElement | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  // A ref, not a dependency: the parent passes a fresh closure each render,
  // and the search effect must not re-run (and re-fetch) because of it.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const q = query.replace(/\s+/g, " ").trim();
  const searching = q.length >= SEARCH_MIN_CHARS;
  // Derived, never stored: an answer counts only for the query (and the
  // "Try again" attempt) it answered; anything else is still loading.
  const current = searching && answer && answer.q === q && answer.attempt === attempt ? answer : null;
  const fetchState = useMemo<{ status: "idle" } | { status: "loading" } | Answer>(
    () => (!searching ? { status: "idle" } : current ?? { status: "loading" }),
    [searching, current],
  );

  useEffect(() => {
    const mine = ++seq.current;
    if (!searching) return;
    const t = window.setTimeout(async () => {
      const r = await apiFetch<SearchPayload>(`/api/admin/search?q=${encodeURIComponent(q)}&limit=8`);
      if (mine !== seq.current) return;
      if (r.ok) {
        setAnswer({ q, attempt, status: "ok", data: r.data });
        setActive(0);
        return;
      }
      // A 401 is the session-expired dialog's: close so it owns the screen.
      if (r.status === 401) {
        onCloseRef.current();
        return;
      }
      setAnswer({ q, attempt, status: "failed", offline: Boolean(r.offline) });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // attempt: "Try again" re-runs the same query.
  }, [q, searching, attempt]);

  const goTo = useMemo<Section>(
    () => ({
      key: "goto",
      label: "Go to",
      rows: shippedConsoleNav().map((r) => {
        const Icon = CONSOLE_NAV_ICONS[r.key];
        return {
          id: `goto:${r.key}`,
          glyph: <Icon className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />,
          label: r.label,
          href: r.href,
        };
      }),
    }),
    [],
  );

  const sections = useMemo<Section[]>(() => {
    if (!searching) {
      const out: Section[] = [];
      if (recents.length > 0) {
        out.push({
          key: "recent",
          label: "Recent",
          rows: recents.map((c) => ({
            id: `recent:${c.id}`,
            glyph: companyTile(c.name),
            label: c.name,
            secondary: companySecondary(c.plan, c.status),
            href: `/admin/companies/${c.id}`,
          })),
        });
      }
      out.push(goTo);
      return out;
    }
    if (fetchState.status !== "ok") return [];
    const d = fetchState.data;
    const enc = encodeURIComponent(fetchState.q);
    const out: Section[] = [];
    if (d.companies.length > 0) {
      const rows: Row[] = d.companies.map((c) => ({
        id: `company:${c.id}`,
        glyph: companyTile(c.name),
        label: c.name,
        secondary: companySecondary(c.plan, c.status),
        href: `/admin/companies/${c.id}`,
      }));
      if (d.counts.companies > d.companies.length) {
        rows.push({
          id: "company:all",
          glyph: <ArrowRight className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />,
          label: `See all ${d.counts.companies} in Companies`,
          quiet: true,
          href: `/admin/companies?search=${enc}`,
        });
      }
      out.push({ key: "companies", label: "Companies", rows });
    }
    if (d.staff.length > 0) {
      const rows: Row[] = d.staff.map((s) => ({
        id: `staff:${s.email}`,
        glyph: <PersonGlyph name={s.name || s.email} />,
        label: s.name || s.email,
        secondary: s.email,
        href: `/admin/staff?focus=${encodeURIComponent(s.email)}`,
      }));
      if (d.counts.staff > d.staff.length) {
        rows.push({
          id: "staff:all",
          glyph: <ArrowRight className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />,
          label: `See all ${d.counts.staff} in Staff`,
          quiet: true,
          href: "/admin/staff",
        });
      }
      out.push({ key: "staff", label: "Staff", rows });
    }
    if (d.codes.length > 0) {
      const rows: Row[] = d.codes.map((c) => ({
        id: `code:${c.code}`,
        glyph: <KeyRound className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />,
        label: c.code,
        mono: true,
        secondary: c.label,
        href: `/admin/appsumo?code=${encodeURIComponent(c.code)}`,
      }));
      if (d.counts.codes > d.codes.length) {
        rows.push({
          id: "code:all",
          glyph: <ArrowRight className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />,
          label: `See all ${d.counts.codes} in AppSumo codes`,
          quiet: true,
          href: `/admin/appsumo?code=${enc}`,
        });
      }
      out.push({ key: "codes", label: "Codes", rows });
    }
    // A dead end always offers a next step.
    if (out.length === 0) out.push(goTo);
    return out;
  }, [searching, recents, goTo, fetchState]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1));

  const activate = useCallback(
    (row: Row) => {
      // Close first, then open: nothing ever stacks on the overlay.
      onClose();
      void leaveThen(() => router.push(row.href));
    },
    [onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const row = flat[activeIdx];
      if (row) {
        e.preventDefault();
        activate(row);
      }
    }
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const loading = searching && fetchState.status === "loading";
  const failed = fetchState.status === "failed" ? fetchState : null;
  const noMatches =
    searching &&
    fetchState.status === "ok" &&
    fetchState.data.companies.length + fetchState.data.staff.length + fetchState.data.codes.length === 0;
  let runningIdx = -1;

  return (
    <DialogPrimitive.Content
      aria-label="Search"
      aria-describedby={undefined}
      onKeyDown={onKeyDown}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
      }}
      onCloseAutoFocus={(e) => {
        const el = returnFocusTo?.();
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }}
      className="workwrk-os os-chrome fixed inset-x-0 mx-auto top-[12vh] z-[61] flex max-h-[76vh] w-[640px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-line bg-raised text-ink shadow-[var(--os-shadow-modal)] outline-none"
    >
      <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder={STAFF_SEARCH_PLACEHOLDER}
          aria-label="Search"
          aria-controls="staff-search-results"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        ) : null}
        <kbd className="rounded border border-line bg-kbd px-1.5 font-sans text-[11px] font-medium text-ink-2">esc</kbd>
      </div>

      <div ref={listRef} id="staff-search-results" className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Results">
        {failed ? (
          failed.offline ? (
            <div className="flex h-9 items-center px-4 text-sm text-ink-2">You&apos;re offline. Search needs a connection.</div>
          ) : (
            <div className="flex h-9 items-center gap-1 px-4 text-sm text-ink-2">
              <span>Search isn&apos;t available right now</span>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-medium text-brand-deep hover:underline">
                Try again
              </button>
            </div>
          )
        ) : null}
        {noMatches ? (
          <div className="flex h-9 items-center px-4 text-sm text-ink-2">No matches for &lsquo;{q}&rsquo;</div>
        ) : null}
        {query.trim().length > 0 && !searching ? (
          <div className="flex h-9 items-center px-4 text-sm text-ink-2">Keep typing to search</div>
        ) : null}
        {loading ? (
          <div aria-hidden className="py-1">
            {["60%", "40%", "80%"].map((w, i) => (
              <div key={i} className="flex h-9 items-center gap-3 px-4">
                <span className="h-4 w-4 shrink-0 rounded bg-skeleton os-skeleton-pulse" />
                <span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />
              </div>
            ))}
          </div>
        ) : null}
        {sections.map((s) => (
          <div key={s.key} role="group" aria-label={s.label}>
            <div className="px-4 pb-1 pt-2 text-micro uppercase tracking-[0.06em] text-ink-2">{s.label}</div>
            {s.rows.map((row) => {
              runningIdx += 1;
              const idx = runningIdx;
              const on = idx === activeIdx;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-idx={idx}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => activate(row)}
                  className={cn(
                    "flex h-9 w-full items-center gap-3 px-4 text-start text-base",
                    row.quiet ? "text-ink-2" : "text-ink",
                    on ? "bg-active" : "hover:bg-hover",
                  )}
                >
                  <span className="inline-flex w-5 shrink-0 items-center justify-center">{row.glyph}</span>
                  <span className={cn("min-w-0 flex-1 truncate", row.mono && "font-mono")}>{row.label}</span>
                  {row.secondary ? (
                    <span className="min-w-0 max-w-[45%] shrink-0 truncate text-sm text-ink-2">{row.secondary}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap border-t border-line px-4 text-xs font-medium text-ink-3">
        <span>↑↓ move</span>
        <span aria-hidden>·</span>
        <span>↵ open</span>
        <span aria-hidden>·</span>
        <span>esc close</span>
      </div>
    </DialogPrimitive.Content>
  );
}
