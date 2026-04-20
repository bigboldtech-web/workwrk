import { AlertCircle, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  status?: number;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ status, message, onRetry }: ErrorStateProps) {
  const isOffline =
    message?.toLowerCase().includes("fetch") || message?.toLowerCase().includes("network");

  let icon = AlertCircle;
  let title = "Something went wrong";
  let desc = message || "An unexpected error occurred. Please try again.";

  if (isOffline) {
    icon = WifiOff;
    title = "You're offline";
    desc = "Check your connection and try again.";
  } else if (status === 404) {
    title = "Not found";
    desc = "The resource you're looking for doesn't exist or has been removed.";
  } else if (status === 403) {
    title = "Access denied";
    desc = "You don't have permission to view this.";
  }

  const Icon = icon;

  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-6 rounded-2xl bg-surface"
      style={{ border: "1px dashed rgba(255, 61, 138, 0.25)" }}
    >
      <div
        className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4"
        style={{
          background: "rgba(255, 61, 138, 0.08)",
          border: "1px solid rgba(255, 61, 138, 0.25)",
          color: "#ff3d8a",
        }}
      >
        <Icon size={26} />
      </div>
      <h3
        className="mb-1.5 text-center text-foreground"
        style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}
      >
        {title}
      </h3>
      <p
        className="text-center max-w-md mb-6 text-muted"
        style={{ fontSize: 14, lineHeight: 1.55 }}
      >
        {desc}
      </p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="gap-2">
          <RefreshCw size={14} /> Try again
        </Button>
      )}
    </div>
  );
}
