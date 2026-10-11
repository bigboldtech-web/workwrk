// The names under which anyone may own a site (src/lib/browser/public-suffixes.ts,
// review of Phase 4 step 1): a wildcard over one of them is everyone's
// sites, and a wildcard DNS name is any address, so the first is refused
// as an entry and the second is never opened at all.

import { describe, expect, it } from "vitest";
import { WILDCARD_DNS, isPublicSuffix, isWildcardDnsHost, wildcardTooBroad } from "./public-suffixes";

describe("isPublicSuffix", () => {
  it("knows the common country forms, listed or by the rule, and the hosting and platform names", () => {
    for (const s of ["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp", "or.jp", "co.in", "com.br", "com.cn", "com.mx", "co.za"]) {
      expect(isPublicSuffix(s), s).toBe(true);
    }
    // The rule: a second label under a two-letter country code.
    for (const s of ["co.ke", "com.pk", "net.pl", "org.pe", "gov.ng", "edu.vn", "ac.th", "or.kr", "ne.jp", "go.id", "mil.co", "nic.in", "ltd.uk"]) expect(isPublicSuffix(s), s).toBe(true);
    for (const s of ["github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com", "appspot.com", "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com", "blogspot.com", "onrender.com", "fly.dev", "ngrok.io", "ngrok.app", "ngrok-free.app", "glitch.me", "repl.co", "replit.dev", "surge.sh", "wixsite.com", "squarespace.com", "myshopify.com", "webflow.io", "bubbleapps.io", "carrd.co", "notion.site", "framer.app"]) {
      expect(isPublicSuffix(s), s).toBe(true);
    }
    // Regional S3 and Blogger's country names, by pattern.
    expect(isPublicSuffix("s3.eu-west-1.amazonaws.com")).toBe(true);
    expect(isPublicSuffix("s3-website-us-east-1.amazonaws.com")).toBe(true);
    expect(isPublicSuffix("s3.dualstack.ap-south-1.amazonaws.com")).toBe(true);
    expect(isPublicSuffix("blogspot.co.uk")).toBe(true);
    expect(isPublicSuffix("blogspot.de")).toBe(true);
  });

  it("does not name a company's own domain, however it looks", () => {
    for (const s of ["example.com", "example.co.uk", "acme.github.io", "shop.myshopify.com", "google.com", "amazon.com", "bbc.co.uk", "co.example", "company.com", "ac.example.org", ""]) {
      expect(isPublicSuffix(s), s).toBe(false);
    }
    // A two-letter first label under a country code is not the rule ("ab.uk" is somebody's domain, if it exists).
    expect(isPublicSuffix("ab.uk")).toBe(false);
    // Three labels never match the rule.
    expect(isPublicSuffix("co.example.uk")).toBe(false);
  });
});

describe("wildcardTooBroad", () => {
  it("refuses a wildcard over a public suffix, over a name with a suffix below it, over a shared cloud zone, and over one label", () => {
    for (const b of ["com", "co.uk", "github.io", "herokuapp.com", "com.au", "s3.amazonaws.com", "amazonaws.com", "windows.net", "core.windows.net", "azure.com", "cloudapp.azure.com", "run.app", "on.aws", "blogspot.fr", "co.ke", "ngrok-free.app"]) {
      expect(wildcardTooBroad(b), b).toBe(true);
    }
  });

  it("leaves wildcard DNS names to the never list, which names them internal (sites.ts neverReason)", () => {
    expect(wildcardTooBroad("nip.io")).toBe(false);
    expect(isWildcardDnsHost("nip.io")).toBe(true);
  });

  it("allows a wildcard over a name one owner holds", () => {
    for (const b of ["example.com", "example.co.uk", "acme.github.io", "shop.example.com", "a.b.example.org", "google.com", "bbc.co.uk", "acme.herokuapp.com"]) {
      expect(wildcardTooBroad(b), b).toBe(false);
    }
  });
});

describe("isWildcardDnsHost", () => {
  it("names every wildcard DNS service and every name under one, and nothing else", () => {
    expect(WILDCARD_DNS).toEqual(expect.arrayContaining(["nip.io", "sslip.io", "xip.io", "localtest.me", "lvh.me", "vcap.me", "traefik.me", "localhost.run"]));
    for (const h of ["nip.io", "10.0.0.8.nip.io", "app-10-0-0-8.nip.io", "169.254.169.254.sslip.io", "a.b.xip.io", "www.localtest.me", "api.lvh.me", "vcap.me", "x.traefik.me", "abc.localhost.run"]) {
      expect(isWildcardDnsHost(h), h).toBe(true);
    }
    for (const h of ["example.com", "nip.io.example.com", "notnip.io", "snip.io", "", "lvh.me.evil.test"]) expect(isWildcardDnsHost(h), h).toBe(false);
  });
});
