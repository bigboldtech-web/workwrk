import type { CSSProperties } from "react";

// workwrk logo — monday-style "three colored dots over the wordmark."
//
// The mark is three small circles in our brand triad — pink-red, blue,
// yellow — sitting just above the "wrk" letters. The wordmark is a
// rounded, tightly-tracked sans serif. The three dots are the brand;
// the wordmark is the name.
//
// Variants
//   default — colored dots + dark wordmark, for light surfaces
//   mono    — single-color rendering (use `color`), for dark surfaces,
//             favicons, embossed contexts

const BRAND_RED    = "#FF3D57";
const BRAND_BLUE   = "#0073EA";
const BRAND_YELLOW = "#FFCB00";

// LogoMark — the dots-only variant. Use when you need a square icon
// (favicon, app icon, isolated brand bug).
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
  // Mono mode: single fill, three dots in a row inside a rounded square.
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
        <circle cx="12" cy="24" r="5" fill="white" />
        <circle cx="24" cy="24" r="5" fill="white" />
        <circle cx="36" cy="24" r="5" fill="white" />
      </svg>
    );
  }

  // Default mode: three colored dots on transparent, sized to fit the
  // canvas. No background square — the dots are the mark.
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
      <circle cx="12" cy="24" r="7" fill={BRAND_RED} />
      <circle cx="24" cy="24" r="7" fill={BRAND_BLUE} />
      <circle cx="36" cy="24" r="7" fill={BRAND_YELLOW} />
    </svg>
  );
}

// LogoLockup — the workhorse for headers and footers. Wordmark with
// three small colored dots floating just above the "wrk" stem.
//
// Layout:
//   ·  ·  ·     ← three brand dots, anchored to the right half
//   workwrk     ← wordmark, rounded sans, tightly tracked
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
  const dotSize = Math.max(4, Math.round(size * 0.22));
  const dotGap = Math.max(2, Math.round(size * 0.12));
  const stemOffset = Math.round(size * 1.85); // pushes dots over the "wrk"

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
          marginBottom: Math.max(2, Math.round(size * 0.12)),
        }}
        aria-hidden
      >
        <Dot size={dotSize} color={mono ? wordmarkColor : BRAND_RED} />
        <Dot size={dotSize} color={mono ? wordmarkColor : BRAND_BLUE} />
        <Dot size={dotSize} color={mono ? wordmarkColor : BRAND_YELLOW} />
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
