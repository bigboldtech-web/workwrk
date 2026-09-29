"use client";

// GoalAudiencePicker: ONE multi-select for a goal's audience, mixing
// people, departments and roles in grouped sections. Same popover pattern
// as board-view/assignee-picker (search on top, MenuItem rows), but
// absolute-positioned so it survives the goal modal's transformed
// DialogContent; selection is a list of
// { type: "USER"|"DEPARTMENT"|"ROLE", id } refs: the API resolves them
// to people at read time, so a department/role entry follows the org
// chart instead of freezing a member list.
//
// Also exports MemberAvatarStack: the resolved-members avatar stack with
// a "+N" overflow chip used on the goals list and goal detail.

import { useEffect, useRef, useState } from "react";
import { Briefcase, Building2, ChevronDown, Search, Tag, UsersRound, X } from "lucide-react";
import { MenuItem, MenuSectionLabel, MenuSeparator } from "@/components/ui/menu";
import { PersonAvatar } from "@/components/board-view/assignee-picker";

export type AudienceType = "USER" | "DEPARTMENT" | "ROLE" | "TAG";

export interface AudienceEntry {
  type: AudienceType;
  id: string;
  label: string;
  avatar?: string | null;
}

export interface AudienceMember {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
}

/* ───────────────────────── avatar stack ───────────────────────── */

export function MemberAvatarStack({
  members,
  total,
  size = 22,
}: {
  members: AudienceMember[];
  /** Full member count: anything beyond the preview renders as "+N". */
  total: number;
  size?: number;
}) {
  if (total === 0 || members.length === 0) return null;
  const overflow = total - members.length;
  return (
    <span className="inline-flex items-center" aria-label={`${total} member${total === 1 ? "" : "s"}`}>
      {members.map((m, i) => (
        <span
          key={m.id}
          className="inline-flex rounded-full ring-2 ring-[var(--os-surface)]"
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.3) }}
        >
          <PersonAvatar person={{ ...m, email: null }} size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-subtle font-semibold text-ink-2 ring-2 ring-[var(--os-surface)]"
          style={{
            width: size,
            height: size,
            marginLeft: -Math.round(size * 0.3),
            fontSize: Math.max(9, Math.round(size * 0.38)),
          }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

/* ─────────────────────────── the picker ───────────────────────── */

/** Two skeleton rows while a section's list loads (no "Loading" text). */
function PickerSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 py-2" aria-busy="true" aria-label="Fetching">
      <span className="os-skeleton-pulse h-3 w-3/5 rounded bg-skeleton" />
      <span className="os-skeleton-pulse h-3 w-2/5 rounded bg-skeleton" />
    </div>
  );
}

interface UserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  email?: string | null;
}
interface DeptRow { id: string; name: string }
interface RoleRow { id: string; title: string }
interface TagRow { id: string; name: string; color?: string | null }

function userLabel(u: UserRow): string {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "Unknown";
}

interface GoalAudiencePickerProps {
  value: AudienceEntry[];
  onChange: (next: AudienceEntry[]) => void;
  canEdit?: boolean;
  /** Optional custom trigger content (defaults to a summary button). */
  placeholder?: string;
}

