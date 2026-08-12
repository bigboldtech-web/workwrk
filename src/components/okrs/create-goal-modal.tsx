"use client";

// Create-goal modal — title + level + ONE audience multi-select (people,
// departments and roles in grouped sections; see GoalAudiencePicker).
// A goal is created as ONE record: single accountable owner (defaults to
// the creator server-side rules), many contributors, one shared
// scoreboard — never per-person copies.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoalAudiencePicker, type AudienceEntry } from "@/components/okrs/goal-audience-picker";

export type GoalLevel = "COMPANY" | "DEPARTMENT" | "INDIVIDUAL";

const LEVEL_OPTIONS: { value: GoalLevel; label: string }[] = [
  { value: "COMPANY", label: "Company" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "INDIVIDUAL", label: "Individual" },
];

interface CreateGoalModalProps {
  open: boolean;
  /** Preselected level (which section's "Add" was clicked). Render this
   *  modal with `key={level}` so reopening at a different level remounts
   *  with a fresh preselection. */
  level: GoalLevel;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateGoalModal({ open, level, onClose, onCreated }: CreateGoalModalProps) {
  const [title, setTitle] = useState("");
  const [selLevel, setSelLevel] = useState<GoalLevel>(level);
  const [audience, setAudience] = useState<AudienceEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setAudience([]);
    setError(null);
  }

  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/okrs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          level: selLevel,
          assignees: audience.map((e) => ({ type: e.type, id: e.id })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      reset();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the goal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New objective</DialogTitle>
          <DialogDescription>
            One goal, one scoreboard — everyone assigned shares the same progress bar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Title
            </label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="What are we pushing toward?"
              className="h-8 text-[13px]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Level
            </label>
            <div className="flex gap-1.5">
              {LEVEL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSelLevel(o.value)}
                  className={`h-7 rounded-md border px-2.5 text-[12px] transition-colors ${
                    selLevel === o.value
                      ? "border-[#0073EA] bg-[#0073EA]/10 font-medium text-[#0073EA]"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Assignees
            </label>
            <GoalAudiencePicker value={audience} onChange={setAudience} />
            <p className="mt-1 text-[11px] text-zinc-400">
              Departments and roles resolve to their current members — new hires inherit automatically.
            </p>
          </div>

          {error && <p className="text-[12px] text-[#E2445C]">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onClose(); }} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Create goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
