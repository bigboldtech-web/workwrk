"use client";

// MissionSplash (spec-shell 2.18, design-system 5.15): the company's mission
// and one value as the app opens. Full screen on the navy chrome colour, the
// four dots at 12px rising in sequence, an eyebrow, one line, 1.2s hold and
// a 160ms fade. Skippable by any key or click: it registers as a layer and
// the shell's one keydown listener closes it on any key. Boot only, per the
// org setting `companyProfile.splash` from /api/boot:
//
//   every-open        once per tab session (a cold boot, never a navigation)
//   first-open-daily  once per calendar day on this device
//   off               never
//
// An org with no mission and no values never shows it. The 10-minute
// navigation re-trigger is gone; the old bottom progress line is gone.

import { useEffect, useRef, useState } from "react";
import { useBoot } from "@/components/layout/os/boot-context";
import { useLayer } from "@/components/layout/os/shell-context";
import { nextRotateIndex } from "@/lib/use-culture";
import "./mission-splash.css";

const HOLD_MS = 1200;
const FADE_MS = 160;
const SESSION_KEY = "workwrk:splash:shown";
const DAY_KEY = "workwrk:splash:day";
const DOTS = ["#FFCB00", "#0073EA", "#FF3D57", "#00C875"] as const;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function shouldShow(policy: string): boolean {
  if (policy === "off") return false;
  try {
    if (policy === "first-open-daily") {
      if (window.localStorage.getItem(DAY_KEY) === today()) return false;
      window.localStorage.setItem(DAY_KEY, today());
      window.sessionStorage.setItem(SESSION_KEY, "1");
      return true;
    }
    if (window.sessionStorage.getItem(SESSION_KEY) === "1") return false;
    window.sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function MissionSplash() {
  const { boot } = useBoot();
  const [phase, setPhase] = useState<"idle" | "in" | "out">("idle");
  const [item, setItem] = useState<{ kind: "mission" | "value"; text: string } | null>(null);
  const timers = useRef<number[]>([]);
  // The one decision per boot, cached: the throttle in shouldShow writes
  // storage, so it must run exactly once, while the timers below must be
  // (re)scheduled on every effect run, because React's development double
  // effect cleans the first run up before its 0ms timer fires. A ref that
  // only said "decided" made the second run bail out with the throttle
  // already consumed, so the splash never mounted on the dev server.
  const decision = useRef<{ kind: "mission" | "value"; text: string } | null | undefined>(undefined);
  const played = useRef(false);

  const dismiss = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPhase((p) => (p === "in" ? "out" : p));
    timers.current.push(window.setTimeout(() => setPhase("idle"), FADE_MS));
  };

  useEffect(() => {
    if (decision.current === undefined) {
      const { mission, values, splash } = boot.org.culture;
      const pool: Array<{ kind: "mission" | "value"; text: string }> = [];
      if (mission) pool.push({ kind: "mission", text: mission });
      for (const v of values) pool.push({ kind: "value", text: v });
      decision.current = pool.length > 0 && shouldShow(splash) ? pool[nextRotateIndex(pool.length)] : null;
    }
    const chosen = decision.current;
    if (!chosen || played.current) return;
    // Next tick, so the frame commits once before the splash paints over it.
    timers.current.push(window.setTimeout(() => {
      played.current = true;
      setItem(chosen);
      setPhase("in");
    }, 0));
    timers.current.push(window.setTimeout(() => setPhase("out"), HOLD_MS));
    timers.current.push(window.setTimeout(() => setPhase("idle"), HOLD_MS + FADE_MS));
    return () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  }, [boot.org.culture]);

  useLayer(phase === "in", { id: "mission-splash", kind: "splash", close: dismiss });

  if (phase === "idle" || !item) return null;
  const eyebrow = `${boot.org.name ? boot.org.name + " · " : ""}${item.kind === "mission" ? "Our mission" : "We live by"}`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      onClick={dismiss}
      className={`wwk-splash${phase === "in" ? " is-in" : ""}`}
    >
      <div className="wwk-splash__inner">
        <span className="wwk-splash__dots" aria-hidden>
          {DOTS.map((c, i) => (
            <span key={i} className="wwk-splash__dot" style={{ backgroundColor: c, animationDelay: `${i * 80}ms` }} />
          ))}
        </span>
        <span className="wwk-splash__eyebrow">{eyebrow}</span>
        <p className="wwk-splash__line">{item.text}</p>
      </div>
      <span className="wwk-splash__skip">Press any key or click to skip</span>
    </div>
  );
}
