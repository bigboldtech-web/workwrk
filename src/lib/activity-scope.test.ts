import { describe, expect, it } from "vitest";
import { ACTIVITY_SCOPES, allowedScopes, parseActivityScope, scopeAllowed } from "./activity-scope";

const ic = { isOrgAdmin: false, onPeopleTeam: false, hasReports: false };
const manager = { isOrgAdmin: false, onPeopleTeam: false, hasReports: true };
const peopleTeam = { isOrgAdmin: false, onPeopleTeam: true, hasReports: false };
const admin = { isOrgAdmin: true, onPeopleTeam: false, hasReports: false };

describe("parseActivityScope", () => {
  it("defaults to Just me, including for junk", () => {
    expect(parseActivityScope(null)).toBe("my");
    expect(parseActivityScope("")).toBe("my");
    expect(parseActivityScope("everything")).toBe("my");
  });

  it("reads the two real scopes", () => {
    expect(parseActivityScope("team")).toBe("team");
    expect(parseActivityScope("all")).toBe("all");
  });
});

describe("scopeAllowed", () => {
  it("gives Just me to everyone", () => {
    for (const who of [ic, manager, peopleTeam, admin]) {
      expect(scopeAllowed("my", who)).toBe(true);
    }
  });

  it("refuses My team and Everyone to an IC", () => {
    // This is the whole point: the old route answered `my` while the page kept
    // the other pill lit, so an IC saw their own rows labelled "My team".
    expect(scopeAllowed("team", ic)).toBe(false);
    expect(scopeAllowed("all", ic)).toBe(false);
  });

  it("gives My team to anyone with reports, and Everyone to nobody without the People team", () => {
    expect(scopeAllowed("team", manager)).toBe(true);
    expect(scopeAllowed("all", manager)).toBe(false);
  });

  it("gives both to the People team and to admins", () => {
    for (const who of [peopleTeam, admin]) {
      expect(scopeAllowed("team", who)).toBe(true);
      expect(scopeAllowed("all", who)).toBe(true);
    }
  });
});

describe("allowedScopes drives the pills", () => {
  it("draws one pill for an IC, two for a manager, three for the People team", () => {
    expect(allowedScopes(ic)).toEqual(["my"]);
    expect(allowedScopes(manager)).toEqual(["my", "team"]);
    expect(allowedScopes(peopleTeam)).toEqual(["my", "team", "all"]);
    expect(allowedScopes(admin)).toEqual(["my", "team", "all"]);
  });

  it("never offers a pill whose request would 403", () => {
    for (const who of [ic, manager, peopleTeam, admin]) {
      for (const scope of allowedScopes(who)) {
        expect(scopeAllowed(scope, who), `${scope} for ${JSON.stringify(who)}`).toBe(true);
      }
    }
  });

  it("names all three scopes in the user's words", () => {
    expect(ACTIVITY_SCOPES.map((s) => s.label)).toEqual(["Just me", "My team", "Everyone"]);
  });
});
