"use client";

// Dev-only preview so you can actually watch the brand loader without
// waiting for a real loading state. Visit /loader-preview.

import { DotsLoader } from "@/components/brand/dots-loader";

export default function LoaderPreviewPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#FBFBFC", padding: 40, fontFamily: "Figtree, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#181B34", marginBottom: 4 }}>WorkwrK loader preview</h1>
      <p style={{ fontSize: 13, color: "#676879", marginBottom: 32 }}>
        Bounce in a row, converge and orbit as a circle, expand back, on a loop.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        {/* Light card, with caption (what the real workspace loader looks like) */}
        <Card bg="#FFFFFF">
          <DotsLoader size={48} label="Loading workspace" />
        </Card>

        {/* Dark card */}
        <Card bg="#0B0E15">
          <DotsLoader size={48} label="Loading workspace" />
        </Card>

        {/* A few sizes, no label */}
        <Card bg="#FFFFFF">
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <DotsLoader size={28} />
            <DotsLoader size={40} />
            <DotsLoader size={64} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 280,
        minHeight: 200,
        padding: 32,
        borderRadius: 16,
        border: "1px solid #E6E9EF",
        background: bg,
      }}
    >
      {children}
    </div>
  );
}
