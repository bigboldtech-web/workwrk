"use client";

// TemplateCenter: one component, two homes.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/templates) and
// section 3 (`mode: "page" | "modal"`).
//
// WHAT THIS REPLACES, AND WHERE EACH ONE LANDS. Six things called "Templates"
// collapse into this page (critic #3). Nothing loses its door:
//
//   1. /templates, the legacy "Workspace templates" page over
//      /api/workspace-templates (gradient card heads, an "Applied - apply
//      again?" button, errors swallowed into "No templates configured.").
//      Its bundles are the "Starter kits" kind here and still apply through
//      POST /api/workspace-templates/apply.
//   2. The Template Center modal itself, which was modal-only and had no
//      full-size home. It is this same component with mode="page".
//   3. Space "..." > Templates > Browse templates  -> mode="modal" kind SPACE/LIST
//   4. Folder "..." > Templates                    -> mode="modal" kind FOLDER/LIST
//   5. List "..." > Browse templates               -> mode="modal" kind LIST
//   6. CreateListModal / NewFolderDialog "Use a template" -> mode="modal"
//
//   Settings > Task system > Templates keeps its link card at
//   /templates?kind=task; the Docs header "+" points at /templates?kind=doc.
//
// APPLY NAVIGATES, ALWAYS. The old flow had the client decide navigation for
// LIST and SPACE, ignore the other five, and hand the result to a shell
// handler that reacted to TASK alone, so four kinds dead-ended (audit High #6).
// Now the server materializes every kind and src/lib/templates/kinds.ts turns
// the result into one destination, so a card that can be clicked always
// arrives somewhere.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlignLeft, LayoutGrid, MoreHorizontal, Pencil, Rows3, Search, Trash2 } from "lucide-react";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { apiFetch } from "@/lib/api-fetch";
import { INTAKE_TEMPLATES, type IntakeTemplate } from "@/lib/forms/intake-templates";
import { fieldTypeLabel } from "@/lib/forms/builder";
import {
  COMPLEXITIES,
  COMPLEXITY_LABEL,
  TEMPLATE_KINDS,
  TEMPLATE_KIND_BY_KEY,
  appliedToast,
  navigationFor,
  type AppliedTemplate,
  type TemplateComplexity,
  type TemplateKind,
  type TemplateKindKey,
} from "@/lib/templates/kinds";
import { TemplateArtwork } from "./template-art";
import { NewTemplateModal } from "./new-template-modal";
import { EntityCard } from "@/components/ui/entity-card";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Avatar } from "@/components/ui/avatar-stack";
import { Picker } from "@/components/ui/picker";
import { DotsArt } from "@/components/ui/dots-art";
import { Dots } from "@/components/ui/dots";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";

/* ───────────────────────────── data shapes ───────────────────────────── */

interface TemplateRow {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  complexity: TemplateComplexity | null;
  category: string | null;
  useCases: string[];
  tags: string[];
  builtIn: boolean;
  usedCount: number;
  organizationId: string | null;
  createdById: string | null;
  updatedAt: string;
}

interface TemplateDetailRow extends TemplateRow {
  payload: Record<string, unknown>;
}

/** Who saved a "Made here" template, for the card avatar and the filter. */
interface CreatorRef {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  count: number;
}

/** A legacy workspace bundle, rendered as the "Starter kits" kind. */
interface KitRow {
  id: string;
  name: string;
  tagline: string;
  description: string;
  summary: { doc: string; form: string; table: string };
}

interface SpaceRef {
  id: string;
  slug: string;
  name: string;
  icon?: string | null;
  color?: string | null;
}

const SORTS = [
  { value: "popular", label: "Popular" },
  { value: "name", label: "Name" },
  { value: "newest", label: "Newest" },
] as const;
type SortKey = (typeof SORTS)[number]["value"];

export interface TemplateCenterProps {
  mode: "page" | "modal";
  /** Modal mode only. */
  open?: boolean;
  onClose?: () => void;
  /** Pre-filter the kind pills. `null` shows every kind. */
  kind?: TemplateKindKey | null;
  /** The page's `?q=`, so a search link lands on a searched page. */
  initialQuery?: string;
  /** Page mode: the pills write `?kind=` so a scoped view is a link. */
  onKindChange?: (kind: TemplateKindKey | null) => void;
  /** The container an apply lands in, when the caller already knows it. */
  target?: { spaceId?: string | null; folderId?: string | null; boardId?: string | null };
  /** Told what was applied and where it went, after this component navigated. */
  onApplied?: (result: AppliedTemplate) => void;
  /** Stored per person: Show built-in, the grid-or-list choice, sort, kind. */
  initialShowBuiltIn?: boolean;
  initialLayout?: "grid" | "list";
}

export function TemplateCenter(props: TemplateCenterProps) {
  if (props.mode === "modal" && !props.open) return null;
  return <TemplateCenterBody {...props} />;
}

