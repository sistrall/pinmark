import { Effect, Schema } from "effect";
import matter from "gray-matter";
import { VaultError } from "../errors.js";
import { Frontmatter } from "../schemas/frontmatter.js";

export const composeBookmarkFile = (
  frontmatter: Frontmatter,
  body: string,
): Effect.Effect<string, VaultError> =>
  Schema.encode(Frontmatter)(frontmatter).pipe(
    Effect.map((encoded) => matter.stringify(body, encoded as Record<string, unknown>)),
    Effect.mapError((cause) => new VaultError({ message: "Failed to encode frontmatter", cause })),
  );

export interface ParsedBookmarkFile {
  readonly frontmatter: Frontmatter;
  readonly body: string;
}

export const parseBookmarkFile = (content: string): Effect.Effect<ParsedBookmarkFile, VaultError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      // Passing options bypasses gray-matter's content cache, whose hits come back
      // without the (non-enumerable) `matter` field and which would otherwise hold
      // every note of the vault in memory for the whole sync.
      try: () => matter(content, {}),
      catch: (cause) => new VaultError({ message: "Failed to parse markdown frontmatter", cause }),
    });
    if (parsed.matter.length === 0) {
      return yield* Effect.fail(
        new VaultError({ message: "File does not have a YAML frontmatter block" }),
      );
    }
    const frontmatter = yield* Schema.decodeUnknown(Frontmatter)(parsed.data).pipe(
      Effect.mapError(
        (cause) => new VaultError({ message: "Frontmatter does not match schema", cause }),
      ),
    );
    return { frontmatter, body: parsed.content.trim() };
  });
