import { it } from "@effect/vitest";
import { Effect, Option, pipe } from "effect";
import { expect } from "vitest";
import { composeBookmarkFile } from "../bookmark/markdown.js";
import type { RemoteBookmark } from "../bookmark/types.js";
import type { PinmarkConfig } from "../config.js";
import { ExtractionError, FetchError } from "../errors.js";
import { type Outcome, Pair } from "../pair/index.js";
import type { Frontmatter } from "../schemas/frontmatter.js";
import { MarkdownConverter } from "../services/converter.js";
import { Extractor } from "../services/extractor.js";
import { Fetcher } from "../services/fetcher.js";
import { PinboardClient } from "../services/pinboard.js";
import { State } from "../services/state.js";
import { Vault } from "../services/vault.js";
import { sync } from "./sync.js";

// ────────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────────

const baseConfig: PinmarkConfig = {
  vault: "./test-vault",
  layout: "",
  fetch: {
    concurrency: 1,
    perHostConcurrency: 1,
    timeoutMs: 30_000,
    maxBodyBytes: 5_000_000,
    userAgent: "pinmark-test/1.0",
  },
  extraction: { minWordCount: 100, timeoutMs: 30_000, headlessAllowlist: [] },
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
  fetchHttp: (_url: string, _ua: string, _t: number, _max: number) => die("fetchHttp"),
  fetchHeadless: (
    _url: string,
    _ua: string,
    _t: number,
    _screenshot?: import("../services/fetcher.js").ScreenshotOptions,
  ) => die("fetchHeadless"),
};

const defaultExtractor = {
  extract: (_html: string, _url: string, _t: number) => die("extract"),
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
  moveFile: (_root: string, _from: string, _to: string) => Effect.void,
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

// Captures the last file written through the vault stub so tests can assert on
// the frontmatter a failure leaves behind.
const capturingVault = () => {
  const written: { content?: string } = {};
  return {
    written,
    vault: {
      writeBookmark: (_root: string, _filename: string, content: string) =>
        Effect.sync(() => {
          written.content = content;
        }),
    },
  };
};

it.effect("Untracked → Abandoned at once when the URL serves a non-HTML content type", () =>
  Effect.gen(function* () {
    const pair: Pair = { hash: sampleRemote.hash.slice(0, 8), remote: sampleRemote };
    const { written, vault } = capturingVault();
    const outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      vault,
      fetcher: {
        fetchHttp: () =>
          Effect.fail(
            new FetchError({
              kind: "unsupported_content",
              message: "Unsupported content type: application/pdf",
              url: sampleRemote.href,
            }),
          ),
      },
    });
    expect(outcome._tag).toBe("Abandoned");
    expect(written.content).toContain("pinmark_fetch_status: abandoned");
    expect(written.content).toContain("pinmark_fetch_attempts: 1");
    expect(written.content).toContain("pinmark_fetch_error_kind: unsupported_content");
  }),
);

it.effect("Untracked → Abandoned without extracting when headless HTML exceeds the size cap", () =>
  Effect.gen(function* () {
    const screenshotConfig: PinmarkConfig = {
      ...baseConfig,
      fetch: { ...baseConfig.fetch, maxBodyBytes: 10 },
      screenshot: { ...baseConfig.screenshot, enabled: true },
    };
    const pair: Pair = { hash: sampleRemote.hash.slice(0, 8), remote: sampleRemote };
    const outcome = yield* withStubs(Pair.reconcile(pair, screenshotConfig, now), {
      fetcher: {
        fetchHeadless: () =>
          Effect.succeed({
            html: "<p>well over ten bytes of html</p>",
            method: "headless",
            finalUrl: sampleRemote.href,
          }),
      },
      // defaultExtractor dies if called, which is the assertion.
    });
    expect(outcome._tag).toBe("Abandoned");
  }),
);

it.effect("Untracked → Failed with kind timeout when extraction times out", () =>
  Effect.gen(function* () {
    const pair: Pair = { hash: sampleRemote.hash.slice(0, 8), remote: sampleRemote };
    const { written, vault } = capturingVault();
    const outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      vault,
      fetcher: {
        fetchHttp: () =>
          Effect.succeed({ html: "<p>x</p>", method: "http", finalUrl: sampleRemote.href }),
      },
      extractor: {
        extract: () =>
          Effect.fail(
            new ExtractionError({
              message: "Extraction exceeded 30000ms",
              url: sampleRemote.href,
              timedOut: true,
            }),
          ),
      },
    });
    expect(outcome._tag).toBe("Failed");
    expect(written.content).toContain("pinmark_fetch_status: failed");
    expect(written.content).toContain("pinmark_fetch_error_kind: timeout");
  }),
);

// ────────────────────────────────────────────────────────────────────────────────
// Layout — notes live in dated folders and move when they're in the wrong one.
// ────────────────────────────────────────────────────────────────────────────────

