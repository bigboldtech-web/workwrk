"use client";

// Assign / reassign / unassign an asset. Lists org people from
// GET /api/users (already org-scoped + scope-gated server-side) and
// PATCHes /api/assets/[id] with { assignedToId }. The server validates
// the chosen person belongs to the caller's org before it lands.

import { useEffect, useMemo, useState } from "react";
import { Search, UserRound, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { personName, type ApiAsset } from "./types";

type Person = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
  department?: { name?: string | null } | null;
};

function initials(p: Person): string {
  const a = (p.firstName ?? "").trim();
  const b = (p.lastName ?? "").trim();
  return ((a[0] ?? "") + (b[0] ?? "")).toUpperCase() || (p.email?.[0] ?? "?").toUpperCase();
}

export function AssignDialog({
  open, onOpenChange, asset, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  asset: ApiAsset | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPeople(null);
    setLoadErr(false);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users?limit=500");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const list: Person[] = json?.data ?? (Array.isArray(json) ? json : []);
        if (!cancelled) setPeople(list);
      } catch {
        if (!cancelled) setLoadErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const filtered = useMemo(() => {
    const list = people ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      personName(p).toLowerCase().includes(q) ||
      (p.email ?? "").toLowerCase().includes(q),
    );
  }, [people, query]);

  const patchAssignee = async (assignedToId: string | null) => {
    if (!asset) return;
    setBusyId(assignedToId ?? "__unassign__");
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(
          "Couldn't update assignment",
          res.status === 403 ? "You don't have permission for this." : (d?.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      toast.success(assignedToId ? "Asset assigned" : "Asset unassigned");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Network error", "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const currentId = asset?.assignedTo?.id ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign asset</DialogTitle>
          <DialogDescription>
            {asset ? asset.name : ""}
            {asset?.assignedTo ? ` · currently ${personName(asset.assignedTo) || "assigned"}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            autoFocus
            className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-surface-2 pl-9 pr-3 text-[14px] text-foreground placeholder:text-muted-2 focus-visible:outline-none focus-visible:border-[color:var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--accent)]/15"
          />
        </div>

        {currentId && (
          <Button
            variant="outline"
            className="justify-start gap-2 h-9"
            onClick={() => void patchAssignee(null)}
            disabled={busyId !== null}
          >
            <X className="h-3.5 w-3.5" /> Unassign (mark as returned)
          </Button>
        )}

        <div className="max-h-[46vh] overflow-y-auto -mx-1 px-1">
          {people === null && !loadErr ? (
            <div className="py-8 text-center text-[13.5px] text-muted-2">Loading people…</div>
          ) : loadErr ? (
            <div className="py-8 text-center text-[13.5px] text-[#E2445C]">Could not load people.</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-[13.5px] text-muted-2">No people match.</div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((p) => {
                const isCurrent = p.id === currentId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => { if (!isCurrent) void patchAssignee(p.id); }}
                      disabled={busyId !== null || isCurrent}
                      className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left appearance-none bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-default transition-colors"
                    >
                      <span className="shrink-0 h-7 w-7 rounded-full bg-[color:var(--os-brand)]/12 text-[color:var(--os-brand)] grid place-items-center text-[11.5px] font-semibold overflow-hidden">
                        {p.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.avatar} alt="" className="h-full w-full object-cover" />
                        ) : initials(p)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-foreground">
                          {personName(p) || p.email || "Unnamed"}
                        </span>
                        {(p.department?.name || p.email) && (
                          <span className="block truncate text-[12.5px] text-muted-2">
                            {p.department?.name || p.email}
                          </span>
                        )}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[12px] text-muted-2">
                          <UserRound className="h-3 w-3" /> current
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
