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
  CheckCircle2,
  Lightbulb,
  Clock,
  Zap,
} from "lucide-react";
import { AutonomousDialog } from "@/components/agents/autonomous-dialog";
import { X, Loader2, AlertCircle } from "lucide-react";

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
  autonomousEnabled: boolean;
  scheduleCron: string | null;
  autonomousPrompt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
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
  const [scheduling, setScheduling] = useState<InstalledAgent | null>(null);
  // Custom-agent create dialog. Lives at the page level so the open
  // state survives any re-render of the list below.
  const [showCreate, setShowCreate] = useState(false);

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
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} />
          Create custom agent
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
                    autonomousEnabled={a.autonomousEnabled}
                    scheduleCron={a.scheduleCron}
                    nextRunAt={a.nextRunAt}
                    onChat={() => chatWith(a.slug)}
                    onSchedule={() => setScheduling(a)}
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

      {scheduling && (
        <AutonomousDialog
          agentSlug={scheduling.slug}
          agentName={scheduling.name}
          initial={{
            autonomousEnabled: scheduling.autonomousEnabled,
            scheduleCron: scheduling.scheduleCron,
            autonomousPrompt: scheduling.autonomousPrompt,
            lastRunAt: scheduling.lastRunAt,
            nextRunAt: scheduling.nextRunAt,
          }}
          onClose={() => setScheduling(null)}
          onSaved={async () => { await refresh(); }}
        />
      )}

      {showCreate && (
        <CreateAgentDialog
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await refresh(); }}
        />
      )}
    </div>
  );
}

// Inline create-custom-agent dialog. Posts to /api/agents and lets the
// new agent appear in the list above with its own Chat / Autonomous
// CTAs alongside the prebuilt catalog entries.
function CreateAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [productSlug, setProductSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !description.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          persona: persona.trim() || undefined,
          description: description.trim(),
          systemPrompt: systemPrompt.trim(),
          productSlug: productSlug.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Create failed");
        return;
      }
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => { if (!saving) onClose(); }}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create custom agent</h2>
          <button type="button" onClick={onClose} disabled={saving} className="p-1 rounded hover:bg-surface-2 text-muted" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-muted-2">Named specialist with a persistent persona. The system prompt shapes every reply — be specific about voice, scope, and what the agent should refuse.</p>

        <Row label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Pricing Analyst" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </Row>
        <Row label="Persona (one line)">
          <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Pricing expert. Pragmatic, numbers-first." className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </Row>
        <Row label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do? (shown on the agent card)" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </Row>
        <Row label="System prompt">
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6} placeholder="You are a Pricing Analyst at WorkwrK. You help the team set list prices, model discounts, and stress-test deals. Always cite the math. Refuse to give legal advice." className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none font-mono text-xs" />
        </Row>
        <Row label="Default app scope (optional)">
          <input value={productSlug} onChange={(e) => setProductSlug(e.target.value)} placeholder="workwrk-crm" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono text-xs" />
        </Row>

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300 inline-flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-md text-sm text-muted hover:bg-surface-2">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !name.trim() || !description.trim() || !systemPrompt.trim()}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Create agent
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1">{label}</label>
      {children}
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
  autonomousEnabled,
  scheduleCron,
  nextRunAt,
  onChat,
  onInstall,
  onSchedule,
}: {
  name: string;
  persona: string;
  description: string;
  hue: string;
  isInstalled?: boolean;
  productSlug: string | null;
  examplePrompts: string[];
  busy: boolean;
  autonomousEnabled?: boolean;
  scheduleCron?: string | null;
  nextRunAt?: string | null;
  onChat?: () => void;
  onInstall?: () => void;
  onSchedule?: () => void;
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

      {isInstalled && autonomousEnabled && nextRunAt && (
        <div className="text-[10px] text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 mb-2 font-medium">
          <Zap size={9} /> Autonomous · next run {(() => {
            const ms = new Date(nextRunAt).getTime() - Date.now();
            const mins = Math.max(0, Math.round(ms / 60_000));
            if (mins < 60) return `in ${mins}m`;
            const hrs = Math.round(mins / 60);
            if (hrs < 24) return `in ${hrs}h`;
            return `in ${Math.round(hrs / 24)}d`;
          })()}
          {scheduleCron && <span className="text-muted-2"> · {scheduleCron}</span>}
        </div>
      )}

      {isInstalled ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onChat}
            disabled={busy}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {busy ? "Opening…" : (<><MessageSquare size={12} /> Chat</>)}
          </button>
          <button
            type="button"
            onClick={onSchedule}
            className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg border border-border hover:border-violet-300 text-xs font-medium text-muted hover:text-violet-700"
            title="Schedule autonomous runs"
          >
            <Clock size={12} /> Auto
          </button>
        </div>
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
