import type { CSSProperties } from "react";

// workwrk logo. The brand palette is "Workwrk YBRG": four Monday dots
// sequenced yellow, blue, red, green, sitting just above the wordmark
// (tucked into the gap between the two "k" letters of "workwrk"). Blue
// is the primary colour; the others are accents used per surface. The
// dots are the brand; the wordmark is the name.
//
// Variants
//   default - colored dots + dark wordmark, for light surfaces
//   mono    - single-color rendering (use `color`), for dark surfaces,
//             favicons, embossed contexts

// Workwrk YBRG palette. Blue is primary.
export const BRAND_YELLOW = "#FFCB00";
export const BRAND_BLUE   = "#0073EA";
export const BRAND_RED    = "#FF3D57";
export const BRAND_GREEN  = "#00C875";

// The required dot sequence: yellow, blue, red, green.
const DOT_SEQUENCE = [BRAND_YELLOW, BRAND_BLUE, BRAND_RED, BRAND_GREEN] as const;

// LogoMark, the dots-only variant. Use when you need a square icon
// (favicon, app icon, isolated brand bug). Four dots in a row.
export function LogoMark({
  size = 32,
  color,
  className,
  title,
  style,
}: {
  size?: number | string;
  color?: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  // Even spacing of four dots across the 48-unit canvas.
  const xs = [9.6, 19.2, 28.8, 38.4];

  // Mono mode: single fill, four dots inside a rounded square.
  if (color) {
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
        <rect x="0" y="0" width="48" height="48" rx="12" fill={color} />
        {xs.map((cx) => (
          <circle key={cx} cx={cx} cy="24" r="4" fill="white" />
        ))}
      </svg>
    );
  }

  // Default mode: four colored dots on transparent, no background square.
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
      {xs.map((cx, i) => (
        <circle key={cx} cx={cx} cy="24" r="5.2" fill={DOT_SEQUENCE[i]} />
      ))}
    </svg>
  );
}

// LogoLockup, the workhorse for headers and footers. Wordmark with the
// four brand dots floating just above, centered in the gap between the
// two "k" letters of "workwrk".
//
// Layout:
//   . . . .     (yellow, blue, red, green, anchored between the two k's)
//   workwrk     (wordmark, rounded sans, tightly tracked)
export function LogoLockup({
  size = 22,
  textColor,
  className,
  style,
  mono = false,
}: {
  /** Wordmark font size in px. */
  size?: number;
  /** Override wordmark color. Default: --m-text (dark navy). */
  textColor?: string;
  className?: string;
  style?: CSSProperties;
  /** Render dots as a single tone matching textColor. */
  mono?: boolean;
}) {
  const wordmarkColor = textColor ?? "var(--m-text, #181B34)";
  // Small dots, snug spacing, so all four sit in the narrow gap between
  // the two "k" letters rather than spilling over them.
  const dotSize = Math.max(3, Math.round(size * 0.17));
  const dotGap = Math.max(2, Math.round(size * 0.08));
  const stemOffset = Math.round(size * 1.78); // centers the row between the two k's

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        lineHeight: 1,
        ...style,
      }}
    >
      {/* Dots row */}
      <span
        style={{
          display: "inline-flex",
          gap: dotGap,
          marginLeft: stemOffset,
          marginBottom: Math.max(2, Math.round(size * 0.1)),
        }}
        aria-hidden
      >
        {DOT_SEQUENCE.map((c, i) => (
          <Dot key={i} size={dotSize} color={mono ? wordmarkColor : c} />
        ))}
      </span>
      {/* Wordmark */}
      <span
        style={{
          fontWeight: 800,
          letterSpacing: "-0.045em",
          fontSize: size,
          color: wordmarkColor,
        }}
      >
        workwrk
      </span>
    </span>
  );
}

function Dot({ size, color }: { size: number; color: string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color,
        display: "inline-block",
      }}
    />
  );
}
