"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Rocket,
  X,
} from "lucide-react";

interface Step {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  href: string;
}

interface ChecklistData {
  steps: Step[];
  completedCount: number;
  totalCount: number;
  percentage: number;
  allDone: boolean;
}

export function OnboardingChecklist() {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const wasDismissed = localStorage.getItem("twrk-checklist-dismissed");
    if (wasDismissed === "true") {
      setDismissed(true);
      setLoading(false);
      return;
    }

    fetch("/api/onboarding-progress")
      .then((res) => res.json())
      .then((json) => {
        const d = json.data || json;
        setData(d);
        if (d.allDone) {
          setDismissed(true);
          localStorage.setItem("twrk-checklist-dismissed", "true");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || dismissed || !data || data.allDone) return null;

  return (
    <div
      style={{
        background: "#141414",
        border: "1px solid rgba(74, 158, 255, 0.25)",
        borderRadius: 16,
        padding: 20,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient blue glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -50,
          right: -40,
          width: 200,
          height: 200,
          background: "radial-gradient(circle, rgba(74,158,255,0.15), transparent 70%)",
          filter: "blur(40px)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: "rgba(74, 158, 255, 0.12)",
              border: "1px solid rgba(74, 158, 255, 0.3)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#4a9eff",
              flexShrink: 0,
            }}
          >
            <Rocket size={16} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#fafafa", margin: 0 }}>Get started</p>
            <p style={{ fontSize: 11.5, color: "#a0a0a0", margin: "2px 0 0" }}>
              {data.completedCount} of {data.totalCount} completed
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 13,
              fontWeight: 700,
              color: "#4a9eff",
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {data.percentage}%
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              padding: 6,
              color: "#a0a0a0",
              background: "transparent",
              border: 0,
              borderRadius: 6,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={() => {
              setDismissed(true);
              localStorage.setItem("twrk-checklist-dismissed", "true");
            }}
            style={{
              padding: 6,
              color: "#707070",
              background: "transparent",
              border: 0,
              borderRadius: 6,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 5,
          borderRadius: 100,
          background: "rgba(255, 255, 255, 0.06)",
          overflow: "hidden",
          marginBottom: expanded ? 16 : 0,
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${data.percentage}%`,
            background: "linear-gradient(90deg, #4a9eff, #5eead4)",
            borderRadius: 100,
            boxShadow: "0 0 10px rgba(74, 158, 255, 0.5)",
            transition: "width 0.5s cubic-bezier(0.2, 0.9, 0.3, 1)",
          }}
        />
      </div>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
          {data.steps.map((step) => (
            <Link
              key={step.id}
              href={step.completed ? "#" : step.href}
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderRadius: 10,
                  padding: "10px 12px",
                  transition: "background 0.2s",
                  opacity: step.completed ? 0.55 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!step.completed) e.currentTarget.style.background = "#1a1a1a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {step.completed ? (
                  <CheckCircle2 size={16} style={{ color: "var(--b-accent-text)", flexShrink: 0 }} />
                ) : (
                  <Circle size={16} style={{ color: "#707070", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: step.completed ? "#707070" : "#fafafa",
                      textDecoration: step.completed ? "line-through" : "none",
                      margin: 0,
                    }}
                  >
                    {step.label}
                  </p>
                  <p style={{ fontSize: 11.5, color: "#a0a0a0", margin: "2px 0 0" }}>
                    {step.description}
                  </p>
                </div>
                {!step.completed && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "#4a9eff",
                      flexShrink: 0,
                      fontFamily: "var(--font-geist-mono), monospace",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Start →
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
