/**
 * vitest.config.ts
 *
 * Exists for one reason: `@/…` imports.
 *
 * `package.json` has had `"test": "vitest run"` and vitest in devDependencies
 * for a while, but no config file — which means any test importing `@/lib/…`
 * fails to resolve, because the `paths` mapping in tsconfig.json is a
 * TypeScript-only concept that Vite knows nothing about.
 *
 * This adds the alias and nothing else. `include` is left at the vitest
 * default, so any suite that already ran keeps running exactly as before.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig.json compilerOptions.paths.
      "@": path.resolve(__dirname, "."),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    // Node, not jsdom: the paywall suite covers pure modules only, and pulling
    // in a DOM would invite tests that quietly depend on one.
    environment: "node",
  },
});