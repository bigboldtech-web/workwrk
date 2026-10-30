"use client";

// The viewer's Workload settings (home.work.workload: mode, windowDays,
// countWeekends, showAllPeople, dailyTasks), shared by Teams > Workload and a
// Space's Workload tab, so the two read and save one set of preferences.
//
// An optimistic local copy means a toggle never waits on the round trip. A
// failed save keeps the local value on screen and offers Try again, which
// resends the same patch; a second failure shows the toast again. The toast
// key is per setting: retries of one setting share one toast, and a later
// save of that setting that lands takes the old toast down, so a stale Try
// again can never write back a value the person moved off.

import { useCallback, useState } from "react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { workloadPrefs, type WorkloadPrefs } from "@/lib/people-prefs";

export function useWorkloadPrefs(): {
  /** The settings in force: what is stored, under what was set on this page. */
  prefs: WorkloadPrefs;
  /** Show a change at once and save it. */
  setPref: (patch: Partial<WorkloadPrefs>) => void;
  /** Show a change at once without saving it (the caller saves it its own way). */
  adopt: (patch: Partial<WorkloadPrefs>) => void;
} {
  const { toast, dismiss } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const stored = workloadPrefs(prefs.home);
  const [local, setLocal] = useState<Partial<WorkloadPrefs>>({});
  const savePref = useCallback((patch: Partial<WorkloadPrefs>) => {
    const key = `workload-pref-${Object.keys(patch).sort().join(",")}`;
    const send = () => {
      void patchPrefs({ home: { work: { workload: patch } } }).then((ok) => {
        if (ok) { dismiss(key); return; }
        toast("Couldn't save that setting. It applies until you leave.", { tone: "danger", key, action: { label: "Try again", onClick: send } });
      });
    };
    send();
  }, [patchPrefs, toast, dismiss]);
  const adopt = useCallback((patch: Partial<WorkloadPrefs>) => {
    setLocal((l) => ({ ...l, ...patch }));
  }, []);
  const setPref = useCallback((patch: Partial<WorkloadPrefs>) => {
    adopt(patch);
    savePref(patch);
  }, [adopt, savePref]);
  return { prefs: { ...stored, ...local }, setPref, adopt };
}
