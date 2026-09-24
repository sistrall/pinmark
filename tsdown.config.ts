import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    main: "src/main.ts",
    index: "src/index.ts",
    // Loaded by path from the content pool, so it must be its own file next to
    // the other chunks.
    "content-worker": "src/services/content-worker.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: "dist",
});
