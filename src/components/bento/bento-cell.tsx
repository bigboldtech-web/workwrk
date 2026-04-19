import type { CSSProperties, ReactNode } from "react";

type Variant = "dark" | "lime" | "pink" | "blue" | "amber";

type BentoCellProps = {
  children: ReactNode;
  className?: string;
  variant?: Variant;
  span?: number;
  rowSpan?: number;
  dots?: boolean;
  as?: "div" | "article" | "section";
  style?: CSSProperties;
};

export function BentoCell({
  children,
  className = "",
  variant = "dark",
  span,
  rowSpan,
  dots = false,
  as = "div",
  style,
}: BentoCellProps) {
  const Tag = as;
  const isColor = variant !== "dark";
  const finalStyle: CSSProperties = {
    ...(span ? { gridColumn: `span ${span}` } : {}),
    ...(rowSpan ? { gridRow: `span ${rowSpan}` } : {}),
    ...style,
  };
  const classes = [
    "bento-cell",
    variant,
    isColor ? "bento-color-card" : "",
    dots ? "bento-dots" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} style={finalStyle}>
      {children}
    </Tag>
  );
}
