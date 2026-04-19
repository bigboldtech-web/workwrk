import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "WorkwrK — The operating system for teams that mean business";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "#d4ff2e",
              boxShadow: "0 0 24px #d4ff2e",
            }}
          />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em" }}>
            workwrk
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 88,
              lineHeight: 0.95,
              letterSpacing: "-0.045em",
              fontWeight: 600,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Run your company</span>
            <span style={{ display: "flex", gap: 16 }}>
              <span style={{ color: "#707070", textDecoration: "line-through" }}>on</span>
              <span>chaos.</span>
            </span>
            <span style={{ color: "#d4ff2e" }}>Or on workwrk.</span>
          </div>
          <div
            style={{
              fontSize: 24,
              color: "#a0a0a0",
              maxWidth: 900,
              lineHeight: 1.4,
            }}
          >
            One system for people, performance, KPIs, SOPs, and AI. Replaces 15 disconnected tools.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{
              fontSize: 16,
              color: "#707070",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            Business Operating System · Made in India
          </div>
          <div
            style={{
              padding: "10px 18px",
              background: "#d4ff2e",
              color: "#0a0a0a",
              fontSize: 18,
              fontWeight: 700,
              borderRadius: 100,
              letterSpacing: "-0.02em",
            }}
          >
            workwrk.com →
          </div>
        </div>
      </div>
    ),
    size,
  );
}
