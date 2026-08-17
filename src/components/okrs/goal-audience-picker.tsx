"use client";

// GoalAudiencePicker — ONE multi-select for a goal's audience, mixing
// people, departments and roles in grouped sections. Same popover pattern
// as board-view/assignee-picker (search on top, MenuItem rows), but
// absolute-positioned so it survives the goal modal's transformed
// DialogContent; selection is a list of
// { type: "USER"|"DEPARTMENT"|"ROLE", id } refs — the API resolves them
// to people at read time, so a department/role entry follows the org
// chart instead of freezing a member list.
//
// Also exports MemberAvatarStack — the resolved-members avatar stack with
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
  /** Full member count — anything beyond the preview renders as "+N". */
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
          className="inline-flex rounded-full ring-2 ring-white dark:ring-zinc-900"
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.3) }}
        >
          <PersonAvatar person={{ ...m, email: null }} size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-zinc-100 text-zinc-500 font-semibold ring-2 ring-white dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-900"
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
  placeholder = "Assign people, departments or roles",
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

  // Departments + roles are small lookup lists — fetch once per open,
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
    return <span className="text-[12.5px] text-zinc-500 truncate">{summary}</span>;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-left text-[12.5px] text-zinc-800 hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0073EA]/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        aria-label="Edit goal audience"
      >
        <UsersRound className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <span className={`flex-1 truncate ${value.length === 0 ? "text-zinc-400" : ""}`}>{summary}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
      </button>

      {open ? (
        // Absolute (not fixed): the goal modal centres its DialogContent with a
        // CSS transform, and a position:fixed child anchors to that transformed
        // box, not the viewport — which flung this popover off-screen (the
        // "owner/contributors don't work" bug). Absolute anchors to this
        // relative wrapper, so it stays put inside the dialog AND on the inline
        // goal-detail usage. Staying a DOM child also keeps the dialog's focus
        // trap + click-outside working (a body portal would break the search).
        <div
          className="absolute left-0 top-full z-[200] mt-1 w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-9 items-center gap-2 border-b border-zinc-100 px-3 dark:border-zinc-800">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, departments, roles…"
              className="flex-1 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-zinc-400 hover:text-zinc-600" aria-label="Clear search">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="max-h-[300px] overflow-y-auto py-1.5">
            <MenuSectionLabel>People</MenuSectionLabel>
            {users === null ? (
              <div className="px-3 py-2 text-[12px] text-zinc-400">Loading…</div>
            ) : users.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-zinc-400">No people found</div>
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
              <div className="px-3 py-2 text-[12px] text-zinc-400">Loading…</div>
            ) : filteredDepts.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-zinc-400">No departments found</div>
            ) : (
              filteredDepts.map((d) => (
                <MenuItem
                  key={d.id}
                  icon={Building2}
                  iconClassName="text-zinc-400"
                  label={d.name}
                  selected={isSelected("DEPARTMENT", d.id)}
                  onClick={() => toggle({ type: "DEPARTMENT", id: d.id, label: d.name })}
                />
              ))
            )}

            <MenuSeparator />
            <MenuSectionLabel>Roles</MenuSectionLabel>
            {roles === null ? (
              <div className="px-3 py-2 text-[12px] text-zinc-400">Loading…</div>
            ) : filteredRoles.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-zinc-400">No roles found</div>
            ) : (
              filteredRoles.map((r) => (
                <MenuItem
                  key={r.id}
                  icon={Briefcase}
                  iconClassName="text-zinc-400"
                  label={r.title}
                  selected={isSelected("ROLE", r.id)}
                  onClick={() => toggle({ type: "ROLE", id: r.id, label: r.title })}
                />
              ))
            )}

            <MenuSeparator />
            <MenuSectionLabel>Tags</MenuSectionLabel>
            {tags === null ? (
              <div className="px-3 py-2 text-[12px] text-zinc-400">Loading…</div>
            ) : filteredTags.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-zinc-400">No tags found</div>
            ) : (
              filteredTags.map((t) => (
                <MenuItem
                  key={t.id}
                  leading={
                    <span
                      className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md"
                      style={t.color ? { background: `${t.color}1a` } : { background: "#f4f4f5" }}
                    >
                      <Tag className="h-3.5 w-3.5" style={{ color: t.color ?? "#71717a" }} />
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
