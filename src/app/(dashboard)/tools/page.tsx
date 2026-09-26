"use client";

// Tools (spec-tools-misc 2.1): the apps the company pays for, and the saved
// login for the ones you may use. Every Member reads the tools shared with
// them; the tool admins see every tool; a manager adds tools and manages the
// ones they added (src/lib/tools/tool-access.ts).
//
// What changed: one Add tool modal (name, website, category, icon,
// description, and a login) replaces the two chained prompts that always
// wrote "Uncategorized". A drawer at /tools?tool=<id> replaces the
// hand-rolled overlay, and it is where the fields, the login (shown, copied,
// changed), sharing (the share routes' first caller) and Delete live. Delete
// moves the tool to Trash with its shares instead of erasing it. The KPI
// tiles (one of them, "With creds", counted shares, not logins) and the
// Settings header link go. Search is ?q= on the API instead of a filter over
// one loaded page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Search, ExternalLink, KeyRound, Eye, EyeOff, Copy, Plus, Link2, X, Trash2, UserPlus, ChevronDown,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Drawer } from "@/components/ui/drawer";
import { Picker } from "@/components/ui/picker";
import { SkeletonLines } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

type Person = { id: string; name: string; avatar?: string | null };
type ToolRow = {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  icon: string | null;
  category: string | null;
  addedBy: string;
  createdAt: string;
  hasLogin: boolean;
  canManage: boolean;
  sharedAt: string | null;
  addedByPerson: Person | null;
  sharedWith: Person[];
  shareCount: number;
};
type Credentials = { username?: string; password?: string; apiKey?: string; notes?: string };
type ToolDetail = Omit<ToolRow, "sharedWith" | "shareCount" | "addedByPerson" | "sharedAt"> & {
  credentials: Credentials | null;
  shares: Array<{ userId: string; sharedAt: string; name: string; avatar: string | null }>;
};

const LOGIN_FIELDS: Array<{ key: keyof Credentials; label: string; secret: boolean }> = [
  { key: "username", label: "Username", secret: false },
  { key: "password", label: "Password", secret: true },
  { key: "apiKey", label: "API key", secret: true },
  { key: "notes", label: "Notes", secret: false },
];

const splitName = (name: string) => {
  const [firstName, ...rest] = name.split(" ");
  return { firstName, lastName: rest.join(" ") };
};

export default function ToolsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { rowVersion } = useOsShell();
  const datePrefs = useDatePrefs();

  const openId = sp?.get("tool") ?? null;
  const [q, setQ] = useState(sp?.get("q") ?? "");
  const [view, setView] = useState<"all" | "shared">("all");
  const [rows, setRows] = useState<ToolRow[] | null>(null);
  const [canAdd, setCanAdd] = useState(false);
  const [seesAll, setSeesAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    if (value) next.set(key, value); else next.delete(key);
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const load = useCallback(async () => {
    const r = await apiFetch<{ tools: ToolRow[]; canAdd: boolean; seesAll: boolean }>(`/api/tools${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setRows(r.data.tools);
    setCanAdd(r.data.canAdd);
    setSeesAll(r.data.seesAll);
  }, [q]);
  const version = rowVersion("tools");
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q, version]);

  const shown = useMemo(() => (rows && view === "shared" ? rows.filter((r) => r.sharedAt) : rows), [rows, view]);

  const columns = useMemo<TableColumn<ToolRow>[]>(() => [
    { key: "name", label: "Name", title: true, width: "minmax(220px,1.4fr)", render: (t) => (
      <span className="flex min-w-0 items-center gap-2">
        <EntityTile size="sm" icon={t.icon || null} name={t.name} {...NEUTRAL_TILE} />
        <span className="truncate">{t.name}</span>
      </span>
    ) },
    { key: "category", label: "Category", width: "160px", render: (t) => t.category
      ? <span className="inline-flex h-6 max-w-full items-center truncate rounded-md bg-hover px-2 text-xs font-medium text-ink-2">{t.category}</span>
      : <span className="text-sm text-ink-2">No category</span> },
    { key: "login", label: "Login", width: "120px", render: (t) => t.hasLogin
      ? <span className="inline-flex items-center gap-1.5 text-sm text-ink"><KeyRound className="h-3 w-3" aria-hidden />Saved</span>
      : <span className="text-sm text-ink-2">None</span> },
    { key: "shared", label: "Shared with", width: "150px", className: "max-lg:hidden", render: (t) => t.sharedWith.length > 0
      ? <AvatarStack size={20} max={3} people={t.sharedWith.map((p) => ({ id: p.id, avatar: p.avatar, ...splitName(p.name) }))} />
      : <span className="text-sm text-ink-2">{t.shareCount > 0 ? `${t.shareCount} ${t.shareCount === 1 ? "person" : "people"}` : "Not shared"}</span> },
    { key: "added", label: "Added", width: "120px", className: "max-lg:hidden", render: (t) => (
      <span className="text-sm text-ink-2" title={t.addedByPerson ? `Added by ${t.addedByPerson.name}` : undefined}>{formatRelative(t.createdAt, datePrefs)}</span>
    ) },
  ], [datePrefs]);

  return (
    <>
      <OsPageHeader
        title="Tools"
        views={seesAll ? (
          <>
            <ViewTab label="All tools" active={view === "all"} onClick={() => setView("all")} />
            <ViewTab label="Shared with me" active={view === "shared"} onClick={() => setView("shared")} />
          </>
        ) : undefined}
        toolbar={{
          left: (
            <label className="flex h-9 w-64 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base text-ink">
              <Search className="h-4 w-4 text-ink-2" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools" aria-label="Search tools" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
            </label>
          ),
          primary: canAdd ? { label: "Add tool", icon: Plus, onClick: () => setAddOpen(true) } : undefined,
        }}
      />
      <div className="px-6 pb-8 pt-2">
        {error ? (
          <OsEmptyView variant="error" title="Couldn't load Tools" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
        ) : shown && shown.length === 0 && !q ? (
          <OsEmptyView title={canAdd ? "No tools yet" : "No tools shared with you yet."} />
        ) : (
          <TableCard
            ariaLabel="Tools"
            columns={columns}
            rows={shown}
            rowKey={(t) => t.id}
            onRowClick={(t) => setParam("tool", t.id)}
            highlightKey={openId}
            empty={<span className="text-row text-ink-2">No results · <button type="button" className="text-brand-deep hover:underline" onClick={() => setQ("")}>Clear search</button></span>}
            rowMenu={(t) => t.url ? (
              <a
                href={t.url.startsWith("http") ? t.url : `https://${t.url}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open ${t.name} website`}
                title="Open website"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          />
        )}
      </div>

      <ToolDrawer id={openId} onClose={() => setParam("tool", null)} onChanged={() => void load()} />
      {addOpen ? <AddToolDialog onClose={() => setAddOpen(false)} onAdded={(id) => { setAddOpen(false); void load(); setParam("tool", id); }} /> : null}
    </>
  );
}

