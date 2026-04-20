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
    <div className="flex flex-col items-center justify-center py-16 px-6 rounded-2xl border border-dashed border-border bg-surface">
      <div
        className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4"
        style={{
          background: "var(--b-accent-tint)",
          border: "1px solid var(--b-accent-border)",
          color: "var(--b-accent-text)",
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
