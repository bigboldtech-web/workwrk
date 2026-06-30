// StatusGlyph — the ClickUp-style progress status circle, shared by the board
// List (board-table-view) and the Space "List" tab so both render identically.
//
//   no status / first "to do"  → dashed ring ("cut cut cut")
//   mid-pipeline               → solid ring + pie wedge filled to the fraction
//                                of how far the status sits in the list
//   DONE / CLOSED              → solid fill + white check

import { Check } from "lucide-react";
import type { StatusOption } from "@/lib/board-items-shared";

// SVG pie wedge from 12 o'clock, clockwise, covering `fraction` of the circle.
export function piePath(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  const start = -Math.PI / 2;
  const end = start + f * 2 * Math.PI;
  const sx = cx + r * Math.cos(start);
  const sy = cy + r * Math.sin(start);
  const ex = cx + r * Math.cos(end);
  const ey = cy + r * Math.sin(end);
  const largeArc = f > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)} Z`;
}

export function StatusGlyph({ current, statuses }: { current: StatusOption | null; statuses: StatusOption[] }) {
  if (!current) {
    return <span className="inline-block w-[15px] h-[15px] rounded-full border-[1.6px] border-dashed border-zinc-300 shrink-0" aria-hidden />;
  }
  if (current.group === "DONE" || current.group === "CLOSED") {
    return (
      <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full shrink-0" style={{ backgroundColor: current.color }} aria-hidden>
        <Check className="w-2.5 h-2.5 text-white" />
      </span>
    );
  }
  const idx = statuses.findIndex((o) => o.value === current.value);
  const n = statuses.length;
  const fraction = n > 1 && idx >= 0 ? idx / (n - 1) : 0;
  if (fraction <= 0) {
    return (
      <svg viewBox="0 0 16 16" className="w-[15px] h-[15px] shrink-0" aria-hidden>
        <circle cx="8" cy="8" r="6" fill="none" stroke={current.color} strokeWidth="1.8" strokeDasharray="2.4 1.9" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="w-[15px] h-[15px] shrink-0" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke={current.color} strokeWidth="1.8" />
      <path d={piePath(8, 8, 4.6, fraction)} fill={current.color} />
    </svg>
  );
}
