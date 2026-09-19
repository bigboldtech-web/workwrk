"use client";

// DuplicateContainerDialog — "Duplicate {name}" with one checkbox.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1, Space row 16 /
// Folder row 14 / List row 17: "opens a 400 confirm 'Duplicate {name}' with one
// checkbox 'Include tasks' (off)".
//
// WHY NOT `useConfirm`. That helper answers one yes/no, so folding "include
// tasks" into it would make Cancel mean two different things: "don't copy" and
// "copy without tasks". A copy is not destructive and its one question is a
// real choice, so it gets its own 400 dialog with the checkbox OFF, which is
// what a person almost always wants: the shape of the thing, not its contents.
//
// The host mounts this only while it is open, so the checkbox starts off on
// every open without an effect pushing props into state.

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Dots } from "@/components/ui/dots";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** "Space" | "Folder" | "List", already capitalised. */
  noun: string;
  busy?: boolean;
  onConfirm: (includeTasks: boolean) => void;
}

export function DuplicateContainerDialog({ open, onOpenChange, name, noun, busy = false, onConfirm }: Props) {
  const [includeTasks, setIncludeTasks] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-[420px] gap-0 p-6" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="text-base leading-none">Duplicate {name}</DialogTitle>
        <p className="mt-2.5 text-base leading-relaxed text-muted">
          {noun === "List"
            ? "The copy keeps this List's statuses, fields and saved views."
            : `The copy keeps this ${noun.toLowerCase()}'s folders, lists, statuses, fields and saved views.`}
        </p>
        <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-line-strong"
            checked={includeTasks}
            onChange={(e) => setIncludeTasks(e.target.checked)}
            disabled={busy}
          />
          <span className="text-base text-foreground">Include tasks</span>
        </label>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => onConfirm(includeTasks)} disabled={busy}>
            {busy ? <Dots variant="pending" /> : null}
            Duplicate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