const datedConfig: PinmarkConfig = { ...baseConfig, layout: "{yyyy}/{mm}" };

// Records every vault write and move so tests can assert on paths.
const recordingVault = (content: string) => {
  const moves: Array<[string, string]> = [];
  const writes: string[] = [];
  return {
    moves,
    writes,
    vault: {
      readBookmark: () => Effect.succeed(Option.some(content)),
      moveFile: (_root: string, from: string, to: string) =>
        Effect.sync(() => {
          moves.push([from, to]);
        }),
      writeBookmark: (_root: string, filename: string) =>
        Effect.sync(() => {
          writes.push(filename);
        }),
    },
  };
};

it.effect("Paired healthy note in the wrong folder is moved with its screenshot", () =>
  Effect.gen(function* () {
    const content = yield* sampleLocalMarkdown(baseFrontmatter);
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: sampleRemote,
      localFilename: "example-article-5d41402a.md",
    };
    const { moves, writes, vault } = recordingVault(content);
    const outcome = yield* withStubs(Pair.reconcile(pair, datedConfig, now), { vault });
    expect(outcome._tag).toBe("Stable");
    // Screenshot first, so an interrupted run redoes both moves next time.
    expect(moves).toEqual([
      ["example-article-5d41402a.png", "2026/01/example-article-5d41402a.png"],
      ["example-article-5d41402a.md", "2026/01/example-article-5d41402a.md"],
    ]);
    expect(writes).toEqual([]);
  }),
);

it.effect("Paired note already in place → Stable, nothing moved", () =>
  Effect.gen(function* () {
    const content = yield* sampleLocalMarkdown(baseFrontmatter);
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: sampleRemote,
      localFilename: "2026/01/example-article-5d41402a.md",
    };
    const { moves, vault } = recordingVault(content);
    const outcome = yield* withStubs(Pair.reconcile(pair, datedConfig, now), { vault });
    expect(outcome._tag).toBe("Stable");
    expect(moves).toEqual([]);
  }),
);

it.effect("Paired note moves back to the root when the layout goes flat", () =>
  Effect.gen(function* () {
    const { screenshot: _, ...noScreenshot } = baseFrontmatter;
    const content = yield* sampleLocalMarkdown(noScreenshot);
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: sampleRemote,
      localFilename: "2026/01/example-article-5d41402a.md",
    };
    const { moves, vault } = recordingVault(content);
    const outcome = yield* withStubs(Pair.reconcile(pair, baseConfig, now), { vault });
    expect(outcome._tag).toBe("Stable");
    expect(moves).toEqual([["2026/01/example-article-5d41402a.md", "example-article-5d41402a.md"]]);
  }),
);

it.effect("Paired note with broken frontmatter still moves, then is skipped", () =>
  Effect.gen(function* () {
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: sampleRemote,
      localFilename: "example-article-5d41402a.md",
    };
    const { moves, vault } = recordingVault("no frontmatter here");
    const outcome = yield* withStubs(Pair.reconcile(pair, datedConfig, now), { vault });
    expect(outcome._tag).toBe("Skipped");
    expect(moves).toEqual([["example-article-5d41402a.md", "2026/01/example-article-5d41402a.md"]]);
  }),
);

it.effect("Paired drifted note in the wrong folder → moved, then refreshed at the new path", () =>
  Effect.gen(function* () {
    const content = yield* sampleLocalMarkdown({ ...baseFrontmatter, tags: ["old-tag"] });
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: sampleRemote,
      localFilename: "example-article-5d41402a.md",
    };
    const { moves, writes, vault } = recordingVault(content);
    const outcome = yield* withStubs(Pair.reconcile(pair, datedConfig, now), { vault });
    expect(outcome._tag).toBe("MetadataRefreshed");
    expect(moves.map(([, to]) => to)).toContain("2026/01/example-article-5d41402a.md");
    expect(writes).toEqual(["2026/01/example-article-5d41402a.md"]);
  }),
);

it.effect("Untracked bookmark is created in its dated folder", () =>
  Effect.gen(function* () {
    const pair: Pair = { hash: sampleRemote.hash.slice(0, 8), remote: sampleRemote };
    const { writes, vault } = recordingVault("");
    const outcome = yield* withStubs(Pair.reconcile(pair, datedConfig, now), {
      vault,
      fetcher: {
        fetchHttp: () =>
          Effect.succeed({ html: "<p>x</p>", method: "http", finalUrl: sampleRemote.href }),
      },
      extractor: {
        extract: () => Effect.succeed({ cleanHtml: "<p>x</p>", metadata: { wordCount: 500 } }),
      },
    });
    expect(outcome._tag).toBe("Created");
    expect(writes).toEqual(["2026/01/example-article-5d41402a.md"]);
  }),
);

