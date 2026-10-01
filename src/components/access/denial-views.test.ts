import { describe, expect, it } from "vitest";
import { adminNamesSentence } from "./denial-views";

// The ask-an-admin strip names the Owners and Admins who look after
// Workspace settings. Past three it must say how many it left out, so the
// sentence never reads as the complete list beside faces it does not name.
describe("adminNamesSentence", () => {
  it("falls back to the role names when nobody is named", () => {
    expect(adminNamesSentence([])).toBe("your workspace Owners and Admins");
    expect(adminNamesSentence(["", ""])).toBe("your workspace Owners and Admins");
  });

  it("names one, two and three people in full", () => {
    expect(adminNamesSentence(["Ana"])).toBe("Ana");
    expect(adminNamesSentence(["Ana", "Ben"])).toBe("Ana and Ben");
    expect(adminNamesSentence(["Ana", "Ben", "Cy"])).toBe("Ana, Ben and Cy");
  });

  it("counts the rest past three", () => {
    expect(adminNamesSentence(["Ana", "Ben", "Cy", "Dee"])).toBe("Ana, Ben, Cy and 1 more");
    expect(adminNamesSentence(["Ana", "Ben", "Cy", "Dee", "Eli", "Fay"])).toBe("Ana, Ben, Cy and 3 more");
  });

  it("does not count blank names in the remainder", () => {
    expect(adminNamesSentence(["Ana", "", "Ben", "Cy"])).toBe("Ana, Ben and Cy");
    expect(adminNamesSentence(["Ana", "", "Ben", "Cy", "", "Dee"])).toBe("Ana, Ben, Cy and 1 more");
  });
});
