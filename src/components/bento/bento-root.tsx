import type { ReactNode } from "react";
import "./bento.css";

type BentoRootProps = {
  children: ReactNode;
  className?: string;
  grain?: boolean;
};

export function BentoRoot({ children, className = "", grain = true }: BentoRootProps) {
  return (
    <div
      className={`bento-root dark ${grain ? "bento-grain" : ""} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
