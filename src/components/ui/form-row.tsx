import * as React from "react";
import { cn } from "@/lib/utils";

export function FormGrid({
  cols = 1,
  children,
  className,
}: {
  cols?: 1 | 2 | 3;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "dash-form-grid",
        cols === 2 && "is-2col",
        cols === 3 && "is-3col",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FormRow({
  label,
  htmlFor,
  required,
  hint,
  error,
  full,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  full?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("dash-form-row", full && "is-full", className)}>
      {label && (
        <label htmlFor={htmlFor} className="dash-form-row-label">
          {label}
          {required && <span className="dash-form-row-label-required" aria-hidden>*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="dash-form-row-error" role="alert">{error}</span>
      ) : hint ? (
        <span className="dash-form-row-hint">{hint}</span>
      ) : null}
    </div>
  );
}
