"use client";

// The time zone a schedule runs in: a searchable Picker over the zones this
// browser knows (Intl.supportedValuesOf), with UTC first and the schedule's
// own value always present, even when the browser lists that zone under
// another name (a stored Asia/Kolkata against the browser's Asia/Calcutta:
// timezoneOptions matches them through canonicalZone and shows the stored
// name, once).

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { timezoneOptions, zoneLabel } from "@/lib/reports/schedule-form";

function supportedZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return fn ? fn("timeZone") : [];
  } catch {
    return [];
  }
}

export function TimezonePicker({
  value,
  onChange,
  disabled,
  onOpenChange,
}: {
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
  /** Told when the list opens and closes, so a clipping host can make room. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
    // Only the open state is reported; a new callback identity is not news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Built once the picker is first opened: canonicalising ~400 zones is work
  // nobody needs until they look.
  const zones = useMemo(() => (open ? timezoneOptions(supportedZones(), value) : [value]), [open, value]);
  return (
    <span className="relative inline-flex min-w-0 max-w-full">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Time zone"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-3"
      >
        <span className="min-w-0 truncate">{zoneLabel(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        alwaysSearch
        ariaLabel="Time zone"
        searchPlaceholder="Search time zones"
        selected={value}
        width={280}
        sections={[{ options: zones.map((z) => ({ value: z, label: zoneLabel(z), keywords: z })) }]}
        onSelect={(z) => {
          setOpen(false);
          onChange(z);
        }}
      />
    </span>
  );
}
