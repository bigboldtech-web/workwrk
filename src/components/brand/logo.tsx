import type { CSSProperties } from "react";

// The workwrk mark — three rounded rectangles arranged as a bento grid
// on a 48x48 canvas. The shape is the brand; the color is a quiet note.
//
//   Tile A  top-left, 28x22     primary tile  (violet 600)
//   Tile B  top-right, 17x22    accent tile   (violet 500)
//   Tile C  bottom-strip, 48x23 foundation tile (violet 700)
//
// Gap: 3 units. Corner radius: 7 units.
//
// Variants:
//   "tonal"  (default) — three shades of violet. Subtle, professional.
//   "mono"           — single fill (use a color prop or currentColor).
//
// The previous "rainbow" variant — multi-hue tiles with a gradient
// strip — was retired for being too noisy against the new restrained
// marketing aesthetic. The shape carries the brand; chrome stays calm.

export function LogoMark({
  size = 24,
  color,
  className,
  title,
  style,
  variant = "tonal",
}: {
  size?: number | string;
  color?: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
  variant?: "tonal" | "mono";
}) {
  const monoFill = color ?? "currentColor";

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
        <rect x="0"  y="0"  width="28" height="22" rx="7" fill={monoFill} />
        <rect x="31" y="0"  width="17" height="22" rx="7" fill={monoFill} />
        <rect x="0"  y="25" width="48" height="23" rx="7" fill={monoFill} />
      </svg>
    );
  }

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
      <rect x="0"  y="0"  width="28" height="22" rx="7" fill="#7c3aed" />
      <rect x="31" y="0"  width="17" height="22" rx="7" fill="#a78bfa" />
      <rect x="0"  y="25" width="48" height="23" rx="7" fill="#6d28d9" />
    </svg>
  );
}

// Horizontal lockup — icon mark + "workwrk" wordmark.
export function LogoLockup({
  iconSize = 26,
  wordSize = 18,
  color,
  textColor,
  gap = 9,
  className,
  style,
  variant = "tonal",
}: {
  iconSize?: number;
  wordSize?: number;
  color?: string;
  textColor?: string;
  gap?: number;
  className?: string;
  style?: CSSProperties;
  variant?: "tonal" | "mono";
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
      <LogoMark size={iconSize} color={color} variant={variant} />
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
