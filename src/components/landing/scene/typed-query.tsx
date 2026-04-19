"use client";

import { useEffect, useRef, useState } from "react";

type TypedQueryProps = {
  text: string;
  speed?: number;
  startDelay?: number;
  onDone?: () => void;
  className?: string;
};

export function TypedQuery({
  text,
  speed = 35,
  startDelay = 300,
  onDone,
  className = "",
}: TypedQueryProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState("");
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || started.current) continue;
          started.current = true;
          let i = 0;
          const startTimer = window.setTimeout(() => {
            const iv = window.setInterval(() => {
              i++;
              setShown(text.slice(0, i));
              if (i >= text.length) {
                window.clearInterval(iv);
                onDone?.();
              }
            }, speed);
          }, startDelay);
          io.unobserve(e.target);
          return () => window.clearTimeout(startTimer);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [text, speed, startDelay, onDone]);

  return (
    <span ref={ref} className={className}>
      {shown}
      <span className="typed-caret" aria-hidden>
        |
      </span>
      <style jsx>{`
        .typed-caret {
          display: inline-block;
          margin-left: 1px;
          animation: typedBlink 1s steps(1) infinite;
          color: var(--b-lime);
          font-weight: 300;
        }
        @keyframes typedBlink {
          50% {
            opacity: 0;
          }
        }
      `}</style>
    </span>
  );
}
