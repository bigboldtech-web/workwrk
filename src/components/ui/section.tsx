import * as React from "react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const hasHead = !!(title || subtitle || actions);
  return (
    <section className={cn("dash-section", className)}>
      {hasHead && (
        <header className="dash-section-head">
          <div>
            {title && <h2 className="dash-section-title">{title}</h2>}
            {subtitle && <p className="dash-section-sub">{subtitle}</p>}
          </div>
          {actions && <div className="dash-section-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
