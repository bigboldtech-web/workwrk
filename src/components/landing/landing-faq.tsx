// FAQ — section 8.
//
// Header on the left, accordion on the right. Pure CSS expand using
// the native <details> element + a CSS rotation on the plus icon when
// open. Each row fades up on scroll with a small stagger. The "Live"
// signal dot on the contact link is the only continuous motion in
// this section — the accordion is calm.

"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const ITEMS: readonly { q: string; a: string }[] = [
  {
    q: "How is this different from an HRMS?",
    a: "HRMS tools focus on HR administration — payroll, leave, attendance. WorkwrK is the business operating system: KPIs, SOPs, performance, tasks, money, culture, and AI. You'd put WorkwrK over (or instead of) an HRMS, not next to one.",
  },
  {
    q: "Do I have to migrate everything at once?",
    a: "No. The hubs are independent. Most customers start with Work (tasks + OKRs + KPIs) or Culture (kudos + surveys), see the wins, then expand. We have a one-click importer for the top 12 SaaS tools.",
  },
  {
    q: "What about AI — is it just a chatbot?",
    a: "It's the runtime. AI triages your inbox, surfaces SOP drift, recommends promotions, flags KPI risk, and answers business questions in plain English over your real data — not a generic LLM. Cmd-K searches every entity.",
  },
  {
    q: "How does WorkwrK price compare to the alternatives?",
    a: "Free under 5 people. $8/user above that. A typical 50-person company replaces ~$12k/mo of disconnected tools with ~$400/mo of WorkwrK. The math works on day one.",
  },
  {
    q: "Is it built for India, UAE, and Southeast Asia?",
    a: "Yes — INR/AED/SGD pricing, multi-currency, multi-location org charts, IST/Asia time zones across the workflow engine. We're built for the operational reality of fast-growing companies in those markets.",
  },
  {
    q: "What about data security?",
    a: "SOC 2 Type II, ISO 27001, GDPR + DPDP-compliant. SSO + SCIM on Scale. Encryption at rest and in transit. EU and India data residency options. See /security for the full deck.",
  },
];

export function LandingFAQ() {
  return (
    <section className="bg-white py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-[1fr_2fr] gap-12 lg:gap-16">
          {/* Left rail */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-[0.22em]"
              style={{ color: "var(--brand-red)" }}
            >
              Common questions
            </p>
            <h2
              className="mt-5 font-extrabold tracking-[-0.03em]"
              style={{
                color: "var(--m-text)",
                fontSize: "clamp(1.9rem, 3.6vw, 3rem)",
                lineHeight: 1.06,
              }}
            >
              Everything you wanted to ask{" "}
              <span style={{ color: "var(--brand-blue)" }}>before sign-up.</span>
            </h2>
            <p
              className="mt-5 text-base lg:text-lg leading-relaxed"
              style={{ color: "var(--m-text-muted)" }}
            >
              Still curious?{" "}
              <Link
                href="/contact"
                className="font-semibold inline-flex items-center gap-1.5 transition-colors"
                style={{ color: "var(--m-text)" }}
              >
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "var(--brand-red)" }}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
                Chat with the team
              </Link>
              . Real humans, real responses.
            </p>
          </motion.div>

          {/* Accordion */}
          <motion.div
            className="rounded-2xl bg-white"
            style={{ border: "1px solid var(--m-border)" }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            {ITEMS.map((item, i) => (
              <FAQRow key={item.q} q={item.q} a={item.a} isLast={i === ITEMS.length - 1} delay={0.05 + i * 0.05} />
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FAQRow({
  q, a, isLast, delay,
}: { q: string; a: string; isLast: boolean; delay: number }) {
  return (
    <motion.details
      className="group [&_summary::-webkit-details-marker]:hidden"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--m-border)" }}
      initial={{ opacity: 0, x: -10 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <summary className="flex items-center justify-between gap-6 cursor-pointer list-none px-6 lg:px-7 py-5 lg:py-6 hover:bg-[var(--m-surface)] transition-colors">
        <span
          className="font-semibold text-base lg:text-[17px]"
          style={{ color: "var(--m-text)" }}
        >
          {q}
        </span>
        <span
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all group-open:rotate-45 flex-shrink-0"
          style={{
            backgroundColor: "var(--m-surface)",
            color: "var(--m-text)",
            border: "1px solid var(--m-border)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 1v12M1 7h12" />
          </svg>
        </span>
      </summary>
      <div
        className="px-6 lg:px-7 pb-6 text-[14.5px] leading-relaxed"
        style={{ color: "var(--m-text-muted)" }}
      >
        {a}
      </div>
    </motion.details>
  );
}
