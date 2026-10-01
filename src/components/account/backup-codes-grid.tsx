"use client";

// The eight backup codes, shown once (spec-account-auth, the enrolment and
// Backup codes dialogs and `/login` step 2b): a two-column mono grid, Copy
// codes, Download .txt, and the required "I have saved these" checkbox that
// the caller reads before letting the person finish.

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { btn } from "./account-ui";
import { backupCodesText } from "@/lib/account/backup-codes-text";


export function BackupCodesGrid({
  codes,
  who,
  saved,
  onSavedChange,
}: {
  codes: readonly string[];
  who: string;
  saved: boolean;
  onSavedChange: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const blob = new Blob([backupCodesText(codes, who)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workwrk-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line bg-[var(--os-surface-1,var(--os-bg))] p-4 font-mono text-base text-ink" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c} className="tracking-wider">{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.secondary} onClick={() => { void copy(); }}>
          {copied ? <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          {copied ? "Copied" : "Copy codes"}
        </button>
        <button type="button" className={btn.secondary} onClick={download}>
          <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          Download .txt
        </button>
      </div>
      <p className="text-sm text-warning-text">
        Each code works once. Without your phone and without these you will need an admin to reset your access.
      </p>
      <label className="flex items-center gap-2 text-base text-ink">
        <input type="checkbox" checked={saved} onChange={(e) => onSavedChange(e.target.checked)} className="h-4 w-4 accent-[var(--os-brand)]" />
        I have saved these codes somewhere safe
      </label>
    </div>
  );
}
