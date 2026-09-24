// Which cached PrismaClient a freshly evaluated src/lib/prisma.ts may reuse
// in dev. Pure: no Prisma import, so the test is node-only.
//
// The cache is keyed by the PrismaClient CLASS the module sees, not shared
// as one global. The dev bundler evaluates the generated client once per
// server layer (a page's RSC layer and a route handler's layer each get their
// own copy of src/generated/prisma), and every copy has its own Prisma.Sql
// class. One shared global handed the page layer's client to route handlers,
// and that client did not recognise the route's own Prisma.sql or
// Prisma.join fragments as SQL: it bound them as parameters, and Postgres
// answered 22P02 (GET /api/tables and the Related TABLES list 500ed locally
// whenever a page rendered before the first API call). Keyed by class, each
// copy reuses only a client it built itself, and a `prisma generate` (a new
// class) always gets a fresh one. Production never caches at all.

/**
 * The client to use: the one cached for this key when it has the same shape
 * as a fresh build (`sameShape`), otherwise the fresh build. A fresh build
 * that is not used is handed to `drop` so its pool is released.
 */
export function reuseCachedClient<K extends object, C>(
  cache: WeakMap<K, C>,
  key: K,
  build: () => C,
  sameShape: (cached: C, fresh: C) => boolean,
  drop: (unused: C) => void,
): C {
  const cached = cache.get(key);
  if (cached === undefined) return build();
  const fresh = build();
  if (sameShape(cached, fresh)) {
    drop(fresh);
    return cached;
  }
  return fresh;
}
