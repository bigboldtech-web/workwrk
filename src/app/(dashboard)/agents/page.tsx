"use client";

// WorkwrK Agents — Phase D2 real runtime.
//
// Shows the org's installed prebuilt agents at the top, then the catalog
// of additional agents below ("Install" CTA). Each agent card has a
// "Chat" button that creates a /sidekick session scoped to that agent
// and routes the user there — so chatting with an agent reuses the same
// Sidekick UI but with the agent's persona + system prompt.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Plus,
  Sparkles,
  MessageSquare,
  Lock,
  CheckCircle2,
  Lightbulb,
} from "lucide-react";

type InstalledAgent = {
  id: string;
  slug: string;
  name: string;
  persona: string;
  description: string;
  productSlug: string | null;
  hue: string;
  isFlagship: boolean;
  isPrebuilt: boolean;
  status: string;
  examplePrompts: string[];
  createdAt: string;
};

type CatalogAgent = {
  slug: string;
  name: string;
  persona: string;
  description: string;
  productSlug: string;
  hue: string;
  examplePrompts: string[];
};

export default function AgentsPage() {
  const router = useRouter();
  const [installed, setInstalled] = useState<InstalledAgent[]>([]);
  const [available, setAvailable] = useState<CatalogAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const data = await res.json();
      setInstalled(data.installed ?? []);
      setAvailable(data.available ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function installAgent(slug: string) {
    setInstalling(slug);
    try {
      const res = await fetch(`/api/agents/${slug}/install`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Install failed");
        return;
      }
      await refresh();
    } finally {
      setInstalling(null);
    }
  }

  async function chatWith(slug: string) {
    setOpening(slug);
    try {
      const res = await fetch("/api/sidekick/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Could not start chat");
        return;
      }
      const data = await res.json();
      router.push(`/sidekick?session=${data.session.id}`);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium mb-3">
            <Bot size={12} />
            Agents
          </div>
          <h1 className="text-3xl font-semibold mb-1">Your AI workforce</h1>
          <p className="text-muted max-w-xl">
            Named specialists with persistent personas. Each agent ships with the matching product
            and runs on Claude with a domain-tuned system prompt.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
          title="Custom agent builder ships in Phase D3"
        >
          <Plus size={14} />
          Create custom agent
          <Lock size={11} className="ml-1" />
        </button>
      </div>

      {loading && installed.length === 0 ? (
        <div className="text-center text-sm text-muted py-20">Loading agents…</div>
      ) : (
        <>
          {/* Installed */}
          {installed.length > 0 && (
            <section className="mb-12">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-2 mb-3 inline-flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-600" />
                Installed in your workspace ({installed.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {installed.map((a) => (
                  <AgentCard
                    key={a.slug}
                    name={a.name}
                    persona={a.persona}
                    description={a.description}
                    hue={a.hue}
                    isInstalled
                    productSlug={a.productSlug ?? null}
                    examplePrompts={a.examplePrompts}
                    busy={opening === a.slug}
                    onChat={() => chatWith(a.slug)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Available to install */}
          {available.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-2 mb-3">
                More agents available ({available.length})
              </h2>
              <p className="text-xs text-muted-2 mb-4">
                Install a product from the Product Store to add its agents automatically — or install
                an agent directly here.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {available.map((a) => (
                  <AgentCard
                    key={a.slug}
                    name={a.name}
                    persona={a.persona}
                    description={a.description}
                    hue={a.hue}
                    productSlug={a.productSlug}
                    examplePrompts={a.examplePrompts}
                    busy={installing === a.slug}
                    onInstall={() => installAgent(a.slug)}
                  />
                ))}
              </div>
            </section>
          )}

          {installed.length === 0 && available.length === 0 && (
            <div className="text-center py-20">
              <Bot size={48} className="mx-auto mb-3 text-muted-2" />
              <p className="text-sm text-muted">No agents available. This is unexpected — please reach out to support.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentCard({
  name,
  persona,
  description,
  hue,
  isInstalled,
  productSlug,
  examplePrompts,
  busy,
  onChat,
  onInstall,
}: {
  name: string;
  persona: string;
  description: string;
  hue: string;
  isInstalled?: boolean;
  productSlug: string | null;
  examplePrompts: string[];
  busy: boolean;
  onChat?: () => void;
  onInstall?: () => void;
}) {
  return (
    <article className="group rounded-2xl border border-border bg-surface hover:border-violet-300 transition-all hover:shadow-md p-5 flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-16 h-16 rounded-2xl bg-${hue}-100 text-${hue}-600 flex items-center justify-center text-2xl font-bold`}
          aria-hidden
        >
          {name[0]}
        </div>
        {isInstalled && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 mt-1">
            <CheckCircle2 size={11} /> Installed
          </span>
        )}
      </div>
      <h3 className="font-semibold text-lg mb-0.5">{name}</h3>
      <p className="text-xs text-muted mb-1">{persona}</p>
      {productSlug && (
        <p className="text-[10px] text-muted-2 mb-3 uppercase tracking-wider">{productSlug.replace("workwrk-", "")}</p>
      )}
      <p className="text-xs text-muted leading-relaxed mb-3 flex-1">{description}</p>

      {examplePrompts.length > 0 && (
        <div className="mb-3 space-y-1">
          {examplePrompts.slice(0, 2).map((p) => (
            <div key={p} className="text-[10px] text-muted-2 inline-flex items-start gap-1">
              <Lightbulb size={9} className="flex-shrink-0 mt-0.5" />
              <span className="line-clamp-1">{p}</span>
            </div>
          ))}
        </div>
      )}

      {isInstalled ? (
        <button
          type="button"
          onClick={onChat}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {busy ? "Opening…" : (<><MessageSquare size={12} /> Chat with {name}</>)}
        </button>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-violet-300 text-xs font-medium text-muted hover:text-violet-700 disabled:opacity-50"
        >
          {busy ? "Installing…" : (<><Plus size={12} /> Install agent</>)}
        </button>
      )}
    </article>
  );
}
