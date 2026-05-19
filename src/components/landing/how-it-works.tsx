// "How it works" — section 6.
//
// Three numbered steps in a row, each with a mini product mock showing
// what happens at that step. Between the cards, an animated dashed
// path connects them and draws itself as the section enters view.
//
// Step content:
//   01 · Sign up           — sign-up form, "started in 60s", brand red
//   02 · Pick your hubs    — hub picker with auto-checking animation, brand blue
//   03 · Invite your team — avatar tiles filling in + AI auto-assign, brand yellow

"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";

export function HowItWorks() {
  return (
    <section className="relative bg-white py-24 lg:py-32 overflow-hidden">
      <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
        {/* Header */}
        <motion.div
          className="max-w-3xl"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p
            className="text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "var(--brand-red)" }}
          >
            How it works
          </p>
          <h2
            className="mt-5 font-extrabold tracking-[-0.03em]"
            style={{
              color: "var(--m-text)",
              fontSize: "clamp(2rem, 4vw, 3.4rem)",
              lineHeight: 1.04,
            }}
          >
            From signup to a running workspace{" "}
            <span style={{ color: "var(--brand-blue)" }}>in under five minutes.</span>
          </h2>
          <p
            className="mt-5 text-base lg:text-lg leading-relaxed max-w-2xl"
            style={{ color: "var(--m-text-muted)" }}
          >
            No sales call. No SOW. Pick the hubs you need today, invite
            your team, and the workspace starts working with you on the
            same afternoon.
          </p>
        </motion.div>

        {/* Steps row */}
        <div className="mt-16 lg:mt-20 relative">
          {/* Connecting dashed path (desktop) — animated draw */}
          <ConnectorPath />

          <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 relative">
            <Step
              num="01"
              hue="var(--brand-red)"
              hueSoft="var(--brand-red-soft)"
              title="Sign up free"
              body="Get started in 60 seconds. Free forever for up to 5 people. No card, no demo gate, no sales SOW."
              footer={<SignupCounter />}
              mock={<SignupMock />}
              delay={0.05}
            />
            <Step
              num="02"
              hue="var(--brand-blue)"
              hueSoft="var(--brand-blue-soft)"
              title="Pick your hubs"
              body="Turn on the hubs you need today. People, Work, Money, Talent, Culture, Growth — pick three, pick seven, add more whenever."
              footer={<HubsCounter />}
              mock={<HubPickerMock />}
              delay={0.2}
            />
            <Step
              num="03"
              hue="var(--brand-yellow)"
              hueSoft="var(--brand-yellow-soft)"
              title="Invite your team"
              body="Drop in emails or paste from SCIM. WorkwrK AI assigns the first batch of tasks on day one — your team lands on a workspace already moving."
              footer={<AIAssignChip />}
              mock={<InviteMock />}
              delay={0.35}
            />
          </div>
        </div>

        {/* Closing line */}
        <motion.div
          className="mt-16 lg:mt-20 text-center"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          <a
            href="/signup"
            className="inline-flex items-center gap-2 h-12 px-7 rounded-full text-white font-semibold text-[15px] shadow-[0_8px_24px_-8px_rgba(255,61,87,0.45)] hover:shadow-[0_12px_32px_-8px_rgba(255,61,87,0.6)] hover:-translate-y-0.5 transition-all"
            style={{ backgroundColor: "var(--brand-red)" }}
          >
            Start your workspace <ArrowRight size={15} />
          </a>
          <p className="mt-4 text-sm" style={{ color: "var(--m-text-soft)" }}>
            Free forever up to 5 people · 60-second signup
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Connector path — dashed line that draws between the three step cards
// ════════════════════════════════════════════════════════════════════

function ConnectorPath() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <svg
      ref={ref}
      className="absolute hidden lg:block pointer-events-none"
      width="100%"
      height="60"
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      style={{ top: "30%", left: 0, right: 0 }}
      aria-hidden
    >
      <motion.path
        d="M 5 30 Q 25 5, 50 30 T 95 30"
        stroke="var(--m-border-dark)"
        strokeWidth="0.5"
        strokeDasharray="1.5 1.5"
        fill="none"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={inView ? { pathLength: 1, opacity: 0.6 } : { pathLength: 0, opacity: 0 }}
        transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step card
// ════════════════════════════════════════════════════════════════════

function Step({
  num, hue, hueSoft, title, body, mock, footer, delay,
}: {
  num: string;
  hue: string;
  hueSoft: string;
  title: string;
  body: string;
  mock: React.ReactNode;
  footer: React.ReactNode;
  delay: number;
}) {
  return (
    <motion.div
      className="relative rounded-2xl bg-white p-7 overflow-hidden"
      style={{ border: "1px solid var(--m-border)" }}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -6 }}
    >
      {/* Color stripe top */}
      <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: hue }} />

      {/* Step number badge */}
      <div className="flex items-baseline justify-between">
        <span
          className="font-extrabold tracking-[-0.04em] tabular-nums"
          style={{
            color: hue,
            fontSize: "44px",
            lineHeight: 1,
          }}
        >
          {num}
        </span>
        <span
          className="inline-flex items-center text-[9px] font-bold uppercase tracking-[0.18em] px-2 h-5 rounded-full"
          style={{ backgroundColor: hueSoft, color: hue }}
        >
          Step
        </span>
      </div>

      {/* Title + body */}
      <h3
        className="mt-5 font-extrabold tracking-tight"
        style={{
          color: "var(--m-text)",
          fontSize: "22px",
          lineHeight: 1.15,
        }}
      >
        {title}
      </h3>
      <p
        className="mt-3 text-[14px] leading-relaxed"
        style={{ color: "var(--m-text-muted)" }}
      >
        {body}
      </p>

      {/* Mini mock */}
      <div className="mt-6">{mock}</div>

      {/* Footer accent */}
      <div className="mt-5">{footer}</div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 1 mock — Signup form + counter
