import { describe, expect, it } from "vitest";
import { invitationTemplate } from "./invitation";

// The invite sentence reads "join Co as a Member" / "as an Admin". The article
// follows the role word the person reads, not the raw level the route passes.
function sentence(vars: { accessLevel?: string; role?: string; inviterName?: string }) {
  const html = invitationTemplate({ companyName: "Acme Corp", inviteLink: "https://a/join?token=t", ...vars }).html;
  const m = html.match(/to join <span class="highlight">Acme Corp<\/span> as (an?) <strong>([^<]*)<\/strong>\./);
  return m ? `${m[1]} ${m[2]}` : null;
}

describe("invitation sentence article", () => {
  it("says an Admin for an admin level, from either field", () => {
    expect(sentence({ accessLevel: "COMPANY_ADMIN", inviterName: "VerifyAdmin Bot" })).toBe("an Admin");
    expect(sentence({ accessLevel: "SUPER_ADMIN" })).toBe("an Admin");
    expect(sentence({ role: "COMPANY_ADMIN" })).toBe("an Admin");
    expect(sentence({ role: "Admin" })).toBe("an Admin");
  });

  it("says a Member for every other level and when nothing is passed", () => {
    expect(sentence({ accessLevel: "EMPLOYEE" })).toBe("a Member");
    expect(sentence({ accessLevel: "TEAM_LEAD" })).toBe("a Member");
    expect(sentence({})).toBe("a Member");
  });

  it("picks the article from a role word passed through as is", () => {
    expect(sentence({ role: "Owner" })).toBe("an Owner");
    expect(sentence({ role: "Guest" })).toBe("a Guest");
    expect(sentence({ role: "View only" })).toBe("a View only");
  });

  it("works out the article before escaping, so an entity never decides it", () => {
    // "&" escapes to "&amp;", which starts with a letter a vowel test would misread.
    expect(sentence({ role: "& Co" })).toBe("a &amp; Co");
  });
});
