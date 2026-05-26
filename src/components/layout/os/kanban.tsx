"use client";

import { MoreHorizontal, Plus, Calendar as CalendarIcon } from "lucide-react";
import type { Person } from "./title-bar";
import type { LabelColor } from "./main-table";

export type KCard = {
  id: string;
  title: string;
  refId?: string;
  labels?: { label: string; color: LabelColor }[];
  people?: Person[];
  date?: { iso: string; state?: "today" | "overdue" };
};

export type KColumn = {
  id: string;
  title: string;
  color: string;
  cards: KCard[];
};

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function OsKanban({ columns }: { columns: KColumn[] }) {
  return (
    <div className="os-kanban">
      {columns.map((col) => (
        <section key={col.id} className="os-kcol" aria-label={col.title}>
          <header className="os-kcol__head">
            <span className="os-kcol__stripe" style={{ background: col.color }} />
            <h3 className="os-kcol__title">
              {col.title}
              <span className="os-kcol__count">{col.cards.length}</span>
            </h3>
            <button type="button" className="os-kcol__menu" aria-label="Column menu">
              <MoreHorizontal />
            </button>
          </header>
          <div className="os-kcol__list">
            {col.cards.map((c) => (
              <article
                key={c.id}
                className="os-kcard"
                style={{ "--os-kcard-color": col.color } as React.CSSProperties}
              >
                <div className="os-kcard__top">
                  <h4 className="os-kcard__title">{c.title}</h4>
                  {c.refId ? <span className="os-kcard__id">{c.refId}</span> : null}
                </div>
                {c.labels && c.labels.length > 0 ? (
                  <div className="os-kcard__labels">
                    {c.labels.map((l, i) => (
                      <span key={i} className={`os-lbl os-c-${l.color}`}>{l.label}</span>
                    ))}
                  </div>
                ) : null}
                <div className="os-kcard__foot">
                  {c.people && c.people.length > 0 ? (
                    <div className="os-kcard__people">
                      {c.people.slice(0, 3).map((p, i) => (
                        <span key={i} className="os-av" style={{ background: p.color }}>{p.initials}</span>
                      ))}
                    </div>
                  ) : null}
                  {c.date ? (
                    <span className={`os-kcard__date ${c.date.state ? `is-${c.date.state}` : ""}`}>
                      <CalendarIcon />
                      {fmtShort(c.date.iso)}
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
            <button type="button" className="os-kcol__add">
              <Plus />
              <span>Add item</span>
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
