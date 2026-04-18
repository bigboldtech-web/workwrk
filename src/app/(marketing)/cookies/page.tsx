import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookie Policy — WorkwrK",
  description: "How WorkwrK uses cookies and similar technologies.",
};

// NEEDS LEGAL REVIEW — this is a starting template. Have local counsel
// review for GDPR, UK-GDPR/PECR, ePrivacy, CCPA, LGPD, PIPEDA, APPI, DPDPA
// before publishing in a given jurisdiction.

export default function CookiePolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        Template — needs legal review before publication. Last updated:{" "}
        {new Date().toISOString().slice(0, 10)}.
      </div>

      <h1 className="text-3xl font-bold tracking-tight">Cookie Policy</h1>
      <p className="mt-3 text-sm text-muted">
        This policy explains what cookies and similar technologies WorkwrK
        uses, why we use them, and how you can control them. It supplements
        our{" "}
        <Link className="underline" href="/privacy">
          Privacy Policy
        </Link>
        .
      </p>

      <Section title="1. What are cookies?">
        Cookies are small text files a website stores on your device. They
        help sites remember preferences, keep you signed in, and measure
        usage. Similar technologies include local storage, pixels, SDKs, and
        beacons — this policy covers all of them.
      </Section>

      <Section title="2. Categories we use">
        <Category
          name="Strictly necessary"
          purpose="Authentication, CSRF protection, load balancing, language/currency preference, fraud prevention."
          examples="next-auth.session-token, NEXT_LOCALE, NEXT_CURRENCY, wwrk_consent"
          lifetime="Session or up to 1 year"
          legalBasis="Necessary for performance of contract (GDPR Art. 6(1)(b))."
        />
        <Category
          name="Preferences"
          purpose="Remember non-essential UI choices (theme, list layouts, dismissed tooltips)."
          examples="theme, sidebar_collapsed"
          lifetime="Up to 1 year"
          legalBasis="Consent (GDPR Art. 6(1)(a))."
        />
        <Category
          name="Analytics"
          purpose="Understand which features are used so we can improve the product. Aggregate, not used to identify you."
          examples="posthog_*, _ga, ph_session"
          lifetime="Up to 13 months"
          legalBasis="Consent (GDPR Art. 6(1)(a) / CCPA opt-out)."
        />
        <Category
          name="Marketing"
          purpose="Measure ad performance and show relevant product updates. Off by default."
          examples="_fbp, _gcl_au, li_sugr"
          lifetime="Up to 13 months"
          legalBasis="Consent (GDPR Art. 6(1)(a))."
        />
      </Section>

      <Section title="3. How to manage your choices">
        You can accept, reject, or change your cookie preferences at any
        time from the banner that appears on first visit, or from your{" "}
        <Link className="underline" href="/settings">
          Settings → Privacy
        </Link>
        . You can also use your browser&apos;s settings to block or delete
        cookies — note that essential cookies are required for the site to
        function.
      </Section>

      <Section title="4. Regional rights">
        <p className="text-sm text-muted leading-relaxed">
          <strong className="text-foreground">EU/EEA, UK, Switzerland:</strong>{" "}
          non-essential cookies require prior consent (GDPR/PECR). You can
          withdraw consent at any time.
        </p>
        <p className="mt-3 text-sm text-muted leading-relaxed">
          <strong className="text-foreground">California, Colorado, Virginia, and other US states:</strong>{" "}
          you can opt out of the sale or sharing of personal information via{" "}
          <Link className="underline" href="/do-not-sell">
            Do Not Sell or Share My Personal Information
          </Link>
          .
        </p>
        <p className="mt-3 text-sm text-muted leading-relaxed">
          <strong className="text-foreground">Brazil (LGPD), India (DPDPA), Japan (APPI), Singapore (PDPA), South Korea (PIPA), South Africa (POPIA):</strong>{" "}
          local data protection rights apply. Contact our DPO below.
        </p>
      </Section>

      <Section title="5. Third-party cookies">
        <p className="text-sm text-muted leading-relaxed">
          We may use trusted vendors for authentication (NextAuth), analytics
          (PostHog or GA), error monitoring (Sentry), and payments (Stripe).
          Each has its own privacy notice. We only set their cookies with
          the consent you provide in the categories above.
        </p>
      </Section>

      <Section title="6. Changes">
        We may update this policy. If changes are material we will
        re-prompt you for consent and log the new policy version against
        your choice.
      </Section>

      <Section title="7. Contact">
        <p className="text-sm text-muted leading-relaxed">
          Data Protection Officer: <a href="mailto:dpo@workwrk.com" className="underline">dpo@workwrk.com</a>
          <br />
          Postal address: [company address — NEEDS LEGAL REVIEW]
          <br />
          EU Representative (Art. 27): [appointed rep — NEEDS LEGAL REVIEW]
          <br />
          UK Representative: [appointed rep — NEEDS LEGAL REVIEW]
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-sm text-muted leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Category({
  name,
  purpose,
  examples,
  lifetime,
  legalBasis,
}: {
  name: string;
  purpose: string;
  examples: string;
  lifetime: string;
  legalBasis: string;
}) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <p className="font-medium text-foreground">{name}</p>
      <dl className="mt-2 grid grid-cols-[120px,1fr] gap-x-3 gap-y-1 text-xs text-muted">
        <dt>Purpose</dt><dd>{purpose}</dd>
        <dt>Examples</dt><dd className="font-mono">{examples}</dd>
        <dt>Lifetime</dt><dd>{lifetime}</dd>
        <dt>Legal basis</dt><dd>{legalBasis}</dd>
      </dl>
    </div>
  );
}
