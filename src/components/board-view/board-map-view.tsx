"use client";

// BoardMapView — MAP renderer. Groups items by their LOCATION field
// value (plain string, same shape FieldValue edits) and renders a
// location card per place with its items + an open-in-Google-Maps
// link. An interactive pin map needs a maps lib + geocoding — that's
// the documented follow-up; this view makes location data usable now.
// View.config.locationKey can pin a specific LOCATION field; default
// is the board's first one.

import { useMemo } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

interface BoardMapViewProps {
  viewConfig: Record<string, unknown>;
  initialItems: BoardItemRow[];
  initialFields?: FieldDef[];
  statuses: StatusOption[];
  onOpenItem?: (itemId: string) => void;
}

export function BoardMapView({ viewConfig, initialItems, initialFields, statuses, onOpenItem }: BoardMapViewProps) {
  const fields = useMemo(() => initialFields ?? [], [initialFields]);
  const locationField = useMemo(() => {
    const configured = typeof viewConfig?.locationKey === "string" ? (viewConfig.locationKey as string) : null;
    const locationFields = fields.filter((f) => f.type === "LOCATION");
    return locationFields.find((f) => f.key === configured) ?? locationFields[0] ?? null;
  }, [fields, viewConfig]);

  const groups = useMemo(() => {
    if (!locationField) return [];
    const map = new Map<string, BoardItemRow[]>();
    for (const it of initialItems) {
      const raw = it.metadata?.[locationField.key];
      if (typeof raw !== "string" || !raw.trim()) continue;
      const key = raw.trim();
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([place, rows]) => ({ place, rows }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [initialItems, locationField]);

  const located = groups.reduce((a, g) => a + g.rows.length, 0);

  if (!locationField) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <MapPin className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <h3 className="text-[15px] font-semibold text-zinc-900 mb-1">No Location field yet</h3>
        <p className="text-[12.5px] text-zinc-500 max-w-sm mx-auto">
          Add a <span className="font-medium">Location</span> field from the Fields shelf, fill it on
          your tasks, and this view groups them by place.
        </p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <MapPin className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[12.5px] text-zinc-500">
          No items have a {locationField.label} value yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        {located} of {initialItems.length} item{initialItems.length === 1 ? "" : "s"} located via{" "}
        <span className="font-medium text-zinc-500">{locationField.label}</span> · interactive pin map
        lands with the maps-library integration.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {groups.map(({ place, rows }) => (
          <div key={place} className="rounded-lg border border-zinc-200 bg-white p-3">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-zinc-900" title={place}>
                {place}
              </span>
              <span className="text-[11px] text-zinc-400 tabular-nums">{rows.length}</span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
                aria-label={`Open ${place} in Google Maps`}
                title="Open in Google Maps"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <ul className="space-y-1">
              {rows.map((it) => {
                const opt = it.status ? statuses.find((o) => o.value === it.status) : null;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => onOpenItem?.(it.id)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] text-zinc-700 hover:bg-zinc-50"
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: opt?.color ?? "#A1A1AA" }}
                        aria-hidden
                      />
                      <span className="truncate">{it.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
