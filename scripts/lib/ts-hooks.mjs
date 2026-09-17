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

export function initialize(data) {
  ROOT = data.root;
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
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
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
