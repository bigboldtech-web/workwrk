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
          background: "#ffffff",
          color: "#18181b",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 13, color: "#71717a", lineHeight: 1.5, margin: "0 0 20px" }}>
            The app hit an unexpected error. Try reloading, or head back home.
          </p>
          {error?.digest ? (
            <p style={{ fontSize: 11, color: "#a1a1aa", margin: "0 0 20px" }}>
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
                borderRadius: 999,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: "#18181b",
                color: "#fff",
              }}
            >
              Try again
            </button>
            <a
              href="/today"
              style={{
                borderRadius: 999,
                padding: "8px 16px",
                fontSize: 13,
                textDecoration: "none",
                border: "1px solid #e4e4e7",
                color: "#3f3f46",
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
