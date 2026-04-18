"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useConsent } from "@/components/layout/consent-provider";

// NEEDS LEGAL REVIEW — CCPA/CPRA, Colorado Privacy Act, Virginia CDPA,
// Connecticut CTDPA, Utah UCPA text. Confirm authorized-agent acceptance
// requirements for each state.

export default function DoNotSellPage() {
  const { consent, accept } = useConsent();
  const { success, error } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState("");

  async function optOut() {
    setSubmitting(true);
    try {
      await accept({
        preferences: consent.preferences,
        analytics: false,
        marketing: false,
        doNotSell: true,
      });
      // Also log a separate DNSMPI request for audit
      await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...consent,
          analytics: false,
          marketing: false,
          doNotSell: true,
          method: "dnsmpi",
        }),
      });
      success("Opt-out recorded. We won't sell or share your personal information.");
    } catch {
      error("Could not record your request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        Template — needs legal review before publication.
      </div>

      <h1 className="text-3xl font-bold tracking-tight">
        Do Not Sell or Share My Personal Information
      </h1>
      <p className="mt-3 text-sm text-muted leading-relaxed">
        Under the California Consumer Privacy Act (CCPA/CPRA) and similar laws
        in Colorado, Virginia, Connecticut, Utah, and other states, you have
        the right to opt out of the sale or sharing of your personal
        information, including for cross-context behavioral advertising.
      </p>

      <Card className="mt-6">
        <CardContent className="p-5 space-y-4">
          <p className="text-sm">
            Submitting this form will record an opt-out against your current
            session. We do not sell personal information for money. We may
            share limited technical data with analytics and advertising
            partners — this opt-out disables that sharing.
          </p>
          <Button onClick={optOut} disabled={submitting}>
            {submitting ? "Recording…" : "Opt me out now"}
          </Button>
        </CardContent>
      </Card>

      <h2 className="mt-10 text-lg font-semibold">
        Submit a formal request (optional)
      </h2>
      <p className="mt-2 text-sm text-muted">
        If you would like a written confirmation or are submitting on behalf of
        a California resident as an authorized agent, please provide:
      </p>
      <Card className="mt-4">
        <CardContent className="p-5 space-y-3">
          <div className="space-y-1">
            <Label>Email for confirmation</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1">
            <Label>Additional details (optional)</Label>
            <Textarea
              rows={4}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Agent relationship, proof of residency, specific accounts..."
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (!email) {
                error("Email required for written confirmation");
                return;
              }
              window.location.href = `mailto:privacy@workwrk.com?subject=DNSMPI%20request&body=${encodeURIComponent(
                `Email: ${email}\n\nDetails:\n${details}`,
              )}`;
            }}
          >
            Send to privacy@workwrk.com
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
