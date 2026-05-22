import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    main: "src/main.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: "dist",
});