export function GoalAudiencePicker({
  value,
  onChange,
  canEdit = true,
  placeholder = "Assign people, departments or job titles",
}: GoalAudiencePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [depts, setDepts] = useState<DeptRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Departments + roles are small lookup lists: fetch once per open,
  // filter client-side. People are server-searched (debounced), same as
  // the existing assignee picker.
  useEffect(() => {
    if (!open || depts !== null) return;
    fetch("/api/departments", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setDepts(Array.isArray(d) ? d : (d?.data ?? [])))
      .catch(() => setDepts([]));
    fetch("/api/roles", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRoles(Array.isArray(d) ? d : (d?.data ?? [])))
      .catch(() => setRoles([]));
    fetch("/api/tags", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTags(Array.isArray(d) ? d : (d?.data ?? [])))
      .catch(() => setTags([]));
  }, [open, depts]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ scope: "all", limit: "20" });
      if (query.trim()) params.set("search", query.trim());
      fetch(`/api/users?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => { if (active) setUsers(Array.isArray(d?.data) ? d.data : []); })
        .catch(() => { if (active) setUsers([]); });
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [open, query]);

  const selectedKeys = new Set(value.map((e) => `${e.type}:${e.id}`));
  const isSelected = (type: AudienceType, id: string) => selectedKeys.has(`${type}:${id}`);
  const toggle = (entry: AudienceEntry) => {
    if (isSelected(entry.type, entry.id)) {
      onChange(value.filter((e) => !(e.type === entry.type && e.id === entry.id)));
    } else {
      onChange([...value, entry]);
    }
  };

  const q = query.trim().toLowerCase();
  const filteredDepts = (depts ?? []).filter((d) => !q || d.name.toLowerCase().includes(q));
  const filteredRoles = (roles ?? []).filter((r) => !q || r.title.toLowerCase().includes(q));
  const filteredTags = (tags ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));

  const summary =
    value.length === 0
      ? placeholder
      : value.map((e) => e.label).slice(0, 3).join(", ") + (value.length > 3 ? ` +${value.length - 3}` : "");

  if (!canEdit) {
    return <span className="truncate text-base text-ink-2">{summary}</span>;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-start text-base text-ink hover:bg-hover focus:outline-none focus-visible:border-brand"
        aria-label="Edit goal audience"
      >
        <UsersRound className="h-3.5 w-3.5 shrink-0 text-ink-2" />
        <span className={`flex-1 truncate ${value.length === 0 ? "text-ink-2" : ""}`}>{summary}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ink-2" />
      </button>

      {open ? (
        // Absolute (not fixed): the goal modal centres its DialogContent with a
        // CSS transform, and a position:fixed child anchors to that transformed
        // box, not the viewport: which flung this popover off-screen (the
        // "owner/contributors don't work" bug). Absolute anchors to this
        // relative wrapper, so it stays put inside the dialog AND on the inline
        // goal-detail usage. Staying a DOM child also keeps the dialog's focus
        // trap + click-outside working (a body portal would break the search).
        <div
          className="absolute start-0 top-full z-[200] mt-1 w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-raised"
          style={{ boxShadow: "var(--os-shadow-pop)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-9 items-center gap-2 border-b border-line-soft px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-2" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, departments, job titles"
              className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-ink-2 hover:text-ink" aria-label="Clear search">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="max-h-[300px] overflow-y-auto py-1.5">
            <MenuSectionLabel>People</MenuSectionLabel>
            {users === null ? (
              <PickerSkeleton />
            ) : users.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ink-2">No people found</div>
            ) : (
              users.map((u) => (
                <MenuItem
                  key={u.id}
                  leading={<PersonAvatar person={u} size={22} />}
                  label={userLabel(u)}
                  selected={isSelected("USER", u.id)}
                  onClick={() => toggle({ type: "USER", id: u.id, label: userLabel(u), avatar: u.avatar })}
                />
              ))
            )}

            <MenuSeparator />
            <MenuSectionLabel>Departments</MenuSectionLabel>
            {depts === null ? (
              <PickerSkeleton />
            ) : filteredDepts.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ink-2">No departments found</div>
            ) : (
              filteredDepts.map((d) => (
                <MenuItem
                  key={d.id}
                  icon={Building2}
                  iconClassName="text-ink-2"
                  label={d.name}
                  selected={isSelected("DEPARTMENT", d.id)}
                  onClick={() => toggle({ type: "DEPARTMENT", id: d.id, label: d.name })}
                />
              ))
            )}

            <MenuSeparator />
            <MenuSectionLabel>Job titles</MenuSectionLabel>
            {roles === null ? (
              <PickerSkeleton />
            ) : filteredRoles.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ink-2">No job titles found</div>
            ) : (
              filteredRoles.map((r) => (
                <MenuItem
                  key={r.id}
                  icon={Briefcase}
                  iconClassName="text-ink-2"
                  label={r.title}
                  selected={isSelected("ROLE", r.id)}
                  onClick={() => toggle({ type: "ROLE", id: r.id, label: r.title })}
                />
              ))
            )}

            <MenuSeparator />
            <MenuSectionLabel>Tags</MenuSectionLabel>
            {tags === null ? (
              <PickerSkeleton />
            ) : filteredTags.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ink-2">No tags found</div>
            ) : (
              filteredTags.map((t) => (
                <MenuItem
                  key={t.id}
                  leading={
                    <span
                      className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md"
                      style={t.color ? { background: `${t.color}1a` } : { background: "var(--os-surface-2)" }}
                    >
                      <Tag className="h-3.5 w-3.5" style={{ color: t.color ?? "var(--os-ink-2)" }} />
                    </span>
                  }
                  label={t.name}
                  selected={isSelected("TAG", t.id)}
                  onClick={() => toggle({ type: "TAG", id: t.id, label: t.name })}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
