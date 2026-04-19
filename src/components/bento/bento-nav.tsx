"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "./locale-switcher";
import { CurrencySwitcher } from "./currency-switcher";
import { LogoMark } from "@/components/brand/logo";

type NavLink = { href: string; labelKey: string };

const defaultLinks: NavLink[] = [
  { href: "/features", labelKey: "features" },
  { href: "/industries", labelKey: "industries" },
  { href: "/pricing", labelKey: "pricing" },
  { href: "/about", labelKey: "about" },
  { href: "/faq", labelKey: "faq" },
];

export function BentoNav({ links = defaultLinks }: { links?: NavLink[] }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
  const t = useTranslations("marketing.nav");

  return (
    <nav
      className="bento-nav"
      aria-label="Main navigation"
      style={{
        padding: "20px 0",
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(10,10,10,0.7)",
        backdropFilter: "blur(16px) saturate(1.2)",
        WebkitBackdropFilter: "blur(16px) saturate(1.2)",
      }}
    >
      <div
        className="bento-container"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <Link
          href="/"
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--b-fg)",
            textDecoration: "none",
          }}
          aria-label="WorkwrK — Home"
        >
          <LogoMark size={22} />
          workwrk
        </Link>

        <div className="bento-nav-mid">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={active ? "is-active" : ""}
                style={{
                  padding: "7px 14px",
                  fontSize: 13,
                  color: active ? "var(--b-lime)" : "var(--b-t2)",
                  background: active ? "var(--b-card-3)" : "transparent",
                  fontWeight: 500,
                  borderRadius: 100,
                  transition: "all 0.2s",
                  textDecoration: "none",
                }}
              >
                {t(l.labelKey)}
              </Link>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="bento-nav-globe">
            <LocaleSwitcher />
            <CurrencySwitcher />
          </div>
          {isLoggedIn ? (
            <Link href="/dashboard" className="bento-btn bento-btn-lime">
              {t("dashboard")} <span className="arr">→</span>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="bento-nav-sign"
                style={{
                  fontSize: 13,
                  color: "var(--b-t2)",
                  padding: "9px 14px",
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                {t("signIn")}
              </Link>
              <Link href="/register" className="bento-btn bento-btn-lime">
                {t("startFree")} <span className="arr">→</span>
              </Link>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .bento-nav-mid {
          display: flex;
          gap: 4px;
          padding: 5px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 100px;
        }
        .bento-nav-mid a:hover {
          background: var(--b-card-3) !important;
          color: var(--b-fg) !important;
        }
        .bento-nav-globe {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        @media (max-width: 1024px) {
          .bento-nav-globe {
            display: none !important;
          }
        }
        @media (max-width: 820px) {
          .bento-nav-mid,
          .bento-nav-sign {
            display: none !important;
          }
        }
      `}</style>
    </nav>
  );
}
