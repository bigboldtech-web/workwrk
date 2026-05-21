"use client";

// TemplateBrowserDialog — modal that lists installable BoardTemplates.
// Shows org-internal templates first, then public ones from other
// orgs sorted by install count. One-click install clones the template
// into a new StudioBoard in the caller's org (and optionally inside a
// specific workspace + product, if scope provided).

import { useCallback, useEffect, useState } from "react";
import {
  X, Loader2, Layers, Table as TableIcon, Kanban, Building2, Globe,
  Download, Search as SearchIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

type Template = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  productSlug: string | null;
  layout: "TABLE" | "KANBAN";
  color: string | null;
  visibility: "ORG" | "PUBLIC";
  installCount: number;
  isOwn: boolean;
  organization: { name: string; slug: string };
};

interface Props {
  scope?: {
    workspaceId?: string | null;
    productSlug?: string | null;
    productName?: string | null;
  };
  onClose: () => void;
  onInstalled: () => Promise<void> | void;
}

export function TemplateBrowserDialog({ scope, onClose, onInstalled }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (scope?.productSlug) params.set("product", scope.productSlug);
      if (query.trim()) params.set("q", query.trim());
      const qs = params.toString();
      const r = await fetch(`/api/studio/templates${qs ? `?${qs}` : ""}`);
      if (!r.ok) {
        setTemplates([]);
        return;
      }
      const d = await r.json();
      setTemplates(d.templates ?? []);
    } finally {
      setLoading(false);
    }
  }, [scope?.productSlug, query]);

  useEffect(() => { load(); }, [load]);

  const handleInstall = async (templateId: string) => {
    setInstalling(templateId);
    setError(null);
    try {
      const r = await fetch("/api/studio/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          workspaceId: scope?.workspaceId ?? undefined,
          productSlug: scope?.productSlug ?? undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Install failed");
        return;
      }
      await onInstalled();
      // Send the user straight into the freshly-installed board.
      if (d.board?.slug) router.push(`/studio/boards/${d.board.slug}`);
    } finally {
      setInstalling(null);
    }
  };

  const own = templates.filter((t) => t.isOwn);
  const community = templates.filter((t) => !t.isOwn);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={() => { if (!installing) onClose(); }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-surface border border-border shadow-xl p-5 space-y-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Board templates</h2>
            <p className="text-xs text-muted-2 mt-0.5">
              Install a pre-built board from your org or the community.
              {scope?.productName && (
                <> Filtering by <span className="font-medium">{scope.productName}</span>.</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2 text-muted"
            aria-label="Close"
            disabled={!!installing}
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative">
          <SearchIcon
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, description, category…"
            className="w-full pl-7 pr-3 py-1.5 rounded-md border border-border bg-surface-2 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        {error && (
          <p className="text-xs text-rose-600">{error}</p>
        )}

        <div className="overflow-y-auto -mx-1 px-1 flex-1 space-y-5">
          {loading ? (
            <div className="text-sm text-muted-2 inline-flex items-center gap-2 py-6">
              <Loader2 size={14} className="animate-spin" /> Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
              <Layers size={28} className="mx-auto mb-2 text-muted-2" />
              <p className="text-sm font-medium mb-1">No templates yet</p>
              <p className="text-xs text-muted-2 max-w-md mx-auto">
                Publish one of your boards from its detail view to make it installable here. Mark it Public to share with every org.
              </p>
            </div>
          ) : (
            <>
              {own.length > 0 && (
                <TemplateSection
                  title="From your org"
                  Icon={Building2}
                  templates={own}
                  onInstall={handleInstall}
                  installing={installing}
                />
              )}
              {community.length > 0 && (
                <TemplateSection
                  title="From the community"
                  Icon={Globe}
                  templates={community}
                  onInstall={handleInstall}
                  installing={installing}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateSection({
  title, Icon, templates, onInstall, installing,
}: {
  title: string;
  Icon: typeof Building2;
  templates: Template[];
  onInstall: (id: string) => void | Promise<void>;
  installing: string | null;
}) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-2 inline-flex items-center gap-1">
        <Icon size={10} /> {title} <span className="text-muted-2/70">· {templates.length}</span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {templates.map((t) => (
          <article
            key={t.id}
            className="rounded-xl border border-border bg-surface p-3 flex flex-col gap-2 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
          >
            <div className="flex items-center gap-2">
              {t.layout === "KANBAN" ? (
                <Kanban size={13} className="text-violet-600" />
              ) : (
                <TableIcon size={13} className="text-violet-600" />
              )}
              <h4 className="font-medium text-sm truncate flex-1">{t.name}</h4>
              {t.visibility === "PUBLIC" && (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-violet-700 bg-violet-50 dark:bg-violet-950/30 px-1.5 py-0.5 rounded">
                  Public
                </span>
              )}
            </div>
            {t.description && (
              <p className="text-[11px] text-muted-2 line-clamp-2">{t.description}</p>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-2 flex-wrap">
              {t.category && <span className="px-1.5 py-0.5 rounded bg-surface-2">{t.category}</span>}
              {t.productSlug && (
                <span className="uppercase tracking-wider">{t.productSlug.replace(/^workwrk-/, "")}</span>
              )}
              {!t.isOwn && (
                <span className="truncate max-w-[140px]">by {t.organization.name}</span>
              )}
              <span>· {t.installCount} install{t.installCount === 1 ? "" : "s"}</span>
            </div>
            <button
              type="button"
              onClick={() => onInstall(t.id)}
              disabled={installing !== null}
              className="mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
            >
              {installing === t.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              {installing === t.id ? "Installing…" : "Install"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
