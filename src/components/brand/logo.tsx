import type { CSSProperties } from "react";

/**
 * The workwrk mark — three rounded rectangles arranged as a bento
 * grid on a 48×48 unit canvas. ClickUp-style: violet primary, with
 * subtle tonal variation across the three tiles for brand depth.
 *
 * Module A — 28×22  (top-left, primary tile)
 * Module B — 17×22  (top-right, accent tile)
 * Module C — 48×23  (full-width bottom, foundation tile)
 *
 * Gap between cells: 3 units. Corner radius: 7 units.
 *
 * Override the palette via `color` — passing a single color gives
 * the legacy single-tone mark. Default uses the gradient mark.
 */
export function LogoMark({
  size = 24,
  color,
  className,
  title,
  style,
  variant = "gradient",
}: {
  size?: number | string;
  /** Override fill. If omitted, uses the adaptive brand color. */
  color?: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
  /** "gradient" (default, ClickUp-style 3-tone) or "mono" (single fill). */
  variant?: "gradient" | "mono";
}) {
  const monoFill = color ?? "var(--b-logo-color, #7c3aed)";

  if (variant === "mono" || color) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        role={title ? "img" : undefined}
        aria-label={title ?? undefined}
        aria-hidden={title ? undefined : true}
        style={style}
      >
        <rect x="0" y="0" width="28" height="22" rx="7" fill={monoFill} />
        <rect x="31" y="0" width="17" height="22" rx="7" fill={monoFill} />
        <rect x="0" y="25" width="48" height="23" rx="7" fill={monoFill} />
      </svg>
    );
  }

  // Gradient variant — three violet shades for ClickUp-style depth.
  const gradId = "wwk-logo-grad";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      style={style}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      {/* Top-left primary tile — full violet 600 */}
      <rect x="0" y="0" width="28" height="22" rx="7" fill="#7c3aed" />
      {/* Top-right accent tile — violet 500 (slightly lighter) */}
      <rect x="31" y="0" width="17" height="22" rx="7" fill="#a78bfa" />
      {/* Bottom foundation tile — gradient 500 → 700 for depth */}
      <rect x="0" y="25" width="48" height="23" rx="7" fill={`url(#${gradId})`} />
    </svg>
  );
}

/**
 * Icon + wordmark horizontal lockup. Used in nav bars, email
 * signatures, doc headers.
 */
export function LogoLockup({
  iconSize = 24,
  wordSize = 18,
  color,
  textColor,
  gap = 9,
  className,
  style,
}: {
  iconSize?: number;
  wordSize?: number;
  color?: string;
  textColor?: string;
  gap?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        lineHeight: 1,
        ...style,
      }}
    >
      <LogoMark size={iconSize} color={color} />
      <span
        style={{
          fontWeight: 700,
          letterSpacing: "-0.04em",
          fontSize: wordSize,
          color: textColor ?? "inherit",
        }}
      >
        workwrk
      </span>
    </span>
  );
}