// ════════════════════════════════════════════════════════════════════

function SignupMock() {
  // Animated typing effect for the email field
  const text = "priya@helios.com";
  const [typed, setTyped] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  useEffect(() => {
    if (!inView) return;
    let i = 0;
    const t = setInterval(() => {
      setTyped(text.slice(0, ++i));
      if (i >= text.length) clearInterval(t);
    }, 65);
    return () => clearInterval(t);
  }, [inView]);

  return (
    <div
      ref={ref}
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}
    >
      <p
        className="text-[9.5px] font-bold uppercase tracking-[0.18em]"
        style={{ color: "var(--m-text-soft)" }}
      >
        Get started
      </p>
      <div
        className="mt-2 px-3 h-10 rounded-md bg-white flex items-center"
        style={{ border: "1px solid var(--m-border)" }}
      >
        <span className="text-[12.5px]" style={{ color: "var(--m-text)" }}>
          {typed}
        </span>
        <motion.span
          className="ml-px w-px h-4 inline-block"
          style={{ backgroundColor: "var(--brand-red)" }}
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: "var(--m-text-soft)" }}
        >
          ENTER ↵
        </span>
      </div>
      <div
        className="mt-2 inline-flex items-center justify-center w-full h-10 rounded-md text-white text-[12px] font-bold"
        style={{ backgroundColor: "var(--brand-red)" }}
      >
        Create workspace
      </div>
    </div>
  );
}

