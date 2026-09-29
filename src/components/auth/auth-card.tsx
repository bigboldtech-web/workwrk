// AuthCard and AuthBanner (spec-account-auth section 3): the one title,
// subtitle, banner slot and footer every sign-in page uses, so the success,
// error and info strips on /login, /signup, /join, /forgot-password,
// /reset-password and /verify-email are the same object. Server-safe.

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

export type BannerTone = "danger" | "info" | "success" | "warning";

const ICONS = { danger: CircleAlert, info: Info, success: CircleCheck, warning: TriangleAlert } as const;

export function AuthBanner({ tone, children, strip = false, icon }: { tone: BannerTone; children: ReactNode; strip?: boolean; icon?: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <div className={`wa-banner wa-banner--${tone}${strip ? " wa-strip" : ""}`} role={tone === "danger" ? "alert" : "status"}>
      {icon ?? <Icon size={16} aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

export function AuthCard({
  title,
  subtitle,
  banner,
  children,
  footer,
  drawing = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  banner?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** The 96px four-dots-in-a-row line drawing above the title (success and failure screens). */
  drawing?: boolean;
}) {
  return (
    <div className="wa-card">
      {banner}
      {drawing || title || subtitle ? (
        <div className="wa-card__head">
          {drawing ? <FourDotsDrawing /> : null}
          {title ? <h1 className="wa-title">{title}</h1> : null}
          {subtitle ? <p className="wa-sub">{subtitle}</p> : null}
        </div>
      ) : null}
      {children ? <div className="wa-body">{children}</div> : null}
      {footer ? <div className="wa-footer">{footer}</div> : null}
    </div>
  );
}

/** Four hollow dots in a row: the product's quiet illustration (design-system 5.8). */
export function FourDotsDrawing() {
  return (
    <span className="wa-drawing" aria-hidden style={{ marginBottom: 12 }}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
