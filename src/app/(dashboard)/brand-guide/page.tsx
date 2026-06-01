"use client";

/* Brand Guide — bespoke showcase with color swatches, type specimens, narrative cards.
 *
 *  GET   /api/brand-guide          { brandGuide, canEdit }
 *  PATCH /api/brand-guide          (manager+)
 */

import { useCallback, useEffect, useState } from "react";
import {
  Palette, Type, Image as ImageIcon, FileText, Edit3, CheckCircle2, ChevronRight,
  Activity, Layers,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type BrandColor = { id: string; name: string; hex: string; role?: string };
type BrandFont = { id: string; name: string; usage?: string; source?: string };
type BrandGuide = {
  story?: string; positioning?: string; voiceAndTone?: string; messaging?: string;
  logoUrl?: string; logoUsage?: string;
  colors?: BrandColor[]; typography?: BrandFont[];
  imageryGuidelines?: string; updatedAt?: string;
};
type ApiBrand = { data?: { brandGuide: BrandGuide; canEdit: boolean } };

function isLight(hex: string): boolean {
  const m = hex.replace("#", "").match(/.{1,2}/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.slice(0, 3).map((x) => parseInt(x, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160;
}

export default function BrandGuidePage() {
  const [data, setData] = useState<{ brandGuide: BrandGuide; canEdit: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/brand-guide");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: ApiBrand = await res.json();
      setData(d.data ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("brand-guide");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const g = data?.brandGuide;
  const colorCount = g?.colors?.length ?? 0;
  const fontCount = g?.typography?.length ?? 0;
  const narrativeFields = [g?.story, g?.positioning, g?.voiceAndTone, g?.messaging].filter(Boolean).length;
  const completeness = Math.round(((narrativeFields + (g?.logoUrl ? 1 : 0) + (g?.imageryGuidelines ? 1 : 0)) / 6) * 100);

  return (
    <>
      <OsTitleBar
        title="Brand guide"
        Icon={Palette}
        iconGradient={GRAD.pinkPurple}
        description={data === null ? "Loading…" : `${colorCount} color${colorCount === 1 ? "" : "s"} · ${fontCount} font${fontCount === 1 ? "" : "s"} · ${completeness}% complete${g?.updatedAt ? ` · updated ${new Date(g.updatedAt).toLocaleDateString()}` : ""}`}
        actions={
          <div className="brnd__head-actions">
            {data?.canEdit && (
              <button type="button" className="brnd__btn-primary" onClick={() => toast("Brand guide editor coming soon")}>
                <Edit3 /> Edit guide
              </button>
            )}
          </div>
        }
      />

      <div className="brnd">
        {loadError ? (
          <OsEmptyView Icon={Palette} iconGradient={GRAD.redPink} title="Couldn't load brand guide" subtitle={loadError} cta="Retry" />
        ) : data === null ? (
          <div className="brnd__loading">Loading…</div>
        ) : !g ? (
          <OsEmptyView
            Icon={Palette}
            iconGradient={GRAD.pinkPurple}
            title="Brand guide not set up yet"
            subtitle="Define your colors, typography, voice, and visual rules in one place. Everything else in the OS reads from here."
            chips={["Colors", "Typography", "Voice", "Logo"]}
            cta="Set up guide"
          />
        ) : (
          <>
            <div className="brnd__kpis">
              <KpiTile accent="var(--os-c-pink)"   Icon={Palette} label="Colors"     value={`${colorCount}`}  sub="palette tokens" />
              <KpiTile accent="var(--os-c-indigo)" Icon={Type}    label="Typography" value={`${fontCount}`}    sub="fonts in use" />
              <KpiTile accent="var(--os-c-purple)" Icon={FileText} label="Narrative" value={`${narrativeFields}/4`} sub="story · voice · positioning" />
              <KpiTile accent={completeness >= 80 ? "var(--os-c-green)" : "var(--os-c-orange)"} Icon={Activity} label="Completeness" value={`${completeness}%`} sub={completeness >= 80 ? "ready to ship" : "fill remaining sections"} />
            </div>

            {/* Colors */}
            <section className="brnd__section">
              <header className="brnd__section-head">
                <h2><Palette /> Colors</h2>
                <span className="brnd__section-line" />
                <span className="brnd__section-count">{colorCount}</span>
              </header>
              {(g.colors ?? []).length === 0 ? (
                <div className="brnd__empty">No colors defined yet.</div>
              ) : (
                <div className="brnd__swatches">
                  {(g.colors ?? []).map((c) => (
                    <article key={c.id} className="brnd__swatch" style={{ background: c.hex, color: isLight(c.hex) ? "#111" : "#fff" }}>
                      <div className="brnd__swatch-name">{c.name}</div>
                      {c.role && <div className="brnd__swatch-role">{c.role}</div>}
                      <div className="brnd__swatch-hex">{c.hex.toUpperCase()}</div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Typography */}
            <section className="brnd__section">
              <header className="brnd__section-head">
                <h2><Type /> Typography</h2>
                <span className="brnd__section-line" />
                <span className="brnd__section-count">{fontCount}</span>
              </header>
              {(g.typography ?? []).length === 0 ? (
                <div className="brnd__empty">No typography set yet.</div>
              ) : (
                <div className="brnd__fonts">
                  {(g.typography ?? []).map((f) => (
                    <article key={f.id} className="brnd__font">
                      <header className="brnd__font-head">
                        <h3 style={{ fontFamily: `'${f.name}', sans-serif` }}>{f.name}</h3>
                        {f.source && <span>{f.source}</span>}
                      </header>
                      {f.usage && <p className="brnd__font-usage">{f.usage}</p>}
                      <div className="brnd__font-specimen" style={{ fontFamily: `'${f.name}', sans-serif` }}>
                        <span className="brnd__font-big">Aa</span>
                        <span className="brnd__font-pangram">The quick brown fox jumps over the lazy dog. 1234567890</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Narrative cards */}
            <section className="brnd__section">
              <header className="brnd__section-head">
                <h2><FileText /> Narrative</h2>
                <span className="brnd__section-line" />
              </header>
              <div className="brnd__narrative">
                <NarrativeCard title="Brand story" value={g.story} hue="var(--os-c-purple)" />
                <NarrativeCard title="Positioning" value={g.positioning} hue="var(--os-c-blue)" />
                <NarrativeCard title="Voice & tone" value={g.voiceAndTone} hue="var(--os-c-teal)" />
                <NarrativeCard title="Messaging pillars" value={g.messaging} hue="var(--os-c-pink)" />
              </div>
            </section>

            {/* Visual identity */}
            <section className="brnd__section">
              <header className="brnd__section-head">
                <h2><ImageIcon /> Visual identity</h2>
                <span className="brnd__section-line" />
              </header>
              <div className="brnd__visual">
                <article className="brnd__visual-card">
                  <header><h3><Layers /> Logo</h3></header>
                  {g.logoUrl ? (
                    <div className="brnd__logo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.logoUrl} alt="Brand logo" />
                      <span className="brnd__logo-sub">{g.logoUrl}</span>
                    </div>
                  ) : (
                    <div className="brnd__visual-empty">No logo uploaded.</div>
                  )}
                </article>
                <article className="brnd__visual-card">
                  <header><h3><CheckCircle2 /> Logo usage rules</h3></header>
                  <p className="brnd__visual-body">{g.logoUsage ?? "Not documented yet."}</p>
                </article>
                <article className="brnd__visual-card brnd__visual-card--wide">
                  <header><h3><ImageIcon /> Imagery guidelines</h3></header>
                  <p className="brnd__visual-body">{g.imageryGuidelines ?? "Not documented yet."}</p>
                </article>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function NarrativeCard({ title, value, hue }: { title: string; value?: string; hue: string }) {
  return (
    <article className="brnd__narrative-card" style={{ ["--n-c" as unknown as string]: hue }}>
      <header className="brnd__narrative-head">
        <h3>{title}</h3>
        {value ? <span className="brnd__narrative-status"><CheckCircle2 /> Set</span> : <span className="brnd__narrative-status brnd__narrative-status--empty">Empty</span>}
      </header>
      <p className="brnd__narrative-body">{value ?? "Not documented yet."}</p>
      <span className="brnd__narrative-foot">Edit <ChevronRight /></span>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Palette; label: string; value: string; sub: string }) {
  return (
    <div className="brnd__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="brnd__kpi-accent" aria-hidden="true" />
      <div className="brnd__kpi-row">
        <div className="brnd__kpi-icon"><Icon /></div>
        <div className="brnd__kpi-label">{label}</div>
      </div>
      <div className="brnd__kpi-value">{value}</div>
      <div className="brnd__kpi-sub">{sub}</div>
    </div>
  );
}
