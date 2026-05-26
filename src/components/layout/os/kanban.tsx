"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal, Plus, Calendar as CalendarIcon } from "lucide-react";
import type { Person } from "./title-bar";
import type { LabelColor } from "./main-table";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";

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

export function OsKanban({ columns: initial, moduleId = "tasks" }: { columns: KColumn[]; moduleId?: string }) {
  const { openItemDrawer } = useOsShell();
  const { toast } = useOsToast();
  const [columns, setColumns] = useState<KColumn[]>(initial);

  // dragging state — local to this render only
  const [dragging, setDragging] = useState<{ colId: string; cardId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => { setColumns(initial); }, [initial]);

  function move(fromColId: string, cardId: string, toColId: string) {
    if (fromColId === toColId) return;
    let movedCard: KCard | null = null;
    const fromCol = columns.find((c) => c.id === fromColId);
    const toCol = columns.find((c) => c.id === toColId);
    if (!fromCol || !toCol) return;

    setColumns((cols) => cols.map((col) => {
      if (col.id === fromColId) {
        const card = col.cards.find((c) => c.id === cardId);
        if (card) movedCard = card;
        return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
      }
      if (col.id === toColId && movedCard) {
        return { ...col, cards: [...col.cards, movedCard] };
      }
      return col;
    }));
    toast(`Moved to "${toCol.title}"`);
  }

  return (
    <div className="os-kanban">
      {columns.map((col) => (
        <section
          key={col.id}
          className={`os-kcol ${dropTarget === col.id ? "is-drop-target" : ""}`}
          aria-label={col.title}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragging && dragging.colId !== col.id) setDropTarget(col.id);
          }}
          onDragLeave={(e) => {
            // only clear if we left the column entirely
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left || e.clientX > r.right ||
              e.clientY < r.top || e.clientY > r.bottom
            ) {
              setDropTarget((t) => (t === col.id ? null : t));
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragging) move(dragging.colId, dragging.cardId, col.id);
            setDragging(null);
            setDropTarget(null);
          }}
        >
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
          <div className="os-kcol__list os-kcol__list-empty-target">
            {col.cards.length === 0 && dropTarget === col.id ? (
              <div className="os-kcol__list-empty">Drop here</div>
            ) : null}
            {col.cards.map((c) => (
              <article
                key={c.id}
                className={`os-kcard ${dragging?.cardId === c.id ? "is-dragging" : ""}`}
                style={{ "--os-kcard-color": col.color } as React.CSSProperties}
                draggable
                onDragStart={(e) => {
                  setDragging({ colId: col.id, cardId: c.id });
                  e.dataTransfer.effectAllowed = "move";
                  // some browsers require some data set
                  e.dataTransfer.setData("text/plain", c.id);
                }}
                onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                onClick={() => openItemDrawer({ moduleId, itemId: c.refId ?? c.id.toUpperCase(), name: c.title, groupColor: col.color })}
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
            <button
              type="button"
              className="os-kcol__add"
              onClick={() => {
                const newCard: KCard = {
                  id: `new-${Date.now()}`,
                  title: "Untitled card",
                  refId: `NEW-${Math.floor(Math.random() * 900 + 100)}`,
                };
                setColumns((cs) => cs.map((c) =>
                  c.id === col.id ? { ...c, cards: [...c.cards, newCard] } : c
                ));
                toast("Card added");
              }}
            >
              <Plus />
              <span>Add item</span>
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
