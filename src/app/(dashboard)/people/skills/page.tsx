"use client";

/* People · Skills — org skill taxonomy.
 *
 * Aggregates every UserSkill row across the org into a taxonomy:
 *   skill name -> #holders, avg self rating, avg manager rating,
 *                 top holders (ranked by manager rating).
 *
 * Use case: "Who do we have who knows Postgres?" - find a skill, see
 * everyone who has rated themselves on it.
 *
 * Reads: GET /api/skills
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Search, TrendingUp } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiSkill = {
  name: string;
  holders: number;
  avgSelf: number;
  avgManager: number;
  topHolders: { id: string; firstName: string; lastName: string; rating: number; department?: string | null }[];
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}
function ratingDots(rating: number): React.ReactNode {
  const n = Math.round(rating);
  return Array.from({ length: 5 }, (_, i) => (
    <span key={i} className={`skill-rating-dot ${i < n ? "is-on" : ""}`} />
  ));
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<ApiSkill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiSkill[] = data.data ?? (Array.isArray(data) ? data : []);
      setSkills(list);
      setSelected((cur) => cur ?? list[0]?.name ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills ?? [];
    return (skills ?? []).filter((s) => s.name.toLowerCase().includes(q));
  }, [skills, search]);

  const active = useMemo(() => (skills ?? []).find((s) => s.name === selected) ?? null, [skills, selected]);

  const total = skills?.length ?? 0;
  const totalHolders = (skills ?? []).reduce((acc, s) => acc + s.holders, 0);
  const expertCount = (skills ?? []).filter((s) => s.avgManager >= 4 || s.avgSelf >= 4).length;

  return (
    <div className="skills">
      <header className="skills__head">
        <div className="skills__head-l">
          <div className="skills__icon"><Sparkles /></div>
          <div>
            <h1 className="skills__title">Skills taxonomy</h1>
            <div className="skills__sub">{skills === null ? "Loading…" : `${total} unique skill${total === 1 ? "" : "s"} · ${totalHolders} rating${totalHolders === 1 ? "" : "s"} · ${expertCount} with expert-level avg`}</div>
          </div>
        </div>
        <div className="skills__search">
          <Search />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search skills…" />
        </div>
      </header>

      {loadError ? (
        <div className="skills__error">{loadError}</div>
      ) : skills === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="skills__empty">
          <Sparkles />
          <div>
            <h3>No skills tracked yet</h3>
            <p>Once people add skills to their profile and rate themselves, the org-wide taxonomy populates here automatically.</p>
          </div>
        </div>
      ) : (
        <div className="skills__grid">
          <aside className="skills__list">
            {filtered.length === 0 ? (
              <div className="skills__list-empty">No skills match &quot;{search}&quot;</div>
            ) : filtered.map((s) => (
              <button
                key={s.name}
                type="button"
                className={`skill-item ${selected === s.name ? "is-active" : ""}`}
                onClick={() => setSelected(s.name)}
              >
                <span className="skill-item__name">{s.name}</span>
                <span className="skill-item__bar-row">
                  <span className="skill-item__bar">
                    <span className="skill-item__bar-fill" style={{ width: `${(s.avgManager || s.avgSelf) * 20}%` }} />
                  </span>
                  <span className="skill-item__holders">{s.holders}</span>
                </span>
              </button>
            ))}
          </aside>

          <section className="skill-detail">
            {active ? (
              <>
                <header className="skill-detail__head">
                  <h2>{active.name}</h2>
                  <div className="skill-detail__stats">
                    <div className="skill-detail__stat">
                      <span className="skill-detail__stat-label">Holders</span>
                      <span className="skill-detail__stat-val">{active.holders}</span>
                    </div>
                    <div className="skill-detail__stat">
                      <span className="skill-detail__stat-label">Avg self</span>
                      <span className="skill-detail__stat-val">{active.avgSelf.toFixed(1)}<small>/5</small></span>
                    </div>
                    <div className="skill-detail__stat">
                      <span className="skill-detail__stat-label">Avg manager</span>
                      <span className="skill-detail__stat-val">{active.avgManager > 0 ? `${active.avgManager.toFixed(1)}` : "—"}<small>/5</small></span>
                    </div>
                  </div>
                </header>
                <h3 className="skill-detail__h3"><TrendingUp /> Top rated holders</h3>
                <div className="skill-detail__holders">
                  {active.topHolders.map((h) => (
                    <div key={h.id} className="skill-holder">
                      <span className="skill-holder__av" style={{ background: avColor(h.id) }}>{initials(h.firstName, h.lastName)}</span>
                      <span className="skill-holder__name">{[h.firstName, h.lastName].filter(Boolean).join(" ")}</span>
                      <span className="skill-holder__dept">{h.department ?? "—"}</span>
                      <span className="skill-holder__rating">{ratingDots(h.rating)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="skill-detail__empty">
                <Sparkles />
                <p>Pick a skill from the left to see its expert directory.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
