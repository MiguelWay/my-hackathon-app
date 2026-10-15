import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The API suites reset and re-seed the SAME test database, so they must not run in parallel.
    // (Unit tests don't care, and the whole suite still runs in a couple of seconds.)
    fileParallelism: false,
  },
});
