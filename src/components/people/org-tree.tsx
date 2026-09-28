"use client";

// OrgTree (spec-teams-people section 3, /organization): the reporting tree,
// every root (the old eight-root cap and "+N more" are gone), rows 44 at any
// depth, 20px indent a level, depth 2 and deeper starting collapsed. In edit
// mode every row carries a Reports to picker and a Dotted lines picker that
// save on pick; a refused change (a loop, an Agent as manager) shows its
// reason under the row until fixed.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { recordWriteQueue } from "@/lib/people/record-write-queue";
import { useOsToast } from "@/components/layout/os/toast";
import type { OrgNode, OrgPerson } from "@/lib/people/reporting-lines";
import { PeoplePickerField, PersonAvatar, type PickPerson } from "./person-bits";

export interface ChartPerson extends OrgPerson {
  firstName: string;
  lastName: string;
  avatar: string | null;
  isAgent: boolean;
  jobTitle: string | null;
  department: string | null;
  departmentId: string | null;
  officeId: string | null;
  roleId: string | null;
  dottedManagerIds: string[];
  presenceStatus: string | null;
  presenceUntil: string | null;
}

export interface OrgTreeDisplay { showTitle: boolean; showDepartment: boolean }

type RowError = Record<string, string>;

function Row({
  node, depth, open, toggle, editable, display, byId, error, onSaved, onError, focused, flash,
}: {
  node: OrgNode<ChartPerson>;
  depth: number;
  open: boolean;
  toggle: () => void;
  editable: boolean;
  display: OrgTreeDisplay;
  byId: Map<string, ChartPerson>;
  error?: string;
  onSaved: () => void;
  onError: (id: string, msg: string | null) => void;
  focused: boolean;
  flash: boolean;
}) {
  const p = node.person;
  const manager = p.managerId ? byId.get(p.managerId) : null;
  const toPick = (x: ChartPerson): PickPerson => ({ id: x.id, firstName: x.firstName, lastName: x.lastName, avatar: x.avatar, email: null });
  const meta = [display.showTitle ? p.jobTitle : null, display.showDepartment ? p.department : null].filter(Boolean).join(" · ");
  const { toast } = useOsToast();
  // Through the record write queue: a dropped connection keeps the change
  // and retries it (at once on reconnect), and the row says so meanwhile.
  // A reporting line decides who reads this person's reviews, KPI sign-offs
  // and weekly reviews, so every saved change says what moved and offers
  // one Undo back to the previous manager (principle 10).
  async function setManager(id: string | null, undoing = false) {
    const previous = p.managerId ?? null;
    if (!undoing && id === previous) return;
    onError(p.id, null);
    const r = await recordWriteQueue().write("PATCH", `/api/users/${p.id}`, { managerId: id }, {
      onRetrying: () => onError(p.id, "Not saved, retrying"),
    });
    if (!r.ok) { onError(p.id, r.error || "Not saved"); return; }
    onError(p.id, null);
    onSaved();
    if (undoing) {
      toast(`Undone. ${p.name} reports to ${id ? byId.get(id)?.name ?? "their manager" : "nobody"} again`, { key: `org-line:${p.id}` });
      return;
    }
    const prevName = previous ? byId.get(previous)?.name ?? "their manager" : null;
    const message = id
      ? `${p.name} now reports to ${byId.get(id)?.name ?? "the new manager"}`
      : `${p.name} no longer reports to anyone`;
    toast(message, {
      key: `org-line:${p.id}`,
      tone: id ? "info" : "danger",
      description: prevName ? `Their open reviews and approvals move away from ${prevName}.` : undefined,
      action: { label: "Undo", onClick: () => void setManager(previous, true) },
    });
  }
  async function setDotted(ids: string[]) {
    onError(p.id, null);
    const r = await recordWriteQueue().write("PUT", `/api/users/${p.id}/dotted-lines`, { managerIds: ids }, {
      onRetrying: () => onError(p.id, "Not saved, retrying"),
    });
    if (!r.ok) { onError(p.id, r.error || "Not saved"); return; }
    onError(p.id, null);
    onSaved();
  }
  return (
    <div
      data-org-row={p.id}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={node.children.length ? open : undefined}
      aria-selected={focused}
      tabIndex={focused ? 0 : -1}
      className={`border-b border-line-soft last:border-b-0 outline-none focus-visible:bg-hover ${flash ? "ring-2 ring-inset ring-brand transition-shadow" : ""}`}
    >
      <div className="flex min-h-11 items-center gap-2 pe-3" style={{ paddingInlineStart: 12 + depth * 20 }}>
        {node.children.length ? (
          <button type="button" tabIndex={-1} aria-label={open ? "Collapse" : "Expand"} onClick={toggle} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-hover">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden><span className="h-1.5 w-1.5 rounded-full bg-[var(--os-line-strong)]" /></span>
        )}
        <PersonAvatar person={p} size={28} />
        <span className="min-w-0 flex-1">
          <Link href={`/people/${p.id}`} tabIndex={-1} className="block truncate text-row font-medium text-ink hover:underline">{p.name}</Link>
          {meta ? <span className="block truncate text-sm text-ink-2">{meta}</span> : null}
        </span>
        {editable ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-ink-2 md:inline">Reports to</span>
            <PeoplePickerField
              className="w-44"
              ariaLabel={`${p.name} reports to`}
              managersOnly
              exclude={[p.id]}
              value={manager ? [manager.id] : []}
              people={manager ? [toPick(manager)] : []}
              placeholder="Nobody"
              onChange={(ids) => void setManager(ids[0] ?? null)}
            />
            <PeoplePickerField
              className="w-36"
              ariaLabel={`${p.name} dotted lines`}
              multiple
              managersOnly
              exclude={[p.id, ...(p.managerId ? [p.managerId] : [])]}
              value={p.dottedManagerIds}
              people={p.dottedManagerIds.map((id) => byId.get(id)).filter((x): x is ChartPerson => !!x).map(toPick)}
              placeholder="Dotted lines"
              onChange={(ids) => void setDotted(ids)}
            />
          </span>
        ) : node.children.length ? (
          <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2" title={`${node.children.length} direct, ${node.total} in total`}>{node.children.length}</span>
        ) : null}
      </div>
      {error ? <p role="alert" className="pb-2 text-sm text-danger-text" style={{ paddingInlineStart: 12 + depth * 20 + 40 }}>{error}</p> : null}
    </div>
  );
}

