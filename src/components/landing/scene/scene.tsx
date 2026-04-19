import type { CSSProperties, ReactNode } from "react";

type SceneProps = {
  id?: string;
  children: ReactNode;
  compact?: boolean;
  background?: CSSProperties["background"];
  className?: string;
  style?: CSSProperties;
};

export function Scene({
  id,
  children,
  compact,
  background,
  className = "",
  style,
}: SceneProps) {
  return (
    <section
      id={id}
      className={`scene${compact ? " scene-compact" : ""} ${className}`.trim()}
      style={{ background, ...style }}
    >
      <div className="bento-container scene-inner">{children}</div>
    </section>
  );
}
