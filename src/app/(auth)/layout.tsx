import { BentoRoot } from "@/components/bento/bento-root";
import "./auth.css";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <BentoRoot>
      <div className="auth-shell">
        <div className="auth-bg" aria-hidden>
          <span className="auth-glow auth-glow-1" />
          <span className="auth-glow auth-glow-2" />
          <svg className="auth-grid-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <defs>
              <pattern id="auth-grid" width="56" height="56" patternUnits="userSpaceOnUse">
                <path d="M 56 0 L 0 0 0 56" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#auth-grid)" />
          </svg>
        </div>
        <main className="auth-main">{children}</main>
      </div>
    </BentoRoot>
  );
}
