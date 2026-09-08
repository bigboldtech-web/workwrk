"use client";

// MissionSplash — the company's mission, in front of everyone, every time they
// open WorkwrK. A brief (~2s), skippable full-screen welcome: the ONE mission
// shows every load; the values rotate one at a time (a different value each
// open) so the team absorbs them over time. Renders nothing until a mission is
// set, and never blocks the app (it fades away over the workspace loading
// behind it). Reads /api/organization/culture (all members).

import { useCallback, useEffect, useRef, useState } from "react";
import { DotsLoader } from "./dots-loader";

type Culture = { orgName: string; logo: string | null; mission: string; values: string[] };

const VALUE_COLORS = ["#579BFC", "#00C875", "#FFCB00", "#E2445C"]; // YBRG accents, rotated with the value
const HOLD_MS = 2000;   // how long the mission stays up
const FADE_MS = 420;    // fade in / out
const IDX_KEY = "wwk_mission_value_idx";

function nextValueIndex(len: number): number {
  if (len <= 0) return 0;
  try {
    const raw = window.localStorage.getItem(IDX_KEY);
    const cur = raw ? parseInt(raw, 10) || 0 : 0;
    window.localStorage.setItem(IDX_KEY, String((cur + 1) % 1_000_000));
    return cur % len;
  } catch {
    return 0;
  }
}

export function MissionSplash() {
  const [culture, setCulture] = useState<Culture | null>(null);
  const [value, setValue] = useState<{ text: string; color: string } | null>(null);
  const [phase, setPhase] = useState<"in" | "out" | "done">("in");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const dismiss = useCallback(() => {
    timers.current.forEach(clearTimeout);
    setPhase("out");
    timers.current = [setTimeout(() => setPhase("done"), FADE_MS)];
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/organization/culture")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j) => {
        if (!active) return;
        const c: Culture = j.data ?? j;
        if (!c?.mission) { setPhase("done"); return; } // nothing to show → never appear
        setCulture(c);
        if (c.values.length) {
          const i = nextValueIndex(c.values.length);
          setValue({ text: c.values[i], color: VALUE_COLORS[i % VALUE_COLORS.length] });
        }
        timers.current.push(setTimeout(() => setPhase("out"), HOLD_MS));
        timers.current.push(setTimeout(() => setPhase("done"), HOLD_MS + FADE_MS));
      })
      .catch(() => { if (active) setPhase("done"); });
    return () => { active = false; timers.current.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  if (phase === "done" || !culture?.mission) return null;

  const visible = phase === "in";
  return (
    <div
      role="dialog"
      aria-label="Company mission"
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 100000, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "radial-gradient(120% 120% at 50% 0%, #22345A 0%, #16233E 55%, #0F1B31 100%)",
        opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease`,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        style={{
          maxWidth: 660, width: "100%", textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 22,
          transform: visible ? "translateY(0)" : "translateY(10px)",
          transition: `transform ${FADE_MS}ms ease`,
        }}
      >
        {culture.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={culture.logo} alt="" style={{ height: 40, width: "auto", objectFit: "contain", opacity: 0.95 }} />
        ) : (
          <DotsLoader />
        )}

        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
          {culture.orgName ? `${culture.orgName} · Our mission` : "Our mission"}
        </span>

        <p style={{ margin: 0, fontSize: "clamp(22px, 3.4vw, 32px)", lineHeight: 1.35, fontWeight: 600, color: "#fff", textWrap: "balance" }}>
          {culture.mission}
        </p>

        {value ? (
          <>
            <span style={{ display: "block", width: 40, height: 2, borderRadius: 2, background: "rgba(255,255,255,0.16)" }} />
            <span style={{ fontSize: 15.5, color: "rgba(255,255,255,0.72)" }}>
              We live by{" "}
              <strong style={{ color: value.color, fontWeight: 700 }}>{value.text}</strong>
            </span>
          </>
        ) : null}
      </div>

      {/* progress bar — reinforces the "loading" feel while the app boots behind it */}
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: "100%", background: "rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", background: "linear-gradient(90deg, #579BFC, #00C875)", width: visible ? "100%" : "0%", transition: `width ${HOLD_MS}ms linear` }} />
      </div>
      <span style={{ position: "absolute", bottom: 14, right: 16, fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>Click or press Esc to skip</span>
    </div>
  );
}
