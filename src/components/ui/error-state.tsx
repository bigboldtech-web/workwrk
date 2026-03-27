import { AlertCircle, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  status?: number;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ status, message, onRetry }: ErrorStateProps) {
  const isOffline = message?.toLowerCase().includes("fetch") || message?.toLowerCase().includes("network");

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
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="h-16 w-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
        <Icon size={28} className="text-red-400" />
      </div>
      <h3 className="text-lg font-semibold text-[#E8E8F0] mb-1">{title}</h3>
      <p className="text-sm text-[#8888A0] text-center max-w-sm mb-6">{desc}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="gap-2">
          <RefreshCw size={14} /> Try again
        </Button>
      )}
    </div>
  );
}
