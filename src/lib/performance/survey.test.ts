import { describe, expect, it } from "vitest";
import { cleanSurveyAnswers, cleanSurveyQuestions, missingRequired, surveyMinutes, surveyStatusOf, surveyTransitionBlocked } from "./survey";

describe("cleanSurveyQuestions", () => {
  it("keeps real questions, drops blanks and gives every question an id", () => {
    const r = cleanSurveyQuestions([{ text: " How was the week? ", type: "rating" }, { text: "" }, { id: "x", text: "Pick", type: "single_choice", options: ["A", "B", "A"] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.questions.map((q) => q.id)).toEqual(["q1", "x"]);
    expect(r.questions[1].options).toEqual(["A", "B"]);
  });
  it("refuses a choice with fewer than two options, and no questions at all", () => {
    expect(cleanSurveyQuestions([{ text: "Pick", type: "multi_choice", options: ["only"] }]).ok).toBe(false);
    expect(cleanSurveyQuestions([]).ok).toBe(false);
  });
});

describe("cleanSurveyAnswers", () => {
  const qs = [
    { id: "r", text: "r", type: "rating" as const },
    { id: "n", text: "n", type: "nps" as const },
    { id: "y", text: "y", type: "yes_no" as const },
    { id: "s", text: "s", type: "single_choice" as const, options: ["A", "B"] },
    { id: "m", text: "m", type: "multi_choice" as const, options: ["A", "B"] },
    { id: "t", text: "t", type: "text" as const, required: true },
  ];
  it("bounds every type to what the survey can count", () => {
    const a = cleanSurveyAnswers([
      { questionId: "r", value: 6 }, { questionId: "n", value: 0 }, { questionId: "y", value: true },
      { questionId: "s", value: "C" }, { questionId: "m", value: ["B", "Z", "B"] }, { questionId: "ghost", value: 1 },
    ], qs);
    expect(a).toEqual([{ questionId: "n", value: 0 }, { questionId: "y", value: "Yes" }, { questionId: "m", value: ["B"] }]);
    expect(missingRequired(qs, a)).toEqual(["t"]);
  });
});

describe("survey moves and words", () => {
  it("launches, closes and reopens, never back to draft", () => {
    expect(surveyTransitionBlocked("DRAFT", "ACTIVE")).toBeNull();
    expect(surveyTransitionBlocked("CLOSED", "ACTIVE")).toBeNull();
    expect(surveyTransitionBlocked("ACTIVE", "DRAFT")).not.toBeNull();
    expect(surveyTransitionBlocked("DRAFT", "CLOSED")).not.toBeNull();
  });
  it("says Open and a time", () => {
    expect(surveyStatusOf("ACTIVE").label).toBe("Open");
    expect(surveyMinutes(8)).toBe("about 2 minutes");
    expect(surveyMinutes(2)).toBe("about a minute");
  });
});
