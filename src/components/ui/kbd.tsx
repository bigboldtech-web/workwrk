import * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({
  keys,
  className,
}: {
  keys: string | string[];
  className?: string;
}) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {list.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="dash-shortcuts-plus">+</span>}
          <kbd className="dash-kbd">{k}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}
