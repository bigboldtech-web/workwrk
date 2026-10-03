"use client";

// What a people Picker says while usePeoplePicker cannot read: an empty or
// near-empty list never stands in for "no one", the person is told the read
// failed and can try again, from every picker the hook feeds.

import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { PickerFooterRow } from "@/components/ui/picker";
import type { PeoplePicker } from "@/components/people/use-people-picker";

/** The Picker footer: "Couldn't load people. Try again" after a failed read, else nothing. */
export function peopleFailedFooter(picker: Pick<PeoplePicker, "failed" | "retry">): ReactNode | undefined {
  if (!picker.failed) return undefined;
  return (
    <PickerFooterRow onClick={picker.retry} icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}>
      Couldn&apos;t load people. Try again
    </PickerFooterRow>
  );
}

/** The Picker's empty line: never "no one matches" when the read failed. */
export function peopleEmptyLabel(picker: Pick<PeoplePicker, "failed" | "query">, idle = "No one to show yet"): string {
  if (picker.failed) return "No one to show";
  return picker.query.trim() ? "No one matches" : idle;
}
