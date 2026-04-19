import type { ReactNode } from "react";

type LabelProps = {
  children: ReactNode;
  className?: string;
};

export function Label({ children, className = "" }: LabelProps) {
  return <span className={`bento-label ${className}`.trim()}>{children}</span>;
}
