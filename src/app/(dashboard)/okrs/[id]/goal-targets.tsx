"use client";

// GoalTargets — the ClickUp-style "Targets" card on the goal detail page
// (Key Results = Targets). Header carries "+ Add"; each target is a row:
// owner avatar, title, right-aligned thin progress bar with a caption +
// current/target fraction, and a "…" menu (Check in / Delete target).
// Clicking a row expands it inline to the Start / Current / Target caption
// and the existing check-in form (okr-checkin-form — mechanics untouched,
// direction-aware math stays server-side). KPI-linked targets are measured
// BY their gauge, so they show the link instead of a check-in form.
//
// Empty state is honest ClickUp copy + "Create a Target" — no fake numbers.
// The composer POSTs /api/okrs/[id]/key-results; row delete goes through
// DELETE /api/okrs/[id]/key-results/[krId] with useConfirm. Both gate on
// canEdit (the exact canEditOkrOwner rule those routes enforce), then
// router.refresh() so the server-rendered ring/Timeline repaint.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, Pencil, Plus, Target as TargetIcon, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { OkrCheckInForm } from "./okr-checkin-form";

export interface TargetRowData {
  id: string;
  title: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progress: number;
  /** Measured by a linked role KPI — check-ins are refused server-side. */
  isDerived: boolean;
  kpiName: string | null;
  /** Pre-formatted relative time of the last check-in (server clock). */
  lastCheckIn: string | null;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function GoalTargets({ okrId, canEdit, owner, targets }: {
  okrId: string;
  /** canEditOkrOwner — the gate POST/DELETE key-results + check-in enforce. */
  canEdit: boolean;
  /** The goal's accountable owner — targets inherit their avatar. */
  owner: PersonRef | null;
  targets: TargetRowData[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="okrd-card">
      <header>
        <h2>Targets</h2>
        <div className="okrd-card__tools">
          {targets.length > 0 && <span className="okrd-card__count">{targets.length}</span>}
          {canEdit && (
            <button type="button" className="okrd-add" onClick={() => setAdding((v) => !v)}>
              <Plus /> Add
            </button>
          )}
        </div>
      </header>

      {targets.length === 0 && !adding ? (
        <div className="okrd-targets-empty">
          <TargetIcon />
          <p>Targets are specific and measurable pieces that must be accomplished in order to reach your Goal.</p>
          {canEdit && (
            <button type="button" className="okrd-cta" onClick={() => setAdding(true)}>
              Create a Target
            </button>
          )}
        </div>
      ) : (
        <ol className="okrd-targets">
          {targets.map((t) => (
            <TargetRow key={t.id} okrId={okrId} target={t} owner={owner} canEdit={canEdit} />
          ))}
        </ol>
      )}

      {adding && <TargetComposer okrId={okrId} onDone={() => setAdding(false)} />}
    </section>
  );
}

/* ── one target row (expandable to the inline check-in) ─────────────── */

function TargetRow({ okrId, target: t, owner, canEdit }: {
  okrId: string;
  target: TargetRowData;
  owner: PersonRef | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as Node;
      if (panelRef.current?.contains(el) || btnRef.current?.contains(el)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const pct = Math.max(0, Math.min(100, t.progress));

  const del = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: "Delete target",
      description: `Delete "${t.title}"? Its check-in history goes with it, and the Goal's progress re-rolls from what's left. This can't be undone.`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/okrs/${okrId}/key-results/${t.id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Target deleted");
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't delete target");
      }
    } catch {
      toast("Couldn't delete target");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="okrd-target">
      <button
        type="button"
        className="okrd-target__row"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {owner ? (
          <PersonAvatar person={owner} size={24} />
        ) : (
          <span className="okrd-target__noowner" aria-hidden>?</span>
        )}
        <span className="okrd-target__text">
          <span className="okrd-target__title">{t.title}</span>
          <span className="okrd-target__sub">
            {t.isDerived && t.kpiName
              ? `measured by KPI · ${t.kpiName}`
              : t.lastCheckIn
                ? `last check-in ${t.lastCheckIn}`
                : "no check-ins yet"}
          </span>
        </span>
        <span className="okrd-target__prog">
          <span className="okrd-target__cap">{t.unit?.trim() || "value"}</span>
          <span className="okrd-target__track">
            <span className="okrd-target__fill" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className="okrd-target__frac">{fmtNum(t.currentValue)}/{fmtNum(t.targetValue)}</span>
      </button>

      <span className="okrd-target__menu" data-open={menuOpen ? "true" : "false"}>
        <button
          ref={btnRef}
          type="button"
          className="okrd-target__menu-btn"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          title="Target actions"
          aria-label="Target actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal />
        </button>
        <MorePortal anchorRef={btnRef} panelRef={panelRef} width={190} open={menuOpen} placement="below">
          <MenuList className="min-w-[190px]" onClick={(e) => e.stopPropagation()}>
            <MenuItem
              icon={Pencil}
              label={expanded ? "Hide check-in" : "Check in"}
              onClick={() => { setMenuOpen(false); setExpanded((v) => !v); }}
            />
            {canEdit && (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete target" destructive onClick={del} busy={busy} />
              </>
            )}
          </MenuList>
        </MorePortal>
      </span>

      {expanded && (
        <div className="okrd-target__detail">
          {t.isDerived ? (
            <p className="okrd-target__derived">
              This target is measured by the KPI <strong>{t.kpiName ?? "linked KPI"}</strong> — record the KPI reading and the number lands here automatically.
            </p>
          ) : canEdit ? (
            <OkrCheckInForm
              okrId={okrId}
              keyResultId={t.id}
              unit={t.unit ?? ""}
              current={t.currentValue}
              start={t.startValue}
              target={t.targetValue}
            />
          ) : (
            <p className="okrd-target__readonly">
              Start {fmtNum(t.startValue)}{t.unit ?? ""} · Current {fmtNum(t.currentValue)}{t.unit ?? ""} · Target {fmtNum(t.targetValue)}{t.unit ?? ""}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/* ── inline composer ("+ Add" / "Create a Target") ──────────────────── */

function TargetComposer({ okrId, onDone }: { okrId: string; onDone: () => void }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [title, setTitle] = useState("");
  const [startValue, setStartValue] = useState("0");
  const [targetValue, setTargetValue] = useState("100");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    const start = Number(startValue);
    const target = Number(targetValue);
    if (Number.isNaN(start) || Number.isNaN(target)) {
      setError("Start and Target must be numbers");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/okrs/${okrId}/key-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          startValue: start,
          targetValue: target,
          unit: unit.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      toast("Target created");
      onDone();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the target");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="okrd-composer" onSubmit={submit}>
      <div>
        <label className="okrd-composer__label" htmlFor="okrd-target-name">Target name</label>
        <Input
          id="okrd-target-name"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What measurable result defines success?"
          className="h-8 text-[13px]"
        />
      </div>
      <div className="okrd-composer__grid">
        <div>
          <label className="okrd-composer__label" htmlFor="okrd-target-start">Start</label>
          <Input id="okrd-target-start" type="number" step="any" value={startValue} onChange={(e) => setStartValue(e.target.value)} className="h-8 text-[13px]" />
        </div>
        <div>
          <label className="okrd-composer__label" htmlFor="okrd-target-target">Target</label>
          <Input id="okrd-target-target" type="number" step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className="h-8 text-[13px]" />
        </div>
        <div>
          <label className="okrd-composer__label" htmlFor="okrd-target-unit">Unit <em>(optional)</em></label>
          <Input id="okrd-target-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, $, users…" className="h-8 text-[13px]" />
        </div>
      </div>
      {error && <p className="okrd-composer__error">{error}</p>}
      <div className="okrd-composer__actions">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || !title.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Create a Target
        </Button>
      </div>
    </form>
  );
}
