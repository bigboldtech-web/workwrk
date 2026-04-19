import type { ReactNode } from "react";

import { Label } from "./label";

/**
 * Section header used across marketing pages.
 *
 * Design discipline:
 *   - Default aside is DARK with a lime-accent stat. This keeps pages calm.
 *   - Pass `aside.variant: "lime"` only for genuinely hero-worthy stats.
 *   - Pink / amber / violet are intentionally not supported — they made
 *     every page feel like a patchwork of unrelated colour swatches.
 */

type AsideProps = {
  variant?: "dark" | "lime" | "blue";
  label: string;
  stat: ReactNode;
  text: ReactNode;
};

type SectionHeaderProps = {
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: AsideProps;
};

export function SectionHeader({
  label,
  title,
  subtitle,
  aside,
}: SectionHeaderProps) {
  const variant = aside?.variant ?? "dark";
  return (
    <div className="bento-grid" style={{ marginBottom: 40 }}>
      <div
        className="bento-cell dark"
        style={{
          gridColumn: "span 8",
          padding: "40px 48px",
          minHeight: 210,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <Label>{label}</Label>
        <h2 className="bento-sec-title">{title}</h2>
        {subtitle ? <p className="bento-sec-sub">{subtitle}</p> : null}
      </div>
      {aside ? (
        <SectionHeaderAside variant={variant} aside={aside} />
      ) : null}
    </div>
  );
}

function SectionHeaderAside({
  variant,
  aside,
}: {
  variant: "dark" | "lime" | "blue";
  aside: AsideProps;
}) {
  const isColor = variant !== "dark";
  const className = isColor ? `bento-cell ${variant} bento-dots` : "bento-cell dark";
  const statColor = isColor ? "inherit" : "var(--b-lime)";
  const textColor = isColor ? "inherit" : "var(--b-t2)";
  return (
    <div
      className={className}
      style={{
        gridColumn: "span 4",
        padding: 40,
        minHeight: 210,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <Label>{aside.label}</Label>
      <div>
        <div
          style={{
            fontSize: 84,
            fontWeight: 600,
            letterSpacing: "-0.05em",
            lineHeight: 0.9,
            fontVariantNumeric: "tabular-nums",
            color: statColor,
          }}
        >
          {aside.stat}
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            maxWidth: 240,
            lineHeight: 1.4,
            marginTop: 12,
            color: textColor,
          }}
        >
          {aside.text}
        </div>
      </div>
    </div>
  );
}
