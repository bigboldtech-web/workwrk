"use client";

// MissionSplash — the company's mission + values ARE the loader. On each page
// load (initial app open and every navigation) it covers the screen for ~2s
// with ONE item, rotating through [mission, ...values] one at a time, then
// fades to reveal the page. So instead of a blank spinner, people see (and
// absorb) the mission and a value every time. Skippable (click / Esc). Renders
// nothing until a mission or value is set, so it never gates an unconfigured
// workspace. Reads /api/organization/culture (all members).

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DotsLoader } from "./dots-loader";

type Culture = { orgName: string; logo: string | null; mission: string; values: string[] };
type Item = { kind: "mission" | "value"; text: string; color: string };

const VALUE_COLORS = ["#579BFC", "#00C875", "#FFCB00", "#E2445C"]; // YBRG accents
const HOLD_MS = 2000; // how long the screen stays up per load
const FADE_MS = 380;
const IDX_KEY = "wwk_mission_rotate_idx";

// Fetched once per full app load; reused across client navigations so nav is
// instant (no per-nav round-trip).
let cultureCache: Culture | null | undefined;

function buildPool(c: Culture): Item[] {
  const pool: Item[] = [];
  if (c.mission) pool.push({ kind: "mission", text: c.mission, color: "#ffffff" });
  c.values.forEach((v, i) => pool.push({ kind: "value", text: v, color: VALUE_COLORS[i % VALUE_COLORS.length] }));
  return pool;
}
function nextIndex(len: number): number {
  if (len <= 0) return 0;
  try {
    const cur = parseInt(window.localStorage.getItem(IDX_KEY) || "0", 10) || 0;
    window.localStorage.setItem(IDX_KEY, String((cur + 1) % 1_000_000));
    return cur % len;
  } catch { return 0; }
}

export function MissionSplash() {
  const pathname = usePathname();
  const [item, setItem] = useState<Item | null>(null);
  const [phase, setPhase] = useState<"idle" | "in" | "out">("idle");
  const [meta, setMeta] = useState<{ orgName: string; logo: string | null }>({ orgName: "", logo: null });
  const poolRef = useRef<Item[]>([]);
  const readyRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const dismiss = useCallback(() => {
    clearTimers();
    setPhase("out");
    timers.current = [setTimeout(() => setPhase("idle"), FADE_MS)];
  }, []);

  const showNext = useCallback(() => {
    const pool = poolRef.current;
    if (!pool.length) return;
    clearTimers();
    setItem(pool[nextIndex(pool.length)]);
    setPhase("in");
    timers.current.push(setTimeout(() => setPhase("out"), HOLD_MS));
    timers.current.push(setTimeout(() => setPhase("idle"), HOLD_MS + FADE_MS));
  }, []);

  // Load culture once, then show the first item.
  useEffect(() => {
    let active = true;
    const apply = (c: Culture) => {
      if (!active) return;
      setMeta({ orgName: c.orgName, logo: c.logo });
      poolRef.current = buildPool(c);
      readyRef.current = true;
      showNext();
    };
    if (cultureCache !== undefined) {
      if (cultureCache) apply(cultureCache);
      return () => { active = false; clearTimers(); };
    }
    fetch("/api/organization/culture")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j) => { const c: Culture = j.data ?? j; cultureCache = c; apply(c); })
      .catch(() => { cultureCache = null; });
    return () => { active = false; clearTimers(); };
  }, [showNext]);

  // Every navigation shows the next item (skip the initial render — handled above).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (readyRef.current) showNext();
  }, [pathname, showNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  if (phase === "idle" || !item) return null;
  const visible = phase === "in";
  const eyebrow = `${meta.orgName ? meta.orgName + " · " : ""}${item.kind === "mission" ? "Our mission" : "We live by"}`;

  return (
    <div
      role="status" aria-label="Loading"
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 100000, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "radial-gradient(120% 120% at 50% 0%, #22345A 0%, #16233E 55%, #0F1B31 100%)",
        opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease`, WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        style={{
          maxWidth: 660, width: "100%", textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 22,
          transform: visible ? "translateY(0)" : "translateY(8px)", transition: `transform ${FADE_MS}ms ease`,
        }}
      >
        {meta.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.logo} alt="" style={{ height: 38, width: "auto", objectFit: "contain", opacity: 0.95 }} />
        ) : (
          <DotsLoader />
        )}

        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
          {eyebrow}
        </span>

        <p style={{ margin: 0, fontSize: "clamp(22px, 3.4vw, 32px)", lineHeight: 1.35, fontWeight: 600, color: item.color, textWrap: "balance" }}>
          {item.text}
        </p>
      </div>

      <div style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: "100%", background: "rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", background: "linear-gradient(90deg, #579BFC, #00C875)", width: visible ? "100%" : "0%", transition: `width ${HOLD_MS}ms linear` }} />
      </div>
      <span style={{ position: "absolute", bottom: 14, right: 16, fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>Click or press Esc to skip</span>
    </div>
  );
}