/* ─────────────────────────── the drawer ─────────────────────────── */

function ToolDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(false);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [loginDraft, setLoginDraft] = useState<Credentials | null>(null);

  const load = useCallback(async (toolId: string) => {
    const r = await apiFetch<{ tool: ToolDetail }>(`/api/tools/${toolId}`, { cache: "no-store" });
    if (!r.ok) { if (r.status === 404) setMissing(true); else setError(true); return; }
    setMissing(false);
    setError(false);
    setTool(r.data.tool);
  }, []);
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => { setTool(null); setShown({}); setLoginDraft(null); void load(id); }, 0);
    return () => clearTimeout(t);
  }, [id, load]);

  async function patch(body: Record<string, unknown>, done?: string) {
    if (!tool) return false;
    const r = await apiFetch(`/api/tools/${tool.id}`, { method: "PATCH", json: body });
    if (!r.ok) { toast(r.error || "Couldn't save the change", { tone: "danger", action: { label: "Try again", onClick: () => void patch(body, done) } }); return false; }
    if (done) toast(done);
    await load(tool.id);
    onChanged();
    return true;
  }

  async function remove() {
    if (!tool) return;
    const ok = await confirm({
      title: `Delete ${tool.name}?`,
      description: `It moves to Trash with its saved login and its shares, and the people it was shared with lose it. Restore it from Trash within ${boot.org.trashDays} days to bring all of it back.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/tools/${tool.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete the tool", { tone: "danger" }); return; }
    toast(`${tool.name} moved to Trash`);
    onChanged();
    onClose();
  }

  async function copy(value: string, what: string) {
    try { await navigator.clipboard.writeText(value); toast(`${what} copied`); } catch { toast(`Couldn't copy the ${what.toLowerCase()}`, { tone: "danger" }); }
  }

  const manage = tool?.canManage ?? false;
  const creds = tool?.credentials ?? {};

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      ariaLabel="Tool"
      layerId="tool-drawer"
      header={
        <div className="flex h-12 items-center gap-2 px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">Tools › <span className="text-ink">{tool?.name ?? ""}</span></span>
          {tool ? (
            <button type="button" aria-label="Copy link" title="Copy link" onClick={() => void copy(`${window.location.origin}/tools?tool=${tool.id}`, "Link")} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
              <Link2 className="h-4 w-4" />
            </button>
          ) : null}
          {tool && !manage ? <span className="inline-flex h-6 items-center rounded-md bg-hover px-2 text-xs font-medium text-ink-2">Can view</span> : null}
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      }
    >
      {missing ? (
        <OsEmptyView title="This tool isn't here any more, or it isn't shared with you." compact />
      ) : error ? (
        <OsEmptyView variant="error" title="Couldn't load this tool" action={{ label: "Try again", onClick: () => id && void load(id) }} compact />
      ) : !tool ? (
        <div className="p-4"><SkeletonLines lines={6} /></div>
      ) : (
        <div className="flex flex-col gap-6 p-4">
          {!manage ? (
            <div className="rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">View only. Ask whoever added it for changes.</div>
          ) : null}

          <section className="flex flex-col">
            <FieldRow label="Name" value={tool.name} editable={manage} onSave={(v) => patch({ name: v })} required />
            <FieldRow label="Website" value={tool.url ?? ""} editable={manage} onSave={(v) => patch({ url: v })} placeholder="https://" />
            <FieldRow label="Category" value={tool.category ?? ""} editable={manage} onSave={(v) => patch({ category: v })} placeholder="No category" />
            <FieldRow label="Icon" value={tool.icon ?? ""} editable={manage} onSave={(v) => patch({ icon: v })} placeholder="An emoji" />
            <FieldRow label="Description" value={tool.description ?? ""} editable={manage} onSave={(v) => patch({ description: v })} multiline />
          </section>

          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">Login</h3>
              {manage && !loginDraft ? (
                <button type="button" onClick={() => setLoginDraft({ ...creds })} className="text-sm font-medium text-brand-deep hover:underline">Edit</button>
              ) : null}
            </div>
            {loginDraft ? (
              <div className="flex flex-col gap-2">
                {LOGIN_FIELDS.map((f) => (
                  <label key={f.key} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 font-medium text-ink-2">{f.label}</span>
                    {f.key === "notes" ? (
                      <textarea value={loginDraft[f.key] ?? ""} onChange={(e) => setLoginDraft({ ...loginDraft, [f.key]: e.target.value })} rows={2} className="min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 py-1 text-base text-ink" />
                    ) : (
                      <input type={f.secret ? "password" : "text"} value={loginDraft[f.key] ?? ""} onChange={(e) => setLoginDraft({ ...loginDraft, [f.key]: e.target.value })} autoComplete="off" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink" />
                    )}
                  </label>
                ))}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setLoginDraft(null)} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
                  <button type="button" onClick={async () => { if (await patch({ credentials: loginDraft }, "Login saved")) setLoginDraft(null); }} className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover">Save login</button>
                </div>
              </div>
            ) : (
              LOGIN_FIELDS.map((f) => {
                const value = creds[f.key];
                return (
                  <div key={f.key} className="flex min-h-9 items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 font-medium text-ink-2">{f.label}</span>
                    {value ? (
                      <>
                        <span className="min-w-0 flex-1 truncate font-mono text-ink">{f.secret && !shown[f.key] ? "••••••••" : value}</span>
                        {f.secret ? (
                          <button type="button" aria-label={`${shown[f.key] ? "Hide" : "Show"} ${f.label.toLowerCase()}`} title={shown[f.key] ? "Hide" : "Show"} onClick={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                            {shown[f.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        ) : null}
                        <button type="button" aria-label={`Copy ${f.label.toLowerCase()}`} title="Copy" onClick={() => void copy(value, f.label)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                          <Copy className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <span className="text-ink-3">Not set</span>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {manage ? (
            <ShareSection tool={tool} onChanged={async () => { await load(tool.id); onChanged(); }} />
          ) : null}

          {manage ? (
            <section className="rounded-lg border border-danger-soft p-3">
              <button type="button" onClick={() => void remove()} className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium text-danger-text hover:bg-danger-bg">
                <Trash2 className="h-4 w-4" /> Delete tool
              </button>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

function FieldRow({ label, value, editable, onSave, placeholder, multiline, required }: {
  label: string;
  value: string;
  editable: boolean;
  onSave: (v: string) => Promise<boolean>;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = async () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next === value.trim()) { setDraft(null); return; }
    if (required && !next) { setDraft(null); return; }
    // A failed save keeps the edit on screen (the toast has Try again).
    if (await onSave(next)) setDraft(null);
  };
  return (
    <div className="flex min-h-9 items-start gap-3 py-1 text-sm">
      <span className="w-28 shrink-0 pt-1.5 font-medium text-ink-2">{label}</span>
      {editable ? (
        multiline ? (
          <textarea
            value={draft ?? value}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            rows={3}
            aria-label={label}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base text-ink hover:border-line focus:border-line-strong"
          />
        ) : (
          <input
            value={draft ?? value}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            aria-label={label}
            className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base text-ink hover:border-line focus:border-line-strong"
          />
        )
      ) : (
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-1.5 text-base text-ink">{value || <span className="text-ink-3">{placeholder ?? "None"}</span>}</span>
      )}
    </div>
  );
}

function ShareSection({ tool, onChanged }: { tool: ToolDetail; onChanged: () => Promise<void> }) {
  const { toast } = useOsToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const exclude = tool.shares.map((s) => s.userId).join(",");
      const r = await apiFetch<{ people: Array<{ id: string; firstName: string | null; lastName: string | null; email: string | null }> }>(`/api/people/pick?q=${encodeURIComponent(query)}&exclude=${exclude}`, { cache: "no-store" });
      setLoading(false);
      if (r.ok) setOptions(r.data.people.map((p) => ({ id: p.id, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone", email: p.email })));
    }, 200);
    return () => clearTimeout(t);
  }, [open, query, tool.shares]);

  async function share(userId: string) {
    setOpen(false);
    const r = await apiFetch(`/api/tools/${tool.id}/share`, { method: "POST", json: { userIds: [userId] } });
    if (!r.ok) { toast(r.error || "Couldn't share the tool", { tone: "danger" }); return; }
    toast("Shared");
    await onChanged();
  }
  async function unshare(userId: string) {
    const r = await apiFetch(`/api/tools/${tool.id}/share`, { method: "DELETE", json: { userId } });
    if (!r.ok) { toast(r.error || "Couldn't remove access", { tone: "danger" }); return; }
    toast("Access removed");
    await onChanged();
  }

  return (
    <section className="flex flex-col gap-1">
      <div className="relative flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink">Who has access</h3>
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm font-medium text-ink hover:bg-hover" aria-haspopup="listbox">
          <UserPlus className="h-4 w-4" /> Share <ChevronDown className="h-3.5 w-3.5 text-ink-2" />
        </button>
        <Picker
          open={open}
          onClose={() => setOpen(false)}
          align="end"
          alwaysSearch
          onSearchChange={setQuery}
          loading={loading}
          searchPlaceholder="Search people"
          ariaLabel="Share with"
          sections={[{ options: options.map((p) => ({ value: p.id, label: p.name, description: p.email ?? undefined, keywords: p.email ?? undefined })) }]}
          onSelect={(v) => void share(v)}
          className="absolute end-0 top-9 z-20"
        />
      </div>
      <p className="text-sm text-ink-2">People you share with can see this tool and its saved login.</p>
      {tool.shares.length === 0 ? (
        <p className="py-2 text-sm text-ink-3">Not shared with anyone yet.</p>
      ) : (
        <ul className="flex flex-col">
          {tool.shares.map((s) => (
            <li key={s.userId} className="flex h-9 items-center gap-2 text-base text-ink">
              <AvatarStack size={24} max={1} people={[{ id: s.userId, avatar: s.avatar, ...splitName(s.name) }]} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs font-medium text-ink-2">Can view</span>
              <button type="button" aria-label={`Remove ${s.name}`} onClick={() => void unshare(s.userId)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─────────────────────────── Add tool ─────────────────────────── */

function AddToolDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [login, setLogin] = useState<Credentials>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(name || url || category || icon || description || Object.values(login).some(Boolean));

  useEffect(() => {
    void apiFetch<{ categories: string[] }>("/api/tools/categories", { cache: "no-store" }).then((r) => { if (r.ok) setCategories(r.data.categories); });
  }, []);

  async function close() {
    if (dirty && !(await confirm({ title: "Discard this tool?", description: "What you typed here is not saved.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const r = await apiFetch<{ id: string }>("/api/tools", {
      method: "POST",
      json: { name, url, category, icon, description, credentials: Object.values(login).some((v) => v && v.trim()) ? login : undefined },
    });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't add the tool", { tone: "danger" }); return; }
    toast(`${name.trim()} added`);
    onAdded(r.data.id);
  }

  const input = "h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink placeholder:text-ink-3";
  return (
    <Dialog open onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add tool</DialogTitle>
          <DialogDescription>An app the company uses. Share it with the people who need the login.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Name <span className="font-normal text-ink-2">(required)</span></span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={input} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Website
            <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" className={input} />
          </label>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Category
              <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} list="tool-categories" placeholder="Pick or type a new one" className={input} />
              <datalist id="tool-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Icon
              <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} placeholder="An emoji" className={input} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink" />
          </label>
          <button type="button" onClick={() => setLoginOpen((v) => !v)} aria-expanded={loginOpen} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-ink">
            <ChevronDown className={`h-4 w-4 transition-transform ${loginOpen ? "" : "-rotate-90"}`} /> Add a login
          </button>
          {loginOpen ? (
            <div className="flex flex-col gap-2">
              {LOGIN_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 font-medium text-ink-2">{f.label}</span>
                  <input type={f.secret ? "password" : "text"} autoComplete="off" value={login[f.key] ?? ""} onChange={(e) => setLogin({ ...login, [f.key]: e.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink" />
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <button type="button" onClick={() => void close()} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy || !name.trim()} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50">Add tool</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
