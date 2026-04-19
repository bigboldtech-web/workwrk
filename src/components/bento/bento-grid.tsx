import type { CSSProperties, ReactNode } from "react";

type BentoGridProps = {
  children: ReactNode;
  className?: string;
  rowHeight?: string;
  style?: CSSProperties;
};

export function BentoGrid({
  children,
  className = "",
  rowHeight,
  style,
}: BentoGridProps) {
  const finalStyle: CSSProperties = {
    ...(rowHeight ? { gridAutoRows: rowHeight } : {}),
    ...style,
  };
  return (
    <div className={`bento-grid ${className}`.trim()} style={finalStyle}>
      {children}
    </div>
  );
}
