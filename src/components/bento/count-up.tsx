"use client";

import { useEffect, useRef, useState } from "react";

type CountUpProps = {
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
};

export function CountUp({
  to,
  suffix = "",
  prefix = "",
  duration = 1400,
  className = "",
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || started.current) continue;
          started.current = true;
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(Math.floor(to * eased));
            if (t < 1) requestAnimationFrame(tick);
            else setValue(to);
          };
          requestAnimationFrame(tick);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} className={`bento-tabular ${className}`.trim()}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
