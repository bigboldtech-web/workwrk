"use client";

// Build apps (spec-tools-misc 2.3): small apps of your own, made by
// describing them. Owner and Admin only (the layout's app-key gate).
//
// What changed: there is a way to build an app again. "New app" opens a
// two-step modal: describe it and Generate (POST /api/build/generate, which
// saves nothing), then check the fields and Create app (POST /api/build/apps).
// "Start blank" skips straight to the fields. Nothing is written until
// Create app. "Show archived" is real (?includeArchived=1 on the API, which
// used to exclude archived apps server side so the checkbox could never show
// anything), and an archived app can be restored. The KPI tiles (including
// the Drafts tile that was always 0), the hashed hue palette, the Agents
// header link and the page-local search go; search is ?q= on the API.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Hammer, MoreHorizontal, Plus, Search, X, ArchiveRestore, Archive, ExternalLink, Wand2 } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { ViewTab } from "@/components/ui/view-tabs";
import { Dots } from "@/components/ui/dots";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import {
  FIELD_TYPES, FIELD_TYPE_LABEL, blankDraft, draftFromGenerated, draftProblem, slugify, uniqueFieldKey,
  type AppDraft, type FieldType,
} from "@/lib/build/app-draft";

type AppStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type ApiApp = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  status: AppStatus;
  rowCount: number;
  updatedAt: string;
  /** Archive and Restore: Owner and Admin, or the app's creator. */
  canManage?: boolean;
};
type Tab = "all" | "published" | "drafts";

const STATUS: Record<AppStatus, { label: string; color: string }> = {
  PUBLISHED: { label: "Published", color: "#1F8F4E" },
  DRAFT: { label: "Draft", color: "#6B7280" },
  ARCHIVED: { label: "Archived", color: "#6B7280" },
};

const EXAMPLES = [
  "A register of our company vehicles, with the plate, the driver, the service date and whether it is on the road.",
  "Visitor log for the front desk: name, company, host, time in and time out.",
  "A list of supplier contracts with the renewal date, the owner and the yearly cost.",
];

