import type { CSSProperties } from "react";

/**
 * The official workwrk mark — three lime rounded rectangles arranged
 * as a bento grid on a 48×48 unit canvas.
 *
 * Module A — 28×22  (top-left, primary)
 * Module B — 17×22  (top-right, accent)
 * Module C — 48×23  (full-width bottom, foundation)
 *
 * Gap between cells: 3 units. Corner radius: 6 units.
 * Single fill color — defaults to brand lime.
 *
 * Do not add strokes, gradients, or extra rectangles. If you need a
 * different finish (mono white, mono black, inverted), pass `color`.
 */
export function LogoMark({
  size = 24,
  color,
  className,
  title,
  style,
}: {
  size?: number | string;
  /** Override fill. If omitted, uses the adaptive brand color (lime in dark mode, near-black in light mode). */
  color?: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const fill = color ?? "var(--b-logo-color, #d4ff2e)";
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
      <rect x="0" y="0" width="28" height="22" rx="6" fill={fill} />
      <rect x="31" y="0" width="17" height="22" rx="6" fill={fill} />
      <rect x="0" y="25" width="48" height="23" rx="6" fill={fill} />
    </svg>
  );
}

/**
 * Icon + wordmark horizontal lockup. Geist 700, tracking -0.04em.
 * Used in nav bars, email signatures, doc headers.
 */
export function LogoLockup({
  iconSize = 24,
  wordSize = 18,
  color = "#d4ff2e",
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
