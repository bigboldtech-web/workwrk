import { describe, expect, it } from "vitest";
import { popoverRevealDelta } from "./survey-builder";

// The builder's body scrolls, and its lists open as absolutely positioned DOM
// children, so a list near the body's foot was cut off (Who it goes to showed
// Everyone and half of By office at 1440x900). popoverRevealDelta is how far
// the body scrolls when one opens. The numbers are the walk's own: the body
// ran 281 to 619 and the Audience list 452 to 720 under a trigger at 412.
describe("popoverRevealDelta", () => {
  const body = { top: 281, bottom: 619 };

  it("scrolls a list that runs past the foot until it shows whole, with the gap below it", () => {
    expect(popoverRevealDelta({ top: 452, bottom: 720 }, { top: 412, bottom: 444 }, body)).toBe(720 + 8 - 619);
  });

  it("leaves a list that already fits where it is", () => {
    expect(popoverRevealDelta({ top: 300, bottom: 500 }, { top: 260, bottom: 292 }, body)).toBe(0);
    expect(popoverRevealDelta({ top: 400, bottom: 611 }, { top: 360, bottom: 392 }, body)).toBe(0);
  });

  it("never scrolls the trigger out of the top, even when the list is taller than the body", () => {
    // A 600px calendar under a trigger at 500: showing its foot would need
    // 489px, but only 211px of room sits above the trigger.
    expect(popoverRevealDelta({ top: 530, bottom: 1100 }, { top: 500, bottom: 532 }, body)).toBe(500 - 8 - 281);
  });

  it("does not scroll backwards when the trigger is already at the top", () => {
    expect(popoverRevealDelta({ top: 300, bottom: 900 }, { top: 285, bottom: 317 }, body)).toBe(0);
  });
});
