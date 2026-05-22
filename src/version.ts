import { readFileSync } from "node:fs";

// Reads version from the package.json that ships alongside the built code.
// In dev: src/version.ts → ../package.json (repo root).
// In prod: dist/<bundle>.mjs → ../package.json (installed-package root). Same path.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const PINMARK_VERSION: string = pkg.version;
