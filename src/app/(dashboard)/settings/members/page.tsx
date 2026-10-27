"use client";

// Workspace settings > Members (spec-settings-workspace `/settings/members`,
// settings-architecture 5.5): everyone who works here, what they can do and
// who they report to. Tabs People, Guests, Teams and Pending invites.
//
//   People     a server list (GET /api/settings/members: search, filters,
//              sort, pages of 50; the old 500-row cap is gone), a filter
//              panel (Role, Department, Office, Job title, Status, No
//              manager, People team, Inactive 30+ days), a row drawer, and
//              a bulk bar (Change role, one confirmed step and one audit row
//              per person; Change department)
//   Guests     empty until the Guest tier lands, and says so (the quiet
//              empty state, settings-cleanup B10)
//   Pending    Invite rules (one Save bar, section "users") and the pending
//              invitations with Resend and Revoke; "Invite people" is the
//              toolbar's primary, a secondary while the rules are unsaved
//   Teams      "New team" is the toolbar's primary; it opens the name row
//              in the Teams card (final Settings review, M3)
//
// The header stack carries every tab's toolbar (settings-cleanup Phase 4):
// People draws its own (search, Filter, the Sort chip, Invite, "...") into
// the header's toolbar row with SettingsToolbar, Teams' "New team" and
// Pending's "Invite people" ride on their tabs, and Guests holds the same
// empty row, so the first card starts at one height on every tab. The count strip sits at the right of the title row on
// every tab: People's list carries the counts, and a tab opened first reads
// them once (CountsReader).
//
// Deep links kept: ?invite=1 opens the invite modal, ?open=<userId> opens
// that person's drawer, ?filter=unlinked (and role:owner|admin|member,
// peopleteam) applies the filter, #pending-invites lands on that tab.
//
// Owner and Admin edit everything; the People team edits the people fields
// (job title, department, office, reports to, capacity); the rest of the
// manager tier reads their own team. Anyone the Access settings let invite
// (the people.create cell) invites and manages pending invites here, and the
// copy says exactly that.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCw, Search, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useRole } from "@/lib/access/use-legacy-permissions";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage, SettingsToolbar, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsReadOnlyBanner } from "@/components/settings/settings-read-only";
import { SaveBar } from "@/components/settings/save-bar";
import { ChipsInput, ConfirmDialog, Field, NativeSelect, NumberInput, useTypedNumbers } from "@/components/settings/settings-form";
import { TableCard, BulkAction, type TableColumn } from "@/components/ui/table-card";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { returnFocusOnClose } from "@/components/ui/return-focus";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { ErrorState } from "@/components/ui/error-state";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { InviteModal } from "@/components/layout/os/invite-modal";
import { draftAfterSave, useSettingsSection } from "@/hooks/use-settings-section";
import { normalizeDomain } from "@/lib/settings/org-policy";
import { formatRelative } from "@/lib/format/date";
import { useFormat } from "@/lib/format/use-date-prefs";
import { Avatar, MemberDrawer } from "./member-drawer";
import { TeamsTab } from "./teams-tab";
import { BulkRoleFields, PendingRowActions, ROLE_WORD, STATUS_WORD, TransferDialog, countsReadNeeded, membersTabs, pendingRowMenuWidth, useLookups, type Counts, type MemberRole, type MemberRow } from "./members-shared";

type ListBody = {
  rows: MemberRow[];
  total: number;
  page: number;
  pageCount: number;
  counts: Counts;
  scope: "org" | "team";
  viewer: { id: string; isOwner?: boolean; canEdit: boolean; canEditPeopleFields: boolean };
  scopesLive?: boolean;
  peopleTeam: { configured: boolean; ids: string[] };
};

const SORTS = [
  { value: "name_asc", label: "Name A to Z" },
  { value: "name_desc", label: "Name Z to A" },
  { value: "role", label: "Role" },
  { value: "department", label: "Department" },
  { value: "title", label: "Job title" },
  { value: "status", label: "Status" },
  { value: "joined", label: "Joined, newest first" },
] as const;
const PAGE = 50;

