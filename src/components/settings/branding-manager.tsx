"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { invalidateBrandingCache } from "@/hooks/use-branding";
import { Loader2, Upload, X, Crown } from "lucide-react";

interface BrandingState {
  name: string | null;
  logo: string | null;
  displayName: string | null;
  primaryColor: string | null;
  whiteLabelEnabled: boolean;
}

interface Features { plan: string; features: { whiteLabel: boolean } }

/**
 * Customer-side white-label settings — only rendered when the
 * Enterprise `whiteLabel` feature flag is on for this org. The
 * SOP/Notifications-style Settings tab wraps this with the gate
 * (Settings page checks the feature before mounting).
 */
export function BrandingManager() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [data, setData] = useState<BrandingState | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Local form state — diffs against `data` to know what to PATCH.
  const [displayName, setDisplayName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [logo, setLogo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, fRes] = await Promise.all([
      fetch("/api/organization/branding"),
      fetch("/api/organization/features"),
    ]);
    if (bRes.ok) {
      const d = await bRes.json();
      const branding = (d.data ?? d) as BrandingState;
      setData(branding);
      setDisplayName(branding.displayName ?? branding.name ?? "");
      setPrimaryColor(branding.primaryColor ?? "");
      setLogo(branding.logo);
    }
    if (fRes.ok) {
      const d = await fRes.json();
      setFeatures(d.data ?? d);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1_000_000) {
      toastError("Logo too big. Use a file under 1 MB or paste a URL instead.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      if (src) setLogo(src);
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/organization/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          primaryColor: primaryColor.trim() || null,
          logo,
        }),
      });
      if (res.ok) {
        invalidateBrandingCache();
        toastSuccess("Branding saved");
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to save branding");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card><CardContent className="p-8 text-center text-sm text-muted">
        <Loader2 size={16} className="animate-spin mx-auto mb-2" /> Loading…
      </CardContent></Card>
    );
  }

  // Gate: if features.whiteLabel is off, show the upsell.
  if (!features?.features?.whiteLabel) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Crown size={14} className="text-[#d4ff2e]" /> Branding
          </CardTitle>
          <CardDescription>
            Replace the WorkwrK wordmark with your own logo + primary color across the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center">
            <Crown size={20} className="mx-auto text-muted mb-2" />
            <p className="text-sm font-medium">Enterprise add-on</p>
            <p className="text-[12px] text-muted mt-1 max-w-md mx-auto">
              Branding is a custom add-on we enable per Enterprise customer. Reach out to
              your WorkwrK contact and we&rsquo;ll switch it on for {data?.name ?? "your org"}.
            </p>
            <Badge variant="outline" className="mt-3 text-[10px]">{features?.plan ?? "STARTER"}</Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Crown size={14} className="text-[#d4ff2e]" /> Branding
        </CardTitle>
        <CardDescription>
          These show up in the sidebar wordmark, page titles, and outgoing emails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-lg border border-border bg-surface-2 flex items-center justify-center overflow-hidden shrink-0">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] text-muted">No logo</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogoFile} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                <Upload size={12} /> Upload
              </Button>
              {logo && (
                <Button variant="ghost" size="sm" className="gap-1.5 text-red-400" onClick={() => setLogo(null)}>
                  <X size={12} /> Remove
                </Button>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted">PNG or SVG, ideally under 200 KB. Square aspect ratio looks best.</p>
        </div>

        {/* Display name */}
        <div className="space-y-2">
          <Label>Display name</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={data?.name ?? "Your company name"}
            maxLength={60}
          />
          <p className="text-[11px] text-muted">Shown next to the logo in the sidebar. Leave blank to use your org name.</p>
        </div>

        {/* Primary color */}
        <div className="space-y-2">
          <Label>Primary color</Label>
          <div className="flex items-center gap-2">
            <Input
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#d4ff2e"
              className="font-mono w-40"
              maxLength={7}
            />
            <div
              className="h-9 w-9 rounded-lg border border-border"
              style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : "transparent" }}
            />
          </div>
          <p className="text-[11px] text-muted">Hex format. Used for accents — links, primary buttons, progress bars.</p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            Save branding
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
