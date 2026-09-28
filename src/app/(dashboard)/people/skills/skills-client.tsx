"use client";

// Teams > Skills (spec-teams-people /people/skills): who knows what across
// the company, and where the gaps are.
//
//   views    All · Gaps (nobody the viewer can see is rated 4 or more) ·
//            Expert (someone the viewer can see is rated 4 or more)
//   body     a TableCard: Skill, People (everyone), Who, Avg self and Avg
//            manager (over the people whose ratings the viewer may read, a
//            "·" when that is nobody), and the Gap or Expert chip
//   drawer   the Skill drawer: every holder, their ratings where visible,
//            Rate (the chain, the People team, Admins), Add to my skills
//
// The write path the page never had (PO-5): Add a skill, the one blue
// button, writes the viewer's own record (POST /api/users/[me]/skills).

import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, MoreHorizontal, Plus, Star, X } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { useBoot } from "@/components/layout/os/boot-context";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Drawer } from "@/components/ui/drawer";
import { AvatarStack, Avatar } from "@/components/ui/avatar-stack";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { apiFetch } from "@/lib/api-fetch";
import { ratingLabel } from "@/lib/people/skills-aggregate";
import { ToneChip, personName } from "@/components/people/person-bits";
import { AddSkillDialog, RateSkillDialog, SKILLS_CHANGED } from "@/components/people/skill-dialogs";

interface Holder {
  userId: string;
  skillId: string;
  selfRating: number | null;
  managerRating: number | null;
  firstName: string;
  lastName: string;
  avatar: string | null;
  department: { id: string; name: string } | null;
  canRate: boolean;
}
interface SkillRow {
  name: string;
  holders: number;
  visibleRated: number;
  avgSelf: number | null;
  avgManager: number | null;
  gap: boolean;
  expert: boolean;
  people: Holder[];
}
type SortKey = "people" | "rated" | "name";
const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "people", label: "Most people" },
  { value: "rated", label: "Highest rated" },
  { value: "name", label: "A to Z" },
];

