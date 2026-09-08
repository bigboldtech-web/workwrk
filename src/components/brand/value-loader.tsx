"use client";

// ValueLoader — the brand dots loader, captioned with a rotating company VALUE
// instead of a generic "Loading…". Drop-in for any full-panel / section loading
// state (a detail panel opening, a page fetching), so every wait doubles as a
// nudge toward a value. Falls back to plain dots (or `fallback`) when no value
// is set. For inline button spinners keep the bare <DotsLoader/>.

import type { CSSProperties } from "react";
import { DotsLoader } from "./dots-loader";
import { useCultureLine } from "@/lib/use-culture";

export function ValueLoader({
  size = 40,
  fallback = "",
  className,
  style,
}: {
  size?: number;
  /** Caption when no value is configured yet (default: none — just dots). */
  fallback?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const line = useCultureLine();
  return <DotsLoader size={size} label={line || fallback || undefined} className={className} style={style} />;
}

// Full-container centered version — for a panel/section/page loading state.
// Defaults to a transparent background + fill-height so it sits inside whatever
// container it's dropped into.
export function ValueLoaderScreen({
  background = "transparent",
  size = 44,
  minHeight = "100%",
}: {
  background?: string;
  size?: number;
  minHeight?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight, background, padding: 24 }}>
      <ValueLoader size={size} />
    </div>
  );
}