export default function MembersPage() {
  const { canInvite } = useRole();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [list, setList] = useState<ListBody | null>(null);
  const [inviteSignal, setInviteSignal] = useState(0);
  // The toolbar's New team, counted (Structure's New office pattern), and
  // whether the Invite rules are unsaved (Invite people then steps down).
  const [newTeam, setNewTeam] = useState(0);
  const [rulesDirty, setRulesDirty] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("invite") === "1") setInviteOpen(true);
      // #pending-invites (the People import's result step links here).
      if (window.location.hash === "#pending-invites" && !sp.get("tab")) router.replace("/settings/members?tab=pending#pending-invites");
    }, 0);
    return () => clearTimeout(t);
  }, [router]);

  // Owner and Admin: the server's answer once the list has loaded, the boot
  // role before it (the Pending tab may be the first one opened).
  const { isAdmin } = useViewerRole();
  const canEdit = list ? list.viewer.canEdit : isAdmin;
  const canManageInvites = canEdit || canInvite;
  const tabs: SettingsTab[] = membersTabs(canManageInvites, () => setInviteOpen(true), {
    canMakeTeams: canEdit,
    onNewTeam: () => setNewTeam((n) => n + 1),
    rulesDirty,
  });

  return (
    <SettingsPage pageKey="members" tabs={tabs} width="list" actions={list && list.scope === "org" ? <CountStrip counts={list.counts} /> : undefined}>
      {(tab) => (
        <>
          {/* A tab other than People, opened first, reads the counts once; People's own list carries them. */}
          {countsReadNeeded(tab, !!list) ? <CountsReader onList={setList} /> : null}
          {tab === "pending" ? (
            <PendingTab canEdit={canEdit} canManageInvites={canManageInvites} onInvite={() => setInviteOpen(true)} inviteSignal={inviteSignal} onRulesDirty={setRulesDirty} />
          ) : tab === "guests" ? (
            <GuestsTab />
          ) : tab === "teams" ? (
            <TeamsTab createSignal={newTeam} />
          ) : (
            <PeopleTab onList={setList} inviteSignal={inviteSignal} canInvite={canManageInvites} onInvite={() => setInviteOpen(true)} />
          )}
          {/* A sent invite bumps the signal, and People and Pending both
              read their list again at once: Pending showing the new invite
              only after a reload let an admin send it twice (Phase 4
              review, L4). */}
          <InviteModal
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            onSent={() => setInviteSignal((n) => n + 1)}
          />
        </>
      )}
    </SettingsPage>
  );
}

/**
 * The count strip's numbers on a tab with no list of its own: one read of
 * the first page, the same answer (counts and scope) People's list carries,
 * so the strip is on every tab (settings-cleanup P9).
 */
function CountsReader({ onList }: { onList: (b: ListBody) => void }) {
  useEffect(() => {
    let live = true;
    void apiFetch<ListBody>("/api/settings/members?sort=name_asc&page=0", { cache: "no-store" }).then((r) => {
      if (live && r.ok) onList(r.data);
    });
    return () => { live = false; };
  }, [onList]);
  return null;
}

function CountStrip({ counts }: { counts: Counts }) {
  const items: [string, number, string][] = [
    ["Owners", counts.owners, "role:owner"],
    ["Admins", counts.admins, "role:admin"],
    ["Members", counts.members, "role:member"],
    ["Guests (free)", counts.guests, "role:guest"],
    ["People team", counts.peopleTeam, "peopleteam"],
  ];
  // Narrow windows drop the strip rather than squeeze the page title (the
  // same filters stay one click away under Filter).
  return (
    <p className="hidden flex-wrap justify-end gap-x-2 gap-y-1 text-sm text-ink-2 min-[1100px]:flex">
      {items.map(([label, n, f], i) => (
        <span key={label}>
          <Link href={`/settings/members?tab=people&filter=${f}`} className="hover:text-ink hover:underline">
            {label} <span className="font-medium tabular-nums text-ink">{n}</span>
          </Link>
          {i < items.length - 1 ? <span className="ms-2" aria-hidden>·</span> : null}
        </span>
      ))}
    </p>
  );
}

/* ───────────────────────── People ───────────────────────── */

