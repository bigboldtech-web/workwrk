"use client";

// AskDataDialog, ask a natural-language question about the sheet (Zia-style).
// The formula engine is client-side, so this resolves the rows into a 2D array
// and posts them with the question to /api/tables/[id]/ask, which asks the org's
// model for a concise answer. Read-only: it never writes to the sheet.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, CornerDownLeft } from "lucide-react";
import { Dots } from "@/components/ui/dots";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tableId: string | null;
  columns: { id: string; label: string }[];
  /** Resolves the sheet into a 2D value array aligned to `columns` (formula
   *  cells already evaluated). Called on each Ask. */
  buildRows: () => unknown[][];
}

export function AskDataDialog({ open, onOpenChange, tableId, columns, buildRows }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstCol = columns[0]?.label;
  const examples = [
    "Summarise this table",
    "How many rows are there?",
    firstCol ? `What are the most common values in ${firstCol}?` : "What stands out in this data?",
  ];

  const ask = async (q: string) => {
    if (!tableId || !q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setNote(null);
    try {
      const rows = buildRows();
      const res = await fetch(`/api/tables/${tableId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q.trim(), columns: columns.map((c) => c.label), rows }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error as string) ?? "Something went wrong.");
        return;
      }
      const payload = data?.data ?? data;
      setAnswer(typeof payload?.answer === "string" ? payload.answer : "No answer.");
      if (payload?.truncated) setNote("Answered from the first 300 rows.");
    } catch {
      setError("Couldn't reach the assistant. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="os-chrome max-w-[720px] gap-0 border-line bg-raised p-0">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-lg font-semibold inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--os-brand)]" /> Ask your data
          </DialogTitle>
          <DialogDescription className="mt-1">
            Ask a question about this table in plain language: totals, trends or a quick summary.
          </DialogDescription>
        </div>

        <div className="px-6 pb-4">
          <div className="flex items-end gap-1.5 rounded-lg border border-line focus-within:border-[var(--os-brand)] p-2">
            <textarea
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(question); }
              }}
              rows={2}
              placeholder="e.g. What's the total revenue by region?"
              className="flex-1 resize-none bg-transparent text-base outline-none placeholder:text-ink-3 min-h-[40px] max-h-[120px]"
            />
            <button
              type="button"
              onClick={() => void ask(question)}
              disabled={busy || !question.trim()}
              className="h-8 px-3 rounded-md bg-[var(--os-brand)] text-white text-base font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Dots variant="pending" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
              Ask
            </button>
          </div>

          {!answer && !busy ? (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => { setQuestion(ex); void ask(ex); }}
                  className="text-xs px-2.5 py-1 rounded-full border border-line text-ink-2 hover:bg-hover"
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : null}

          {error ? <div className="mt-3 text-sm text-red-500">{error}</div> : null}

          {busy ? (
            <div className="mt-4 text-sm text-ink-3 inline-flex items-center gap-2">
              <Dots variant="pending" /> Reading your table
            </div>
          ) : null}

          {answer ? (
            <div className="mt-4 rounded-lg border border-line bg-[var(--os-surface-1)] p-3.5">
              <div className="text-base text-ink whitespace-pre-wrap leading-relaxed">{answer}</div>
              {note ? <div className="mt-2 text-xs text-ink-3">{note}</div> : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
