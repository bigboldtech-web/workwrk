import { ImageResponse } from "next/og";
import { DOT_HEX, DOT_ORDER } from "@/components/marketing/dots";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The brand mark: the four dots (yellow, blue, red, green) on white, in a
// two by two grid so they read at tab size. The colours are IMPORTED from the
// brand module (next/og renders through Satori, which cannot read custom
// properties), never retyped here. This replaces the retired lime on black
// block mark.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexWrap: "wrap",
          alignContent: "center",
          justifyContent: "center",
          gap: 16,
          background: "white",
          padding: 16,
        }}
      >
        {DOT_ORDER.map((c) => (
          <div key={c} style={{ width: 56, height: 56, borderRadius: 56, background: DOT_HEX[c] }} />
        ))}
      </div>
    ),
    size,
  );
}