function PeopleTab({ onList, inviteSignal, canInvite, onInvite }: { onList: (b: ListBody) => void; inviteSignal: number; canInvite: boolean; onInvite: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useOsToast();
  const fmt = useFormat();
  const lookups = useLookups();
  const initialFilter = params.get("filter") ?? "";
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<string>("name_asc");
  const [page, setPage] = useState(0);
  const [filterOpen, setFilterOpen] = useState(!!initialFilter);
  const [role, setRole] = useState<string | null>(() => (initialFilter.startsWith("role:") ? initialFilter.slice(5) : null));
  const [noManager, setNoManager] = useState(initialFilter === "unlinked");
  const [peopleTeam, setPeopleTeam] = useState(initialFilter === "peopleteam");
  const [inactive30, setInactive30] = useState(initialFilter === "inactive30");
  const [dept, setDept] = useState<string | null>(null);
  const [office, setOffice] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [data, setData] = useState<ListBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(() => params.get("open"));
  const [openRow, setOpenRow] = useState<MemberRow | null>(null);
  const [transfer, setTransfer] = useState<{ member: MemberRow; mode: "deactivate" | "remove" } | null>(null);
  const [bulkRole, setBulkRole] = useState<{ role: MemberRole; tier: string } | null>(null);
  const [bulkDept, setBulkDept] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ sort, page: String(page) });
    if (debounced) p.set("q", debounced);
    const f: string[] = [];
    if (role) f.push(`role:${role}`);
    if (noManager) f.push("unlinked");
    if (peopleTeam) f.push("peopleteam");
    if (inactive30) f.push("inactive30");
    if (f.length) p.set("filter", f.join(","));
    if (dept) p.set("department", dept);
    if (office) p.set("office", office);
    if (title) p.set("title", title);
    if (status) p.set("status", status);
    return p.toString();
  }, [sort, page, debounced, role, noManager, peopleTeam, inactive30, dept, office, title, status]);

  // The search text the list on screen was read for (the ?open= lookup waits for its own).
  const [loadedQ, setLoadedQ] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const askedQ = debounced;
    const r = await apiFetch<ListBody>(`/api/settings/members?${qs}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setData(r.data);
    setLoadedQ(askedQ);
    onList(r.data);
  }, [qs, onList, debounced]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load, inviteSignal]);
  // Any filter change goes back to page one.
  useEffect(() => {
    const t = setTimeout(() => setPage(0), 0);
    return () => clearTimeout(t);
  }, [debounced, role, noManager, peopleTeam, inactive30, dept, office, title, status, sort]);

  // ?open=<id>: that person's drawer. On the first page it opens at once;
  // past it, the list is searched by their email and the drawer opens when
  // that search brings them in (it used to search and never open). Someone
  // this list cannot show (outside your team, or removed) is said so.
  const [pendingOpen, setPendingOpen] = useState<{ id: string; q: string } | null>(null);
  useEffect(() => {
    if (!openId || !data) return;
    const hit = data.rows.find((r) => r.id === openId);
    const t = setTimeout(() => {
      setOpenId(null);
      if (hit) { setOpenRow(hit); return; }
      void apiFetch<{ email?: string }>(`/api/users/${openId}`, { cache: "no-store" }).then((r) => {
        if (r.ok && r.data.email) { setPendingOpen({ id: openId, q: r.data.email }); setQ(r.data.email); }
        else toast("Couldn't find that person in this list.", { tone: "danger" });
      });
    }, 0);
    return () => clearTimeout(t);
  }, [openId, data, toast]);
  // The search for them has answered: their drawer, or a word that they are not here.
  useEffect(() => {
    if (!pendingOpen || !data || loadedQ !== pendingOpen.q) return;
    const hit = data.rows.find((r) => r.id === pendingOpen.id);
    const t = setTimeout(() => {
      setPendingOpen(null);
      if (hit) setOpenRow(hit);
      else toast("Couldn't find that person in this list.", { tone: "danger" });
    }, 0);
    return () => clearTimeout(t);
  }, [pendingOpen, data, loadedQ, toast]);

  const canEdit = !!data?.viewer.canEdit;
  const canEditPeople = !!data?.viewer.canEditPeopleFields;
  const activeCount = [role, dept, office, title, status].filter(Boolean).length + (noManager ? 1 : 0) + (peopleTeam ? 1 : 0) + (inactive30 ? 1 : 0);
  const clearAll = () => { setRole(null); setDept(null); setOffice(null); setTitle(null); setStatus(null); setNoManager(false); setPeopleTeam(false); setInactive30(false); };

  const togglePeopleTeam = async (m: MemberRow, on: boolean) => {
    if (!data) return;
    // Starting from the team as it stands (the HR fallback included), so
    // adding one person never drops the people already on it.
    const next = new Set(data.peopleTeam.ids);
    if (on) next.add(m.id); else next.delete(m.id);
    const r = await apiFetch("/api/settings", { method: "PATCH", json: { section: "access", data: { peopleTeamUserIds: [...next] } } });
    if (!r.ok) { toast(r.error); return; }
    toast(on ? `${m.name} is on the People team` : `${m.name} left the People team`);
    void load();
  };

  const runBulkRole = async () => {
    if (!bulkRole) return;
    setBusy(true);
    const r = await apiFetch<{ changed: number; refused: number; results: { id: string; ok: boolean; error?: string }[] }>("/api/settings/members/bulk", {
      method: "POST",
      json: { ids: [...selected], role: bulkRole.role, tier: bulkRole.role === "MEMBER" ? bulkRole.tier : null },
    });
    setBusy(false);
    setBulkRole(null);
    if (!r.ok) { toast(r.error); return; }
    const refused = r.data.results.filter((x) => !x.ok);
    toast(`${r.data.changed} changed${refused.length ? `, ${refused.length} not changed: ${refused[0]?.error ?? ""}` : ""}`);
    setSelected(new Set());
    void load();
  };
  const runBulkDept = async () => {
    if (!bulkDept) return;
    setBusy(true);
    const r = await apiFetch<{ updated: number }>("/api/people/bulk-update", { method: "POST", json: { userIds: [...selected], action: "change_department", payload: { departmentId: bulkDept } } });
    setBusy(false);
    setBulkDept(null);
    if (!r.ok) { toast(r.error); return; }
    toast(`${r.data.updated} moved`);
    setSelected(new Set());
    void load();
  };

  const columns: TableColumn<MemberRow>[] = [
    {
      key: "person", label: "Person", title: true, width: "minmax(220px,1.6fr)",
      render: (m) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={m.name} src={m.avatar} />
          <span className="min-w-0">
            <span className="block truncate">{m.name}</span>
            <span className="block truncate text-sm font-normal text-ink-2">{m.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: "role", label: "Role", width: "130px",
      render: (m) => (
        <span className="block min-w-0" title={m.role === "MEMBER" && m.tier && m.tier !== "EMPLOYEE" ? `${ROLE_WORD[m.role]}, ${m.tierLabel}` : undefined}>
          <span className="block truncate">{ROLE_WORD[m.role]}</span>
          {m.role === "MEMBER" && m.tier && m.tier !== "EMPLOYEE" ? <span className="block truncate text-sm text-ink-2">{m.tierLabel}</span> : null}
        </span>
      ),
    },
    { key: "title", label: "Job title", width: "minmax(120px,1fr)", hideBelow: 900, render: (m) => <span className="block truncate" title={m.jobTitle?.title}>{m.jobTitle?.title ?? "·"}</span> },
    { key: "dept", label: "Department", width: "minmax(120px,1fr)", hideBelow: 760, render: (m) => <span className="block truncate" title={m.department?.name}>{m.department?.name ?? "·"}</span> },
    { key: "manager", label: "Reports to", width: "minmax(120px,1fr)", hideBelow: 1000, render: (m) => <span className="block truncate" title={m.manager?.name}>{m.manager?.name ?? "·"}</span> },
    {
      key: "pt", label: "People team", width: "110px", align: "center",
      render: (m) => canEdit ? (
        <input type="checkbox" className="h-[18px] w-[18px] accent-[var(--os-brand)]" checked={m.peopleTeam} aria-label={`${m.name} on the People team`}
          onClick={(e) => e.stopPropagation()} onChange={(e) => { void togglePeopleTeam(m, e.target.checked); }} />
      ) : m.peopleTeam ? "Yes" : "",
    },
    { key: "status", label: "Status", width: "120px", render: (m) => <span className={m.status === "INACTIVE" ? "text-danger-text" : ""}>{STATUS_WORD[m.status] ?? m.status}</span> },
    { key: "seen", label: "Last sign-in", width: "120px", hideBelow: 1100, render: (m) => (m.lastSignInAt ? <span title={fmt.title(m.lastSignInAt)}>{formatRelative(m.lastSignInAt)}</span> : "Never") },
  ];

  return (
    <div className="flex flex-col gap-4">
      {data?.scope === "team" ? (
        <SettingsReadOnlyBanner>
          You see your own team here. {canInvite ? "You can invite people and look after pending invites; " : ""}roles, placement and removals are for Owners and Admins, who see everyone.
        </SettingsReadOnlyBanner>
      ) : data && !canEdit ? <SettingsReadOnlyBanner /> : null}
      {/* Drawn into the header's toolbar row (the tab says ownToolbar), under the tabs. */}
      <SettingsToolbar
        left={
          <label className="flex h-9 w-[280px] max-w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
            <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none" />
            {q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" /></button> : null}
          </label>
        }
        filter={{ open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeCount }}
        // A chip at the left beside Filter, never a select (B8): it opens the orders under itself.
        sort={{
          label: sort === SORTS[0].value ? "Sort" : SORTS.find((s) => s.value === sort)?.label,
          active: sort !== SORTS[0].value,
          options: SORTS,
          value: sort,
          onChange: setSort,
          menuLabel: "Sort people",
        }}
        primary={canInvite ? { label: "Invite", onClick: onInvite } : undefined}
        menu={[
          { label: "Export members (CSV)", href: "/settings/data?tab=export" },
          { label: "Import people (CSV)", href: "/settings/data?tab=import" },
        ]}
      />
      <div className="flex items-start gap-4">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="people" activeCount={activeCount} onClearAll={clearAll}>
          {/* The four value pickers below are the one Picker: it measures the
              panel it opens in (the panel scrolls its own overflow, 272px
              wide) and opens narrowed to it, up or down where the whole list
              is seen (PickerSelect, autoPlace; checked live in Phase 4). */}
          <ul className="flex flex-col">
            <FilterGroup label="Role">
              {(["owner", "admin", "member"] as const).map((r) => (
                <FilterRow key={r} label={ROLE_WORD[r.toUpperCase() as MemberRole]} checked={role === r} onCheckedChange={(on) => setRole(on ? r : null)} />
              ))}
              {/* The Guests count links here (role:guest); the row keeps that filter visible and clearable. */}
              <FilterRow label="Guest" checked={role === "guest"} onCheckedChange={(on) => setRole(on ? "guest" : null)} />
            </FilterGroup>
            <FilterGroup label="Placement">
              <FilterRow label="Department" checked={!!dept} onCheckedChange={(on) => setDept(on ? lookups.depts[0]?.id ?? null : null)}>
                <NativeSelect ariaLabel="Department" align="start" value={dept ?? ""} options={lookups.depts.map((d) => ({ value: d.id, label: d.label }))} onChange={setDept} className="w-full" />
              </FilterRow>
              <FilterRow label="Office" checked={!!office} onCheckedChange={(on) => setOffice(on ? lookups.offices[0]?.id ?? null : null)}>
                <NativeSelect ariaLabel="Office" align="start" value={office ?? ""} options={lookups.offices.map((d) => ({ value: d.id, label: d.label }))} onChange={setOffice} className="w-full" />
              </FilterRow>
              <FilterRow label="Job title" checked={!!title} onCheckedChange={(on) => setTitle(on ? lookups.roles[0]?.id ?? null : null)}>
                <NativeSelect ariaLabel="Job title" align="start" value={title ?? ""} options={lookups.roles.map((d) => ({ value: d.id, label: d.label }))} onChange={setTitle} className="w-full" />
              </FilterRow>
            </FilterGroup>
            <FilterGroup label="Status">
              <FilterRow label="Status" checked={!!status} onCheckedChange={(on) => setStatus(on ? "ACTIVE" : null)}>
                <NativeSelect ariaLabel="Status" align="start" value={status ?? "ACTIVE"} options={Object.entries(STATUS_WORD).map(([v, l]) => ({ value: v, label: l }))} onChange={setStatus} className="w-full" />
              </FilterRow>
              <FilterRow label="No manager" checked={noManager} onCheckedChange={setNoManager} />
              <FilterRow label="People team" checked={peopleTeam} onCheckedChange={setPeopleTeam} />
              <FilterRow label="Inactive 30+ days" checked={inactive30} onCheckedChange={setInactive30} />
            </FilterGroup>
          </ul>
        </FilterPanel>
        <div className="min-w-0 flex-1">
          {error ? (
            <ErrorState what="the members" hint={error} onRetry={() => { void load(); }} />
          ) : (
            <TableCard
              ariaLabel="Members"
              columns={columns}
              rows={data ? data.rows : null}
              rowKey={(m) => m.id}
              onRowClick={(m) => setOpenRow(m)}
              selectable={canEdit}
              isRowSelectable={(m) => m.id !== data?.viewer.id}
              selected={selected}
              onSelectedChange={setSelected}
              columnSettings={{ storageKey: "settings.members.columns" }}
              empty={activeCount || debounced ? <span>No results · <button type="button" className="text-brand-deep hover:underline" onClick={() => { clearAll(); setQ(""); }}>Clear filters</button></span> : <span>Nobody here yet</span>}
              bulkActions={canEdit ? (
                <>
                  <BulkAction label="Change role" onClick={() => setBulkRole({ role: "MEMBER", tier: "EMPLOYEE" })} />
                  <BulkAction label="Change department" onClick={() => setBulkDept(lookups.depts[0]?.id ?? null)} />
                </>
              ) : undefined}
              footer={data ? {
                total: data.total,
                noun: "members",
                from: data.rows.length ? data.page * PAGE + 1 : 0,
                to: data.page * PAGE + data.rows.length,
                onPrev: data.page > 0 ? () => setPage((p) => p - 1) : undefined,
                onNext: data.page + 1 < data.pageCount ? () => setPage((p) => p + 1) : undefined,
              } : undefined}
            />
          )}
        </div>
      </div>

      {openRow && data ? (
        <MemberDrawer
          member={openRow}
          canEdit={canEdit}
          canEditPeople={canEditPeople}
          viewerId={data.viewer.id}
          viewerIsOwner={!!data.viewer.isOwner}
          scopesLive={!!data.scopesLive}
          owners={data.counts.owners}
          lookups={lookups}
          onClose={() => { setOpenRow(null); if (params.get("open")) router.replace("/settings/members"); }}
          onChanged={() => { void load(); }}
          onDeactivate={() => { setTransfer({ member: openRow, mode: "deactivate" }); setOpenRow(null); }}
          onRemove={() => { setTransfer({ member: openRow, mode: "remove" }); setOpenRow(null); }}
        />
      ) : null}
      {transfer && data ? (
        <TransferDialog
          member={transfer.member}
          mode={transfer.mode}
          actingId={data.viewer.id}
          onClose={() => setTransfer(null)}
          onDone={(msg) => { setTransfer(null); toast(msg); void load(); }}
        />
      ) : null}

      <ConfirmDialog
        open={!!bulkRole}
        onOpenChange={(v) => { if (!v) setBulkRole(null); }}
        title={`Change the role of ${selected.size} ${selected.size === 1 ? "person" : "people"}?`}
        confirmLabel="Change roles"
        busy={busy}
        onConfirm={runBulkRole}
      >
        {bulkRole ? <BulkRoleFields value={bulkRole} onChange={setBulkRole} /> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={bulkDept !== null}
        onOpenChange={(v) => { if (!v) setBulkDept(null); }}
        title={`Move ${selected.size} ${selected.size === 1 ? "person" : "people"} to a department`}
        confirmLabel="Move"
        busy={busy}
        onConfirm={runBulkDept}
      >
        <Field label="Department">
          {/* Native here only: this dialog is one field tall, shorter than
              the Picker's smallest list, so above or below its trigger the
              popover was cut by the dialog's own scroll (Phase 4, live). */}
          <NativeSelect native ariaLabel="Department" value={bulkDept ?? ""} options={lookups.depts.map((d) => ({ value: d.id, label: d.label }))} onChange={setBulkDept} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/* ───────────────────────── Guests ───────────────────────── */

// A whole tab with nothing in it: the quiet empty state (B10), centred, the
// four dots, one sentence and its one line of what a Guest is; still saying
// what a Space email invite makes today. That line is a consequence, so it
// is drawn at ink-2, readable at AA, not the ink-3 guidance tone (Phase 4
// review, M1).
function GuestsTab() {
  return (
    <OsEmptyView
      title="No guests yet"
      hint="Guests are people outside your company who can only see what you share with them; inviting someone to a Space by email today creates a member account."
      hintTone="plain"
    />
  );
}

/* ───────────────────────── Pending invites ───────────────────────── */

type PendingInvite = { id: string; email: string; accessLevel: string; accepted: boolean; createdAt: string; expiresAt: string; spaceId?: string | null };
type Rules = { allowedDomains: string[]; autoJoin: boolean; inviteDefaultRole: "ADMIN" | "MEMBER" | "GUEST"; defaultSpaceIds: string[]; inviteExpiryDays: number };

const LEVEL_WORD: Record<string, string> = { SUPER_ADMIN: "Owner", COMPANY_ADMIN: "Admin", AGENT: "Agent" };

/** Below 640px (a phone), the row actions fold into one "..." menu (pendingRowMenuWidth). */
const PHONE_ROWS = "(width < 640px)";
function subscribePhoneRows(cb: () => void) {
  const mq = window.matchMedia(PHONE_ROWS);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readPhoneRows = () => window.matchMedia(PHONE_ROWS).matches;

function PendingTab({ canEdit, canManageInvites, onInvite, inviteSignal, onRulesDirty }: { canEdit: boolean; canManageInvites: boolean; onInvite: () => void; inviteSignal: number; onRulesDirty: (dirty: boolean) => void }) {
  const { toast } = useOsToast();
  const fmt = useFormat();
  const showUpcoming = useShowUpcoming();
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const phone = useSyncExternalStore(subscribePhoneRows, readPhoneRows, () => false);
  const [menu, setMenu] = useState<{ invite: PendingInvite; anchor: RefObject<HTMLElement | null> } | null>(null);
  const rules = useSettingsSection<Rules>("users", (b) => ((b.settings ?? {}) as { users?: Rules }).users ?? { allowedDomains: [], autoJoin: false, inviteDefaultRole: "MEMBER", defaultSpaceIds: [], inviteExpiryDays: 7 });
  const [draft, setDraft] = useState<Rules | null>(null);
  const [saving, setSaving] = useState(false);
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  // Invitation expiry keeps what is typed (a cleared field stays clear); the
  // draft takes only 1 to 90, and Save waits for one.
  const nums = useTypedNumbers();

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<PendingInvite[]>("/api/invitations", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setInvites((Array.isArray(r.data) ? r.data : []).filter((i) => !i.accepted));
  }, []);
  // Read again whenever an invite is sent from this page (inviteSignal), so
  // the new invitation is in the list at once.
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load, inviteSignal]);

  const base = rules.data;
  const form = draft ?? base;
  const dirty = (!!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base)) || nums.blocked;
  // The page's toolbar keeps one blue button: while the Save bar shows, its
  // Invite people is a secondary (membersTabs). Leaving the tab clears it.
  const showsSaveBar = canEdit && dirty;
  useEffect(() => { onRulesDirty(showsSaveBar); }, [showsSaveBar, onRulesDirty]);
  useEffect(() => () => onRulesDirty(false), [onRulesDirty]);
  // Not memoized: the typed-number state it consults is rebuilt each render.
  const saveRules = async () => {
    if (!nums.check()) { setRuleErr("Fix the invitation expiry before saving."); return false; }
    if (!draft) return true;
    setSaving(true);
    // Only what changed: sending the domain list on an expiry-only save
    // would freeze today's fallback domain into the stored rules.
    const patch: Partial<Rules> = { inviteDefaultRole: draft.inviteDefaultRole, inviteExpiryDays: draft.inviteExpiryDays };
    if (!base || JSON.stringify(draft.allowedDomains) !== JSON.stringify(base.allowedDomains)) patch.allowedDomains = draft.allowedDomains;
    const r = await rules.save(patch);
    setSaving(false);
    if (!r.ok) { setRuleErr(r.error ?? "Couldn't save"); return false; }
    // Anything typed while the save was out stays, unsaved: the draft
    // (draftAfterSave) and the expiry's text (nums.saved).
    setDraft((d) => draftAfterSave(d, draft));
    nums.saved();
    toast("Invite rules saved");
    return true;
  };

  const revoke = async (inv: PendingInvite) => {
    setBusyId(inv.id);
    const r = await apiFetch("/api/invitations", { method: "DELETE", json: { id: inv.id } });
    setBusyId(null);
    if (!r.ok) { toast(r.error); return; }
    toast(`Invitation to ${inv.email} revoked`);
    void load();
  };
  const resend = async (inv: PendingInvite) => {
    setBusyId(inv.id);
    const r = await apiFetch<{ expiresAt: string }>("/api/invitations", { method: "PATCH", json: { id: inv.id, resend: true } });
    setBusyId(null);
    if (!r.ok) { toast(r.error); return; }
    toast(`Sent a new link to ${inv.email}`);
    void load();
  };

  const [now] = useState(() => Date.now());
  const expiry = form ? nums.field("inviteExpiryDays", form.inviteExpiryDays, { min: 1, max: 90 }, (n) => { setRuleErr(null); setDraft({ ...form, inviteExpiryDays: n }); }) : null;
  const columns: TableColumn<PendingInvite>[] = [
    // 160 at the least, not 220: on a 390 phone the card is 294 wide, and at
    // 220 the pinned "..." cell sat over Role (Phase 4 review, L1). A long
    // address is cut with its whole text in the title.
    { key: "email", label: "Email", title: true, width: "minmax(160px,1.6fr)", render: (i) => <span className="block truncate" title={i.email}>{i.email}</span> },
    { key: "role", label: "Role", width: "120px", render: (i) => LEVEL_WORD[i.accessLevel] ?? "Member" },
    { key: "to", label: "Invited to", width: "120px", hideBelow: 900, render: (i) => (i.spaceId ? "A Space" : "Workspace") },
    { key: "sent", label: "Sent", width: "120px", render: (i) => formatRelative(i.createdAt) },
    { key: "expires", label: "Expires", width: "120px", render: (i) => <span title={fmt.title(i.expiresAt)}>{fmt.date(i.expiresAt, "date")}</span> },
    { key: "status", label: "Status", width: "100px", render: (i) => (new Date(i.expiresAt).getTime() < now ? <span className="text-warning-text">Expired</span> : "Pending") },
  ];

  return (
    <div id="pending-invites" className="flex flex-col gap-6">
      {rules.status === "error" ? (
        <ErrorState what="the invite rules" hint={rules.error ?? undefined} onRetry={rules.retry} />
      ) : form ? (
        <SettingsCard title="Invite rules" id="members.inviteRules">
          <Field label="Allowed email domains" helper="The workspace's own domain is always allowed. Add other domains invitations may go to." id="members.allowedDomains">
            {canEdit ? (
              <ChipsInput
                values={form.allowedDomains}
                onChange={(v) => { setRuleErr(null); setDraft({ ...form, allowedDomains: v }); }}
                max={20}
                ariaLabel="Allowed domains"
                placeholder="acme.com"
                validate={(v) => (normalizeDomain(v) ? null : "Enter a domain like acme.com")}
              />
            ) : (
              <p className="text-base text-ink">{form.allowedDomains.join(", ") || "The workspace's own domain"}</p>
            )}
          </Field>
          <Field label="Default role for invites" id="members.inviteDefaultRole">
            {canEdit ? (
              <NativeSelect align="start" ariaLabel="Default role" value={form.inviteDefaultRole === "ADMIN" ? "ADMIN" : "MEMBER"} options={[{ value: "MEMBER", label: "Member" }, { value: "ADMIN", label: "Admin" }]}
                onChange={(v) => setDraft({ ...form, inviteDefaultRole: v })} />
            ) : <p className="text-base text-ink">{form.inviteDefaultRole === "ADMIN" ? "Admin" : "Member"}</p>}
          </Field>
          <Field label="Invitation expiry" id="members.inviteExpiryDays" error={canEdit ? expiry?.error : null}>
            {canEdit && expiry ? (
              <NumberInput {...expiry.input} suffix="days" ariaLabel="Invitation expiry days" />
            ) : <p className="text-base text-ink">{form.inviteExpiryDays} days</p>}
          </Field>
          <p className="text-sm text-ink-2">
            Owners and Admins invite people, and so does anyone <Link href="/settings/access" className="font-medium text-brand-deep hover:underline">Access</Link> lets invite (Add new people / invite). Access also decides who can share.
          </p>
          {showUpcoming ? <p className="text-sm text-ink-3">Coming soon: anyone with an allowed-domain email joins on their own; new members added to chosen Spaces.</p> : null}
          {ruleErr ? <p role="alert" className="text-sm text-danger-text">{ruleErr}</p> : null}
        </SettingsCard>
      ) : null}
      {canEdit ? <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(null); setRuleErr(null); nums.reset(); }} onSave={saveRules} /> : null}

      {/* "Invite people" is the toolbar's (membersTabs), never a button floating over the table. */}
      {error ? (
        <ErrorState what="pending invitations" hint={error} onRetry={() => { void load(); }} />
      ) : (
        <TableCard
          ariaLabel="Pending invitations"
          columns={columns}
          rows={invites}
          rowKey={(i) => i.id}
          rowMenuAlwaysVisible
          rowMenuWidth={pendingRowMenuWidth(canManageInvites, phone)}
          rowMenu={canManageInvites ? (i) => (
            <PendingRowActions
              email={i.email}
              phone={phone}
              busy={busyId === i.id}
              menuOpen={menu?.invite.id === i.id}
              onResend={() => { void resend(i); }}
              onRevoke={() => { void revoke(i); }}
              onMenu={(anchor) => setMenu(menu?.invite.id === i.id ? null : { invite: i, anchor: { current: anchor } })}
            />
          ) : undefined}
          empty={<span>No pending invitations{canManageInvites ? <> · <button type="button" className="text-brand-deep hover:underline" onClick={onInvite}>Invite people</button></> : null}</span>}
          footer={invites ? { total: invites.length, noun: "invitations", from: invites.length ? 1 : 0, to: invites.length, hidePaging: true } : undefined}
        />
      )}
      {menu && phone ? (
        <MorePortal anchorRef={menu.anchor} width={200} open placement="below" onClose={() => { const a = menu.anchor.current; setMenu(null); returnFocusOnClose("dismiss", a, null); }}>
          <MenuList keyboard aria-label={`Actions for ${menu.invite.email}`}>
            <MenuItem icon={RotateCw} label="Resend" disabled={busyId === menu.invite.id} onClick={() => { const { invite, anchor } = menu; setMenu(null); returnFocusOnClose("select", anchor.current, null); void resend(invite); }} />
            <MenuItem icon={Trash2} label="Revoke" destructive disabled={busyId === menu.invite.id} onClick={() => { const { invite, anchor } = menu; setMenu(null); returnFocusOnClose("select", anchor.current, null); void revoke(invite); }} />
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}