it.effect("Retry writes to the existing note even after a Pinboard title change", () =>
  Effect.gen(function* () {
    const failingFm: Frontmatter = {
      ...baseFrontmatter,
      pinmark_fetch_status: "failed",
      pinmark_fetch_attempts: 1,
      pinmark_fetch_error_kind: "timeout",
      pinmark_fetch_error_message: "previous failure",
    };
    const content = yield* sampleLocalMarkdown(failingFm, "");
    const renamed: RemoteBookmark = { ...sampleRemote, description: "A brand new title" };
    const pair: Pair = {
      hash: sampleRemote.hash.slice(0, 8),
      remote: renamed,
      localFilename: "example-article-5d41402a.md",
    };
    const { writes, vault } = recordingVault(content);
    yield* withStubs(Pair.reconcile(pair, baseConfig, now), {
      vault,
      fetcher: {
        fetchHttp: () =>
          Effect.succeed({ html: "<p>x</p>", method: "http", finalUrl: sampleRemote.href }),
      },
      extractor: {
        extract: () => Effect.succeed({ cleanHtml: "<p>x</p>", metadata: { wordCount: 500 } }),
      },
    });
    expect(writes).toEqual(["example-article-5d41402a.md"]);
  }),
);

it("needsMove / expectedPath follow saved_at in UTC", () => {
  const lateNewYearsEve: RemoteBookmark = {
    ...sampleRemote,
    time: new Date("2025-12-31T23:30:00Z"),
  };
  expect(Pair.expectedPath("a-12345678.md", lateNewYearsEve, "{yyyy}/{mm}")).toBe(
    "2025/12/a-12345678.md",
  );
  expect(Pair.needsMove("2025/12/a-12345678.md", lateNewYearsEve, "{yyyy}/{mm}")).toBe(false);
  expect(Pair.needsMove("a-12345678.md", lateNewYearsEve, "{yyyy}/{mm}")).toBe(true);
  expect(Pair.needsMove("a-12345678.md", lateNewYearsEve, "")).toBe(false);
});

// ────────────────────────────────────────────────────────────────────────────────
// sync command — the early "no Pinboard changes" exit and layout changes.
// ────────────────────────────────────────────────────────────────────────────────

const runSync = (config: PinmarkConfig, stored: { lastPinboardUpdate: Date; layout?: string }) => {
  const saved: Array<{ layout?: string }> = [];
  let fetchedAll = false;
  const content = sampleLocalMarkdown(baseFrontmatter);
  const eff = Effect.gen(function* () {
    const note = yield* content;
    const withRemoteState = sync({ token: "t", config, dryRun: false }).pipe(
      Effect.provideService(PinboardClient, {
        // Pinboard hasn't changed since the stored sync.
        lastUpdate: () => Effect.succeed({ update_time: stored.lastPinboardUpdate }),
        allPosts: () =>
          Effect.sync(() => {
            fetchedAll = true;
            return [sampleRemote];
          }),
      } as unknown as PinboardClient),
      Effect.provideService(State, {
        load: () => Effect.succeed(Option.some({ schemaVersion: 1, ...stored })),
        save: (_root: string, s: { layout?: string }) =>
          Effect.sync(() => {
            saved.push(s);
          }),
      } as unknown as State),
    );
    return yield* withStubs(withRemoteState, {
      vault: {
        listBookmarkFilenames: () => Effect.succeed(["example-article-5d41402a.md"]),
        readBookmark: () => Effect.succeed(Option.some(note)),
      },
    });
  });
  return eff.pipe(Effect.map((report) => ({ report, saved, fetchedAll: () => fetchedAll })));
};

it.effect("skips the sync when neither Pinboard nor the layout changed", () =>
  Effect.gen(function* () {
    const { report, saved, fetchedAll } = yield* runSync(datedConfig, {
      lastPinboardUpdate: now,
      layout: "{yyyy}/{mm}",
    });
    expect(fetchedAll()).toBe(false);
    expect(report.moved).toBe(0);
    expect(saved).toEqual([]);
  }),
);

it.effect("runs a full pass when the layout changed, and records the new layout", () =>
  Effect.gen(function* () {
    // State written before layouts existed: no `layout`, i.e. flat.
    const { report, saved, fetchedAll } = yield* runSync(datedConfig, { lastPinboardUpdate: now });
    expect(fetchedAll()).toBe(true);
    expect(report.moved).toBe(1);
    expect(saved[0]?.layout).toBe("{yyyy}/{mm}");
  }),
);

it.effect("treats state without a layout as flat, so flat vaults aren't re-synced", () =>
  Effect.gen(function* () {
    const { fetchedAll } = yield* runSync(baseConfig, { lastPinboardUpdate: now });
    expect(fetchedAll()).toBe(false);
  }),
);
