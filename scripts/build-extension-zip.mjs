#!/usr/bin/env node
// Rebuilds the downloadable extension archive at public/workwrk-sop-recorder.zip
// from the current contents of /extension. Run this any time you change
// popup.html / popup.js / content.js / manifest.json — otherwise the
// download endpoint serves stale code.
//
// Uses the system `zip` tool (available on macOS/Linux/WSL out of the
// box). No npm deps, intentional — keeps the critical-path install slim.
//
// Usage: node scripts/build-extension-zip.mjs

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const EXT_DIR = path.join(ROOT, "extension");
const OUT_DIR = path.join(ROOT, "public");
const OUT_ZIP = path.join(OUT_DIR, "workwrk-sop-recorder.zip");

if (!existsSync(EXT_DIR)) {
  console.error(`extension/ directory not found at ${EXT_DIR}`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
await rm(OUT_ZIP, { force: true });

try {
  // `-r` recurse, `-X` strip extra attributes for deterministic output,
  // `-9` max compression. Path is relative to extension/ so the ZIP has
  // a flat top level (users extract → working extension folder).
  // Exclude hidden directories / macOS junk so stray .next, .DS_Store, etc.
  // don't ship to users and get rejected by the Chrome Web Store.
  await execFileP(
    "zip",
    [
      "-r", "-X", "-9", OUT_ZIP, ".",
      "--exclude", ".*",
      "--exclude", "*/.*",
      "--exclude", "__MACOSX",
      "--exclude", "*/__MACOSX/*",
    ],
    { cwd: EXT_DIR },
  );
  console.log(`✓ wrote ${path.relative(ROOT, OUT_ZIP)}`);
} catch (err) {
  console.error("Failed to build extension ZIP.");
  console.error(err?.stderr || err?.message || err);
  process.exit(1);
}