function TemplateCenterBody({
  mode,
  onClose,
  kind: kindProp = null,
  initialQuery = "",
  onKindChange,
  target,
  onApplied,
  initialShowBuiltIn = true,
  initialLayout = "grid",
}: TemplateCenterProps) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { patchPrefs } = useOsShell();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [creators, setCreators] = useState<CreatorRef[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [kits, setKits] = useState<KitRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const [kind, setKind] = useState<TemplateKindKey | null>(kindProp);
  const [query, setQuery] = useState(initialQuery);
  const [sources, setSources] = useState<Array<"builtin" | "made-here">>([]);
  const [complexities, setComplexities] = useState<TemplateComplexity[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  /** "Created by": which people's "Made here" templates to show. */
  const [createdBy, setCreatedBy] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("popular");
  const [layout, setLayout] = useState<"grid" | "list">(initialLayout);
  const [showBuiltIn, setShowBuiltIn] = useState(initialShowBuiltIn);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);

  const [me, setMe] = useState<{ userId: string | null; isOrgAdmin: boolean }>({ userId: null, isOrgAdmin: false });
  const [detail, setDetail] = useState<TemplateDetailRow | null>(null);
  const [detailKit, setDetailKit] = useState<KitRow | null>(null);
  const [detailIntake, setDetailIntake] = useState<IntakeTemplate | null>(null);
  const [spaces, setSpaces] = useState<SpaceRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  // The kind prop is the caller's scope in modal mode, and the URL's ?kind= on
  // the page. Either way an external change re-scopes the grid.
  useEffect(() => { setKind(kindProp); }, [kindProp]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200" });
    if (query.trim()) params.set("q", query.trim());
    const [tplRes, kitRes] = await Promise.all([
      apiFetch<{ templates: TemplateRow[]; hasMore?: boolean; creators?: CreatorRef[] }>(`/api/template-center?${params}`, { cache: "no-store" }),
      apiFetch<{ data?: KitRow[] } | KitRow[]>("/api/workspace-templates", { cache: "no-store" }),
    ]);
    if (!tplRes.ok) {
      // "Couldn't load templates" and "there are none" are different sentences;
      // the legacy page printed the second one for both.
      setFailed(tplRes.error);
      return;
    }
    setRows(tplRes.data.templates ?? []);
    setCreators(tplRes.data.creators ?? []);
    setTruncated(tplRes.data.hasMore === true);
    // A starter kit is a whole extra source; failing to reach it must not hide
    // the templates that did load, so it degrades to an empty kind.
    const kitData = kitRes.ok ? kitRes.data : [];
    setKits(Array.isArray(kitData) ? kitData : (kitData as { data?: KitRow[] }).data ?? []);
    setFailed(null);
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  // Who the viewer is, so the "Made here" row menu renders for the people who
  // may actually use it. It rendered for everybody and was gated only by the
  // API's 403, which is a control that fails after the click.
  useEffect(() => {
    let live = true;
    void apiFetch<{ viewer?: { id?: string; orgRole?: string } }>("/api/boot", { cache: "no-store" }).then((res) => {
      if (!live || !res.ok) return;
      const v = res.data.viewer ?? {};
      setMe({ userId: v.id ?? null, isOrgAdmin: v.orgRole === "OWNER" || v.orgRole === "ADMIN" });
    });
    return () => { live = false; };
  }, []);

  // Spaces are only needed when an apply has to ask where to put the thing.
  useEffect(() => {
    if (target?.spaceId) return;
    let live = true;
    void apiFetch<{ spaces: SpaceRef[] }>("/api/spaces", { cache: "no-store" }).then((res) => {
      if (live && res.ok) setSpaces(res.data.spaces ?? []);
    });
    return () => { live = false; };
  }, [target?.spaceId]);

  const persistDisplay = useCallback(
    (next: { showBuiltIn: boolean; layout: "grid" | "list" }) => {
      void patchPrefs({ home: { work: { surface: { templates: { viewOptions: next } } } } });
    },
    [patchPrefs],
  );

  /* ─────────────────────── the visible set ─────────────────────── */

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.category) set.add(r.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  /**
   * Every card the current filters allow, BEFORE the kind pill narrows it.
   *
   * The pill counts used to be the server's unfiltered groupBy over the whole
   * library while the body applied "Show built-in", Source, Complexity,
   * Category and the search box in the browser, so switching built-ins off
   * left "Spaces 8" beside an empty state reading "No spaces templates yet".
   * One pass produces both now: a pill can never advertise a row the body
   * does not contain.
   */
  const candidates = useMemo((): CardModel[] => {
    const out: CardModel[] = [];
    const q = query.trim().toLowerCase();

    for (const r of rows ?? []) {
      if (!showBuiltIn && r.builtIn) continue;
      if (sources.length) {
        const ok = sources.some((src) => (src === "builtin" ? r.builtIn : !r.builtIn));
        if (!ok) continue;
      }
      if (complexities.length && (!r.complexity || !complexities.includes(r.complexity))) continue;
      if (categories.length && (!r.category || !categories.includes(r.category))) continue;
      // "Created by" is a property only a "Made here" row has, so a built-in
      // never matches it rather than matching every name.
      if (createdBy.length && (!r.createdById || !createdBy.includes(r.createdById))) continue;
      out.push({
        key: `t-${r.id}`,
        kindKey: r.kind,
        name: r.name,
        description: r.description,
        builtIn: r.builtIn,
        usedCount: r.usedCount,
        updatedAt: r.updatedAt,
        template: r,
      });
    }

    // A Starter kit is a built-in bundle with no complexity and no category,
    // so those filters exclude it rather than matching it loosely.
    if ((!sources.length || sources.includes("builtin")) && showBuiltIn && !complexities.length && !categories.length && !createdBy.length) {
      for (const k of kits ?? []) {
        if (q && !`${k.name} ${k.tagline}`.toLowerCase().includes(q)) continue;
        out.push({
          key: `k-${k.id}`,
          kindKey: "KIT",
          name: k.name,
          description: k.tagline,
          builtIn: true,
          usedCount: 0,
          updatedAt: "",
          kit: k,
        });
      }
    }
    // Intake forms: built in, like the kits, so the same filters exclude them.
    if ((!sources.length || sources.includes("builtin")) && showBuiltIn && !complexities.length && !categories.length && !createdBy.length) {
      for (const t of INTAKE_TEMPLATES) {
        if (q && !`${t.name} ${t.tagline}`.toLowerCase().includes(q)) continue;
        out.push({ key: `f-${t.id}`, kindKey: "FORM", name: t.name, description: t.tagline, builtIn: true, usedCount: 0, updatedAt: "", intake: t });
      }
    }
    return out;
  }, [rows, kits, showBuiltIn, sources, complexities, categories, createdBy, query]);

  const creatorById = useMemo(() => new Map(creators.map((c) => [c.id, c])), [creators]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of candidates) out[c.kindKey] = (out[c.kindKey] ?? 0) + 1;
    return out;
  }, [candidates]);

  const cards = useMemo((): CardModel[] => {
    const out = candidates.filter((c) => kind === null || c.kindKey === kind);
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "newest") out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    else out.sort((a, b) => b.usedCount - a.usedCount || a.name.localeCompare(b.name));
    return out;
  }, [candidates, kind, sort]);


  const activeFilters = sources.length + complexities.length + categories.length + createdBy.length;

  /* ─────────────────────────── the apply ─────────────────────────── */

  const openDetail = useCallback(async (card: CardModel) => {
    if (card.kit) { setDetailKit(card.kit); return; }
    if (card.intake) { setDetailIntake(card.intake); return; }
    if (!card.template) return;
    const res = await apiFetch<{ template: TemplateDetailRow }>(`/api/template-center/${card.template.id}`, { cache: "no-store" });
    if (!res.ok) { toast("Couldn't open that template", { tone: "danger", description: res.error }); return; }
    setDetail(res.data.template);
  }, [toast]);

  const finish = useCallback(
    (result: AppliedTemplate) => {
      const href = navigationFor(result);
      setDetail(null);
      setDetailKit(null);
      setDetailIntake(null);
      if (mode === "modal") onClose?.();
      onApplied?.(result);
      if (href) { router.push(href); return; }
      // Nothing to navigate to means a Starter kit (three objects, no single
      // page). The toast names all three and its one action opens the first,
      // so what was just created always has a door out of the flow.
      const first = result.created?.[0];
      toast(appliedToast(result), first ? { action: { label: "Open", onClick: () => router.push(first.href) } } : undefined);
    },
    [mode, onClose, onApplied, router, toast],
  );

  const applyTemplate = useCallback(
    async (tpl: TemplateDetailRow, body: Record<string, unknown>) => {
      setBusy(true);
      const res = await apiFetch<AppliedTemplate>(`/api/template-center/${tpl.id}/apply`, { method: "POST", json: body });
      setBusy(false);
      if (!res.ok) { toast("Couldn't use that template", { tone: "danger", description: res.error }); return; }
      finish({ ...res.data, kind: tpl.kind, name: tpl.name });
    },
    [finish, toast],
  );

  const applyKit = useCallback(
    async (kit: KitRow) => {
      setBusy(true);
      // The route answers `created` as an OBJECT keyed by kind, not an array.
      // Typing it as an array meant the `?? [fallback]` never fired (an object
      // is truthy) and `appliedToast`'s `.map` threw inside an async click
      // handler: no toast, no navigation, and the Doc, Form and Table it had
      // just created had no door out of the flow.
      const res = await apiFetch<{
        created?: {
          doc?: { id: string; title?: string | null } | null;
          form?: { id: string; name?: string | null } | null;
          table?: { id: string; name?: string | null } | null;
        };
      }>("/api/workspace-templates/apply", {
        method: "POST",
        json: { templateId: kit.id },
      });
      setBusy(false);
      if (!res.ok) { toast("Couldn't apply that starter kit", { tone: "danger", description: res.error }); return; }
      const made = res.data.created ?? {};
      // A kit makes three things and has no page of its own, so the toast
      // names what it made and links each one to the page it lives on.
      const created: Array<{ label: string; href: string }> = [
        made.doc ? { label: made.doc.title || kit.summary.doc, href: `/docs/${made.doc.id}` } : { label: kit.summary.doc, href: "/docs" },
        made.form ? { label: made.form.name || kit.summary.form, href: `/forms/${made.form.id}` } : { label: kit.summary.form, href: "/forms" },
        made.table ? { label: made.table.name || kit.summary.table, href: `/tables/${made.table.id}` } : { label: kit.summary.table, href: "/tables" },
      ];
      finish({ kind: "KIT", created });
    },
    [finish, toast],
  );

  /** An intake template becomes an ordinary form, opened in the builder. */
  const applyIntake = useCallback(
    async (t: IntakeTemplate) => {
      setBusy(true);
      const res = await apiFetch<{ id: string }>("/api/forms", { method: "POST", json: { name: t.name, description: t.description, fields: t.fields } });
      setBusy(false);
      if (!res.ok) { toast("Couldn't create the form", { tone: "danger", description: res.error }); return; }
      window.dispatchEvent(new CustomEvent("workwrk:forms-changed"));
      finish({ kind: "FORM", formId: res.data.id, name: t.name });
    },
    [finish, toast],
  );

  const renameTemplate = useCallback(
    async (row: TemplateRow) => {
      const next = await prompt({
        title: "Rename template",
        placeholder: "Template name",
        defaultValue: row.name,
        submitLabel: "Save",
        required: true,
      });
      if (next === null || !next.trim() || next.trim() === row.name) return;
      const res = await apiFetch(`/api/template-center/${row.id}`, { method: "PATCH", json: { name: next.trim() } });
      if (!res.ok) { toast("Couldn't rename that template", { tone: "danger", description: res.error }); return; }
      toast("Template renamed");
      void load();
    },
    [prompt, toast, load],
  );

  const describeTemplate = useCallback(
    async (row: TemplateRow) => {
      const next = await prompt({
        title: "Edit description",
        placeholder: "What is this template for?",
        defaultValue: row.description ?? "",
        submitLabel: "Save",
      });
      if (next === null) return;
      const res = await apiFetch(`/api/template-center/${row.id}`, { method: "PATCH", json: { description: next } });
      if (!res.ok) { toast("Couldn't save that description", { tone: "danger", description: res.error }); return; }
      toast("Description saved");
      void load();
    },
    [prompt, toast, load],
  );

  const deleteTemplate = useCallback(
    async (row: TemplateRow) => {
      const ok = await confirm({
        title: "Delete template",
        description: `Delete "${row.name}"? Anything already created from it is untouched.`,
        destructive: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      const res = await apiFetch(`/api/template-center/${row.id}`, { method: "DELETE" });
      if (!res.ok) { toast("Couldn't delete that template", { tone: "danger", description: res.error }); return; }
      toast(`${row.name} deleted`);
      void load();
    },
    [confirm, toast, load],
  );

  /* ──────────────────────────── the chrome ──────────────────────────── */

  // Every kind gets a pill, including the ones with nothing behind them: the
  // vocabulary is stable, and an empty kind shows its own empty state rather
  // than disappearing from the row (spec section 2). The number beside each
  // one is counted over the SAME filtered set the grid renders.
  const pickKind = (next: TemplateKindKey | null) => {
    setKind(next);
    onKindChange?.(next);
  };
  const kindPills = (
    <>
      <ViewTab label="All" active={kind === null} onClick={() => pickKind(null)} />
      {TEMPLATE_KINDS.map((k) => {
        const n = counts[k.key] ?? 0;
        return (
          <ViewTab
            key={k.key}
            label={k.plural}
            active={kind === k.key}
            onClick={() => pickKind(k.key)}
            trailing={n > 0 ? <span className="text-xs tabular-nums text-ink-3">{n}</span> : undefined}
          />
        );
      })}
    </>
  );

  const grid = (
    <TemplateGrid
      cards={cards}
      layout={layout}
      loading={rows === null && failed === null}
      failed={failed}
      onRetry={() => void load()}
      onOpen={openDetail}
      onDelete={deleteTemplate}
      onRename={renameTemplate}
      onDescribe={describeTemplate}
      // The same rule the DELETE and PATCH routes enforce, so the control is
      // absent where it would 403 rather than failing after the click.
      creatorOf={(card) =>
        card.builtIn || !card.template?.createdById
          ? null
          : creatorById.get(card.template.createdById) ?? null
      }
      canManage={(card) =>
        Boolean(card.template) &&
        !card.builtIn &&
        (me.isOrgAdmin || (me.userId !== null && card.template?.createdById === me.userId))
      }
      kind={kind}
      onClearFilters={activeFilters ? () => { setSources([]); setComplexities([]); setCategories([]); } : null}
    />
  );

  const filters = filterOpen ? (
    <FilterPanel
      open
      onClose={() => setFilterOpen(false)}
      objects="templates"
      activeCount={activeFilters}
      onClearAll={() => { setSources([]); setComplexities([]); setCategories([]); setCreatedBy([]); }}
    >
      <FilterRow label="Built-in" checked={sources.includes("builtin")} onCheckedChange={(on) => setSources((p) => (on ? [...p, "builtin"] : p.filter((v) => v !== "builtin")))} />
      <FilterRow label="Made here" checked={sources.includes("made-here")} onCheckedChange={(on) => setSources((p) => (on ? [...p, "made-here"] : p.filter((v) => v !== "made-here")))} />
      {COMPLEXITIES.map((c) => (
        <FilterRow
          key={c}
          label={COMPLEXITY_LABEL[c]}
          checked={complexities.includes(c)}
          onCheckedChange={(on) => setComplexities((p) => (on ? [...p, c] : p.filter((v) => v !== c)))}
        />
      ))}
      {allCategories.map((c) => (
        <FilterRow
          key={c}
          label={c}
          checked={categories.includes(c)}
          onCheckedChange={(on) => setCategories((p) => (on ? [...p, c] : p.filter((v) => v !== c)))}
        />
      ))}
      {/* "Created by" (spec section 2). It is absent when nobody here has
          saved a template, rather than an empty heading. */}
      {creators.length ? (
        <FilterGroup label="Created by">
          {creators.map((c) => (
            <FilterRow
              key={c.id}
              label={
                <span className="flex items-center gap-2">
                  <Avatar person={c} size={20} />
                  <span className="truncate">{c.name}</span>
                </span>
              }
              count={c.count}
              checked={createdBy.includes(c.id)}
              onCheckedChange={(on) => setCreatedBy((p) => (on ? [...p, c.id] : p.filter((v) => v !== c.id)))}
            />
          ))}
        </FilterGroup>
      ) : null}
    </FilterPanel>
  ) : null;

  const pickers = (
    <div className="relative">
      {sortOpen ? (
        <div className="absolute start-[110px] top-0 z-40">
          <Picker
            open
            onClose={() => setSortOpen(false)}
            ariaLabel="Sort templates"
            selected={sort}
            sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
            onSelect={(v) => { setSortOpen(false); setSort(v as SortKey); }}
          />
        </div>
      ) : null}
      {displayOpen ? (
        <div className="absolute end-6 top-0 z-40">
          <Picker
            open
            onClose={() => setDisplayOpen(false)}
            ariaLabel="Display options"
            align="end"
            width={260}
            multi
            selected={showBuiltIn ? ["builtin"] : []}
            sections={[{ label: "Display", options: [{ value: "builtin", label: "Show built-in templates" }] }]}
            onSelect={() => {
              const next = !showBuiltIn;
              setShowBuiltIn(next);
              persistDisplay({ showBuiltIn: next, layout });
            }}
          />
        </div>
      ) : null}
    </div>
  );

  const toolbar = {
    filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
    sort: { onClick: () => setSortOpen((v) => !v), label: sort === "popular" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "popular" },
    switcher: {
      value: layout,
      options: [
        { key: "grid", label: "Grid", icon: LayoutGrid },
        { key: "list", label: "List", icon: Rows3 },
      ],
      onChange: (v: string) => {
        const next = v === "list" ? "list" : "grid";
        setLayout(next);
        persistDisplay({ showBuiltIn, layout: next });
      },
    },
    left: (
      <label className="inline-flex h-9 min-w-0 items-center gap-2 rounded-lg border border-line px-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates"
          aria-label="Search templates"
          className="w-[180px] min-w-0 bg-transparent text-base outline-none placeholder:text-ink-3"
        />
      </label>
    ),
    menu: [{ label: "Display", onClick: () => setDisplayOpen(true) }],
    // The one blue button. Saving starts from an object, so "Save current as
    // template" is not here; "New template" opens the picker of things the
    // viewer can save, and the modal itself says so when that list is empty.
    ...(mode === "page" ? { primary: { label: "New template", onClick: () => setNewOpen(true) } } : {}),
  };

  if (mode === "page") {
    return (
      <>
        <OsPageHeader title="Templates" views={kindPills} toolbar={toolbar} />
        {pickers}
        <div className="flex min-h-0 flex-1">
          {filters}
          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
            {grid}
            {truncated ? (
              /* The read takes 200 rows. Saying so beats a library that looks
                 complete and is not. */
              <p className="mt-3 px-1 text-sm text-ink-3">
                Showing the first 200 templates. Search or filter to narrow the list.
              </p>
            ) : null}
          </div>
        </div>
        <DetailModal
          // The form resets by REMOUNTING when the template changes, rather
          // than by an effect writing state after the first render.
          key={`${detail?.id ?? detailKit?.id ?? detailIntake?.id ?? "none"}:${target?.spaceId ?? ""}`}
          detail={detail}
          kit={detailKit}
          intake={detailIntake}
          busy={busy}
          target={target}
          spaces={spaces}
          onClose={() => { setDetail(null); setDetailKit(null); setDetailIntake(null); }}
          onUse={applyTemplate}
          onUseKit={applyKit}
          onUseIntake={applyIntake}
        />
        <NewTemplateModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={() => void load()} />
      </>
    );
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-[960px] p-0">
        <DialogHeader className="border-b border-line px-5 py-3">
          <DialogTitle>Templates</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-5 py-2">{kindPills}</div>
        <div className="max-h-[60vh] min-h-[280px] overflow-y-auto p-5">{grid}</div>
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <Link href="/templates" className="text-base font-medium text-brand-deep hover:underline" onClick={() => onClose?.()}>
            Open the Templates page
          </Link>
          <button type="button" onClick={() => onClose?.()} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-base text-ink hover:bg-hover">
            Cancel
          </button>
        </div>
        <DetailModal
          // The form resets by REMOUNTING when the template changes, rather
          // than by an effect writing state after the first render.
          key={`${detail?.id ?? detailKit?.id ?? detailIntake?.id ?? "none"}:${target?.spaceId ?? ""}`}
          detail={detail}
          kit={detailKit}
          intake={detailIntake}
          busy={busy}
          target={target}
          spaces={spaces}
          onClose={() => { setDetail(null); setDetailKit(null); setDetailIntake(null); }}
          onUse={applyTemplate}
          onUseKit={applyKit}
          onUseIntake={applyIntake}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── the grid ───────────────────────────── */

interface CardModel {
  key: string;
  kindKey: TemplateKindKey;
  name: string;
  description: string | null;
  builtIn: boolean;
  usedCount: number;
  updatedAt: string;
  template?: TemplateRow;
  kit?: KitRow;
  intake?: IntakeTemplate;
}

function TemplateGrid({
  cards,
  layout,
  loading,
  failed,
  onRetry,
  onOpen,
  onDelete,
  onRename,
  onDescribe,
  canManage,
  creatorOf,
  kind,
  onClearFilters,
}: {
  cards: CardModel[];
  layout: "grid" | "list";
  loading: boolean;
  failed: string | null;
  onRetry: () => void;
  /** The person who saved a "Made here" card, or null when it is built-in. */
  creatorOf: (c: CardModel) => CreatorRef | null;
  onOpen: (card: CardModel) => void;
  onDelete: (row: TemplateRow) => void;
  onRename: (row: TemplateRow) => void;
  onDescribe: (row: TemplateRow) => void;
  /** Creator, Admin and Owner only: the spec's "Made here" row menu. */
  canManage: (card: CardModel) => boolean;
  kind: TemplateKindKey | null;
  onClearFilters: (() => void) | null;
}) {
  if (failed) {
    return <OsEmptyView variant="error" title="Couldn't load templates" hint={failed} action={{ label: "Retry", onClick: onRetry }} />;
  }
  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-line bg-raised p-4">
            <div className="os-skeleton-pulse h-24 rounded-md bg-skeleton" />
            <div className="os-skeleton-pulse mt-3 h-3.5 w-2/3 rounded bg-skeleton" />
            <div className="os-skeleton-pulse mt-2 h-3 w-1/2 rounded bg-skeleton" />
          </div>
        ))}
      </div>
    );
  }
  if (cards.length === 0) {
    if (onClearFilters) {
      return (
        <div className="flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4 text-base text-ink-2">
          No results
          <button type="button" onClick={onClearFilters} className="font-medium text-brand-deep hover:underline">Clear filters</button>
        </div>
      );
    }
    const def = kind ? TEMPLATE_KIND_BY_KEY[kind] : null;
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <DotsArt arrangement="grid" size={64} />
        {/* The SINGULAR word, because the sentence is about one template:
            lower-casing the pill's plural produced "No spaces templates yet"
            and "No canvases templates yet". */}
        <p className="text-base font-medium text-ink">{def ? `No ${def.label.toLowerCase()} templates yet` : "No templates yet"}</p>
        <p className="max-w-[44ch] text-base text-ink-2">{def ? def.emptyHint : "Save one from a list's or a Space's … menu."}</p>
      </div>
    );
  }

  if (layout === "list") {
    return (
      <div className="os-row overflow-hidden rounded-lg border border-line bg-raised">
        {cards.map((c) => (
          /* A row, not a <button>: the "…" has to live inside it, and a button
             inside a button is invalid. Switching to the List layout used to
             drop the only control a "Made here" card had, so a person who had
             persisted layout:"list" could not remove a template they made. */
          <div
            key={c.key}
            className="flex w-full items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover"
            style={{ minHeight: "var(--os-row-h)" }}
          >
            <button type="button" onClick={() => onOpen(c)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
              <TemplateArtwork art={TEMPLATE_KIND_BY_KEY[c.kindKey].art} size={28} />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.name}</span>
            </button>
            <span className="inline-flex h-[22px] shrink-0 items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">
              {TEMPLATE_KIND_BY_KEY[c.kindKey].label}
            </span>
            {/* The spec's card carries the creator's 20px AVATAR for a
                "Made here" row, not the literal words. The words stay as the
                avatar's label so the row still reads when the person who
                saved it has since left and there is nobody to draw. */}
            <span className="flex w-20 shrink-0 items-center gap-1.5">
              {!c.builtIn ? (
                (() => {
                  const who = creatorOf(c);
                  return who
                    ? <><Avatar person={who} size={20} /><span className="truncate text-sm text-ink-2">{who.name}</span></>
                    : <span className="truncate text-sm text-ink-2">Made here</span>;
                })()
              ) : null}
            </span>
            <span className="flex w-8 shrink-0 justify-end">
              {canManage(c) && c.template ? (
                <TemplateRowMenu row={c.template} onRename={onRename} onDescribe={onDescribe} onDelete={onDelete} />
              ) : null}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
      {cards.map((c) => (
        <EntityCard
          key={c.key}
          variant="template"
          media={<TemplateArtwork art={TEMPLATE_KIND_BY_KEY[c.kindKey].art} />}
          title={c.name}
          subtitle={c.description}
          onClick={() => onOpen(c)}
          meta={
            <>
              <span className="inline-flex h-[22px] shrink-0 items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">
                {TEMPLATE_KIND_BY_KEY[c.kindKey].label}
              </span>
              {!c.builtIn ? (
                (() => {
                  const who = creatorOf(c);
                  return who
                    ? <span className="flex min-w-0 items-center gap-1.5"><Avatar person={who} size={20} /><span className="truncate text-xs text-ink-2">{who.name}</span></span>
                    : <span className="truncate text-xs text-ink-2">Made here</span>;
                })()
              ) : null}
            </>
          }
          menu={
            canManage(c) && c.template ? (
              <TemplateRowMenu row={c.template} onRename={onRename} onDescribe={onDescribe} onDelete={onDelete} />
            ) : null
          }
        />
      ))}
    </div>
  );
}

/**
 * The "Made here" row "…": Rename, Edit description, Delete.
 *
 * It was a single Trash icon, in the Grid layout only, rendered for every
 * viewer and gated purely by the API's 403. Rename and Edit description had no
 * door anywhere in the product.
 */
function TemplateRowMenu({
  row,
  onRename,
  onDescribe,
  onDelete,
}: {
  row: TemplateRow;
  onRename: (row: TemplateRow) => void;
  onDescribe: (row: TemplateRow) => void;
  onDelete: (row: TemplateRow) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={`More actions for ${row.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-raised text-ink-2 hover:bg-active hover:text-ink"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={200} open={open} placement="below">
        <MenuList className="min-w-[200px]" onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={Pencil} label="Rename" onClick={() => { close(); onRename(row); }} />
          <MenuItem icon={AlignLeft} label="Edit description" onClick={() => { close(); onDescribe(row); }} />
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { close(); onDelete(row); }} />
        </MenuList>
      </MorePortal>
    </span>
  );
}

/* ──────────────────────── the 720 detail modal ──────────────────────── */

function DetailModal({
  detail,
  kit,
  intake,
  busy,
  target,
  spaces,
  onClose,
  onUse,
  onUseKit,
  onUseIntake,
}: {
  detail: TemplateDetailRow | null;
  kit: KitRow | null;
  intake?: IntakeTemplate | null;
  busy: boolean;
  target: TemplateCenterProps["target"];
  spaces: SpaceRef[];
  onClose: () => void;
  onUse: (tpl: TemplateDetailRow, body: Record<string, unknown>) => void;
  onUseKit: (kit: KitRow) => void;
  onUseIntake?: (t: IntakeTemplate) => void;
}) {
  const [spaceId, setSpaceId] = useState<string>(target?.spaceId ?? "");
  const [includeSamples, setIncludeSamples] = useState(false);

  if (intake) {
    return (
      <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader><DialogTitle>{intake.name}</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">Intake form</span>
          </div>
          <p className="text-base text-ink-2">{intake.description}</p>
          <div className="mt-2 space-y-1.5">
            {intake.fields.map((fl) => (
              <IncludeLine key={fl.id} label={fl.label || "Question"} value={`${fieldTypeLabel(fl.type)}${fl.required ? " · required" : ""}`} />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onUseIntake?.(intake)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-base font-medium text-white disabled:opacity-60"
            >
              {busy ? <Dots variant="pending" /> : null} Use template
            </button>
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-base text-ink hover:bg-hover">
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (kit) {
    return (
      <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader><DialogTitle>{kit.name}</DialogTitle></DialogHeader>
          <p className="text-base text-ink-2">{kit.description}</p>
          <div className="mt-2 space-y-1.5">
            <IncludeLine label="Doc" value={kit.summary.doc} />
            <IncludeLine label="Form" value={kit.summary.form} />
            <IncludeLine label="Table" value={kit.summary.table} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onUseKit(kit)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-base font-medium text-white disabled:opacity-60"
            >
              {busy ? <Dots variant="pending" /> : null} Use template
            </button>
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-base text-ink hover:bg-hover">
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!detail) return null;

  const def = TEMPLATE_KIND_BY_KEY[detail.kind];
  const payload = detail.payload ?? {};
  const statuses = asArray<{ label?: string; value?: string; color?: string }>(payload.statuses);
  const fields = asArray<{ label?: string }>(payload.fields);
  const views = asArray<{ name?: string; type?: string }>(payload.views);
  const items = asArray<unknown>(payload.items);

  // Which container the apply needs, and whether we already have it.
  const needsSpace = def.target === "space" || def.target === "space-or-folder";
  const needsBoard = def.target === "list";
  const haveSpace = Boolean(target?.spaceId || spaceId);
  const haveBoard = Boolean(target?.boardId);
  const blocked = (needsSpace && !haveSpace) || (needsBoard && !haveBoard);

  const body: Record<string, unknown> = {
    ...(target?.spaceId || spaceId ? { spaceId: target?.spaceId ?? spaceId } : {}),
    ...(target?.folderId ? { folderId: target.folderId } : {}),
    ...(target?.boardId ? { boardId: target.boardId } : {}),
    ...(items.length ? { includeSamples } : {}),
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader><DialogTitle>{detail.name}</DialogTitle></DialogHeader>

        <div className="flex items-center gap-2">
          <span className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">{def.label}</span>
          {detail.complexity ? (
            <span className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">
              {COMPLEXITY_LABEL[detail.complexity]}
            </span>
          ) : null}
          {!detail.builtIn ? <span className="text-xs text-ink-2">Made here</span> : null}
        </div>

        {detail.description ? <p className="text-base leading-relaxed text-ink-2">{detail.description}</p> : null}

        {statuses.length || fields.length || views.length ? (
          <div className="mt-1 space-y-1.5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Includes</h3>
            {statuses.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {statuses.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex h-[22px] items-center rounded-md px-1.5 text-xs font-medium"
                    style={
                      s.color
                        ? { background: `${s.color}1f`, color: s.color }
                        : { background: "var(--os-surface-2)", color: "var(--os-ink-2)" }
                    }
                  >
                    {s.label ?? s.value}
                  </span>
                ))}
              </div>
            ) : null}
            {fields.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {fields.map((f, i) => (
                  <span key={i} className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">{f.label ?? "Field"}</span>
                ))}
              </div>
            ) : null}
            {views.length ? <p className="text-sm text-ink-2">Views: {views.map((v) => v.name ?? v.type).join(", ")}</p> : null}
          </div>
        ) : null}

        {needsSpace && !target?.spaceId ? (
          <label className="mt-1 block">
            <span className="text-sm font-medium text-ink-2">Where should it go?</span>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-line bg-raised px-2 text-base text-ink"
            >
              <option value="">Pick a Space</option>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        ) : null}

        {needsBoard && !haveBoard ? (
          <p className="text-base text-ink-2">
            Open the list you want this view on, then use &ldquo;Browse templates&rdquo; from its &ldquo;…&rdquo; menu.
          </p>
        ) : null}

        {items.length ? (
          <label className="flex items-center gap-2 text-base text-ink">
            <input type="checkbox" checked={includeSamples} onChange={(e) => setIncludeSamples(e.target.checked)} className="h-4 w-4" />
            Include {items.length} sample task{items.length === 1 ? "" : "s"}
          </label>
        ) : null}

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={busy || blocked}
            onClick={() => onUse(detail, body)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-base font-medium text-white disabled:opacity-60"
          >
            {busy ? <Dots variant="pending" /> : null} Use template
          </button>
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-base text-ink hover:bg-hover">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IncludeLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
      <span className="text-base font-medium text-ink">{label}</span>
      <span className="min-w-0 truncate text-base text-ink-2">{value}</span>
    </div>
  );
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
