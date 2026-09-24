// Toggle 10, "Public links" (access-model-spec section 8, settings.access.publicLinks),
// read the one way every public table and form route reads it.
//
// The schema default is "off" (lib/access/settings.ts:38), but no org that has
// never opened Settings > Access stores the key at all, and every public
// embed that is live today was published before the toggle existed. Treating
// ABSENT as "off" would switch every live embed off on the day this ships,
// which is a silent behaviour change nobody approved. So this follows the
// public docs route (api/public/docs/[token]/route.ts:43-50): only an explicit
// "off" closes the door; anything else keeps today's behaviour.
//
// Pure: no imports, so the node test suite proves it directly.

export function orgPublicLinksAllowed(orgSettings: unknown): boolean {
  if (!orgSettings || typeof orgSettings !== "object") return true;
  const access = (orgSettings as { access?: unknown }).access;
  if (!access || typeof access !== "object") return true;
  return (access as { publicLinks?: unknown }).publicLinks !== "off";
}
