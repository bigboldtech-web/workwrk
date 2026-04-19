"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
  as?: "div" | "section" | "article";
  style?: CSSProperties;
};

export function Reveal({
  children,
  className = "",
  stagger = false,
  as = "div",
  style,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-vis");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.05, rootMargin: "0px 0px -30px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as;
  const cls = `${stagger ? "bento-stagger" : "bento-rev"} ${className}`.trim();
  return (
    <Tag ref={ref as never} className={cls} style={style}>
      {children}
    </Tag>
  );
}
