"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { PageHeader } from "@/components/dashboard/page-header";
import { Sparkles, KeyRound, CheckCircle2, Loader2 } from "lucide-react";

/**
 * AppSumo / lifetime-deal code redemption page. A customer who
 * bought through AppSumo lands here, pastes their code, and the
 * org's subscription jumps to the right tier. Stripe is bypassed —
 * AppSumo collected the payment.
 *
 * Gated to org admins because redeeming binds the code to the org
 * permanently.
 */
export default function RedeemCodePage() {
  const { isAdmin } = useRole();
  const { success: toastSuccess, error: toastError } = useToast();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ plan: string; seats: number; tier: number } | null>(null);

  async function redeem() {
    if (!code.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/appsumo/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toastError(json?.error || "Couldn't redeem the code.");
        return;
      }
      const data = json?.data ?? json;
      if (data.alreadyRedeemed) {
        toastSuccess("This code is already active for your organization.");
      } else {
        toastSuccess("🎉 Code redeemed!");
      }
      setResult({ plan: data.plan, seats: data.seats, tier: data.tier ?? 0 });
      setCode("");
    } catch {
      toastError("Network error — try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-3 animate-fade-in">
        <PageHeader
          kicker="Redeem"
          title="AppSumo redemption"
          subtitle="Only the organization admin can redeem a code on behalf of the company."
        />
        <Card><CardContent className="p-8 text-center text-sm text-muted">
          Ask your WorkwrK admin to redeem on this page.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        kicker="Lifetime deal"
        title="Redeem your AppSumo code"
        subtitle="Paste the code from your AppSumo email below. We'll upgrade your organization instantly — no card needed."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound size={14} className="text-[color:var(--accent-strong)]" /> Enter your code
            </CardTitle>
            <CardDescription>
              Codes are single-use across the whole system. Once redeemed, the code is bound to
              your organization and cannot be transferred.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>AppSumo code</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. WK-2026-XXXX-XXXX"
                className="font-mono"
                onKeyDown={(e) => { if (e.key === "Enter") redeem(); }}
              />
            </div>
            <div className="flex items-center justify-end">
              <Button onClick={redeem} disabled={submitting || !code.trim()} className="gap-1.5">
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Redeem code
              </Button>
            </div>

            {result && (
              <div className="rounded-lg border border-[rgba(34,197,94,0.30)] bg-[rgba(34,197,94,0.06)] p-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={14} className="text-green-400" />
                  <span className="text-sm font-semibold">Your organization is now on {result.plan}</span>
                </div>
                <p className="text-[12px] text-muted">
                  Lifetime access · {result.seats} seat{result.seats === 1 ? "" : "s"}
                  {result.tier > 0 && <> · Tier {result.tier}</>}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">FAQ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[12px] leading-relaxed">
            <div>
              <p className="font-semibold text-foreground">Where is my code?</p>
              <p className="text-muted">Check the email AppSumo sent right after purchase. Codes look like <span className="font-mono text-foreground">WK-XXXX-XXXX</span>.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">Can I stack multiple codes?</p>
              <p className="text-muted">Currently one code per organization. To increase your seat count, contact support and we&apos;ll move you to a higher tier manually.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">Refund window?</p>
              <p className="text-muted">AppSumo&rsquo;s standard 60-day refund applies. Email <a href="mailto:support@workwrk.com" className="text-[color:var(--accent-strong)] hover:underline">support@workwrk.com</a> from the email you redeemed with.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">Already on a paid plan?</p>
              <p className="text-muted">Cancel your Stripe subscription first (Settings → Billing), then come back here.</p>
            </div>
            <Badge variant="outline" className="text-[10px]">
              Need help? support@workwrk.com
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
