import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * EmptyState primitive — Phase G refresh.
 *
 * More generous breathing room so empty states feel deliberate, not
 * apologetic. The icon container is larger (h-16 vs h-14), padding
 * is taller (py-20 vs py-16), and the layout supports a secondary
 * action for cases where "Learn how" or "See examples" is as useful
 * as "Create one."
 *
 * Tone: confident, not pleading. Empty isn't a failure state — it's
 * a starting line.
 */
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary action — useful for "Learn more" links sitting
   *  next to the primary CTA. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 rounded-2xl border border-dashed border-border bg-surface">
      <div
        className="h-16 w-16 rounded-2xl flex items-center justify-center mb-5"
        style={{
          background: "var(--b-accent-tint, var(--accent-soft))",
          border: "1px solid var(--b-accent-border, var(--accent-soft))",
          color: "var(--b-accent-text, var(--accent-strong))",
        }}
      >
        <Icon size={28} />
      </div>
      <h3
        className="mb-2 text-center text-foreground"
        style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}
      >
        {title}
      </h3>
      <p
        className="text-center max-w-md mb-7 text-muted"
        style={{ fontSize: 14, lineHeight: 1.6 }}
      >
        {description}
      </p>
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {actionLabel && onAction && (
            <Button onClick={onAction}>{actionLabel}</Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="ghost" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
