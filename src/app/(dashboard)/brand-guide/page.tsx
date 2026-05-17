"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Palette, Sparkles, BookOpen, Megaphone, Mic, Image as ImageIcon,
  Type, Camera, Plus, X, Copy, Check, Edit3, Save, AlertCircle,
  CheckCircle,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { RichEditor } from "@/components/ui/rich-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutosave } from "@/hooks/use-autosave";
import { useToast } from "@/components/ui/toast";
import { usePrompt } from "@/components/ui/dialog-provider";

// --- Types kept in sync with /api/brand-guide/route.ts ---

interface BrandColor { id: string; name: string; hex: string; role?: string }
interface BrandFont { id: string; name: string; usage?: string; source?: string }

interface BrandGuide {
  story?: string;
  positioning?: string;
  voiceAndTone?: string;
  messaging?: string;
  logoUrl?: string;
  logoUsage?: string;
  colors?: BrandColor[];
  typography?: BrandFont[];
  imageryGuidelines?: string;
  updatedAt?: string;
}

function emptyGuide(): BrandGuide {
  return {
    story: "", positioning: "", voiceAndTone: "", messaging: "",
    logoUrl: "", logoUsage: "",
    colors: [], typography: [],
    imageryGuidelines: "",
  };
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function BrandGuidePage() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [guide, setGuide] = useState<BrandGuide>(emptyGuide());
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | undefined>(undefined);

  const fetchGuide = useCallback(async () => {
    try {
      const res = await fetch("/api/brand-guide");
      if (!res.ok) throw new Error("Failed to load brand guide");
      const data = await res.json();
      setGuide({ ...emptyGuide(), ...(data.brandGuide || {}) });
      setServerUpdatedAt(data.brandGuide?.updatedAt);
      setCanEdit(!!data.canEdit);
    } catch {
      toastError("Failed to load brand guide");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { fetchGuide(); }, [fetchGuide]);

  // Autosave — debounced PATCHes while editing, with localStorage crash
  // recovery. Reuses the same hook the SOP editor uses so the two feel
  // identical.
  const autosave = useAutosave<BrandGuide>({
    snapshot: guide,
    enabled: editing && canEdit,
    delay: 1500,
    localKey: "brand-guide-autosave",
    save: async (snap) => {
      const res = await fetch("/api/brand-guide", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
      });
      if (!res.ok) throw new Error("Autosave failed");
      const data = await res.json();
      setServerUpdatedAt(data.brandGuide?.updatedAt);
    },
  });

  const updateField = <K extends keyof BrandGuide>(key: K, value: BrandGuide[K]) => {
    setGuide((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Brand Guide" }]}
        kicker="Company · brand"
        title="Brand Guide"
        subtitle="One source of truth for how the company sounds, looks, and shows up."
      />

      {/* Top-bar with edit / status */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Palette size={14} className="text-[color:var(--accent-strong)]" />
          {serverUpdatedAt ? (
            <span>Last updated {new Date(serverUpdatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
          ) : (
            <span>Not yet published</span>
          )}
          {editing && <AutosaveBadge status={autosave.status} lastSavedAt={autosave.lastSavedAt} />}
        </div>

        {canEdit ? (
          editing ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await autosave.flushNow();
                  setEditing(false);
                  toastSuccess("Saved");
                  fetchGuide();
                }}
                className="gap-1.5"
              >
                <Save size={14} /> Done
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setEditing(true)} className="gap-1.5">
              <Edit3 size={14} /> Edit Brand Guide
            </Button>
          )
        ) : (
          <Badge variant="outline" className="text-[10px]">View only — ask a manager to edit</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TextSection
          title="Brand Story"
          subtitle="What we are, where we came from, why we exist."
          icon={<BookOpen size={16} className="text-[color:var(--accent-strong)]" />}
          value={guide.story || ""}
          editable={editing}
          placeholder="The story of the company — who we are, what we do, why it matters."
          onChange={(v) => updateField("story", v)}
        />

        <TextSection
          title="Positioning"
          subtitle="Who it's for, what they get, why us."
          icon={<Sparkles size={16} className="text-[color:var(--accent-strong)]" />}
          value={guide.positioning || ""}
          editable={editing}
          placeholder="Our audience, the problem we solve, and our unique value proposition."
          onChange={(v) => updateField("positioning", v)}
        />

        <TextSection
          title="Voice & Tone"
          subtitle="How we speak — the personality behind the words."
          icon={<Mic size={16} className="text-[color:var(--accent-strong)]" />}
          value={guide.voiceAndTone || ""}
          editable={editing}
          placeholder="Examples of how we sound. Include do's and don'ts, playful vs. serious, first- vs. third-person."
          onChange={(v) => updateField("voiceAndTone", v)}
        />

        <TextSection
          title="Messaging"
          subtitle="Tagline, elevator pitch, key messages."
          icon={<Megaphone size={16} className="text-[color:var(--accent-strong)]" />}
          value={guide.messaging || ""}
          editable={editing}
          placeholder="Tagline. Elevator pitch (30s). Top 3 key messages. Proof points."
          onChange={(v) => updateField("messaging", v)}
        />

        <LogoSection
          logoUrl={guide.logoUrl || ""}
          logoUsage={guide.logoUsage || ""}
          editable={editing}
          onChange={(partial) => setGuide((prev) => ({ ...prev, ...partial }))}
        />

        <ColorsSection
          colors={guide.colors || []}
          editable={editing}
          onChange={(colors) => updateField("colors", colors)}
        />

        <TypographySection
          fonts={guide.typography || []}
          editable={editing}
          onChange={(fonts) => updateField("typography", fonts)}
        />

        <TextSection
          title="Imagery"
          subtitle="Photography, illustration, and icon direction."
          icon={<Camera size={16} className="text-[color:var(--accent-strong)]" />}
          value={guide.imageryGuidelines || ""}
          editable={editing}
          placeholder="Style direction for photos, illustrations, icons. What to lean into, what to avoid."
          onChange={(v) => updateField("imageryGuidelines", v)}
        />
      </div>
    </div>
  );
}

// --- Section components ---

function SectionShell({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </CardTitle>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TextSection({
  title,
  subtitle,
  icon,
  value,
  editable,
  placeholder,
  onChange,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  value: string;
  editable: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const hasContent = value && value.replace(/<[^>]+>/g, "").trim().length > 0;
  return (
    <SectionShell title={title} subtitle={subtitle} icon={icon}>
      {editable ? (
        <RichEditor
          content={value}
          onChange={onChange}
          editable
          compact
          minHeight="180px"
          placeholder={placeholder}
        />
      ) : hasContent ? (
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-sm [&_p]:my-1.5"
          dangerouslySetInnerHTML={{ __html: value }}
        />
      ) : (
        <p className="text-xs text-muted italic">Not set yet.</p>
      )}
    </SectionShell>
  );
}

function LogoSection({
  logoUrl,
  logoUsage,
  editable,
  onChange,
}: {
  logoUrl: string;
  logoUsage: string;
  editable: boolean;
  onChange: (partial: Partial<BrandGuide>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prompt = usePrompt();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      if (src) onChange({ logoUrl: src });
    };
    reader.readAsDataURL(file);
  }

  async function pasteUrl() {
    const url = await prompt({
      title: "Paste logo URL",
      description: "Leave blank to remove the logo.",
      defaultValue: logoUrl || "",
      placeholder: "https://…",
      submitLabel: logoUrl ? "Save" : "Add logo",
      required: false,
    });
    if (url === null) return;
    onChange({ logoUrl: url });
  }

  return (
    <SectionShell
      title="Logo"
      subtitle="The primary mark and how to use it."
      icon={<ImageIcon size={16} className="text-[color:var(--accent-strong)]" />}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-surface-3 p-4 flex items-center justify-center min-h-[140px]">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Brand logo"
              className="max-h-32 max-w-full object-contain"
              loading="lazy"
            />
          ) : (
            <p className="text-xs text-muted italic">No logo uploaded yet.</p>
          )}
        </div>

        {editable && (
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
              <Plus size={12} /> {logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            <Button size="sm" variant="ghost" onClick={pasteUrl}>Paste URL</Button>
            {logoUrl && (
              <Button size="sm" variant="ghost" onClick={() => onChange({ logoUrl: "" })} className="text-red-400 hover:text-red-300">
                Remove
              </Button>
            )}
          </div>
        )}

        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted">Usage rules</Label>
          {editable ? (
            <RichEditor
              content={logoUsage}
              onChange={(v) => onChange({ logoUsage: v })}
              editable
              compact
              minHeight="100px"
              placeholder="Clearspace, minimum size, incorrect usages, allowed variants."
            />
          ) : logoUsage ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-sm [&_p]:my-1.5 mt-1"
              dangerouslySetInnerHTML={{ __html: logoUsage }}
            />
          ) : (
            <p className="text-xs text-muted italic mt-1">No usage rules yet.</p>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

function ColorsSection({
  colors,
  editable,
  onChange,
}: {
  colors: BrandColor[];
  editable: boolean;
  onChange: (colors: BrandColor[]) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function addColor() {
    onChange([...colors, { id: uid("c"), name: "New color", hex: "#d4ff2e", role: "" }]);
  }

  function updateColor(id: string, patch: Partial<BrandColor>) {
    onChange(colors.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeColor(id: string) {
    onChange(colors.filter((c) => c.id !== id));
  }

  async function copyHex(c: BrandColor) {
    try {
      await navigator.clipboard.writeText(c.hex);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {
      // Clipboard may be blocked in some contexts — fail silently.
    }
  }

  return (
    <SectionShell
      title="Colors"
      subtitle="The palette — primary, secondary, and accents."
      icon={<Palette size={16} className="text-[color:var(--accent-strong)]" />}
    >
      {colors.length === 0 && !editable && (
        <p className="text-xs text-muted italic">No colors defined yet.</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {colors.map((c) => (
          <div key={c.id} className="rounded-lg border border-border bg-surface-3 overflow-hidden group">
            <div
              className="h-16 w-full"
              style={{ background: isValidHex(c.hex) ? c.hex : "transparent" }}
            />
            <div className="p-2 space-y-1">
              {editable ? (
                <>
                  <Input
                    value={c.name}
                    onChange={(e) => updateColor(c.id, { name: e.target.value })}
                    placeholder="Name"
                    className="h-7 text-xs bg-transparent"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={isValidHex(c.hex) ? c.hex : "#000000"}
                      onChange={(e) => updateColor(c.id, { hex: e.target.value })}
                      className="h-7 w-7 rounded border border-border bg-transparent cursor-pointer"
                      aria-label="Pick color"
                    />
                    <Input
                      value={c.hex}
                      onChange={(e) => updateColor(c.id, { hex: e.target.value })}
                      placeholder="#000000"
                      className="h-7 text-xs font-mono bg-transparent"
                    />
                  </div>
                  <Input
                    value={c.role || ""}
                    onChange={(e) => updateColor(c.id, { role: e.target.value })}
                    placeholder="Role (e.g. primary)"
                    className="h-7 text-xs bg-transparent"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeColor(c.id)}
                    className="w-full text-[10px] text-red-400 hover:text-red-300 h-6"
                  >
                    <X size={10} /> Remove
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs font-medium truncate">{c.name}</p>
                  <button
                    type="button"
                    onClick={() => copyHex(c)}
                    className="w-full flex items-center justify-between text-[10px] font-mono text-muted hover:text-foreground"
                    title="Copy hex"
                  >
                    <span>{c.hex}</span>
                    {copiedId === c.id ? <Check size={10} /> : <Copy size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                  </button>
                  {c.role && <p className="text-[9px] uppercase tracking-wider text-muted">{c.role}</p>}
                </>
              )}
            </div>
          </div>
        ))}
        {editable && (
          <button
            type="button"
            onClick={addColor}
            className="rounded-lg border border-dashed border-border hover:border-violet-500 hover:text-[color:var(--accent-strong)] text-muted h-full min-h-[120px] flex flex-col items-center justify-center gap-1 text-xs"
          >
            <Plus size={16} />
            Add color
          </button>
        )}
      </div>
    </SectionShell>
  );
}

function TypographySection({
  fonts,
  editable,
  onChange,
}: {
  fonts: BrandFont[];
  editable: boolean;
  onChange: (fonts: BrandFont[]) => void;
}) {
  function addFont() {
    onChange([...fonts, { id: uid("f"), name: "New font", usage: "", source: "" }]);
  }
  function updateFont(id: string, patch: Partial<BrandFont>) {
    onChange(fonts.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeFont(id: string) {
    onChange(fonts.filter((f) => f.id !== id));
  }

  return (
    <SectionShell
      title="Typography"
      subtitle="The typefaces and where they're used."
      icon={<Type size={16} className="text-[color:var(--accent-strong)]" />}
    >
      {fonts.length === 0 && !editable && (
        <p className="text-xs text-muted italic">No typefaces defined yet.</p>
      )}
      <div className="space-y-2">
        {fonts.map((f) => (
          <div key={f.id} className="rounded-lg border border-border bg-surface-3 p-3 group">
            {editable ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={f.name}
                    onChange={(e) => updateFont(f.id, { name: e.target.value })}
                    placeholder="Font name (e.g. Inter)"
                    className="h-8 text-sm bg-transparent flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFont(f.id)}
                    className="h-7 w-7 text-red-400 hover:text-red-300"
                    aria-label="Remove font"
                  >
                    <X size={12} />
                  </Button>
                </div>
                <Input
                  value={f.usage || ""}
                  onChange={(e) => updateFont(f.id, { usage: e.target.value })}
                  placeholder="Usage (e.g. Headings, body, captions)"
                  className="h-8 text-xs bg-transparent"
                />
                <Input
                  value={f.source || ""}
                  onChange={(e) => updateFont(f.id, { source: e.target.value })}
                  placeholder="Source (e.g. Google Fonts URL)"
                  className="h-8 text-xs bg-transparent"
                />
              </div>
            ) : (
              <div>
                <p
                  className="text-lg font-medium"
                  style={{ fontFamily: f.name ? `${f.name}, system-ui, sans-serif` : undefined }}
                >
                  {f.name}
                </p>
                {f.usage && <p className="text-xs text-muted mt-0.5">{f.usage}</p>}
                {f.source && (
                  <a
                    href={f.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[color:var(--accent-strong)] hover:underline mt-1 inline-block"
                  >
                    Source ↗
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
        {editable && (
          <button
            type="button"
            onClick={addFont}
            className="w-full rounded-lg border border-dashed border-border hover:border-violet-500 hover:text-[color:var(--accent-strong)] text-muted py-2 flex items-center justify-center gap-1 text-xs"
          >
            <Plus size={14} /> Add font
          </button>
        )}
      </div>
    </SectionShell>
  );
}

function AutosaveBadge({
  status,
  lastSavedAt,
}: {
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== "saved") return;
    const id = setInterval(() => tick((v) => v + 1), 15_000);
    return () => clearInterval(id);
  }, [status]);

  if (status === "idle") return null;
  const common = "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ml-2";
  if (status === "saving") {
    return (
      <span className={`${common} border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.08)] text-[color:var(--accent-strong)]`}>
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-600 animate-pulse" />
        Saving…
      </span>
    );
  }
  if (status === "dirty") {
    return <span className={`${common} border-orange-500/30 bg-orange-500/10 text-orange-400`}>Unsaved</span>;
  }
  if (status === "error") {
    return (
      <span className={`${common} border-red-500/30 bg-red-500/10 text-red-400`}>
        <AlertCircle size={10} /> Save failed — retrying
      </span>
    );
  }
  return (
    <span className={`${common} border-green-500/30 bg-green-500/10 text-green-400`}>
      <CheckCircle size={10} /> Saved{lastSavedAt ? ` ${secAgo(lastSavedAt)}` : ""}
    </span>
  );
}

function secAgo(at: Date): string {
  const s = Math.max(1, Math.floor((Date.now() - at.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function isValidHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}
