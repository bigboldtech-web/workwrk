// The names under which anyone may own a site (review of Phase 4 step 1),
// so a wildcard over one of them is everyone's sites, never one company's:
// "*.co.uk", "*.github.io", "*.herokuapp.com" would let a teammate open any
// page any stranger put there, a planted one included. sites.ts
// parseSiteEntry refuses such a wildcard with problem "wildcard", and the
// guard never honours one an allow list holds anyway.
//
// A CURATED LIST, NOT THE PUBLIC SUFFIX LIST. No package may be added, and
// the full list is thousands of rows that change monthly. This holds the
// forms people actually paste: the common two-label country forms, a rule
// for the rest of them (a two-label name whose first label is one of
// COUNTRY_SECOND_LABELS under a two-letter country code), and the hosting
// and platform names where anyone can make a subdomain. A name it misses can
// still only be added as a wildcard by an Owner or Admin, on purpose; the
// block list and the never names hold whatever it says.
//
// WILDCARD DNS. Some services answer any IP address for a name under them
// ("10.0.0.8.nip.io" is 10.0.0.8), so a host under one reaches a private
// network as surely as the address itself. They are never opened at all, as
// entries or as hosts: sites.ts neverReason names them "internal".
//
// Pure: no imports.

/** Two-label country forms and hosting and platform names, lower case. */
const LISTED: readonly string[] = [
  // Country forms the rule below also covers, listed so the list reads whole.
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "ltd.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "org.nz",
  "net.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "go.jp",
  "co.in",
  "net.in",
  "org.in",
  "com.br",
  "com.cn",
  "com.mx",
  "co.za",
  "com.sg",
  "com.hk",
  "co.kr",
  "com.tr",
  "com.ar",
  "co.il",
  // Country forms the rule does not cover.
  "me.uk",
  "net.uk",
  "plc.uk",
  "sch.uk",
  "nhs.uk",
  "police.uk",
  "id.au",
  "asn.au",
  "gen.nz",
  "govt.nz",
  "kiwi.nz",
  "school.nz",
  "ad.jp",
  "ed.jp",
  "gr.jp",
  "lg.jp",
  "firm.in",
  "gen.in",
  "ind.in",
  "res.in",
  "gob.mx",
  "gob.es",
  "gob.ar",
  "gouv.fr",
  // Hosting, where every customer's site is a subdomain.
  "github.io",
  "githubusercontent.com",
  "github.dev",
  "app.github.dev",
  "gitlab.io",
  "bitbucket.io",
  "herokuapp.com",
  "vercel.app",
  "vercel.dev",
  "now.sh",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "r2.dev",
  "deno.dev",
  "web.app",
  "firebaseapp.com",
  "firebaseio.com",
  "appspot.com",
  "run.app",
  "a.run.app",
  "cloudfunctions.net",
  "googleusercontent.com",
  "storage.googleapis.com",
  "googleapis.com",
  "azurewebsites.net",
  "azurestaticapps.net",
  "azureedge.net",
  "azurefd.net",
  "azure-api.net",
  "cloudapp.net",
  "cloudapp.azure.com",
  "trafficmanager.net",
  "blob.core.windows.net",
  "web.core.windows.net",
  "cloudfront.net",
  "s3.amazonaws.com",
  "elasticbeanstalk.com",
  "amplifyapp.com",
  "awsapprunner.com",
  "on.aws",
  "digitaloceanspaces.com",
  "ondigitalocean.app",
  "linodeobjects.com",
  "onrender.com",
  "fly.dev",
  "railway.app",
  "up.railway.app",
  "koyeb.app",
  "csb.app",
  "codesandbox.io",
  "stackblitz.io",
  "gitpod.io",
  "glitch.me",
  "repl.co",
  "replit.app",
  "replit.dev",
  "surge.sh",
  "neocities.org",
  "pythonanywhere.com",
  "000webhostapp.com",
  "readthedocs.io",
  "gitbook.io",
  // Tunnels to someone's own computer.
  "ngrok.io",
  "ngrok.app",
  "ngrok.dev",
  "ngrok-free.app",
  "ngrok-free.dev",
  "loca.lt",
  "trycloudflare.com",
  "serveo.net",
  "pagekite.me",
  // Site builders and blogs, where anyone makes a site under one name.
  "blogspot.com",
  "wordpress.com",
  "tumblr.com",
  "substack.com",
  "weebly.com",
  "wixsite.com",
  "squarespace.com",
  "myshopify.com",
  "webflow.io",
  "bubbleapps.io",
  "carrd.co",
  "notion.site",
  "framer.app",
  "framer.website",
  "hubspotpagebuilder.com",
  "godaddysites.com",
  "jimdosite.com",
  "mystrikingly.com",
  "yolasite.com",
  "site123.me",
  // Dynamic DNS, where anyone points a name at any address.
  "duckdns.org",
  "ddns.net",
  "hopto.org",
  "zapto.org",
  "sytes.net",
  "no-ip.org",
  "no-ip.biz",
  "no-ip.info",
  "dynu.net",
  "freeddns.org",
  "mooo.com",
  "dynv6.net",
  "dedyn.io",
];

