"use client";

/* Tools — org tool catalog with shared credentials, grouped by category.
 *
 *  GET   /api/tools
 *  POST  /api/tools
 *  PATCH /api/tools/[id]
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wrench, Plus, Search, Hash, ChevronRight, ExternalLink, Lock, Users,
  Layers, Activity, Globe, Copy, Eye, EyeOff, X, KeyRound, User as UserIcon, StickyNote, Check,
  Pencil, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { usePrompt } from "@/components/ui/dialog-provider";

type ToolCredentials = { username?: string; password?: string; apiKey?: string; notes?: string } & Record<string, string | undefined>;
type ApiTool = {
  id: string;
  name: string;
  description?: string | null;
  url: string;
  icon?: string | null;
  category?: string | null;
  credentials?: ToolCredentials | null;
  shares?: Array<{ userId: string; sharedAt: string }>;
  sharedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  Productivity: C.blue, Design: C.pink, Engineering: C.purple,
  Marketing: C.orange, Finance: C.green, HR: C.teal, Sales: C.indigo,
  Support: C.red, Communication: C.brown, Uncategorized: C.gray,
};
function categoryColor(name: string) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
  return palette[h % palette.length];
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

export default function ToolsPage() {
  const [rows, setRows] = useState<ApiTool[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [openTool, setOpenTool] = useState<ApiTool | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tools");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tools");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = (await promptDialog({ title: "Tool name?" }))?.trim();
    if (!name) return;
    const url = (await promptDialog({ title: "URL?" }))?.trim();
    if (!url) return;
    try {
      const res = await fetch("/api/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, category: "Uncategorized" }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Admin access required" : "Couldn't add"); return; }
      toast("Tool added");
      void load();
    } catch { toast("Couldn't add"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const sharedToMe = list.filter((t) => t.sharedAt).length;
    const withCreds = list.filter((t) => (t.shares?.length ?? 0) > 0).length;
    const cats = new Set(list.map((t) => t.category ?? "Uncategorized"));
    return { total: list.length, sharedToMe, withCreds, categories: cats.size };
  }, [rows]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of rows ?? []) {
      const k = t.category ?? "Uncategorized";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (activeCategory) list = list.filter((t) => (t.category ?? "Uncategorized") === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q) ||
      t.url.toLowerCase().includes(q));
    return list;
  }, [rows, search, activeCategory]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiTool[]>();
    for (const t of filtered) {
      const k = t.category ?? "Uncategorized";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => ({ cat, color: categoryColor(cat), items: items.slice().sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Tools"
        Icon={Wrench}
        iconGradient={GRAD.brownOrange}
        description={rows === null ? "Loading…" : `${stats.total} tool${stats.total === 1 ? "" : "s"} · ${stats.categories} categor${stats.categories === 1 ? "y" : "ies"} · ${stats.withCreds} with shared creds`}
        actions={
          <div className="tls__head-actions">
            <Link href="/settings" className="tls__nav-link"><Hash /> Settings</Link>
            <button type="button" className="tls__btn-primary" onClick={quickAdd}>
              <Plus /> Add tool
            </button>
          </div>
        }
      />

      <div className="tls">
        <div className="tls__kpis">
          <KpiTile accent="var(--os-c-brown)"  Icon={Wrench}    label="Tools"        value={`${stats.total}`}      sub="in catalog" />
          <KpiTile accent="var(--os-c-purple)" Icon={Layers}    label="Categories"   value={`${stats.categories}`} sub="organized" />
          <KpiTile accent="var(--os-c-orange)" Icon={Users}     label="With creds"   value={`${stats.withCreds}`}  sub="shared access" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Activity}  label="Shared to me" value={`${stats.sharedToMe}`} sub="you have access" />
        </div>

        <div className="tls__toolbar">
          <div className="tls__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools, URLs, descriptions…" />
          </div>
        </div>

        {cats.length > 0 && (
          <div className="tls__cats">
            <button type="button" className={`tls__cat${activeCategory === null ? " is-active" : ""}`} onClick={() => setActiveCategory(null)}>
              <Layers /> All <span>{stats.total}</span>
            </button>
            {cats.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                className={`tls__cat${activeCategory === cat ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: categoryColor(cat) }}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                <span className="tls__cat-dot" />
                {cat}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={Wrench} iconGradient={GRAD.redPink} title="Couldn't load tools" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="tls__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Wrench}
            iconGradient={GRAD.brownOrange}
            title="No tools yet"
            subtitle="Build the team's tool catalog. Add Figma, Notion, GitHub — share credentials with specific people, audit access."
            chips={["Productivity", "Design", "Engineering", "Marketing"]}
            cta="Add tool"
          />
        ) : grouped.length === 0 ? (
          <div className="tls__no-match"><Search /> No tools match.</div>
        ) : (
          grouped.map((g) => (
            <section key={g.cat} className="tls__section" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="tls__section-head">
                <span className="tls__section-dot" />
                <h2>{g.cat}</h2>
                <span className="tls__section-count">{g.items.length}</span>
                <span className="tls__section-line" />
              </header>
              <div className="tls__grid">
                {g.items.map((t) => {
                  const sharedCount = t.shares?.length ?? 0;
                  const isShared = !!t.sharedAt;
                  const hasCreds = !!t.credentials && Object.values(t.credentials).some((v) => v && String(v).trim());
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenTool(t)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenTool(t); } }}
                      className="tls__tool"
                      style={{ ["--t-c" as unknown as string]: g.color, cursor: "pointer" }}
                    >
                      <header className="tls__tool-head">
                        <span className="tls__tool-icon"><Globe /></span>
                        <div className="tls__tool-id">
                          <h3>{t.name}</h3>
                          <span>{getDomain(t.url)}</span>
                        </div>
                        {t.url ? (
                          <a href={t.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open website" className="tls__tool-ext">
                            <ExternalLink />
                          </a>
                        ) : null}
                      </header>
                      {t.description && <p className="tls__tool-desc">{t.description.length > 120 ? t.description.slice(0, 120) + "…" : t.description}</p>}
                      <footer className="tls__tool-foot">
                        {hasCreds ? (
                          <span className="tls__tool-team"><KeyRound /> Credentials</span>
                        ) : isShared ? (
                          <span className="tls__tool-shared"><Lock /> Shared with you</span>
                        ) : sharedCount > 0 ? (
                          <span className="tls__tool-team"><Users /> {sharedCount} member{sharedCount === 1 ? "" : "s"}</span>
                        ) : (
                          <span className="tls__tool-public"><Globe /> Public</span>
                        )}
                        <ChevronRight />
                      </footer>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {openTool ? <ToolDetailModal tool={openTool} onClose={() => setOpenTool(null)} onChanged={load} /> : null}
    </>
  );
}

function ToolDetailModal({ tool, onClose, onChanged }: { tool: ApiTool; onClose: () => void; onChanged: () => void }) {
  const [creds, setCreds] = useState<ToolCredentials>(tool.credentials ?? {});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    username: tool.credentials?.username ?? "",
    password: tool.credentials?.password ?? "",
    apiKey: tool.credentials?.apiKey ?? "",
    notes: tool.credentials?.notes ?? "",
  });

  const fields = ([
    { key: "username", label: "Username / Email", Icon: UserIcon, secret: false },
    { key: "password", label: "Password", Icon: Lock, secret: true },
    { key: "apiKey", label: "API key", Icon: KeyRound, secret: true },
  ] as const).filter((f) => creds[f.key] && String(creds[f.key]).trim());
  const notes = (creds.notes ?? "").trim();
  const hasAny = fields.length > 0 || notes.length > 0;

  async function save() {
    setSaving(true); setErr(null);
    const next: ToolCredentials = {};
    if (draft.username.trim()) next.username = draft.username.trim();
    if (draft.password) next.password = draft.password;
    if (draft.apiKey.trim()) next.apiKey = draft.apiKey.trim();
    if (draft.notes.trim()) next.notes = draft.notes.trim();
    try {
      const res = await fetch(`/api/tools/${tool.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: next }),
      });
      if (!res.ok) { setErr(res.status === 403 ? "Manager access required to edit credentials." : "Couldn't save."); return; }
      setCreds(next);
      setEditing(false);
      onChanged();
    } catch { setErr("Couldn't save."); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-zinc-100 px-4 py-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500"><Globe className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-zinc-900">{tool.name}</div>
            {tool.url ? <div className="truncate text-[12px] text-zinc-400">{getDomain(tool.url)}</div> : null}
          </div>
          {!editing ? (
            <button type="button" onClick={() => setEditing(true)} title="Edit credentials" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><Pencil className="h-4 w-4" /></button>
          ) : null}
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {tool.description ? <p className="text-[13px] text-zinc-600">{tool.description}</p> : null}
          {tool.category ? <div className="text-[12px] text-zinc-400">Category · <span className="text-zinc-600">{tool.category}</span></div> : null}

          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Credentials</div>

          {editing ? (
            <div className="space-y-2.5">
              <Field label="Username / Email" value={draft.username} onChange={(v) => setDraft((d) => ({ ...d, username: v }))} placeholder="name@company.com" />
              <Field label="Password" value={draft.password} onChange={(v) => setDraft((d) => ({ ...d, password: v }))} placeholder="••••••••" type="password" />
              <Field label="API key" value={draft.apiKey} onChange={(v) => setDraft((d) => ({ ...d, apiKey: v }))} placeholder="optional" />
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Notes</div>
                <textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={2} placeholder="2FA, seat owner, plan…" className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-zinc-300" />
              </div>
              {err ? <div className="text-[12px] text-red-600">{err}</div> : null}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setEditing(false); setErr(null); }} className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50">Cancel</button>
                <button type="button" onClick={save} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </button>
              </div>
            </div>
          ) : hasAny ? (
            <div className="space-y-2">
              {fields.map((f) => <CredRow key={f.key} label={f.label} value={String(creds[f.key])} Icon={f.Icon} secret={f.secret} />)}
              {notes ? (
                <div className="rounded-lg border border-zinc-200 px-3 py-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400"><StickyNote className="h-3 w-3" /> Notes</div>
                  <p className="whitespace-pre-wrap text-[13px] text-zinc-700">{notes}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="w-full rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-[12.5px] text-zinc-500 hover:border-violet-300 hover:bg-violet-50/40">
              No credentials yet — click to add an ID &amp; password.
            </button>
          )}
        </div>

        {tool.url ? (
          <div className="border-t border-zinc-100 px-4 py-3">
            <a href={tool.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-zinc-900 text-[13px] font-medium text-white hover:bg-zinc-800">
              <ExternalLink className="h-3.5 w-3.5" /> Open website
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 w-full rounded-md border border-zinc-200 px-2.5 text-[13px] outline-none focus:border-zinc-300" />
    </div>
  );
}

function CredRow({ label, value, Icon, secret }: { label: string; value: string; Icon: typeof Lock; secret: boolean }) {
  const [show, setShow] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {});
  };
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400"><Icon className="h-3 w-3" /> {label}</div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-800">{show ? value : "•".repeat(Math.min(value.length || 8, 16))}</span>
        {secret ? (
          <button type="button" onClick={() => setShow((s) => !s)} title={show ? "Hide" : "Show"} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button type="button" onClick={copy} title="Copy" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Wrench; label: string; value: string; sub: string }) {
  return (
    <div className="tls__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="tls__kpi-accent" aria-hidden="true" />
      <div className="tls__kpi-row">
        <div className="tls__kpi-icon"><Icon /></div>
        <div className="tls__kpi-label">{label}</div>
      </div>
      <div className="tls__kpi-value">{value}</div>
      <div className="tls__kpi-sub">{sub}</div>
    </div>
  );
}
