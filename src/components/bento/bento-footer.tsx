import Link from "next/link";

type Col = { heading: string; links: { href: string; label: string }[] };

const cols: Col[] = [
  {
    heading: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/industries", label: "Industries" },
      { href: "/pricing", label: "Pricing" },
      { href: "/faq", label: "FAQ" },
      { href: "/help-center", label: "Help center" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/blog", label: "Blog" },
      { href: "mailto:hi@workwrk.com", label: "Contact" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/blog", label: "Blog" },
      { href: "/help-center", label: "Docs" },
      { href: "/developers", label: "Developers · API" },
      { href: "/api/v1/openapi.json", label: "OpenAPI spec" },
      { href: "/llms.txt", label: "llms.txt" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/cookies", label: "Cookies" },
      { href: "/do-not-sell", label: "Do not sell my info" },
    ],
  },
];

export function BentoFooter() {
  return (
    <footer style={{ padding: "60px 0 30px" }}>
      <div className="bento-container">
        <div
          style={{
            background: "var(--b-card)",
            border: "1px solid var(--b-line)",
            borderRadius: 28,
            padding: "48px 40px 32px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden
            style={{
              content: "",
              position: "absolute",
              top: -100,
              right: -100,
              width: 400,
              height: 400,
              background:
                "radial-gradient(circle, rgba(212,255,46,0.04), transparent 60%)",
              pointerEvents: "none",
            }}
          />
          <div className="bento-foot-top">
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: "-0.04em",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: "var(--b-lime)",
                    boxShadow: "0 0 14px var(--b-lime)",
                  }}
                />
                workwrk
              </div>
              <p
                style={{
                  fontSize: 13.5,
                  color: "var(--b-t2)",
                  lineHeight: 1.55,
                  marginTop: 16,
                  maxWidth: 280,
                }}
              >
                The operating system for teams that mean business. People,
                performance, processes, AI — one system.
              </p>
            </div>
            {cols.map((c) => (
              <div key={c.heading}>
                <h5
                  className="bento-mono"
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.18em",
                    color: "var(--b-t3)",
                    marginBottom: 16,
                    fontWeight: 500,
                  }}
                >
                  {c.heading}
                </h5>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        style={{
                          fontSize: 13,
                          color: "var(--b-t2)",
                          textDecoration: "none",
                        }}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div
            className="bento-foot-bot"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: 28,
              borderTop: "1px solid var(--b-line)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--b-t3)",
              letterSpacing: "0.02em",
              position: "relative",
            }}
          >
            <div>© {new Date().getFullYear()} workwrk · Built by BigBoldTech · Made in India 🇮🇳</div>
            <div style={{ display: "flex", gap: 18 }}>
              <a href="https://twitter.com/workwrk" style={{ color: "inherit" }}>
                Twitter
              </a>
              <a
                href="https://linkedin.com/company/workwrk"
                style={{ color: "inherit" }}
              >
                LinkedIn
              </a>
              <a href="https://github.com/workwrk" style={{ color: "inherit" }}>
                GitHub
              </a>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .bento-foot-top {
          display: grid;
          grid-template-columns: 1.5fr repeat(4, 1fr);
          gap: 40px;
          margin-bottom: 48px;
          position: relative;
        }
        @media (max-width: 900px) {
          .bento-foot-top { grid-template-columns: 1fr 1fr; }
          .bento-foot-bot { flex-direction: column; gap: 12px; text-align: center; }
        }
      `}</style>
    </footer>
  );
}
