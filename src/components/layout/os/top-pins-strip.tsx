"use client";

// TopPinsStrip: the "Favorite > Top" chip row under the bar. Renders the
// viewer's top-pinned Spaces, Folders, Lists, Tables, Docs and Canvases as
// chips; hover a chip for its X. Pinned from any container's "..." menu
// ("Pin to top"), read from GET /api/me/pins, and refreshed on
// "workwrk:pins-changed" so a pin made elsewhere shows at once.
//
// It sits in the frame's second row (with the offline strip), on the canvas
// tokens, and takes no height at all while there is nothing pinned.
//
// No layout shift: the boot payload already says whether this person has
// pins (prefs.home.topPins), so the 36px row is reserved from the first
// paint, with skeleton chips, and the hydrated chips replace them when
// GET /api/me/pins answers. Before, the strip returned null until the fetch
// resolved and then pushed the whole page down on every hard load.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { apiFetch } from "@/lib/api-fetch";
import { useBoot } from "./boot-context";
import { useObjectHref } from "./use-object-href";

type PinChip = { kind: string; id: string; label: string; href: string; icon: string | null; color: string | null };

export const PINS_CHANGED_EVENT = "workwrk:pins-changed";

export function TopPinsStrip() {
  // A pin's stored href is canonical; it opens in the section the strip is
  // shown in (src/lib/nav/object-href.ts), and a pin of the object already
  // open goes to the address it is mounted at.
  const { map: sectionLink } = useObjectHref();
  const { boot } = useBoot();
  const bootPinCount = Array.isArray(boot.prefs.home?.topPins) ? boot.prefs.home.topPins.length : 0;
  // null = not hydrated yet (the boot count decides whether to reserve the row).
  const [pins, setPins] = useState<PinChip[] | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ pins?: PinChip[] }>("/api/me/pins", { cache: "no-store" });
    if (r.ok) setPins(Array.isArray(r.data?.pins) ? r.data.pins : []);
  }, []);

  useEffect(() => {
    const onChange = () => { void load(); };
    // The first read is deferred a tick: the effect subscribes, the network
    // answers later, and no state is written synchronously inside it.
    const t = window.setTimeout(onChange, 0);
    window.addEventListener(PINS_CHANGED_EVENT, onChange);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(PINS_CHANGED_EVENT, onChange);
    };
  }, [load]);

  const remove = useCallback(async (p: PinChip) => {
    setPins((prev) => (prev ?? []).filter((x) => !(x.kind === p.kind && x.id === p.id)));
    await apiFetch("/api/me/pins", { method: "POST", json: { kind: p.kind, id: p.id, on: false } });
    window.dispatchEvent(new CustomEvent(PINS_CHANGED_EVENT));
  }, []);

  if (pins === null ? bootPinCount === 0 : pins.length === 0) return null;

  return (
    <div
      aria-label="Pinned to top"
      aria-busy={pins === null}
      className="os-chrome flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-app px-3 os-no-scrollbar"
    >
      {pins === null ? (
        Array.from({ length: Math.min(bootPinCount, 6) }, (_, i) => (
          <span key={i} className="inline-flex h-7 w-28 shrink-0 rounded-md bg-skeleton os-skeleton-pulse" aria-hidden />
        ))
      ) : pins.map((p) => (
        <span
          key={`${p.kind}:${p.id}`}
          className="group inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-raised pe-0.5 ps-1.5 text-sm text-ink hover:bg-hover"
        >
          <Link href={sectionLink(p.href)} className="inline-flex min-w-0 items-center gap-1.5" title={p.label}>
            <EntityTile size="xs" icon={p.icon} color={p.color ?? undefined} name={p.label} />
            <span className="max-w-[160px] truncate">{p.label}</span>
          </Link>
          <button
            type="button"
            onClick={() => void remove(p)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-3 opacity-0 hover:bg-active hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`Unpin ${p.label} from top`}
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </span>
      ))}
    </div>
  );
}
