// reviewStripState (weekly-review-client.tsx): the word on the weekly review's
// status chip. A manager's Request changes and an Approve both leave
// status=ACKNOWLEDGED, so the chip has to read managerStatus too, or a week
// the manager sent back says "Reviewed" like a finished one.
//
// The client module's UI imports are stubbed so the pure helper loads in node.

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useRouter: vi.fn() }));
vi.mock("@/components/layout/os/page-header", () => ({ OsPageHeader: () => null }));
vi.mock("@/components/ui/autosave-indicator", () => ({ AutosaveIndicator: () => null }));
vi.mock("@/components/me/week-pills", () => ({ WeekPills: () => null }));
vi.mock("@/hooks/use-autosave", () => ({ useAutosave: vi.fn() }));
vi.mock("@/components/ui/dialog-provider", () => ({ useConfirm: vi.fn() }));
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: vi.fn() }));
vi.mock("@/components/ui/dots-art", () => ({ DotsArt: () => null }));
vi.mock("@/components/ui/dots", () => ({ Dots: () => null }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/nav/route-hub", () => ({ WORK_HOME_HREF: "/home" }));

import { reviewStripState } from "./weekly-review-client";

describe("reviewStripState", () => {
  it("says Changes requested, in the warning tone, for a week the manager sent back", () => {
    expect(reviewStripState({ status: "ACKNOWLEDGED", managerStatus: "CHANGES_REQUESTED" })).toEqual({
      word: "Changes requested",
      tone: "warning",
      changesRequested: true,
    });
  });

  it("says Approved for an approved week, never the sent back word", () => {
    const s = reviewStripState({ status: "ACKNOWLEDGED", managerStatus: "APPROVED" });
    expect(s.word).toBe("Approved");
    expect(s.changesRequested).toBe(false);
    expect(s.tone).toBe("neutral");
  });

  it("keeps Reviewed for an acknowledged row with no manager decision recorded", () => {
    expect(reviewStripState({ status: "ACKNOWLEDGED", managerStatus: null }).word).toBe("Reviewed");
  });

  it("keeps the plain words for draft, submitted and no review", () => {
    expect(reviewStripState({ status: "DRAFT", managerStatus: null }).word).toBe("In progress");
    expect(reviewStripState({ status: "SUBMITTED", managerStatus: "PENDING" }).word).toBe("Submitted");
    expect(reviewStripState(null)).toEqual({ word: "Not started", tone: "neutral", changesRequested: false });
  });

  it("a reopened draft is in progress, not still sent back", () => {
    // reopenWeeklyReview clears managerStatus; the draft is the rework.
    expect(reviewStripState({ status: "DRAFT", managerStatus: null }).changesRequested).toBe(false);
  });
});
