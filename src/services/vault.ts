import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";
import { VaultError } from "../errors.js";
import type { Frontmatter } from "../schemas/frontmatter.js";

export interface VaultEntry {
  readonly filename: string;
  readonly frontmatter: Frontmatter;
}

// Factory: pipeable mapError that wraps an unknown FS failure into a VaultError
// with the call-site's message + path. Saves ~6 inline `Effect.mapError(...)` blocks.
const vaultFail = (message: string, path?: string) =>
  Effect.mapError(
    (cause: unknown) => new VaultError({ message, ...(path !== undefined ? { path } : {}), cause }),
  );

export class Vault extends Effect.Service<Vault>()("Vault", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const ensureRoot = (root: string): Effect.Effect<void, VaultError> =>
      fs
        .makeDirectory(root, { recursive: true })
        .pipe(vaultFail("Failed to create vault directory", root));

    const writeBookmark = (
      root: string,
      filename: string,
      content: string,
    ): Effect.Effect<void, VaultError> =>
      Effect.gen(function* () {
        yield* ensureRoot(root);
        const filePath = path.join(root, filename);
        yield* fs.writeFileString(filePath, content).pipe(vaultFail("Write failed", filePath));
      });

    const deleteBookmark = (root: string, filename: string): Effect.Effect<void, VaultError> =>
      Effect.gen(function* () {
        const filePath = path.join(root, filename);
        const exists = yield* fs.exists(filePath).pipe(vaultFail("Stat failed", filePath));
        if (!exists) return;
        yield* fs.remove(filePath).pipe(vaultFail("Delete failed", filePath));
      });

    const listBookmarkFilenames = (root: string): Effect.Effect<string[], VaultError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(root).pipe(vaultFail("Stat failed", root));
        if (!exists) return [];
        const entries = yield* fs
          .readDirectory(root)
          .pipe(vaultFail("Read directory failed", root));
        return entries.filter((name) => name.endsWith(".md"));
      });

    const readBookmark = (
      root: string,
      filename: string,
    ): Effect.Effect<Option.Option<string>, VaultError> =>
      Effect.gen(function* () {
        const filePath = path.join(root, filename);
        const exists = yield* fs.exists(filePath).pipe(vaultFail("Stat failed", filePath));
        if (!exists) return Option.none<string>();
        const content = yield* fs.readFileString(filePath).pipe(vaultFail("Read failed", filePath));
        return Option.some(content);
      });

    const writeScreenshot = (
      root: string,
      filename: string,
      bytes: Uint8Array,
    ): Effect.Effect<void, VaultError> =>
      Effect.gen(function* () {
        yield* ensureRoot(root);
        const filePath = path.join(root, filename);
        yield* fs.writeFile(filePath, bytes).pipe(vaultFail("Screenshot write failed", filePath));
      });

    return {
      ensureRoot,
      writeBookmark,
      readBookmark,
      writeScreenshot,
      deleteBookmark,
      listBookmarkFilenames,
    } as const;
  }),
  dependencies: [],
}) {}
