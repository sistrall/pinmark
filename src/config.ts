import { cosmiconfig } from "cosmiconfig";
import { Effect, Schema } from "effect";
import { ConfigError } from "./errors.js";
import { PINMARK_VERSION } from "./version.js";

export const FetchConfig = Schema.Struct({
  concurrency: Schema.optionalWith(Schema.Number, { default: () => 4 }),
  perHostConcurrency: Schema.optionalWith(Schema.Number, { default: () => 1 }),
  timeoutMs: Schema.optionalWith(Schema.Number, { default: () => 30_000 }),
  // Responses larger than this are abandoned instead of parsed. Parsing cost grows
  // superlinearly with size, so a multi-MB body can stall extraction for hours.
  maxBodyBytes: Schema.optionalWith(Schema.Number, { default: () => 5_000_000 }),
  userAgent: Schema.optionalWith(Schema.String, {
    default: () => `pinmark/${PINMARK_VERSION} (+https://github.com/sistrall/pinmark)`,
  }),
});

export const ExtractionConfig = Schema.Struct({
  minWordCount: Schema.optionalWith(Schema.Number, { default: () => 100 }),
  // Hard cap on HTML → article → markdown work for one bookmark. Extraction runs in
  // a worker thread that is terminated when this elapses.
  timeoutMs: Schema.optionalWith(Schema.Number, { default: () => 30_000 }),
  headlessAllowlist: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [] as readonly string[],
  }),
});

export const RetryConfig = Schema.Struct({
  maxAttempts: Schema.optionalWith(Schema.Number, { default: () => 5 }),
  initialDelayMs: Schema.optionalWith(Schema.Number, { default: () => 30_000 }),
});

export const ScreenshotConfig = Schema.Struct({
  enabled: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  // 960px is wide enough that responsive sites still look intentional, while saving
  // ~25% over 1280px on file size. Bump back to 1280 if your bookmarks are mostly
  // desktop-first non-responsive sites.
  viewportWidth: Schema.optionalWith(Schema.Number, { default: () => 960 }),
  // JPEG @ q80 is 5-10x smaller than PNG with acceptable artifacting on text/UI for
  // "visual reference" use. Switch to PNG for archival-grade screenshots.
  format: Schema.optionalWith(Schema.Literal("png", "jpeg"), {
    default: () => "jpeg" as const,
  }),
  jpegQuality: Schema.optionalWith(Schema.Number, { default: () => 75 }),
  // Hosts where a screenshot wouldn't be useful (player UI for video, file downloads,
  // sites where the value is the content not the chrome). Matches the host and any
  // subdomain. Bookmarks matching these fall back to the HTTP-first path.
  skipDomains: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () =>
      [
        // Video — content is the media, not the page chrome
        "youtube.com",
        "youtu.be",
        "vimeo.com",
        "twitch.tv",
        "dailymotion.com",
        "tiktok.com",
        // Audio players
        "soundcloud.com",
        "open.spotify.com",
        "music.apple.com",
        // Text-focused: screenshot duplicates the extracted body
        "gist.github.com",
      ] as readonly string[],
  }),
});

export const PinmarkConfig = Schema.Struct({
  vault: Schema.optionalWith(Schema.String, { default: () => "." }),
  fetch: Schema.optionalWith(FetchConfig, {
    default: () => FetchConfig.make({}),
  }),
  extraction: Schema.optionalWith(ExtractionConfig, {
    default: () => ExtractionConfig.make({}),
  }),
  retry: Schema.optionalWith(RetryConfig, {
    default: () => RetryConfig.make({}),
  }),
  screenshot: Schema.optionalWith(ScreenshotConfig, {
    default: () => ScreenshotConfig.make({}),
  }),
});
export type PinmarkConfig = typeof PinmarkConfig.Type;

export interface ConfigOverrides {
  readonly vault?: string;
}

export const loadConfig = (
  overrides: ConfigOverrides = {},
): Effect.Effect<PinmarkConfig, ConfigError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        const explorer = cosmiconfig("pinmark");
        const result = await explorer.search();
        return result?.config ?? {};
      },
      catch: (cause) =>
        new ConfigError({
          message: "Failed to load pinmark config file",
          cause,
        }),
    });

    const merged = {
      ...raw,
      ...(overrides.vault !== undefined ? { vault: overrides.vault } : {}),
      ...(process.env.PINMARK_VAULT !== undefined && overrides.vault === undefined
        ? { vault: process.env.PINMARK_VAULT }
        : {}),
    };

    return yield* Schema.decodeUnknown(PinmarkConfig)(merged).pipe(
      Effect.mapError(
        (cause) =>
          new ConfigError({
            message: "Invalid pinmark config",
            cause,
          }),
      ),
    );
  });

export const requireApiToken = (): Effect.Effect<string, ConfigError> =>
  Effect.sync(() => process.env.PINBOARD_API_TOKEN).pipe(
    Effect.flatMap((token) =>
      token === undefined || token.length === 0
        ? Effect.fail(
            new ConfigError({
              message: "PINBOARD_API_TOKEN environment variable is required",
            }),
          )
        : Effect.succeed(token),
    ),
  );
