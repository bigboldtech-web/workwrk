// Integrations — static hub. Points at the real integration surfaces
// (calendar feeds, the app marketplace, and API keys). No data fetch; just
// navigation cards, so this stays a Server Component.

import Link from "next/link";
import { Plug, Calendar, LayoutGrid, KeyRound, ChevronRight } from "lucide-react";

const CARDS = [
  {
    href: "/settings/calendar",
    icon: Calendar,
    title: "Calendar feeds",
    desc: "Connect Google, Outlook, iCloud or ICS feeds",
  },
  {
    href: "/integrations",
    icon: LayoutGrid,
    title: "App marketplace",
    desc: "Slack, GitHub, Jira, Drive and more",
  },
  {
    href: "/settings/api",
    icon: KeyRound,
    title: "API keys",
    desc: "Service tokens for webhooks & automations",
  },
];

export default function IntegrationsPage() {
  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Plug className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Integrations</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Connect WorkwrK to the tools your team already uses.
      </p>

      <div className="max-w-2xl space-y-2">
        {CARDS.map(({ href, icon: Icon, title, desc }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300 hover:bg-zinc-50"
          >
            <Icon className="h-5 w-5 shrink-0 text-zinc-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-zinc-900">{title}</div>
              <div className="text-[12.5px] text-zinc-500">{desc}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          </Link>
        ))}
      </div>
      <div className="h-10" />
    </div>
  );
}
