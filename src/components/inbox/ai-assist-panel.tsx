"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";

type SuggestedAction = "approve" | "hold" | "reassign" | "do" | "review";

interface Suggestion {
  id: string;
  action: SuggestedAction;
  rationale: string;
  confidence: number;
}

export interface InboxAiItem {
  id: string;
  type: string;
  title: string;
  context?: string;
  link?: string;
}

interface Props {
  items: InboxAiItem[];
}

const ACTION_LABEL: Record<SuggestedAction, string> = {
  approve: "Approve",
  hold: "Hold",
  reassign: "Reassign",
  do: "Do",
  review: "Review",
};

const ACTION_COLOR: Record<SuggestedAction, string> = {
  approve: "text-green-400 border-green-400/30 bg-green-400/10",
  hold: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  reassign: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  do: "text-[color:var(--accent-strong)] border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.06)]",
  review: "text-muted border-white/20 bg-surface-2",
};

/**
 * Asks Claude to triage the inbox: per-item action + one-line rationale.
 * Renders a stacked card list with the user's link still clickable so
 * they can verify before acting. AI is opt-in (button click) to keep
 * the inbox cheap on every page load.
 */
export function InboxAiAssistPanel({ items }: Props) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/inbox-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "AI unavailable");
        return;
      }
      const data = json?.data ?? json;
      setSuggestions(data?.suggestions ?? []);
    } catch {
      setError("Couldn't reach the AI service");
    } finally {
      setLoading(false);
    }
  }

  if (suggestions === null && !loading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles size={14} className="text-[color:var(--accent-strong)]" />
            <span>
              <strong>{items.length}</strong> items to triage —
              {" "}let AI suggest what's safe to approve.
            </span>
          </div>
          <Button size="sm" onClick={run}>
            <Sparkles size={12} className="mr-1.5" /> Suggest actions
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" />
          Thinking through {items.length} item{items.length === 1 ? "" : "s"}…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-amber-400">AI assist: {error}</span>
          <Button size="sm" variant="outline" onClick={run}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const sugByItemId = new Map((suggestions ?? []).map((s) => [s.id, s] as const));
  const itemsWithSug = items.map((it) => ({ item: it, sug: sugByItemId.get(it.id) ?? null }));
  const counts = (suggestions ?? []).reduce<Record<SuggestedAction, number>>((acc, s) => {
    acc[s.action] = (acc[s.action] ?? 0) + 1;
    return acc;
  }, { approve: 0, hold: 0, reassign: 0, do: 0, review: 0 });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles size={14} className="text-[color:var(--accent-strong)]" />
            AI triage
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
            {(Object.entries(counts) as [SuggestedAction, number][])
              .filter(([, n]) => n > 0)
              .map(([action, n]) => (
                <span key={action} className={`rounded-full border px-2 py-0.5 ${ACTION_COLOR[action]}`}>
                  {n} {ACTION_LABEL[action].toLowerCase()}
                </span>
              ))}
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={run}>
              Refresh
            </Button>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {itemsWithSug.map(({ item, sug }) => (
            <li key={`${item.type}:${item.id}`} className="py-2 flex items-start gap-3">
              {sug ? (
                <span
                  className={`text-[10px] uppercase tracking-wide rounded-md border px-1.5 py-0.5 shrink-0 ${ACTION_COLOR[sug.action]}`}
                  title={`Confidence ${(sug.confidence * 100).toFixed(0)}%`}
                >
                  {ACTION_LABEL[sug.action]}
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-wide rounded-md border border-white/20 px-1.5 py-0.5 text-muted shrink-0">—</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.link ? (
                    <a href={item.link} className="text-sm font-medium truncate hover:underline">
                      {item.title}
                    </a>
                  ) : (
                    <span className="text-sm font-medium truncate">{item.title}</span>
                  )}
                  <span className="text-[10px] text-muted-2 uppercase">{item.type}</span>
                </div>
                {sug && <p className="text-xs text-muted line-clamp-2">{sug.rationale}</p>}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-muted-2">
          AI suggestions are advisory. Verify before acting on anything financial or sensitive.
        </p>
      </CardContent>
    </Card>
  );
}
