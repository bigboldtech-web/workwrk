// White ClickUp-style auth shell. Two panes: form on the left,
// product proof on the right (testimonial + feature pills). Mobile
// collapses to a single column with the proof pane below the form.
//
// Replaces the old BentoRoot dark shell so /login, /register,
// /forgot-password, /verify-email, /welcome all share the same
// clean light aesthetic the rest of the marketing + app uses.

import Link from "next/link";
import { Sparkles, Shield, Zap, Globe } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased grid lg:grid-cols-2">
      {/* ── Form pane ── */}
      <div className="flex flex-col px-6 sm:px-10 lg:px-16 py-10">
        <Link href="/" className="inline-flex items-center gap-2 group w-fit">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center group-hover:from-violet-600 group-hover:to-violet-500 transition-colors">
            <span className="text-white text-sm font-bold tracking-tight">W</span>
          </span>
          <span className="font-bold text-base tracking-tight">workwrk</span>
        </Link>

        <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto">
          {children}
        </div>

        <div className="text-xs text-slate-500 mt-8 flex items-center justify-between gap-4 max-w-md w-full mx-auto flex-wrap">
          <span>© {new Date().getFullYear()} WorkwrK</span>
          <div className="flex items-center gap-3">
            <Link href="/terms" className="hover:text-slate-700">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-700">Privacy</Link>
            <Link href="/help-center" className="hover:text-slate-700">Help</Link>
          </div>
        </div>
      </div>

      {/* ── Proof pane ── (hidden on small screens) */}
      <div className="hidden lg:flex flex-col justify-center px-12 xl:px-20 py-12 bg-gradient-to-br from-violet-50 via-white to-emerald-50/40 border-l border-slate-100 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-72 h-72 bg-violet-200/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" aria-hidden />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-200/30 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" aria-hidden />

        <div className="relative max-w-md">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full">
            <Sparkles size={11} /> One platform. Every system.
          </div>

          <h2 className="text-3xl xl:text-4xl font-bold tracking-tight text-slate-900 mt-5 leading-[1.15]">
            The operating system every business deserves.
          </h2>

          <p className="text-slate-600 mt-4 leading-relaxed">
            People · KPIs · SOPs · Tasks · Time · Expenses · Procurement · Payroll · Benefits · Financials · Planning. One login, one source of truth.
          </p>

          <div className="grid grid-cols-2 gap-2 mt-7">
            {[
              { icon: Zap, label: "Set up in minutes" },
              { icon: Shield, label: "SSO + SCIM + audit log" },
              { icon: Globe, label: "Multi-currency, 18 locales" },
              { icon: Sparkles, label: "AI built in" },
            ].map((p) => (
              <div key={p.label} className="flex items-center gap-2 text-sm text-slate-700 bg-white/70 backdrop-blur border border-slate-200/70 rounded-lg px-3 py-2">
                <p.icon size={14} className="text-violet-600 flex-shrink-0" />
                <span>{p.label}</span>
              </div>
            ))}
          </div>

          <figure className="mt-8 border-l-2 border-violet-300 pl-4">
            <blockquote className="text-sm text-slate-700 italic">
              "We replaced 14 SaaS tools with WorkwrK in one quarter. Our managers actually open the app now — that didn't happen with Workday."
            </blockquote>
            <figcaption className="text-xs text-slate-500 mt-2">
              — Mohsin S., COO at a 280-person services firm
            </figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}
