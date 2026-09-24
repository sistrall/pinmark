import { Effect } from "effect";
import { ExtractionError } from "../errors.js";
import { ContentPool, WorkerTimeoutError } from "./content-pool.js";

// HTML → markdown via Turndown, run in the content worker pool for the same
// reason as extraction: it is synchronous and can be slow on large documents.
export class MarkdownConverter extends Effect.Service<MarkdownConverter>()("MarkdownConverter", {
  effect: Effect.gen(function* () {
    const pool = yield* ContentPool;

    const convert = (
      html: string,
      url: string,
      timeoutMs: number,
    ): Effect.Effect<string, ExtractionError> =>
      pool.run({ op: "convert", html }, timeoutMs).pipe(
        Effect.map((md) => md as string),
        Effect.mapError(
          (cause) =>
            new ExtractionError({
              message:
                cause instanceof WorkerTimeoutError
                  ? `Markdown conversion exceeded ${timeoutMs}ms`
                  : `Markdown conversion failed: ${cause.message}`,
              url,
              ...(cause instanceof WorkerTimeoutError ? { timedOut: true } : {}),
              cause,
            }),
        ),
      );

    return { convert } as const;
  }),
  dependencies: [],
}) {}
