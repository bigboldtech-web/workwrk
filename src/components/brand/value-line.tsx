"use client";

// ValueLine (spec-shell 1.6, design-system 5.15): the one 13/400 ink-2
// line with a rotating company value that sits under the first skeleton in
// a route loader or a long-running empty panel. No dots, no overlay, never
// blocks input, renders nothing when the org has no values. The values come
// from the boot payload (spec-shell 2.2 "Data": no fetch here); outside the
// frame there is no boot and the line stays empty.

import { useContext, useMemo } from "react";
import { BootContext } from "@/components/layout/os/boot-context";
import { nextRotateIndex } from "@/lib/use-culture";

export function ValueLine({ className }: { className?: string }) {
  const boot = useContext(BootContext);
  const values = boot?.boot.org.culture.values ?? [];
  const line = useMemo(() => {
    const pool = values.map((v) => v.trim()).filter(Boolean);
    return pool.length ? pool[nextRotateIndex(pool.length)] : "";
    // The rotation advances once per mount, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!line) return null;
  return (
    <p className={`m-0 text-sm text-ink-2 ${className ?? ""}`} aria-live="polite">
      {line}
    </p>
  );
}
