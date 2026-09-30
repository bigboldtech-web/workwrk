// Node module hooks that let a plain `node script.mjs` import the app's
// TypeScript (src/lib/**) without tsx or a build step.
//
//   resolve: "@/x" -> <repo>/src/x; extensionless relative and alias
//            specifiers try .ts / .tsx / .js / index.*; a directory with a
//            package.json "main" (the generated Prisma client) resolves to it.
//   load:    .ts / .tsx files go through esbuild's transform (already a
//            dependency via vitest), so `import type` elision, enums and TSX
//            all behave as they do under the app's own build.
//
// Registered by scripts/access-parity-job.mjs through module.register().
// Nothing here is specific to that job.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

let ROOT = "";
let STUB_AUTH = false;

export function initialize(data) {
  ROOT = data.root;
  STUB_AUTH = data.stubAuth === true;
}

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

function asFile(base) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (!existsSync(candidate)) continue;
    const st = statSync(candidate);
    if (st.isFile()) return candidate;
    if (st.isDirectory() && suffix === "") {
      const pkg = join(candidate, "package.json");
      if (existsSync(pkg)) {
        const main = JSON.parse(readFileSync(pkg, "utf8")).main;
        if (main) return join(candidate, main);
      }
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = join(ROOT, "src", specifier.slice(2));
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const file = asFile(base);
    if (file && STUB_AUTH && file === join(ROOT, "src", "lib", "auth.ts")) {
      return { url: pathToFileURL(join(ROOT, "scripts", "lib", "auth-stub.mjs")).href, shortCircuit: true };
    }
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // A bare package subpath written without its extension ("next/server",
    // "next-auth/providers/credentials") resolves under the app's bundler but
    // not under Node's ESM rules; retry once with ".js".
    const bare = !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:") && specifier.includes("/");
    if (bare && err?.code === "ERR_MODULE_NOT_FOUND" && !/\.[cm]?js$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const path = fileURLToPath(url);
    const source = readFileSync(path, "utf8");
    const { code } = transformSync(source, {
      loader: url.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: "node20",
      sourcefile: path,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
