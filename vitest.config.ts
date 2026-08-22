import { defineConfig } from "vitest/config";

// Unit tests only, and deliberately scoped to the pure libraries under
// src/lib. Nothing here touches React, the database or the network, so the
// default node environment is right and the suite stays fast enough to run
// on every change. Next.js builds ignore this file.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/**/*.test.ts"],
  },
});
