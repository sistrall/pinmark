import { it } from "@effect/vitest";
import { Effect, Option, pipe } from "effect";
import { expect } from "vitest";
import { composeBookmarkFile } from "../bookmark/markdown.js";
import type { RemoteBookmark } from "../bookmark/types.js";
import type { PinmarkConfig } from "../config.js";
import { FetchError } from "../errors.js";
import { type Outcome, Pair } from "../pair/index.js";
import type { Frontmatter } from "../schemas/frontmatter.js";
import { MarkdownConverter } from "../services/converter.js";
import { Extractor } from "../services/extractor.js";
import { Fetcher } from "../services/fetcher.js";
import { Vault } from "../services/vault.js";

// ────────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────────

const baseConfig: PinmarkConfig = {
  vault: "./test-vault",
  fetch: {
    concurrency: 1,
    perHostConcurrency: 1,
    timeoutMs: 30_000,
    userAgent: "pinmark-test/1.0",
  },
  extraction: { minWordCount: 100, headlessAllowlist: [] },
  retry: { maxAttempts: 5, initialDelayMs: 30_000 },
  screenshot: {
    enabled: false,
    viewportWidth: 960,
    format: "jpeg",
    jpegQuality: 80,
    skipDomains: [],
  },
};

const sampleRemote: RemoteBookmark = {
  href: "https://example.com/article",
  description: "Example article",
  extended: "",
  meta: "abc",
  hash: "5d41402abc4b2a76b9719d911017c592",
  time: new Date("2026-01-01T12:00:00Z"),
  shared: false,
  toread: false,
  tags: ["test"],
};

const now = new Date("2026-05-22T10:00:00Z");

const baseFrontmatter: Frontmatter = {
  url: sampleRemote.href,
  domain: "example.com",
  pinboard_hash: sampleRemote.hash,
  title: sampleRemote.description,
  tags: [...sampleRemote.tags],
  saved_at: sampleRemote.time,
  shared: sampleRemote.shared,
  to_read: sampleRemote.toread,
  pinmark_fetch_status: "success",
  pinmark_fetch_method: "http",
  pinmark_fetch_attempts: 1,
  pinmark_fetched_at: new Date("2026-05-20T10:00:00Z"),
  pinmark_version: "0.1.0",
  screenshot: "example-article-5d41402a.png",
};

// ────────────────────────────────────────────────────────────────────────────────
// Default stub services. Every method dies if called without an explicit override
// for the test, so unconfigured paths surface as defects rather than silent passes.
// ────────────────────────────────────────────────────────────────────────────────

const die = (name: string) => Effect.die(`stub '${name}' was not configured for this test`);

const defaultFetcher = {
  fetchHttp: (_url: string, _ua: string, _t: number) => die("fetchHttp"),
  fetchHeadless: (
    _url: string,
    _ua: string,
    _t: number,
    _screenshot?: import("../services/fetcher.js").ScreenshotOptions,
  ) => die("fetchHeadless"),
};

const defaultExtractor = {
  extract: (_html: string, _url: string) => die("extract"),
};

// MarkdownConverter is purely transforming — leave the default usable.
const defaultConverter = {
  convert: (html: string) => Effect.succeed(html),
};

const defaultVault = {
  ensureRoot: (_root: string) => Effect.void,
  writeBookmark: (_root: string, _filename: string, _content: string) => Effect.void,
  readBookmark: (_root: string, _filename: string) => Effect.succeed(Option.none<string>()),
  writeScreenshot: (_root: string, _filename: string, _bytes: Uint8Array) => Effect.void,
  deleteBookmark: (_root: string, _filename: string) => Effect.void,
  listBookmarkFilenames: (_root: string) => Effect.succeed([] as string[]),
};

// biome-ignore lint/suspicious/noExplicitAny: test stubs need looser typing than production services
type AnyOverrides = Record<string, any>;

// Effect.Service classes carry a `_tag` brand on their instance type, which
// plain test stubs don't replicate. We bypass that with a double-cast through
// `unknown` for each provideService call — tests intentionally trade type
// strictness for ergonomic stub objects.
const withStubs = <A, E>(
  eff: Effect.Effect<A, E, Fetcher | Extractor | MarkdownConverter | Vault>,
  overrides: {
    fetcher?: AnyOverrides;
    extractor?: AnyOverrides;
    converter?: AnyOverrides;
    vault?: AnyOverrides;
  } = {},
): Effect.Effect<A, E, never> =>
  eff.pipe(
    Effect.provideService(Fetcher, {
      ...defaultFetcher,
      ...overrides.fetcher,
    } as unknown as Fetcher),
    Effect.provideService(Extractor, {
      ...defaultExtractor,
      ...overrides.extractor,
    } as unknown as Extractor),
    Effect.provideService(MarkdownConverter, {
      ...defaultConverter,
      ...overrides.converter,
    } as unknown as MarkdownConverter),
    Effect.provideService(Vault, { ...defaultVault, ...overrides.vault } as unknown as Vault),
  );

