import { Effect } from "effect";
import { ExtractionError } from "../errors.js";
import { ContentPool, WorkerTimeoutError } from "./content-pool.js";
import type { RawExtraction } from "./content-worker.js";

export interface ExtractedMetadata {
  readonly pageTitle?: string;
  readonly author?: string;
  readonly publishedAt?: Date;
  readonly siteName?: string;
  readonly excerpt?: string;
  readonly language?: string;
  readonly coverImage?: string;
  readonly readingTime?: number;
  readonly wordCount?: number;
}

export interface ExtractedContent {
  readonly cleanHtml: string;
  readonly metadata: ExtractedMetadata;
}

const presentString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parsedDate = (value: unknown): Date | undefined => {
  const str = presentString(value);
  if (!str) return undefined;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? ({} as Partial<Record<K, V>>) : ({ [key]: value } as Partial<Record<K, V>>);

const mapDefuddleResult = (result: RawExtraction): ExtractedContent => {
  const wordCount =
    typeof result.wordCount === "number" && result.wordCount > 0 ? result.wordCount : undefined;
  return {
    cleanHtml: typeof result.content === "string" ? result.content : "",
    metadata: {
      ...opt("pageTitle", presentString(result.title)),
      ...opt("author", presentString(result.author)),
      ...opt("publishedAt", parsedDate(result.published)),
      ...opt("siteName", presentString(result.site)),
      ...opt("excerpt", presentString(result.description)),
      ...opt("language", presentString(result.language)),
      ...opt("coverImage", presentString(result.image)),
      ...opt("wordCount", wordCount),
      ...opt(
        "readingTime",
        wordCount !== undefined ? Math.max(1, Math.ceil(wordCount / 200)) : undefined,
      ),
    },
  };
};

export class Extractor extends Effect.Service<Extractor>()("Extractor", {
  effect: Effect.gen(function* () {
    const pool = yield* ContentPool;

    const extract = (
      html: string,
      url: string,
      timeoutMs: number,
    ): Effect.Effect<ExtractedContent, ExtractionError> =>
      pool.run({ op: "extract", html, url }, timeoutMs).pipe(
        Effect.map((raw) => mapDefuddleResult(raw as RawExtraction)),
        Effect.mapError(
          (cause) =>
            new ExtractionError({
              message:
                cause instanceof WorkerTimeoutError
                  ? `Extraction exceeded ${timeoutMs}ms`
                  : `Defuddle extraction failed: ${cause.message}`,
              url,
              ...(cause instanceof WorkerTimeoutError ? { timedOut: true } : {}),
              cause,
            }),
        ),
      );

    return { extract } as const;
  }),
  dependencies: [],
}) {}