function SignupCounter() {
  const [n, setN] = useState(31247);
  useEffect(() => {
    const t = setInterval(() => setN((c) => c + 1), 5500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--m-text-muted)" }}>
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: "var(--brand-red)" }}
      />
      <span className="font-bold tabular-nums" style={{ color: "var(--m-text)" }}>
        {n.toLocaleString()}
      </span>{" "}
      signups this quarter
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 2 mock — Hub picker with auto-checking
// ════════════════════════════════════════════════════════════════════

const HUBS = [
  { name: "Home",    hue: "#6366f1" },
  { name: "People",  hue: "#7c3aed" },
  { name: "Work",    hue: "#0073EA" },
  { name: "Money",   hue: "#10b981" },
  { name: "Talent",  hue: "#d946ef" },
  { name: "Culture", hue: "#ec4899" },
  { name: "Growth",  hue: "#f59e0b" },
];

function HubPickerMock() {
  // Auto-check 4 hubs over time as the section enters view
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  useEffect(() => {
    if (!inView) return;
    const order = [0, 2, 1, 4]; // Home, Work, People, Talent
    order.forEach((idx, i) => {
      setTimeout(() => {
        setChecked((s) => new Set(s).add(idx));
      }, 350 * (i + 1));
    });
  }, [inView]);

  return (
    <div
      ref={ref}
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}
    >
      <p
        className="text-[9.5px] font-bold uppercase tracking-[0.18em]"
        style={{ color: "var(--m-text-soft)" }}
      >
        Activate hubs
      </p>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {HUBS.map((hub, i) => {
          const isChecked = checked.has(i);
          return (
            <div
              key={hub.name}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white transition-colors"
              style={{
                border: `1px solid ${isChecked ? hub.hue : "var(--m-border)"}`,
              }}
            >
              <span
                className="w-4 h-4 rounded flex items-center justify-center transition-colors"
                style={{
                  backgroundColor: isChecked ? hub.hue : "transparent",
                  border: `1.5px solid ${isChecked ? hub.hue : "var(--m-border-dark)"}`,
                }}
              >
                {isChecked && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Check size={9} className="text-white" strokeWidth={3} />
                  </motion.span>
                )}
              </span>
              <span
                className="text-[11px] font-semibold truncate"
                style={{
                  color: isChecked ? "var(--m-text)" : "var(--m-text-muted)",
                }}
              >
                {hub.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HubsCounter() {
  return (
    <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--m-text-muted)" }}>
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: "var(--brand-blue)" }}
      />
      Add or remove hubs anytime &mdash; no re-platforming.
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 3 mock — Invite team with avatars filling in
// ════════════════════════════════════════════════════════════════════

// Clean illustrated avatars via DiceBear's "notionists" style — the
// Notion-style line illustrations of people on soft pastel backgrounds.
// Looks designed, not stocky. Stable, predictable, and reads well at
// thumbnail size. Swap for real photography when shot.
const AVATAR_BG = "b6e3f4,c0aede,ffd5dc,ffdfbf,d1d4f9,b1e6d3";
function avatar(seed: string) {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${AVATAR_BG}&radius=8`;
}

const INVITEES = [
  { initials: "PI", img: avatar("Priya Iyer")    },
  { initials: "MC", img: avatar("Maya Chen")     },
  { initials: "DK", img: avatar("Daniel Kim")    },
  { initials: "KP", img: avatar("Karim Patel")   },
  { initials: "SC", img: avatar("Sarah Chen")    },
  { initials: "JR", img: avatar("Jamie Reyes")   },
  { initials: "AS", img: avatar("Anita Sharma")  },
  { initials: "MR", img: avatar("Mei Robertson") },
];

function InviteMock() {
  const [visible, setVisible] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  useEffect(() => {
    if (!inView) return;
    INVITEES.forEach((_, i) => {
      setTimeout(() => setVisible((v) => Math.max(v, i + 1)), 200 * (i + 1));
    });
  }, [inView]);

  return (
    <div
      ref={ref}
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}
    >
      <div className="flex items-baseline justify-between">
        <p
          className="text-[9.5px] font-bold uppercase tracking-[0.18em]"
          style={{ color: "var(--m-text-soft)" }}
        >
          Team invited
        </p>
        <span className="text-[10px] font-mono" style={{ color: "var(--m-text-soft)" }}>
          {Math.min(visible, INVITEES.length)} / {INVITEES.length}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {INVITEES.map((a, i) => {
          const shown = i < visible;
          return (
            <motion.div
              key={i}
              className="relative aspect-square rounded-md overflow-hidden"
              style={{
                backgroundColor: "var(--m-border)",
                border: "1px solid var(--m-border)",
              }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={shown ? { opacity: 1, scale: 1 } : { opacity: 0.4, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {shown && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.img}
                    alt={`Team member ${a.initials}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <span
                    className="absolute bottom-1 left-1 text-[8px] font-bold text-white px-1 py-0.5 rounded backdrop-blur-sm"
                    style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
                  >
                    {a.initials}
                  </span>
                </>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function AIAssignChip() {
  return (
    <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--m-text-muted)" }}>
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center"
        style={{ backgroundColor: "var(--brand-yellow-soft)", color: "#92400e" }}
      >
        <Sparkles size={10} strokeWidth={2.4} />
      </span>
      <span>
        AI auto-assigned{" "}
        <span className="font-bold" style={{ color: "var(--m-text)" }}>
          8 tasks
        </span>{" "}
        on day one
      </span>
    </div>
  );
}
