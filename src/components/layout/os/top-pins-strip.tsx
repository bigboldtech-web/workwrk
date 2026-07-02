"use client";

// TopPinsStrip — the ClickUp "Favorite → Top" chip strip. Renders the viewer's
// top-pinned favorites (any kind) as clickable chips near the topbar; hover a
// chip to remove it. Reacts to "workwrk:pins-changed" so pinning elsewhere
// updates it live.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";

type PinChip = { kind: string; id: string; label: string; href: string; icon: string | null; color: string | null };

export function TopPinsStrip() {
  const [pins, setPins] = useState<PinChip[]>([]);

  const load = useCallback(() => {
    fetch("/api/me/pins", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { pins: [] }))
      .then((d) => setPins(Array.isArray(d.pins) ? d.pins : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("workwrk:pins-changed", onChange);
    return () => window.removeEventListener("workwrk:pins-changed", onChange);
  }, [load]);

  const remove = useCallback(async (p: PinChip) => {
    setPins((prev) => prev.filter((x) => !(x.kind === p.kind && x.id === p.id)));
    await fetch("/api/me/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: p.kind, id: p.id, on: false }),
    }).catch(() => {});
  }, []);

  if (pins.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-1 shrink-0 overflow-x-auto no-scrollbar">
      {pins.map((p) => (
        <span
          key={`${p.kind}:${p.id}`}
          className="group inline-flex items-center gap-1 h-6 pl-1 pr-0.5 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-[12px] text-zinc-700 shrink-0"
        >
          <Link href={p.href} className="inline-flex items-center gap-1.5 min-w-0" title={p.label}>
            <EntityTile size="sm" icon={p.icon} color={p.color ?? undefined} name={p.label} />
            <span className="truncate max-w-[140px]">{p.label}</span>
          </Link>
          <button
            type="button"
            onClick={() => remove(p)}
            className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200 shrink-0"
            aria-label={`Remove ${p.label} from top`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
