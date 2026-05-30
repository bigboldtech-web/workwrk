"use client";

/* People · Skills — bespoke skill matrix.
 *
 *  GET /api/skills
 *
 * Layout:
 *   OsTitleBar with back + nav.
 *   4-tile KPI strip: Skills · Holders · Expert-level · Coverage gaps.
 *   Toolbar: search + sort (Holders / Rating / A-Z) + coverage filter.
 *   2-col body:
 *     Left: skill list with rating bar + holder count + tone badge.
 *     Right: selected skill detail — gauge ring + breakdown bars + top holders directory.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Sparkles, Search, ArrowLeft, ChevronDown, Star, TrendingUp,
  AlertOctagon, Users, Award, Building2, GraduationCap, Briefcase,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiSkill = {
  name: string;
  holders: number;
  avgSelf: number;
  avgManager: number;
  topHolders: { id: string; firstName: string; lastName: string; rating: number; department?: string | null }[];
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}
function ratingTone(r: number): "novice" | "regular" | "expert" {
  if (r >= 4) return "expert";
  if (r >= 2.5) return "regular";
  return "novice";
}
function ratingToneColor(t: "novice" | "regular" | "expert"): string {
  if (t === "expert") return C.green;
  if (t === "regular") return C.blue;
  return C.orange;
}

type SortKey = "holders" | "rating" | "name";

export default function SkillsPage() {
  const [skills, setSkills] = useState<ApiSkill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("holders");
  const [filter, setFilter] = useState<"all" | "expert" | "gap">("all");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiSkill[] = data.data ?? (Array.isArray(data) ? data : []);
      setSkills(list);
      setSelected((cur) => cur ?? list[0]?.name ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // ─── Filter + sort ──────────────────────────────────────
  const filtered = useMemo(() => {
    let list = skills ?? [];
    if (filter === "expert") list = list.filter((s) => Math.max(s.avgManager, s.avgSelf) >= 4);
    if (filter === "gap") list = list.filter((s) => s.holders < 3);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q));
    const sorted = list.slice();
    if (sortKey === "holders") sorted.sort((a, b) => b.holders - a.holders);
    else if (sortKey === "rating") sorted.sort((a, b) => Math.max(b.avgManager, b.avgSelf) - Math.max(a.avgManager, a.avgSelf));
    else if (sortKey === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [skills, search, sortKey, filter]);

  const active = useMemo(() => (skills ?? []).find((s) => s.name === selected) ?? null, [skills, selected]);

  // Auto-pick first filtered if current selection is filtered out
  useEffect(() => {
    if (filtered.length === 0) return;
    if (!selected || !filtered.find((s) => s.name === selected)) {
      setSelected(filtered[0].name);
    }
  }, [filtered, selected]);

  // ─── KPIs ───────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = skills ?? [];
    const totalHolders = list.reduce((acc, s) => acc + s.holders, 0);
    const expertSkills = list.filter((s) => Math.max(s.avgManager, s.avgSelf) >= 4).length;
    const gapSkills = list.filter((s) => s.holders < 3).length;
    return { total: list.length, totalHolders, expertSkills, gapSkills };
  }, [skills]);

  return (
    <>
      <OsTitleBar
        title="Skills"
        Icon={Sparkles}
        iconGradient={GRAD.tealGreen}
        description={skills === null
          ? "Loading skill matrix…"
          : `${stats.total} skill${stats.total === 1 ? "" : "s"} · ${stats.totalHolders} rating${stats.totalHolders === 1 ? "" : "s"}${stats.expertSkills > 0 ? ` · ${stats.expertSkills} expert-level` : ""}`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={4}
        actions={
          <div className="skl__head-actions">
            <button type="button" className="skl__back" onClick={() => history.back()}>
              <ArrowLeft /> People
            </button>
            <Link href="/people/departments" className="skl__nav-link"><Building2 /> Departments</Link>
            <Link href="/people/roles" className="skl__nav-link"><Briefcase /> Roles</Link>
          </div>
        }
      />

      <div className="skl">
        {/* KPIs */}
        <div className="skl__kpis">
          <KpiTile accent="var(--os-c-teal)"   Icon={Sparkles}     label="Skills tracked" value={`${stats.total}`}         sub="in the taxonomy" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Users}        label="Total holders"  value={`${stats.totalHolders}`}  sub="ratings across org" />
          <KpiTile accent="var(--os-c-green)"  Icon={Award}        label="Expert-level"   value={`${stats.expertSkills}`}  sub="avg ≥ 4/5" />
          <KpiTile accent={stats.gapSkills > 0 ? "var(--os-c-orange)" : "var(--os-c-green)"}
                   Icon={AlertOctagon} label="Coverage gaps" value={`${stats.gapSkills}`} sub={stats.gapSkills > 0 ? "< 3 holders, hire risk" : "well-covered"} />
        </div>

        {/* Toolbar */}
        <div className="skl__toolbar">
          <div className="skl__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skill name…"
              aria-label="Search skills"
            />
          </div>
          <div className="skl__tabs">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
              All <span>{stats.total}</span>
            </button>
            <button type="button" className={filter === "expert" ? "is-active" : ""} onClick={() => setFilter("expert")}>
              Expert <span>{stats.expertSkills}</span>
            </button>
            <button type="button" className={`${filter === "gap" ? "is-active" : ""} ${stats.gapSkills > 0 ? "is-warn" : ""}`} onClick={() => setFilter("gap")}>
              Gaps <span>{stats.gapSkills}</span>
            </button>
          </div>
          <div className="skl__sort">
            <span>Sort</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="skl__sort-select">
              <option value="holders">Most holders</option>
              <option value="rating">Highest rated</option>
              <option value="name">A–Z</option>
            </select>
            <ChevronDown />
          </div>
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Sparkles} iconGradient={GRAD.redPink} title="Couldn't load skills" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : skills === null ? (
          <div className="skl__loading">Loading skill matrix…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Sparkles}
            iconGradient={GRAD.tealGreen}
            title="No skills tracked yet"
            subtitle="Once people add skills to their profile and rate themselves, the org-wide taxonomy populates here automatically."
            cta="Open my profile"
          />
        ) : filtered.length === 0 ? (
          <div className="skl__empty">
            <Search />
            <div>No skills match these filters.</div>
            <button type="button" className="skl__empty-reset" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button>
          </div>
        ) : (
          <div className="skl__matrix">
            {/* Left: skill list */}
            <aside className="skl__list">
              <header className="skl__list-head">
                <span className="skl__list-label">Skill</span>
                <span className="skl__list-label">Coverage</span>
              </header>
              <ul className="skl__list-items">
                {filtered.map((s) => {
                  const avg = Math.max(s.avgManager, s.avgSelf);
                  const tone = ratingTone(avg);
                  const toneColor = ratingToneColor(tone);
                  const isGap = s.holders < 3;
                  const fillPct = (avg / 5) * 100;
                  return (
                    <li key={s.name}>
                      <button
                        type="button"
                        className={`skl__row${selected === s.name ? " is-active" : ""}${isGap ? " is-gap" : ""}`}
                        onClick={() => setSelected(s.name)}
                        style={{ ["--row-c" as unknown as string]: toneColor }}
                      >
                        <span className="skl__row-main">
                          <span className="skl__row-name">{s.name}</span>
                          <span className="skl__row-tone">
                            <span className={`skl__row-tone-tag skl__row-tone-tag--${tone}`}>{tone}</span>
                            {isGap && (
                              <span className="skl__row-gap">
                                <AlertOctagon /> gap
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="skl__row-bar-row">
                          <span className="skl__row-bar">
                            <span
                              className="skl__row-bar-fill"
                              style={{ width: `${fillPct}%`, background: toneColor }}
                            />
                          </span>
                          <span className="skl__row-holders" title={`${s.holders} holders`}>
                            <Users /> {s.holders}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Right: detail */}
            <section className="skl__detail">
              {active ? <SkillDetail skill={active} /> : (
                <div className="skl__detail-empty">
                  <Sparkles />
                  <div>Pick a skill from the list to see its expert directory.</div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

function SkillDetail({ skill: s }: { skill: ApiSkill }) {
  const composite = Math.max(s.avgManager, s.avgSelf);
  const tone = ratingTone(composite);
  const toneColor = ratingToneColor(tone);
  const isGap = s.holders < 3;
  const selfPct = (s.avgSelf / 5) * 100;
  const mgrPct = (s.avgManager / 5) * 100;

  // Ring math
  const R = 52;
  const C2 = 2 * Math.PI * R;
  const dash = (composite / 5) * C2;

  return (
    <>
      <header className="skl__head" style={{ ["--head-c" as unknown as string]: toneColor }}>
        <div className="skl__head-info">
          <h2 className="skl__head-name">{s.name}</h2>
          <div className="skl__head-tags">
            <span className={`skl__head-tone skl__head-tone--${tone}`}>{tone}</span>
            {isGap && (
              <span className="skl__head-gap">
                <AlertOctagon /> coverage gap — fewer than 3 holders
              </span>
            )}
          </div>
        </div>
        <div className="skl__ring">
          <svg viewBox="0 0 120 120" className="skl__ring-svg">
            <circle cx="60" cy="60" r={R} fill="none" stroke="var(--os-surface-1)" strokeWidth="10" />
            <circle
              cx="60" cy="60" r={R}
              fill="none"
              stroke={toneColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C2 - dash}`}
              transform="rotate(-90 60 60)"
              style={{ transition: "stroke-dasharray 240ms ease" }}
            />
          </svg>
          <div className="skl__ring-text">
            <strong>{composite.toFixed(1)}</strong>
            <span>/5</span>
          </div>
        </div>
      </header>

      <div className="skl__breakdown">
        <div className="skl__bar-row">
          <span className="skl__bar-label">
            <Star /> Avg self rating
          </span>
          <div className="skl__bar-track">
            <div className="skl__bar-fill" style={{ width: `${selfPct}%`, background: "var(--os-c-blue)" }} />
          </div>
          <span className="skl__bar-val">{s.avgSelf.toFixed(1)} <small>/ 5</small></span>
        </div>
        <div className="skl__bar-row">
          <span className="skl__bar-label">
            <TrendingUp /> Avg manager rating
          </span>
          <div className="skl__bar-track">
            <div
              className="skl__bar-fill"
              style={{ width: `${mgrPct}%`, background: s.avgManager > 0 ? "var(--os-c-purple)" : "transparent" }}
            />
          </div>
          <span className="skl__bar-val">{s.avgManager > 0 ? `${s.avgManager.toFixed(1)}` : "—"} <small>/ 5</small></span>
        </div>
        <div className="skl__bar-row">
          <span className="skl__bar-label">
            <Users /> Holders
          </span>
          <div className="skl__bar-track">
            <div
              className="skl__bar-fill"
              style={{ width: `${Math.min(100, (s.holders / 10) * 100)}%`, background: toneColor }}
            />
          </div>
          <span className="skl__bar-val">{s.holders}</span>
        </div>
      </div>

      <h3 className="skl__section-title">
        <Award /> Top rated holders
        <span className="skl__section-sub">{s.topHolders.length} shown</span>
      </h3>

      {s.topHolders.length === 0 ? (
        <div className="skl__holders-empty">No ratings yet.</div>
      ) : (
        <div className="skl__holders">
          {s.topHolders.map((h) => {
            const tone_ = ratingTone(h.rating);
            const toneC = ratingToneColor(tone_);
            return (
              <Link key={h.id} href={`/people/${h.id}`} className="skl__holder">
                <span className="skl__holder-av" style={{ background: avColor(h.id) }}>
                  {initials(h.firstName, h.lastName)}
                </span>
                <div className="skl__holder-info">
                  <div className="skl__holder-name">{[h.firstName, h.lastName].filter(Boolean).join(" ")}</div>
                  {h.department && <div className="skl__holder-dept">{h.department}</div>}
                </div>
                <div className="skl__holder-rating" style={{ ["--rate-c" as unknown as string]: toneC }}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className={`skl__holder-dot${i < Math.round(h.rating) ? " is-on" : ""}`} />
                  ))}
                  <span className="skl__holder-rate-num">{h.rating.toFixed(1)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Sparkles; label: string; value: string; sub: string }) {
  return (
    <div className="skl__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="skl__kpi-accent" aria-hidden="true" />
      <div className="skl__kpi-row">
        <div className="skl__kpi-icon"><Icon /></div>
        <div className="skl__kpi-label">{label}</div>
      </div>
      <div className="skl__kpi-value">{value}</div>
      <div className="skl__kpi-sub">{sub}</div>
    </div>
  );
}
