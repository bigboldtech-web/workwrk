// White ClickUp-style auth shell. Two panes: form on the left,
// product proof on the right (testimonial + feature pills). Mobile
// collapses to a single column with the proof pane below the form.
//
// Replaces the old BentoRoot dark shell so /login, /register,
// /forgot-password, /verify-email, /welcome all share the same
// clean light aesthetic the rest of the marketing + app uses.

import Link from "next/link";
import { Sparkles, Shield, Zap, Globe, FormInput, Table as TableIcon, FileText, Bot } from "lucide-react";

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
          <span className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center">
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
      <div className="hidden lg:flex flex-col justify-center px-12 xl:px-20 py-12 bg-zinc-50/60 border-l border-zinc-100 relative overflow-hidden">
        <div className="relative max-w-md">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0073EA] bg-white border border-blue-200/70 px-3 py-1.5 rounded-full shadow-sm">
            <Sparkles size={12} className="text-[#0073EA]" /> Built like Lego. Runs your whole business.
          </div>

          <h2 className="text-3xl xl:text-[2.5rem] font-bold tracking-tight text-slate-900 mt-6 leading-[1.1]">
            Compose your work OS, <span className="text-[#0073EA]">one primitive at a time.</span>
          </h2>

          <p className="text-slate-600 mt-5 leading-relaxed text-[15px]">
            Forms feed Tables. Tables embed in Docs. Docs link to Tasks.
            Sidekick AI spins up any of them in seconds. No more 14 disconnected SaaS tools.
          </p>

          {/* Primitives showcase — directly tied to what the app actually does */}
          <div className="grid grid-cols-2 gap-2.5 mt-7">
            {[
              { icon: FormInput,  label: "Forms",  hint: "any data, any source",          color: "text-[#0073EA] bg-blue-50 border-blue-100" },
              { icon: TableIcon,  label: "Tables", hint: "grid · kanban · calendar",      color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
              { icon: FileText,   label: "Docs",   hint: "block editor + AI summary",     color: "text-amber-600 bg-amber-50 border-amber-100" },
              { icon: Bot,        label: "Agents", hint: "tools, memory, workflows",      color: "text-rose-600 bg-rose-50 border-rose-100" },
            ].map((p) => (
              <div key={p.label} className={`flex items-start gap-2.5 text-sm text-slate-700 bg-white border rounded-xl px-3 py-2.5 transition hover:shadow-sm ${p.color.split(" ")[2]}`}>
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${p.color.split(" ").slice(0, 2).join(" ")}`}>
                  <p.icon size={14} />
                </span>
                <span className="flex flex-col">
                  <span className="font-semibold text-slate-800">{p.label}</span>
                  <span className="text-[12px] text-slate-500">{p.hint}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Trust badges — kept since they answer real buyer questions */}
          <div className="flex items-center gap-3 mt-6 text-[12px] text-slate-500 font-medium">
            <span className="inline-flex items-center gap-1"><Shield size={11} className="text-emerald-600" /> SSO + audit log</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1"><Zap size={11} className="text-amber-500" /> Setup in minutes</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1"><Globe size={11} className="text-blue-600" /> 18 locales</span>
          </div>

          <figure className="mt-7 bg-white/70 backdrop-blur border border-slate-200/70 rounded-2xl p-5 shadow-sm">
            <blockquote className="text-[15px] text-slate-700 leading-relaxed">
              &ldquo;We replaced <span className="font-semibold text-slate-900">14 SaaS tools</span> with WorkwrK in one quarter. Our managers actually open the app now — that didn&apos;t happen with Workday.&rdquo;
            </blockquote>
            <figcaption className="flex items-center gap-2.5 mt-4">
              <span className="w-8 h-8 rounded-full bg-zinc-900 text-white text-xs font-bold flex items-center justify-center">MS</span>
              <span className="text-xs">
                <span className="block font-semibold text-slate-900">Mohsin S.</span>
                <span className="block text-slate-500">COO · 280-person services firm</span>
              </span>
            </figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}