const sampleLocalMarkdown = (
  frontmatter: Frontmatter,
  body = "Sample body content.",
): Effect.Effect<string> => composeBookmarkFile(frontmatter, body).pipe(Effect.orDie);

// ────────────────────────────────────────────────────────────────────────────────
// Tests — one per state-transition path through `reconcile`.
// ────────────────────────────────────────────────────────────────────────────────

it.effect("Untracked → Created on successful HTTP fetch + extract", () =>
  Effect.gen(function* () {
    const pair: Pair = { hash: sampleRemote.hash.slice(0, 8), remote: sampleRemote };
    const outcome: Outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      fetcher: {
        fetchHttp: () =>
          Effect.succeed({
            html: "<html><body><p>Lots of words.</p></body></html>",
            method: "http",
            finalUrl: sampleRemote.href,
          }),
      },
      extractor: {
        extract: () =>
          Effect.succeed({
            cleanHtml: "<p>Lots of words.</p>",
            metadata: { wordCount: 500 },
          }),
      },
    });
    expect(outcome._tag).toBe("Created");
    if (outcome._tag === "Created") expect(outcome.method).toBe("http");
  }),
);

it.effect("Untracked → Failed when HTTP fetch errors", () =>
  Effect.gen(function* () {
    const pair: Pair = { hash: sampleRemote.hash.slice(0, 8), remote: sampleRemote };
    const outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      fetcher: {
        fetchHttp: () =>
          Effect.fail(
            new FetchError({
              kind: "http_error",
              message: "Server returned 500",
              httpCode: 500,
              url: sampleRemote.href,
            }),
          ),
      },
    });
    expect(outcome._tag).toBe("Failed");
    if (outcome._tag === "Failed") expect(outcome.phase).toBe("create");
  }),
);

it.effect("Orphaned → Deleted", () =>
  pipe(
    withStubs(
      Pair.reconcile(
        { hash: "abc12345", localFilename: "old-bookmark-abc12345.md" },
        baseConfig,
        now,
      ),
    ),
    Effect.tap((outcome) => Effect.sync(() => expect(outcome._tag).toBe("Deleted"))),
  ),
);

it.effect("Paired healthy bookmark → Stable", () =>
  Effect.gen(function* () {
    const content = yield* sampleLocalMarkdown(baseFrontmatter);
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: sampleRemote,
      localFilename: "example-article-5d41402a.md",
    };
    const outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      vault: { readBookmark: () => Effect.succeed(Option.some(content)) },
    });
    expect(outcome._tag).toBe("Stable");
  }),
);

it.effect("Paired/Drifted (Pinboard tags changed) → MetadataRefreshed", () =>
  Effect.gen(function* () {
    const localFm: Frontmatter = { ...baseFrontmatter, tags: ["old-tag"] };
    const content = yield* sampleLocalMarkdown(localFm);
    const driftedRemote: RemoteBookmark = { ...sampleRemote, tags: ["new-tag"] };
    const pair: Pair = {
      hash: driftedRemote.hash.slice(0, 8),
      remote: driftedRemote,
      localFilename: "example-article-5d41402a.md",
    };
    const outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      vault: { readBookmark: () => Effect.succeed(Option.some(content)) },
    });
    expect(outcome._tag).toBe("MetadataRefreshed");
  }),
);

it.effect("Paired/Failing → Recovered when retry succeeds", () =>
  Effect.gen(function* () {
    const failingFm: Frontmatter = {
      ...baseFrontmatter,
      pinmark_fetch_status: "failed",
      pinmark_fetch_attempts: 2,
      pinmark_fetch_error_kind: "http_error",
      pinmark_fetch_error_message: "previous failure",
    };
    const content = yield* sampleLocalMarkdown(failingFm, "");
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: sampleRemote,
      localFilename: "example-article-5d41402a.md",
    };
    const outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      vault: { readBookmark: () => Effect.succeed(Option.some(content)) },
      fetcher: {
        fetchHttp: () =>
          Effect.succeed({
            html: "<p>content this time</p>",
            method: "http",
            finalUrl: sampleRemote.href,
          }),
      },
      extractor: {
        extract: () =>
          Effect.succeed({ cleanHtml: "<p>content</p>", metadata: { wordCount: 500 } }),
      },
    });
    expect(outcome._tag).toBe("Recovered");
    if (outcome._tag === "Recovered") expect(outcome.method).toBe("http");
  }),
);