export function OrgTree({
  roots, unlinked, byId, editable, display, focusId, expandAll, onSaved, canFixUnlinked,
}: {
  roots: OrgNode<ChartPerson>[];
  unlinked: ChartPerson[];
  byId: Map<string, ChartPerson>;
  editable: boolean;
  display: OrgTreeDisplay;
  focusId?: string | null;
  /** A counter: each change expands (positive) or collapses (negative) everything. */
  expandAll: number;
  onSaved: () => void;
  canFixUnlinked: boolean;
}) {
  // Seeded collapse, XOR toggled: depth 2 and deeper start collapsed.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"seed" | "all" | "none">("seed");
  const [errors, setErrors] = useState<RowError>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expandAll === 0) return;
    const t = setTimeout(() => { setMode(expandAll > 0 ? "all" : "none"); setToggled(new Set()); }, 0);
    return () => clearTimeout(t);
  }, [expandAll]);

  // ?focus=: open the path to the person, scroll to them, pulse once.
  useEffect(() => {
    if (!focusId) return;
    const path: string[] = [];
    const walk = (n: OrgNode<ChartPerson>, trail: string[]): boolean => {
      if (n.person.id === focusId) { path.push(...trail); return true; }
      return n.children.some((c) => walk(c, [...trail, n.person.id]));
    };
    roots.some((r) => walk(r, []));
    const t = setTimeout(() => {
      setMode("seed");
      setToggled((cur) => {
        const next = new Set(cur);
        // Ancestors at depth 2 and deeper start collapsed, so they flip open;
        // the first two levels are open by default, so their flip is cleared.
        path.forEach((id, i) => { if (i >= 2) next.add(id); else next.delete(id); });
        return next;
      });
      setFlashId(focusId);
      setTimeout(() => document.querySelector(`[data-org-row="${focusId}"]`)?.scrollIntoView({ block: "center" }), 50);
      setTimeout(() => setFlashId(null), 900);
    }, 0);
    return () => clearTimeout(t);
  }, [focusId, roots]);

  const isOpen = (n: OrgNode<ChartPerson>, depth: number) => {
    const base = mode === "all" ? true : mode === "none" ? false : depth < 2;
    return toggled.has(n.person.id) ? !base : base;
  };
  const flip = (id: string) => setToggled((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const visible = useMemo(() => {
    const out: Array<{ node: OrgNode<ChartPerson>; depth: number; open: boolean }> = [];
    const walk = (n: OrgNode<ChartPerson>, depth: number) => {
      const open = isOpen(n, depth);
      out.push({ node: n, depth, open });
      if (open) n.children.forEach((c) => walk(c, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return out;
    // isOpen reads mode and toggled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, mode, toggled]);

  const setError = (id: string, msg: string | null) => setErrors((e) => { const n = { ...e }; if (msg) n[id] = msg; else delete n[id]; return n; });

  const onKey = (e: React.KeyboardEvent) => {
    const row = visible[cursor];
    if (!row) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(visible.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "ArrowRight" && row.node.children.length && !row.open) { e.preventDefault(); flip(row.node.person.id); }
    else if (e.key === "ArrowLeft" && row.open && row.node.children.length) { e.preventDefault(); flip(row.node.person.id); }
    else if (e.key === "Enter") { e.preventDefault(); (box.current?.querySelector(`[data-org-row="${row.node.person.id}"] a`) as HTMLAnchorElement | null)?.click(); }
  };
  useEffect(() => {
    const id = visible[cursor]?.node.person.id;
    if (id && box.current?.contains(document.activeElement)) (box.current.querySelector(`[data-org-row="${id}"]`) as HTMLElement | null)?.focus();
  }, [cursor, visible]);

  return (
    <div className="os-chrome overflow-hidden rounded-lg border border-line bg-raised">
      <div ref={box} role="tree" aria-label="Reporting lines" onKeyDown={onKey}>
        {visible.map((v, i) => (
          <Row
            key={v.node.person.id}
            node={v.node}
            depth={v.depth}
            open={v.open}
            toggle={() => flip(v.node.person.id)}
            editable={editable}
            display={display}
            byId={byId}
            error={errors[v.node.person.id]}
            onSaved={onSaved}
            onError={setError}
            focused={i === cursor}
            flash={flashId === v.node.person.id}
          />
        ))}
      </div>
      {unlinked.length > 0 ? (
        <div className="border-t border-line">
          <div className="flex h-11 items-center gap-2 bg-subtle px-3">
            <span className="text-row font-medium text-ink">Not linked to a manager</span>
            <span className="text-xs font-medium text-ink-2">{unlinked.length}</span>
          </div>
          {!canFixUnlinked ? <p className="px-3 py-2 text-sm text-ink-2">These people sit in a reporting loop. Ask the People team or an Admin to fix this.</p> : null}
          {unlinked.map((p) => (
            <Row
              key={p.id}
              node={{ person: p, children: [], total: 0, depth: 0 }}
              depth={0}
              open={false}
              toggle={() => undefined}
              editable={editable}
              display={display}
              byId={byId}
              error={errors[p.id]}
              onSaved={onSaved}
              onError={setError}
              focused={false}
              flash={false}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
