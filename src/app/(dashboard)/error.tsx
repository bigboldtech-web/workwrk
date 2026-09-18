"use client";

// In-shell error boundary (spec-shell 2.3): the page you see when a page
// breaks, with the rail, sidebar and bar intact. The quiet ErrorState: four
// dots in a row, "This page couldn't load", the text link "Try again"
// (reset), "Reference {digest}" when there is one, a BackButton to the
// current hub. The digest also goes to POST /api/client-errors, fire and
// forget, so shell errors are visible on the server. In development the
// message renders in a mono block.

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { BackButton } from "@/components/ui/back-button";
import { useHubBack } from "@/components/layout/os/use-hub-back";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const back = useHubBack();

  useEffect(() => {
    console.error("Dashboard route error:", error);
    try {
      void fetch("/api/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ digest: error?.digest ?? null, pathname: window.location.pathname, userAgent: navigator.userAgent, message: error?.message ?? null }),
      }).catch(() => {});
    } catch {
      // Reporting must never re-throw into the boundary.
    }
  }, [error]);

  return (
    <ErrorState what="this page" title="This page couldn't load" onRetry={() => reset()} reference={error?.digest}>
      <BackButton fallbackHref={back.fallbackHref} label={back.label} />
      {process.env.NODE_ENV !== "production" && error?.message ? (
        <pre className="os-chrome mt-2 max-h-56 max-w-md overflow-auto whitespace-pre-wrap rounded-md border border-line bg-subtle p-3 text-start font-mono text-sm text-danger-text">
          {error.message}
        </pre>
      ) : null}
    </ErrorState>
  );
}
