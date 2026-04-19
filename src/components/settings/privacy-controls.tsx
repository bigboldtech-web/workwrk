"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Download, Trash2, Cookie, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConsent } from "@/components/layout/consent-provider";
import { signOut, useSession } from "next-auth/react";

export function PrivacyControls() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const { reopen, consent, withdraw } = useConsent();
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { success, error } = useToast();

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/me/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workwrk-data-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      success("Download started");
    } catch {
      error("Could not create export");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    if (!user?.email) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/me/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      success("Account deleted. Signing you out…");
      setTimeout(() => signOut({ callbackUrl: "/" }), 1500);
    } catch (e: any) {
      error(e.message || "Could not delete account");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Cookie size={18} className="mt-1 text-[#d4ff2e] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Cookie preferences</p>
              <p className="text-xs text-muted mt-0.5">
                Current:{" "}
                {[
                  consent.preferences && "Preferences",
                  consent.analytics && "Analytics",
                  consent.marketing && "Marketing",
                ]
                  .filter(Boolean)
                  .join(", ") || "Essential only"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={reopen}>
              Change
            </Button>
          </div>
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-1 text-[#d4ff2e] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Withdraw all consent</p>
              <p className="text-xs text-muted mt-0.5">
                Revokes all optional cookies and logs the withdrawal.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={withdraw}>
              Withdraw
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Download size={18} className="mt-1 text-[#d4ff2e] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Download my data</p>
              <p className="text-xs text-muted mt-0.5">
                Machine-readable JSON covering your profile, activity, and
                consent records (GDPR Art. 15 / CCPA Right to Know).
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? "Preparing…" : "Download"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Trash2 size={18} className="mt-1 text-red-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Delete my account</p>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">
                Permanently anonymizes your personal data. Organizational
                records you contributed to (reviews, kudos, KPI history) are
                retained in anonymized form as permitted by GDPR Art. 17(3).
                This cannot be undone.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-red-400 hover:bg-red-500/10"
              onClick={() => setShowDelete(true)}
            >
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <p className="text-sm text-muted">
              Type your email address (<span className="font-mono text-foreground">{user?.email}</span>) to confirm. This action is irreversible.
            </p>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={user?.email || ""}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting || confirmEmail.trim().toLowerCase() !== (user?.email || "").toLowerCase()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
