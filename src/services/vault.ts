import { rmdir } from "node:fs/promises";
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

    // Filenames below are vault-relative paths ("2024/03/note.md" or "note.md"),
    // always with "/" separators.

    const ensureParent = (filePath: string): Effect.Effect<void, VaultError> =>
      fs
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(vaultFail("Failed to create directory", path.dirname(filePath)));

    const writeBookmark = (
      root: string,
      filename: string,
      content: string,
    ): Effect.Effect<void, VaultError> =>
      Effect.gen(function* () {
        const filePath = path.join(root, filename);
        yield* ensureParent(filePath);
        yield* fs.writeFileString(filePath, content).pipe(vaultFail("Write failed", filePath));
      });

    // Move a file within the vault, creating the target folder and removing the
    // source folder if the move left it empty. A missing source is a no-op, so an
    // interrupted run can safely redo the move.
    const moveFile = (root: string, from: string, to: string): Effect.Effect<void, VaultError> =>
      Effect.gen(function* () {
        const fromPath = path.join(root, from);
        const toPath = path.join(root, to);
        const exists = yield* fs.exists(fromPath).pipe(vaultFail("Stat failed", fromPath));
        if (!exists) return;
        yield* ensureParent(toPath);
        yield* fs.rename(fromPath, toPath).pipe(vaultFail("Move failed", fromPath));
        // Remove the folders the move emptied, walking up to (never including) the
        // vault root: moving 2024/03/note.md out may leave both 2024/03 and 2024
        // empty. rmdir only succeeds on an empty directory, atomically, so a folder
        // another fiber is moving a note into just stays, which a check-then-rm
        // couldn't guarantee. The first folder that isn't empty ends the walk.
        const rootDir = path.resolve(root);
        let dir = path.resolve(path.dirname(fromPath));
        while (dir !== rootDir && dir.startsWith(rootDir + path.sep)) {
          const current = dir;
          const removed = yield* Effect.promise(() =>
            rmdir(current).then(
              () => true,
              () => false,
            ),
          );
          if (!removed) break;
          dir = path.dirname(dir);
        }
      });

    const deleteBookmark = (root: string, filename: string): Effect.Effect<void, VaultError> =>
      Effect.gen(function* () {
        const filePath = path.join(root, filename);
        const exists = yield* fs.exists(filePath).pipe(vaultFail("Stat failed", filePath));
        if (!exists) return;
        yield* fs.remove(filePath).pipe(vaultFail("Delete failed", filePath));
      });

    // Every .md file in the vault, as vault-relative paths. Walks subfolders so
    // notes are found under any layout, but skips dot-folders (.git, .obsidian,
    // .pinmark, …) and node_modules, which never hold bookmarks.
    const listBookmarkFilenames = (root: string): Effect.Effect<string[], VaultError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(root).pipe(vaultFail("Stat failed", root));
        if (!exists) return [];
        const found: string[] = [];
        const walk = (rel: string): Effect.Effect<void, VaultError> =>
          Effect.gen(function* () {
            const dir = rel === "" ? root : path.join(root, rel);
            const entries = yield* fs
              .readDirectory(dir)
              .pipe(vaultFail("Read directory failed", dir));
            for (const name of entries.sort()) {
              if (name.startsWith(".") || name === "node_modules") continue;
              const childRel = rel === "" ? name : `${rel}/${name}`;
              if (name.endsWith(".md")) {
                found.push(childRel);
                continue;
              }
              const info = yield* fs
                .stat(path.join(dir, name))
                .pipe(vaultFail("Stat failed", path.join(dir, name)));
              if (info.type === "Directory") yield* walk(childRel);
            }
          });
        yield* walk("");
        return found;
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
        const filePath = path.join(root, filename);
        yield* ensureParent(filePath);
        yield* fs.writeFile(filePath, bytes).pipe(vaultFail("Screenshot write failed", filePath));
      });

    return {
      ensureRoot,
      writeBookmark,
      readBookmark,
      writeScreenshot,
      deleteBookmark,
      moveFile,
      listBookmarkFilenames,
    } as const;
  }),
  dependencies: [],
}) {}
