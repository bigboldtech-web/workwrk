"use client";

// ImportPeopleModal (spec-teams-people section 3): the Directory's 960
// ui/dialog wrapper around PeopleImport (people-import.tsx), the one
// import-people flow. The footer carries the one blue button, labelled for
// the step: Continue (check the mapped file), Import {N} people, Done.
// Settings > Data > Import renders the same PeopleImport inline (Phase 8).
// Owner and Admin only (the Directory shows the entry to them alone, and
// POST /api/people/bulk-import refuses anyone else).

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PeopleImport, usePeopleImport } from "./people-import";

export { PeopleImport, usePeopleImport } from "./people-import";

export function ImportPeopleModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const flow = usePeopleImport();
  const { state } = flow;
  const ready = state.staged?.summary.ready ?? 0;
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !state.busy) onClose(); }}>
      <DialogContent className="max-w-[960px]">
        <DialogHeader>
          <DialogTitle>Import people</DialogTitle>
          <DialogDescription>Each row gets an invitation email. Nobody joins until they accept, and everyone joins as a Member.</DialogDescription>
        </DialogHeader>
        <PeopleImport flow={flow} container="modal" />
        <DialogFooter>
          {state.step === "done" ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              {state.step === "review" ? <Button variant="ghost" onClick={flow.back} disabled={state.busy}>Back</Button> : null}
              <Button variant="ghost" onClick={onClose} disabled={state.busy}>Cancel</Button>
              {state.step === "map" ? (
                <Button disabled={state.busy || flow.missing.length > 0} onClick={() => void flow.stage()}>{state.busy ? "Checking" : "Continue"}</Button>
              ) : state.step === "review" ? (
                <Button disabled={ready === 0 || state.busy} onClick={() => void flow.commit().then((ok) => { if (ok) onImported(); })}>
                  {state.busy ? "Inviting" : ready > 0 ? `Import ${ready} ${ready === 1 ? "person" : "people"}` : "Import"}
                </Button>
              ) : (
                <Button disabled>Continue</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
