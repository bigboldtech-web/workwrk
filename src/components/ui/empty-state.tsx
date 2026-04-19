import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-6 rounded-2xl"
      style={{
        background: "#141414",
        border: "1px dashed rgba(255, 255, 255, 0.1)",
      }}
    >
      <div
        className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4"
        style={{
          background: "rgba(212, 255, 46, 0.08)",
          border: "1px solid rgba(212, 255, 46, 0.25)",
          color: "#d4ff2e",
        }}
      >
        <Icon size={26} />
      </div>
      <h3
        className="mb-1.5 text-center"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "#fafafa",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h3>
      <p
        className="text-center max-w-md mb-6"
        style={{
          fontSize: 14,
          color: "#a0a0a0",
          lineHeight: 1.55,
        }}
      >
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
