"use client";

/* Templates — starter workspace bundles users can apply any time.
 *
 * Each template seeds a Doc + Form + Table into the current org. Lets
 * teams get from zero → useful in one click; great for new orgs but
 * also for teams adding a new function (e.g. spinning up Marketing).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutTemplate, FileText, FormInput, Table as TableIcon, Check, Loader2,
  Code2, Users, BarChart3, Megaphone, Boxes,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type ApiTemplate = {
  id: string; name: string; tagline: string; description: string;
  iconKey: string; gradient: string;
  summary: { doc: string; form: string; table: string };
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  code: Code2, users: Users, sales: BarChart3, megaphone: Megaphone, boxes: Boxes,
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ApiTemplate[] | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace-templates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setTemplates(d.data ?? (Array.isArray(d) ? d : []));
    } catch {
      setTemplates([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function apply(id: string) {
    setApplying(id);
    try {
      const res = await fetch("/api/workspace-templates/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApplied((prev) => new Set(prev).add(id));
      toast("Template applied — Doc, Form, and Table created");
    } catch { toast("Couldn't apply template"); }
    finally { setApplying(null); }
  }

  return (
    <div className="tmpl">
      <header className="tmpl__head">
        <div className="tmpl__icon"><LayoutTemplate /></div>
        <div>
          <h1>Workspace templates</h1>
          <p>Pick a team type — we&apos;ll seed a starter doc, form, and table so you can edit instead of starting blank.</p>
        </div>
      </header>

      {templates === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)" }}>Loading…</div>
      ) : templates.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)" }}>No templates configured.</div>
      ) : (
        <div className="tmpl__grid">
          {templates.map((t) => {
            const Icon = ICONS[t.iconKey] ?? LayoutTemplate;
            const isApplying = applying === t.id;
            const isApplied = applied.has(t.id);
            return (
              <article key={t.id} className="tmpl-card">
                <header className="tmpl-card__head" style={{ background: t.gradient }}>
                  <Icon />
                </header>
                <div className="tmpl-card__body">
                  <h3>{t.name}</h3>
                  <p className="tmpl-card__tagline">{t.tagline}</p>
                  <p className="tmpl-card__desc">{t.description}</p>
                  <ul className="tmpl-card__list">
                    <li><FileText /> Doc: <em>{t.summary.doc}</em></li>
                    <li><FormInput /> Form: <em>{t.summary.form}</em></li>
                    <li><TableIcon /> Table: <em>{t.summary.table}</em></li>
                  </ul>
                </div>
                <footer className="tmpl-card__foot">
                  <button type="button" className={`tmpl-card__btn ${isApplied ? "is-done" : ""}`} onClick={() => apply(t.id)} disabled={isApplying}>
                    {isApplying ? <><Loader2 className="tmpl-card__spin" /> Applying…</> : isApplied ? <><Check /> Applied — apply again?</> : "Apply template"}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <p className="tmpl__hint">After applying, find your new items at <Link href="/docs">/docs</Link>, <Link href="/forms">/forms</Link>, and <Link href="/tables">/tables</Link>.</p>
    </div>
  );
}
