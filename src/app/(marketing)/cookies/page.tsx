import type { Metadata } from "next";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  CTABand,
  HUES,
} from "@/components/marketing/primitives";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = {
  title: "Cookie Policy — WorkwrK",
  description: "What cookies we set, why, and how you can control them. Plain English; GDPR + ePrivacy compliant.",
  alternates: { canonical: "https://workwrk.com/cookies" },
};

const COOKIES = [
  { name: "ww_session",     purpose: "Authentication session token",                  duration: "Session",  type: "Essential" },
  { name: "ww_csrf",         purpose: "CSRF protection",                                duration: "Session",  type: "Essential" },
  { name: "ww_preferences",  purpose: "Theme, language, density preferences",           duration: "365 days", type: "Functional" },
  { name: "_ga / _ga_*",     purpose: "Google Analytics (aggregate usage)",             duration: "13 months", type: "Analytics" },
  { name: "ww_attrib",       purpose: "Marketing attribution (last-click)",             duration: "30 days",  type: "Analytics" },
  { name: "ww_consent",      purpose: "Records your cookie preferences",                duration: "365 days", type: "Essential" },
];

export default function CookiesPage() {
  const t = HUES.amber;
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="amber" className="mb-5">Legal</Eyebrow>
            <H1>Cookie Policy.</H1>
            <p className="mt-5 text-base text-slate-600">
              Last updated: <span className="font-semibold text-slate-900">May 18, 2026</span>
            </p>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-2xl">
              The cookies we set on workwrk.com and the WorkwrK product, what they do,
              and how you control them. Six cookies total. No third-party ad networks.
            </p>
          </div>
        </Container>
      </Section>

      <LegalPage
        hue="amber"
        sections={[
          { id: "what", title: "1. What cookies are", body: (
            <p>Cookies are small text files stored in your browser. They let us keep you logged in, remember your preferences, and understand (in aggregate) how the Service is used.</p>
          )},
          { id: "list", title: "2. The cookies we use", body: (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    <th className="p-3">Name</th>
                    <th className="p-3">Purpose</th>
                    <th className="p-3">Duration</th>
                    <th className="p-3">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {COOKIES.map((c) => (
                    <tr key={c.name} className="border-t border-slate-100">
                      <td className="p-3 font-mono text-xs text-slate-900">{c.name}</td>
                      <td className="p-3 text-slate-700">{c.purpose}</td>
                      <td className="p-3 text-slate-500">{c.duration}</td>
                      <td className="p-3">
                        <span className={`inline-flex text-[10px] font-bold uppercase tracking-[0.14em] px-2 h-5 items-center rounded-full ${t.bgTint} ${t.text} border ${t.border}`}>
                          {c.type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )},
          { id: "control", title: "3. How you control them", body: (
            <>
              <p>Essential cookies are required for the Service to work and can&apos;t be disabled. Functional and analytics cookies are opt-in &mdash; you control them via the consent banner on first visit, or anytime by clearing cookies and reloading.</p>
              <p>You can also block all cookies in your browser settings. The Service won&apos;t work properly without essential cookies.</p>
            </>
          )},
          { id: "third", title: "4. Third-party cookies", body: (
            <p>The only third-party cookies we set are Google Analytics (analytics). We don&apos;t use ad-tech, retargeting pixels, or social-network trackers. If we ever add a third-party cookie, we&apos;ll update this page and ask consent.</p>
          )},
          { id: "contact", title: "5. Contact", body: (
            <p>Questions about cookies: <a href="mailto:privacy@workwrk.com" className="text-amber-700 underline underline-offset-2">privacy@workwrk.com</a>.</p>
          )},
        ]}
      />

      <CTABand hue="amber" />
    </>
  );
}
