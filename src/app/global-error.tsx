"use client";

// Last-resort boundary (spec-shell 2.6): renders only when the root layout
// itself fails. It replaces the whole document, so there is no app CSS, no
// tokens and no Inter: every value here is written out on purpose, and the
// four dots are drawn in a literal grey (#D0D5DD, the sRGB value of
// --os-line-strong) rather than a brand hex. This is the one file exempt
// from the raw-hex lint, and the exemption is recorded in eslint.config.mjs.

import { useEffect, useState } from "react";

const GREY = "#D0D5DD";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);

  useEffect(() => {
    try {
      if (typeof fetch === "function") {
        void fetch("/api/client-errors", {
          method: "POST",
          headers: { "content-type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ digest: error?.digest ?? null, pathname: window.location.pathname, userAgent: navigator.userAgent }),
        }).catch(() => {});
      }
    } catch {
      // A failed report never re-throws.
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#FFFFFF",
          color: "#1F2430",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 400, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden style={{ display: "block", marginBottom: 16 }}>
            <rect x="8" y="8" width="80" height="80" rx="12" fill="#F6F7F9" />
            {[24, 40, 56, 72].map((cx) => (
              <circle key={cx} cx={cx} cy={48} r={7} fill="none" stroke={GREY} strokeWidth={1.5} />
            ))}
          </svg>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, lineHeight: "22px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, lineHeight: "20px", color: "#5C6779", margin: "4px 0 0" }}>
            {offline ? "Try again when you're back online." : "The app hit an error it couldn't recover from."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 16,
              cursor: "pointer",
              height: 36,
              padding: "0 16px",
              borderRadius: 6,
              border: `1px solid ${GREY}`,
              background: "#FFFFFF",
              color: "#1F2430",
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            Try again
          </button>
          {error?.digest ? (
            <p style={{ fontSize: 12, lineHeight: "16px", color: "#98A2B3", margin: "12px 0 0" }}>Reference {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
