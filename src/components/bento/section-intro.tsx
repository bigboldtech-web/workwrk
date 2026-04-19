import type { ReactNode } from "react";

/**
 * Centered, typographic section intro for the home page.
 *
 * This is deliberately NOT a card. Wrapping every section heading in a
 * dark box was making the home feel like a wall of tiles. SectionIntro
 * sits in breathing space — just a label, a big headline, and an optional
 * subtitle — so the grid that follows gets visual room to land.
 */

type SectionIntroProps = {
  label?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  /** Max width of the title + subtitle column, in px. */
  width?: number;
};

export function SectionIntro({
  label,
  title,
  subtitle,
  align = "center",
  width = 720,
}: SectionIntroProps) {
  return (
    <div
      style={{
        textAlign: align,
        maxWidth: width,
        margin: align === "center" ? "0 auto 56px" : "0 0 56px",
        padding: "0 4px",
      }}
    >
      {label ? (
        <span
          className="bento-label"
          style={{
            color: "var(--b-lime)",
            opacity: 1,
            marginBottom: 18,
            justifyContent: align === "center" ? "center" : undefined,
          }}
        >
          {label}
        </span>
      ) : null}
      <h2
        style={{
          fontSize: "clamp(32px, 4vw, 52px)",
          fontWeight: 600,
          letterSpacing: "-0.035em",
          lineHeight: 1.05,
          marginTop: label ? 18 : 0,
          color: "var(--b-fg)",
        }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          style={{
            marginTop: 16,
            fontSize: 16,
            lineHeight: 1.6,
            color: "var(--b-t2)",
            maxWidth: 620,
            marginLeft: align === "center" ? "auto" : 0,
            marginRight: align === "center" ? "auto" : 0,
          }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