export default function BuildAppsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();

  const includeArchived = sp?.get("archived") === "1";
  const [q, setQ] = useState(sp?.get("q") ?? "");
  const [tab, setTab] = useState<Tab>("all");
  const [apps, setApps] = useState<ApiApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ app: ApiApp; anchor: { current: HTMLElement | null } } | null>(null);
  const [newOpen, setNewOpen] = useState<null | "describe" | "blank">(null);
  // New app and Generate are Owner and Admin (the API says which). A Member
  // here holds only the apps they created (the creator exception).
  const [canCreate, setCanCreate] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (includeArchived) params.set("includeArchived", "1");
    if (q.trim()) params.set("q", q.trim());
    const r = await apiFetch<{ apps: ApiApp[]; canCreate?: boolean }>(`/api/build/apps?${params}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setApps(r.data.apps);
    setCanCreate(r.data.canCreate !== false);
  }, [includeArchived, q]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const setArchived = (on: boolean) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    if (on) next.set("archived", "1"); else next.delete("archived");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const shown = useMemo(() => {
    if (!apps) return null;
    if (tab === "published") return apps.filter((a) => a.status === "PUBLISHED");
    if (tab === "drafts") return apps.filter((a) => a.status === "DRAFT");
    return apps;
  }, [apps, tab]);

  async function archive(a: ApiApp) {
    const ok = await confirm({ title: `Archive ${a.name}?`, description: "It leaves this list and its rows stop changing. Show archived brings it back, and you can restore it.", confirmLabel: "Archive", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/build/apps/${a.slug}`, { method: "DELETE" });
    if (!r.ok) { toast("Couldn't archive the app", { tone: "danger" }); return; }
    toast(`${a.name} archived`, { action: { label: "Undo", onClick: () => void restore(a) } });
    void load();
  }
  async function restore(a: ApiApp) {
    const r = await apiFetch(`/api/build/apps/${a.slug}`, { method: "PATCH", json: { status: "PUBLISHED" } });
    if (!r.ok) { toast("Couldn't restore the app", { tone: "danger" }); return; }
    toast(`${a.name} restored`);
    void load();
  }

  const columns = useMemo<TableColumn<ApiApp>[]>(() => [
    { key: "name", label: "App", title: true, width: "minmax(220px,1fr)", render: (a) => (
      <span className="flex min-w-0 items-center gap-2">
        <EntityTile size="sm" icon={Hammer} {...NEUTRAL_TILE} />
        <span className="truncate">{a.name}</span>
      </span>
    ) },
    { key: "description", label: "Description", width: "minmax(200px,1.4fr)", className: "max-lg:hidden", render: (a) => <span className="truncate text-sm text-ink-2">{a.description || "No description"}</span> },
    { key: "status", label: "Status", width: "130px", render: (a) => <StatusChip disabled color={STATUS[a.status].color} label={STATUS[a.status].label} /> },
    { key: "rows", label: "Rows", width: "90px", numeric: true, render: (a) => a.rowCount },
    { key: "updated", label: "Updated", width: "130px", render: (a) => <span className="text-sm text-ink-2">{formatRelative(a.updatedAt, datePrefs)}</span> },
  ], [datePrefs]);

  return (
    <>
      <OsPageHeader
        title="Build apps"
        views={
          <>
            <ViewTab label="All" active={tab === "all"} onClick={() => setTab("all")} />
            <ViewTab label="Published" active={tab === "published"} onClick={() => setTab("published")} />
            <ViewTab label="Drafts" active={tab === "drafts"} onClick={() => setTab("drafts")} />
          </>
        }
        toolbar={{
          left: (
            <label className="flex h-9 w-64 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base text-ink">
              <Search className="h-4 w-4 text-ink-2" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps" aria-label="Search apps" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
            </label>
          ),
          primary: canCreate ? { label: "New app", icon: Plus, onClick: () => setNewOpen("describe"), split: { label: "Start blank", onClick: () => setNewOpen("blank") } } : undefined,
          menu: [{ label: "Show archived", checked: includeArchived, keepOpen: true, onClick: () => setArchived(!includeArchived) }],
        }}
      />
      <div className="px-6 pb-8 pt-2">
        {error ? (
          <OsEmptyView variant="error" title="Couldn't load Build apps" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
        ) : shown && shown.length === 0 && !q && tab === "all" ? (
          <OsEmptyView context="board" title="No apps yet" />
        ) : (
          <TableCard
            ariaLabel="Apps"
            columns={columns}
            rows={shown}
            rowKey={(a) => a.id}
            rowHref={(a) => `/build/${a.slug}`}
            empty={
              <span className="text-row text-ink-2">
                No results · <button type="button" className="text-brand-deep hover:underline" onClick={() => { setQ(""); setTab("all"); }}>Clear filters</button>
              </span>
            }
            rowMenu={(a) => (
              <button
                type="button"
                aria-label={`Actions for ${a.name}`}
                aria-haspopup="menu"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ app: a, anchor: { current: e.currentTarget } }); }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          />
        )}
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.app.name}`}>
            <MenuItem icon={ExternalLink} label="Open" onClick={() => { const a = menu.app; setMenu(null); router.push(`/build/${a.slug}`); }} />
            {menu.app.canManage === false ? null : <MenuSeparator />}
            {menu.app.canManage === false ? null : menu.app.status === "ARCHIVED" ? (
              <MenuItem icon={ArchiveRestore} label="Restore" onClick={() => { const a = menu.app; setMenu(null); void restore(a); }} />
            ) : (
              <MenuItem icon={Archive} label="Archive" destructive onClick={() => { const a = menu.app; setMenu(null); void archive(a); }} />
            )}
          </MenuList>
        </MorePortal>
      ) : null}

      {newOpen ? (
        <NewAppDialog
          start={newOpen}
          onClose={() => setNewOpen(null)}
          onCreated={(slug) => { setNewOpen(null); router.push(`/build/${slug}`); }}
        />
      ) : null}
    </>
  );
}

function NewAppDialog({ start, onClose, onCreated }: { start: "describe" | "blank"; onClose: () => void; onCreated: (slug: string) => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [step, setStep] = useState<"describe" | "fields">(start === "blank" ? "fields" : "describe");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<AppDraft>(blankDraft());
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = step === "fields" && (draft.name.trim() !== "" || draft.fields.length > 1);

  async function close() {
    if (dirty && !(await confirm({ title: "Discard this app?", description: "The fields you set up here are not saved.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }

  async function generate() {
    if (prompt.trim().length < 8) { setProblem("Describe the app in a sentence or two."); return; }
    setProblem(null);
    setBusy(true);
    const r = await apiFetch<{ app: unknown; rawText: string | null }>("/api/build/generate", { method: "POST", json: { prompt: prompt.trim() } });
    setBusy(false);
    if (!r.ok) { setProblem(r.error || "Couldn't generate the app. Try again."); return; }
    const d = draftFromGenerated(r.data.app, prompt.trim());
    if (!d) { setProblem("The answer didn't describe an app. Try saying what each row holds."); return; }
    setDraft(d);
    setSlugTouched(true);
    setStep("fields");
  }

  async function create() {
    const issue = draftProblem(draft);
    if (issue) { setProblem(issue); return; }
    setProblem(null);
    setBusy(true);
    const r = await apiFetch<{ app: { slug: string } }>("/api/build/apps", {
      method: "POST",
      json: {
        name: draft.name.trim(),
        slug: draft.slug,
        description: draft.description.trim() || undefined,
        prompt: draft.prompt,
        fields: draft.fields.map((f) => ({ key: f.key, label: f.label.trim(), fieldType: f.fieldType, ...(f.options !== undefined ? { options: f.options } : {}) })),
        sampleRows: draft.sampleRows,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setProblem(r.status === 409 ? "An app already uses that address. Change it and try again." : r.error || "Couldn't create the app.");
      return;
    }
    toast(`${draft.name.trim()} created`);
    onCreated(r.data.app.slug);
  }

  const setField = (i: number, patch: Partial<AppDraft["fields"][number]>) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));

  return (
    <Dialog open onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>New app</DialogTitle>
          <DialogDescription>
            {step === "describe" ? "Describe the app and WorkwrK drafts its fields. Nothing is saved until you create it." : "Check the fields. You can change any of them later."}
          </DialogDescription>
        </DialogHeader>

        {step === "describe" ? (
          <div className="flex flex-col gap-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              maxLength={2000}
              aria-label="Describe the app"
              placeholder={EXAMPLES[0]}
              className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink placeholder:text-ink-3"
            />
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.slice(1).map((e) => (
                <button key={e} type="button" onClick={() => setPrompt(e)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line px-3 text-sm text-ink hover:bg-hover">
                  <span className="truncate">{e.split(":")[0].split(" with")[0]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Name
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, slug: slugTouched ? d.slug : slugify(e.target.value) }))}
                  maxLength={80}
                  className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Address
                <input
                  value={draft.slug}
                  onChange={(e) => { setSlugTouched(true); setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase() })); }}
                  maxLength={60}
                  className="h-9 rounded-md border border-line-strong bg-raised px-3 font-mono text-sm font-normal text-ink"
                />
              </label>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-ink">Fields</span>
              <ul className="mt-1 flex flex-col">
                {draft.fields.map((f, i) => (
                  <li key={`${f.key}-${i}`} className="flex h-10 items-center gap-2">
                    <input
                      value={f.label}
                      onChange={(e) => setField(i, { label: e.target.value })}
                      aria-label="Field name"
                      className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-base text-ink"
                    />
                    <select
                      value={f.fieldType}
                      onChange={(e) => setField(i, { fieldType: e.target.value as FieldType })}
                      aria-label="Field type"
                      className="h-8 w-40 rounded-md border border-line bg-raised px-2 text-sm text-ink"
                    >
                      {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove ${f.label || "field"}`}
                      disabled={draft.fields.length <= 1}
                      onClick={() => setDraft((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={draft.fields.length >= 20}
                onClick={() => setDraft((d) => ({ ...d, fields: [...d.fields, { key: uniqueFieldKey("Field", d.fields.map((x) => x.key)), label: "", fieldType: "TEXT" }] }))}
                className="mt-1 inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Add field
              </button>
            </div>
          </div>
        )}

        {problem ? <p role="alert" className="text-sm text-danger-text">{problem}</p> : null}

        <DialogFooter>
          {step === "fields" && start === "describe" ? (
            <button type="button" onClick={() => setStep("describe")} className="me-auto inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Back</button>
          ) : null}
          <button type="button" onClick={() => void close()} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          {step === "describe" ? (
            <button type="button" onClick={() => void generate()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60">
              {busy ? <Dots variant="pending" /> : <Wand2 className="h-4 w-4" />} Generate
            </button>
          ) : (
            <button type="button" onClick={() => void create()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60">
              {busy ? <Dots variant="pending" /> : null} Create app
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