const LISTED_SET: ReadonlySet<string> = new Set(LISTED);

/** The first labels of a country's own second level ("co.uk", "com.au", "ne.jp"). */
const COUNTRY_SECOND_LABELS: ReadonlySet<string> = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "mil", "nic", "ltd"]);

/** Amazon S3's regional names: "s3.us-east-1.amazonaws.com", "s3-website-eu-west-1.amazonaws.com", "s3.dualstack.us-east-1.amazonaws.com". */
const S3_REGIONAL = /^s3[.-][a-z0-9.-]*\.amazonaws\.com$/;

/** Blogger's country names: "blogspot.co.uk", "blogspot.de". */
const BLOGSPOT = /^blogspot\.[a-z]{2,3}(?:\.[a-z]{2})?$/;

/**
 * Clouds whose names below them are shared by every customer at more levels
 * than a list can hold (a region, a service, a region of a service): no
 * wildcard at or under them is one company's.
 */
const SHARED_ZONES: readonly string[] = ["amazonaws.com", "on.aws", "cloudapp.azure.com", "core.windows.net", "run.app"];

/**
 * Wildcard DNS: any address is a name under these ("10.0.0.8.nip.io").
 * Never opened, as entries or hosts (sites.ts neverReason, "internal").
 */
export const WILDCARD_DNS: readonly string[] = [
  "nip.io",
  "sslip.io",
  "xip.io",
  "localtest.me",
  "lvh.me",
  "vcap.me",
  "traefik.me",
  "localhost.run",
  "localho.st",
  "lacolhost.com",
  "1u.ms",
  "rbndr.us",
];

function underOrAt(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/** Whether anyone may own a site directly under this name (a lower-case host, no trailing dot). */
export function isPublicSuffix(name: string): boolean {
  if (typeof name !== "string" || !name) return false;
  if (LISTED_SET.has(name)) return true;
  if (S3_REGIONAL.test(name) || BLOGSPOT.test(name)) return true;
  const labels = name.split(".");
  return labels.length === 2 && /^[a-z]{2}$/.test(labels[1]) && COUNTRY_SECOND_LABELS.has(labels[0]);
}

/**
 * Whether "*." before this base would be strangers' sites: the base is a
 * public suffix, has one below it ("amazonaws.com" over "s3.amazonaws.com"),
 * or is at or under a shared cloud zone. A base of fewer than two labels is
 * one too ("*.com").
 */
export function wildcardTooBroad(base: string): boolean {
  if (typeof base !== "string" || base.split(".").length < 2) return true;
  if (isPublicSuffix(base)) return true;
  if (LISTED.some((s) => s.endsWith(`.${base}`))) return true;
  return SHARED_ZONES.some((z) => underOrAt(base, z));
}

/** Whether a host is a wildcard DNS name or under one: it can name any address, a private one included. */
export function isWildcardDnsHost(host: string): boolean {
  if (typeof host !== "string" || !host) return false;
  return WILDCARD_DNS.some((z) => underOrAt(host, z));
}
