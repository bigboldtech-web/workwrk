"use client";

// Last-resort boundary — only fires when the root layout itself throws (rare).
// It replaces the entire document, so it must render its own <html>/<body>
// and cannot rely on app CSS. Keep it dependency-free and inline-styled.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#a0a0a0", lineHeight: 1.5, margin: "0 0 20px" }}>
            The app hit an unexpected error. Try reloading, or head back home.
          </p>
          {error?.digest ? (
            <p style={{ fontSize: 11, color: "#707070", margin: "0 0 20px" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                cursor: "pointer",
                border: "none",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 600,
                background: "#d4ff2e",
                color: "#0a0a0a",
              }}
            >
              Try again
            </button>
            <a
              href="/today"
              style={{
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.16)",
                color: "#fafafa",
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
