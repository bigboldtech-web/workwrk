"use client";

import { useEffect, useRef, type ReactNode } from "react";

type CursorSpotlightProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Tracks mousemove and writes --mx / --my CSS variables so a descendant
 * `radial-gradient(...at var(--mx) var(--my), ...)` can follow the cursor.
 */
export function CursorSpotlight({ children, className = "" }: CursorSpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty("--mx", `${x}%`);
      el.style.setProperty("--my", `${y}%`);
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
