"use client";

// Decision UI for the expense approver. Server page renders the
// surrounding context; this client island calls the decision API and
// refreshes the route data.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

export function ExpenseDecisionPanel({
  expenseId,
  status,
}: {
  expenseId: string;
  status: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: "APPROVE" | "REJECT" | "REIMBURSE") {
    setBusy(decision);
    try {
      const res = await fetch(`/api/expenses/${expenseId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't update", description: data?.error });
        return;
      }
      toast({ type: "success", title: `Expense ${decision.toLowerCase()}d` });
      setNote("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // Approver actions vary by status:
  //   SUBMITTED → Approve / Reject
  //   APPROVED  → Mark reimbursed (operations / finance closes the loop)
  const showApproveReject = status === "SUBMITTED";
  const showReimburse = status === "APPROVED";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Your decision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optional note — required when rejecting in most policies."
        />
        <div className="flex flex-wrap gap-2 justify-end">
          {showApproveReject && (
            <>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => decide("REJECT")}
                className="text-red-400"
              >
                {busy === "REJECT" ? "Rejecting…" : "Reject"}
              </Button>
              <Button
                disabled={busy !== null}
                onClick={() => decide("APPROVE")}
              >
                {busy === "APPROVE" ? "Approving…" : "Approve"}
              </Button>
            </>
          )}
          {showReimburse && (
            <Button
              disabled={busy !== null}
              onClick={() => decide("REIMBURSE")}
            >
              {busy === "REIMBURSE" ? "Saving…" : "Mark reimbursed"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
