import type { CSSProperties } from "react";
import "./logo.css";

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

// Logo: the rail mark and the boot mark (design-system 4.1, 5.15). Four
// brand dots in a row, `width` wide (28 on the rail, dots 5px), and the
// route loader: while `pulsing`, each dot lifts to full brightness and back
// on a 900ms loop with a 120ms stagger. At rest the dots are static and full
// colour. The only saturated object in the chrome, so it is also the only
// place outside the splash the four dots animate.
export function Logo({
  width = 28,
  pulsing = false,
  className,
  title,
}: {
  width?: number;
  pulsing?: boolean;
  className?: string;
  title?: string;
}) {
  const dot = width / 5.6;
  const gap = (width - dot * 4) / 3;
  return (
    <span
      className={`wwk-logo${pulsing ? " is-pulsing" : ""}${className ? ` ${className}` : ""}`}
      style={{ width, height: dot, gap }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-pulsing={pulsing ? "true" : undefined}
    >
      {DOT_SEQUENCE.map((c, i) => (
        <span key={i} className="wwk-logo__dot" style={{ width: dot, height: dot, backgroundColor: c, animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
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
  const dotSize = Math.max(4, Math.round(size * 0.26));
  const dotGap = Math.max(2, Math.round(size * 0.075));
  // Drop the dots down so they sit just above the middle "wr".
  const dropPx = Math.round(size * 0.16);
  // Reserve room above the wordmark for the dots row.
  const topPad = dotSize + Math.max(2, Math.round(size * 0.04));

  // The dots, centered over whatever they are anchored to.
  const dots = (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: "50%",
        bottom: `calc(100% - ${dropPx}px)`,
        transform: "translateX(-50%)",
        display: "inline-flex",
        gap: dotGap,
      }}
    >
      {DOT_SEQUENCE.map((c, i) => (
        <Dot key={i} size={dotSize} color={mono ? wordmarkColor : c} />
      ))}
    </span>
  );

  // Split "workwrk" into work + wr + k so the dots can anchor exactly over
  // the middle "wr" (the gap between the two "k" letters), font-width
  // independent. The dots float above that span.
  return (
    <span
      className={className}
      style={{ display: "inline-block", paddingTop: topPad, lineHeight: 1, ...style }}
    >
      <span
        style={{
          fontWeight: 800,
          letterSpacing: "-0.045em",
          fontSize: size,
          color: wordmarkColor,
          whiteSpace: "nowrap",
        }}
      >
        work
        <span style={{ position: "relative" }}>
          wr{dots}
        </span>
        k
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
