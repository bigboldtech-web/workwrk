import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 48 48"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="0" y="0" width="28" height="22" rx="6" fill="#d4ff2e" />
          <rect x="31" y="0" width="17" height="22" rx="6" fill="#d4ff2e" />
          <rect x="0" y="25" width="48" height="23" rx="6" fill="#d4ff2e" />
        </svg>
      </div>
    ),
    size,
  );
}