export default function SkillsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { boot } = useBoot();
  const me = boot.viewer.id;
  const [rows, setRows] = useState<SkillRow[] | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string | null>(null);
  const [managerRated, setManagerRated] = useState(false);
  const [sort, setSort] = useState<SortKey>("people");
  const [adding, setAdding] = useState<string | null>(null);
  const view = sp?.get("view") === "gaps" ? "gaps" : sp?.get("view") === "expert" ? "expert" : "all";
  const openName = sp?.get("skill") ?? null;

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const load = useCallback(async () => {
    const r = await apiFetch<{ data: SkillRow[]; viewer: { canExport: boolean } }>("/api/skills", { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load skills"); return; }
    setError(null);
    setRows(r.data.data);
    setCanExport(r.data.viewer.canExport);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("focus", onChange);
    window.addEventListener(SKILLS_CHANGED, onChange);
    return () => { window.removeEventListener("focus", onChange); window.removeEventListener(SKILLS_CHANGED, onChange); };
  }, [load]);

  const depts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) for (const p of r.people) if (p.department) m.set(p.department.id, p.department.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const filters = (q.trim() ? 1 : 0) + (dept ? 1 : 0) + (managerRated ? 1 : 0);
  const shown = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) =>
      (view === "all" || (view === "gaps" ? r.gap : r.expert)) &&
      (!needle || r.name.toLowerCase().includes(needle)) &&
      (!dept || r.people.some((p) => p.department?.id === dept)) &&
      (!managerRated || r.avgManager != null));
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
        : sort === "rated" ? (b.avgManager ?? b.avgSelf ?? -1) - (a.avgManager ?? a.avgSelf ?? -1) || a.name.localeCompare(b.name)
          : b.holders - a.holders || a.name.localeCompare(b.name));
  }, [rows, q, dept, managerRated, view, sort]);
  const clear = () => { setQ(""); setDept(null); setManagerRated(false); };

  const columns = useMemo<TableColumn<SkillRow>[]>(() => [
    { key: "name", label: "Skill", title: true, width: "minmax(200px,1.4fr)", render: (r) => <span className="truncate">{r.name}</span> },
    { key: "people", label: "People", width: "90px", numeric: true, render: (r) => <span className="tabular-nums">{r.holders}</span> },
    { key: "who", label: "Who", width: "110px", hideBelow: 620, render: (r) => (
      <AvatarStack size={24} max={3} people={r.people.slice(0, 3).map((p) => ({ id: p.userId, firstName: p.firstName, lastName: p.lastName, avatar: p.avatar }))} />
    ) },
    { key: "self", label: "Avg self rating", width: "130px", numeric: true, hideBelow: 720, render: (r) => <span className="tabular-nums">{r.avgSelf ?? "·"}</span> },
    { key: "mgr", label: "Avg manager rating", width: "150px", numeric: true, hideBelow: 820, render: (r) => <span className="tabular-nums">{r.avgManager ?? "·"}</span> },
    { key: "mark", label: "Gap", width: "100px", render: (r) => r.expert ? <ToneChip tone="success" label="Expert" /> : r.gap ? <ToneChip tone="neutral" label="Gap" /> : null },
  ], []);

  const open = openName ? rows?.find((r) => r.name === openName) ?? null : null;
  const heldByMe = new Set((rows ?? []).filter((r) => r.people.some((p) => p.userId === me)).map((r) => r.name));

  return (
    <>
      <Breadcrumb items={[{ label: "Skills" }]} />
      <OsPageHeader
        title="Skills"
        views={
          <>
            <ViewTab label="All" active={view === "all"} onClick={() => setParams({ view: null })} />
            <ViewTab label="Gaps" active={view === "gaps"} onClick={() => setParams({ view: "gaps" })} />
            <ViewTab label="Expert" active={view === "expert"} onClick={() => setParams({ view: "expert" })} />
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: filters },
          sort: { onClick: () => setSortOpen((x) => !x), label: sort === "people" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "people" },
          primary: { label: "Add a skill", icon: Plus, onClick: () => setAdding("") },
          menu: canExport ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = "/api/skills/export"; } }] : undefined,
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort skills" selected={sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(v) => { setSortOpen(false); setSort(v as SortKey); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="skills" activeCount={filters} onClearAll={clear}
          search={{ value: q, onChange: setQ, placeholder: "Search skills" }}>
          {depts.length ? (
            <FilterGroup label="Department">
              {depts.map(([id, name]) => <FilterRow key={id} label={name} checked={dept === id} onCheckedChange={(on) => setDept(on ? id : null)} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Ratings">
            <FilterRow label="Rated by a manager" checked={managerRated} onCheckedChange={setManagerRated} />
          </FilterGroup>
        </FilterPanel>
        <div className="min-w-0 flex-1">
          {error && !rows ? (
            <OsEmptyView variant="error" title="Couldn't load skills" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : rows && rows.length === 0 ? (
            <OsEmptyView title="No skills yet. Add yours to get started." action={{ label: "Add a skill", onClick: () => setAdding("") }} />
          ) : (
            <TableCard
              ariaLabel="Skills"
              columns={columns}
              rows={shown}
              rowKey={(r) => r.name}
              onRowClick={(r) => setParams({ skill: r.name })}
              highlightKey={openName}
              footer={rows ? { total: rows.length, noun: "skills", from: shown?.length ? 1 : 0, to: shown?.length ?? 0 } : undefined}
              empty={<span className="text-row text-ink-2">No skills match · <button type="button" className="text-brand-deep hover:underline" onClick={clear}>Clear filters</button></span>}
            />
          )}
        </div>
      </div>
      {open ? (
        <SkillDrawer
          skill={open}
          me={me}
          heldByMe={heldByMe.has(open.name)}
          onClose={() => setParams({ skill: null })}
          onAddMine={() => setAdding(open.name)}
          onChanged={() => void load()}
        />
      ) : null}
      {adding !== null ? (
        <AddSkillDialog userId={me} self held={[...heldByMe]} initialName={adding} onClose={() => setAdding(null)} onAdded={() => { setAdding(null); void load(); }} />
      ) : null}
    </>
  );
}

function SkillDrawer({ skill, me, heldByMe, onClose, onAddMine, onChanged }: {
  skill: SkillRow; me: string; heldByMe: boolean; onClose: () => void; onAddMine: () => void; onChanged: () => void;
}) {
  const [menu, setMenu] = useState<{ holder: Holder; anchor: { current: HTMLElement | null } } | null>(null);
  const [rate, setRate] = useState<Holder | null>(null);
  return (
    <Drawer
      open
      onClose={onClose}
      ariaLabel="Skill"
      layerId="skill-drawer"
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">Skills › <span className="text-ink">{skill.name}</span></span>
          {!heldByMe ? (
            <button type="button" onClick={onAddMine} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><Star className="h-4 w-4" aria-hidden />Add to my skills</button>
          ) : null}
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" /></button>
        </>
      }
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-sm text-ink-2">{skill.holders} {skill.holders === 1 ? "person has" : "people have"} this skill.</p>
        <ul className="os-chrome divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-raised">
          {skill.people.map((p) => {
            const self = ratingLabel(p.selfRating);
            const mgr = ratingLabel(p.managerRating);
            return (
              <li key={p.skillId} className="flex min-h-11 items-center gap-3 px-3">
                <Avatar person={{ id: p.userId, firstName: p.firstName, lastName: p.lastName, avatar: p.avatar }} size={28} />
                <span className="min-w-0 flex-1">
                  <Link href={`/people/${p.userId}?tab=skills&from=skills`} className="block truncate text-row text-ink hover:underline">{personName(p)}</Link>
                  {p.department ? <span className="block truncate text-xs text-ink-2">{p.department.name}</span> : null}
                </span>
                {self || mgr ? <span className="shrink-0 text-sm tabular-nums text-ink-2">{[self ? `Self ${self}` : null, mgr ? `Manager ${mgr}` : null].filter(Boolean).join(" · ")}</span> : null}
                {p.canRate && p.userId !== me ? (
                  <button type="button" aria-label={`Actions for ${personName(p)}`} onClick={(e) => setMenu({ holder: p, anchor: { current: e.currentTarget } })} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={180} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Holder actions">
            <MenuItem label="Rate" onClick={() => { const h = menu.holder; setMenu(null); setRate(h); }} />
          </MenuList>
        </MorePortal>
      ) : null}
      {rate ? (
        <RateSkillDialog
          userId={rate.userId}
          skill={{ id: rate.skillId, name: skill.name, selfRating: rate.selfRating, managerRating: rate.managerRating }}
          mode="manager"
          onClose={() => setRate(null)}
          onRated={() => { setRate(null); onChanged(); }}
        />
      ) : null}
    </Drawer>
  );
}
