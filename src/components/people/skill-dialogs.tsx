"use client";

// Add skill (560) and Rate skill (400), on ui/dialog (spec-teams-people
// /people/[id] Skills tab and /people/skills). SkillPicker is the typeahead
// over GET /api/skills?names=1 with "Add '{text}'" as the last row, so the
// org's names stay consistent ("Figma", never "figma" and "FIGMA").

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";
import { cleanSkillName } from "@/lib/people/skills-aggregate";
import { RatingControl } from "./rating-control";

export const SKILLS_CHANGED = "workwrk:skills-changed";
export function emitSkillsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SKILLS_CHANGED));
}

export function SkillPicker({ value, onChange, exclude = [] }: { value: string; onChange: (v: string) => void; exclude?: string[] }) {
  const [names, setNames] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let live = true;
    void apiFetch<{ names: string[] }>("/api/skills?names=1", { cache: "no-store" }).then((r) => { if (live && r.ok) setNames(r.data.names ?? []); });
    return () => { live = false; };
  }, []);
  const held = useMemo(() => new Set(exclude.map((n) => n.toLowerCase())), [exclude]);
  const needle = value.trim().toLowerCase();
  const matches = names.filter((n) => !held.has(n.toLowerCase()) && (!needle || n.toLowerCase().includes(needle))).slice(0, 8);
  const exact = names.some((n) => n.toLowerCase() === needle);
  const rows = [...matches.map((n) => ({ key: n, label: n, value: n })), ...(needle && !exact ? [{ key: "__add", label: `Add "${value.trim()}"`, value: value.trim() }] : [])];
  return (
    <div className="relative">
      <input
        autoFocus
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || rows.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === "Enter" && rows[active]) { e.preventDefault(); onChange(rows[active].value); setOpen(false); }
          if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
        }}
        placeholder="Figma, SQL, Negotiation"
        maxLength={60}
        role="combobox"
        aria-expanded={open}
        aria-controls="skill-picker-list"
        aria-label="Skill name"
        className="h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-ink focus:border-brand focus:outline-none"
      />
      {open && rows.length > 0 ? (
        <ul id="skill-picker-list" role="listbox" className="absolute start-0 top-10 z-50 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]">
          {rows.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(r.value); setOpen(false); }}
                className={`flex h-8 w-full items-center px-3 text-start text-sm ${i === active ? "bg-hover text-ink" : "text-ink hover:bg-hover"}`}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AddSkillDialog({
  userId,
  self,
  held,
  initialName = "",
  onClose,
  onAdded,
}: {
  userId: string;
  /** Adding to your own record: you rate yourself. */
  self: boolean;
  held: string[];
  initialName?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useOsToast();
  const [name, setName] = useState(initialName);
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanSkillName(name);
  async function add() {
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch(`/api/users/${userId}/skills`, { method: "POST", json: { name: clean, selfRating: self ? rating ?? 0 : 0 } });
    setBusy(false);
    if (!r.ok) { setError(r.status === 409 ? "That skill is already on the record." : r.error || "Couldn't add the skill"); return; }
    toast(`Added ${clean}`);
    emitSkillsChanged();
    onAdded();
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add skill</DialogTitle>
          <DialogDescription>{self ? "Pick a name the company already uses, or add a new one." : "Adds the skill to this record. They rate themselves."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Skill</span>
            <SkillPicker value={name} onChange={setName} exclude={held} />
          </label>
          {self ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">Self rating</span>
              <RatingControl value={rating} onChange={setRating} label="Self rating" />
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void add()} disabled={!clean || busy}>{busy ? "Adding" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RateSkillDialog({
  userId,
  skill,
  mode,
  onClose,
  onRated,
}: {
  userId: string;
  skill: { id: string; name: string; selfRating: number | null; managerRating: number | null };
  /** "self" rates your own skill; "manager" gives the manager rating. */
  mode: "self" | "manager";
  onClose: () => void;
  onRated: () => void;
}) {
  const { toast } = useOsToast();
  const start = mode === "self" ? skill.selfRating : skill.managerRating;
  const [rating, setRating] = useState<number | null>(start && start <= 5 ? start : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!rating || busy) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch(`/api/users/${userId}/skills/${skill.id}`, { method: "PATCH", json: mode === "self" ? { selfRating: rating } : { managerRating: rating } });
    setBusy(false);
    if (!r.ok) { setError(r.error || "Couldn't save the rating"); return; }
    toast(`Rated ${skill.name} ${rating}/5`);
    emitSkillsChanged();
    onRated();
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{mode === "self" ? "Edit rating" : "Rate skill"}</DialogTitle>
          <DialogDescription>{skill.name}</DialogDescription>
        </DialogHeader>
        <RatingControl value={rating} onChange={setRating} label={mode === "self" ? "Self rating" : "Manager rating"} />
        {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!rating || busy}>{busy ? "Saving" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
