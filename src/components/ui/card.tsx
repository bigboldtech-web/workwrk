import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card primitive — Phase G refresh.
 *
 * Three visual treatments:
 *   default       neutral surface, subtle border, gentle hover
 *   interactive   hover lifts the card 1px with a soft shadow — use on
 *                 anything clickable (link cards, kanban cards, stat
 *                 tiles that drill in)
 *   hero          generous padding + slightly larger radius — use as
 *                 the top-of-page focal element on Home / Hub pages
 *
 * Transition timing uses --duration-fast (150ms) so it matches the
 * sidebar chevron + every other UI feedback in the system.
 */

type CardVariant = "default" | "interactive" | "hero";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      data-card-variant={variant}
      className={cn(
        "rounded-xl border border-border bg-surface transition-fast",
        variant === "interactive" &&
          "cursor-pointer hover:border-[color:var(--accent)]/40 hover:shadow-[0_4px_14px_-6px_rgba(0,0,0,0.12)] hover:-translate-y-px",
        variant === "hero" && "rounded-2xl",
        variant === "default" && "hover:border-[color:var(--b-line-2)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1 p-4", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-[14px] font-semibold text-foreground tracking-tight leading-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-[12.5px] text-muted leading-snug", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
