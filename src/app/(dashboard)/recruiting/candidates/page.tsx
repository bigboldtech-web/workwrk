"use client";

/* Recruiting · Candidates — talent directory.
 *
 * Searchable people grid grouped by source. Each card: avatar initials,
 * name, email, phone, resume link, # of active applications, "Hired"
 * badge if they converted. Click a card to see all their applications
 * via the pipeline view.
 *
 * GET  /api/recruiting/candidates
 * POST /api/recruiting/candidates  { firstName, lastName, email, ... }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Users, Search, Mail, Phone, Plus, FileText, BadgeCheck } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { usePrompt } from "@/components/ui/dialog-provider";

type ApiCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  source?: string | null;
  resumeUrl?: string | null;
  hiredUserId?: string | null;
  _count?: { applications?: number };
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

export default function CandidatesPage() {
  const [cands, setCands] = useState<ApiCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showHired, setShowHired] = useState(true);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recruiting/candidates?limit=500");
      if (res.status === 403) { setLoadError("Manager access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCands(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("recruiting");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const filtered = useMemo(() => {
    let list = cands ?? [];
    if (!showHired) list = list.filter((c) => !c.hiredUserId);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.source ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [cands, search, showHired]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiCandidate[]>();
    for (const c of filtered) {
      const k = (c.source ?? "Other").trim() || "Other";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort(([a, ax], [b, bx]) => bx.length - ax.length || a.localeCompare(b));
  }, [filtered]);

  async function quickAdd() {
    const first = (await promptDialog({ title: "Candidate first name?" }))?.trim();
    if (!first) return;
    const last = (await promptDialog({ title: "Last name?" }))?.trim();
    if (!last) return;
    const email = (await promptDialog({ title: "Email?" }))?.trim();
    if (!email || !email.includes("@")) { toast("Valid email required"); return; }
    try {
      const res = await fetch("/api/recruiting/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: first, lastName: last, email }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't add candidate"); }
  }

  const total = cands?.length ?? 0;
  const hired = (cands ?? []).filter((c) => c.hiredUserId).length;
  const withApps = (cands ?? []).filter((c) => (c._count?.applications ?? 0) > 0).length;

  return (
    <div className="reccands">
      <header className="reccands__head">
        <div className="reccands__head-l">
          <div className="reccands__icon"><Users /></div>
          <div>
            <h1 className="reccands__title">Candidate directory</h1>
            <div className="reccands__sub">
              {cands === null ? "Loading…" : `${total} candidate${total === 1 ? "" : "s"} · ${withApps} with active applications · ${hired} hired`}
            </div>
          </div>
        </div>
        <div className="reccands__actions">
          <div className="reccands__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, source…" />
          </div>
          <label className="reccands__hired">
            <input type="checkbox" checked={showHired} onChange={(e) => setShowHired(e.target.checked)} />
            Show hired
          </label>
          <button type="button" className="reccands__new" onClick={quickAdd}><Plus /> Add candidate</button>
        </div>
      </header>

      {loadError ? (
        <div className="reccands__error">{loadError}</div>
      ) : cands === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="reccands__empty">
          <Users />
          <div>
            <h3>{search ? "Nothing matches that search." : "No candidates yet"}</h3>
            <p>{search ? "Try different terms." : "Add candidates manually, or let them apply via your job posting forms."}</p>
          </div>
        </div>
      ) : (
        <div className="reccands__sections">
          {grouped.map(([source, items]) => (
            <section key={source} className="reccands__section">
              <header className="reccands__section-head">
                <h2>{source}</h2>
                <span>{items.length} candidate{items.length === 1 ? "" : "s"}</span>
              </header>
              <div className="reccands__grid">
                {items.map((c) => {
                  const apps = c._count?.applications ?? 0;
                  return (
                    <Link key={c.id} href={`/recruiting/pipeline`} className="reccand">
                      <div className="reccand__head">
                        <span className="reccand__av" style={{ background: avColor(c.id) }}>{initials(c.firstName, c.lastName)}</span>
                        <div className="reccand__id">
                          <div className="reccand__name">
                            {c.firstName} {c.lastName}
                            {c.hiredUserId && <BadgeCheck className="reccand__hired-badge" />}
                          </div>
                          <a href={`mailto:${c.email}`} className="reccand__email" onClick={(e) => e.stopPropagation()}>
                            <Mail /> {c.email}
                          </a>
                        </div>
                      </div>
                      <footer className="reccand__foot">
                        {c.phone && <span className="reccand__phone"><Phone /> {c.phone}</span>}
                        {c.resumeUrl && (
                          <a href={c.resumeUrl} target="_blank" rel="noopener" className="reccand__resume" onClick={(e) => e.stopPropagation()}>
                            <FileText /> Résumé
                          </a>
                        )}
                        <span className="reccand__apps" title={`${apps} application${apps === 1 ? "" : "s"}`}>
                          {apps} app{apps === 1 ? "" : "s"}
                        </span>
                      </footer>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
