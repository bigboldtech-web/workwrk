"use client";

// MFA enrolment dialog (spec-account-auth): 560px, the shared set-up body.
// Esc on the backup-codes phase confirms first, because the codes are shown
// once; the dialog also refuses to close from the overlay in that phase.

import { useState } from "react";
import { useOsToast } from "@/components/layout/os/toast";
import { AccountDialog } from "./account-ui";
import { MfaEnrolPanel, type EnrolPhase } from "./mfa-enrol-panel";

const CLOSE_CONFIRM = "Save your backup codes first. Close anyway?";

export function MfaEnrolDialog({
  open,
  onOpenChange,
  who,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  who: string;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<EnrolPhase>("scan");
  const [enabled, setEnabled] = useState(false);
  const { toast } = useOsToast();

  const close = (v: boolean) => {
    if (!v && phase === "codes" && !window.confirm(CLOSE_CONFIRM)) return;
    if (!v && enabled) onDone();
    if (!v) { setPhase("scan"); setEnabled(false); }
    onOpenChange(v);
  };

  return (
    <AccountDialog open={open} onOpenChange={close} title="Set up two step verification" width={560}>
      {open ? (
        <MfaEnrolPanel
          source={{ kind: "session" }}
          inDialog
          who={who}
          onPhase={setPhase}
          onEnabled={() => setEnabled(true)}
          onCancel={() => close(false)}
          onFinished={() => {
            toast("Two step verification is on");
            setPhase("scan");
            setEnabled(false);
            onOpenChange(false);
            onDone();
          }}
        />
      ) : null}
    </AccountDialog>
  );
}
