import { Effect, Match, Option, pipe } from "effect";
import {
  bookmarkFilenameFromHash,
  domainOf,
  matchesAnyDomainSuffix,
  screenshotFilename,
} from "../bookmark/filename.js";
import {
  buildAddedFrontmatter,
  buildFailedFrontmatter,
  refreshPinboardFields,
} from "../bookmark/frontmatter.js";
import { composeBookmarkFile, parseBookmarkFile } from "../bookmark/markdown.js";
import { looksLikeSpa } from "../bookmark/spa-markers.js";
import { cleanTitle } from "../bookmark/title.js";
import type { LocalBookmark, RemoteBookmark } from "../bookmark/types.js";
import type { PinmarkConfig } from "../config.js";
import {
  type ExtractionError,
  type FetchError,
  type FetchErrorKind,
  InsufficientContentError,
} from "../errors.js";
import type { Frontmatter } from "../schemas/frontmatter.js";
import { MarkdownConverter } from "../services/converter.js";
import { type ExtractedContent, Extractor } from "../services/extractor.js";
import { Fetcher, type FetchResult, type ScreenshotOptions } from "../services/fetcher.js";
import { Vault } from "../services/vault.js";
import type { Pair } from "./index.js";
import { classify, classifyKind } from "./state.js";
import { type ActionPhase, Outcome, type PipelineResult, type ProcessMode } from "./types.js";

// ────────────────────────────────────────────────────────────────────────────────
// PairContext — per-pair processing context threaded through tryCreate's helpers.
// ────────────────────────────────────────────────────────────────────────────────

interface PairContext {
  readonly post: RemoteBookmark;
  readonly filename: string;
  readonly now: Date;
  readonly attempts: number;
  readonly config: PinmarkConfig;
  readonly phase: ActionPhase;
}

// ────────────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ────────────────────────────────────────────────────────────────────────────────

const filenameFor = (post: RemoteBookmark): string =>
  bookmarkFilenameFromHash(cleanTitle(post.description), post.hash);

const buildScreenshotOpts = (config: PinmarkConfig): ScreenshotOptions => ({
  viewportWidth: config.screenshot.viewportWidth,
  format: config.screenshot.format,
  ...(config.screenshot.format === "jpeg" ? { jpegQuality: config.screenshot.jpegQuality } : {}),
});

const useScreenshotFor = (url: string, config: PinmarkConfig): boolean =>
  config.screenshot.enabled &&
  !matchesAnyDomainSuffix(domainOf(url), config.screenshot.skipDomains);

const modeFor = (url: string, config: PinmarkConfig): ProcessMode =>
  useScreenshotFor(url, config) ? "screenshot-always" : "http-first";

// ────────────────────────────────────────────────────────────────────────────────
// Failure adapters — translate each tagged error to the shape writeFailure needs.
// Lets the catchTags block stay one line per error type.
// ────────────────────────────────────────────────────────────────────────────────

interface FailureDetails {
  readonly kind: FetchErrorKind;
  readonly message: string;
  readonly httpCode?: number;
  readonly logDetail: string;
}

const failureFromFetch = (err: FetchError): FailureDetails => ({
  kind: err.kind,
  message: err.message,
  ...(err.httpCode !== undefined ? { httpCode: err.httpCode } : {}),
  logDetail: `${err.kind}${err.httpCode !== undefined ? ` ${err.httpCode}` : ""}`,
});

const failureFromExtraction = (err: ExtractionError): FailureDetails => ({
  kind: "no_content",
  message: err.message,
  logDetail: "extraction",
});

const failureFromInsufficientContent = (err: InsufficientContentError): FailureDetails => ({
  kind: "no_content",
  message: err.message,
  logDetail: `no_content (${err.wordCount} words${err.kind === "escalation_failed" ? ", headless tried" : ""})`,
});

// ────────────────────────────────────────────────────────────────────────────────
// Write helpers — the single point where bookmark files / screenshots get persisted.
// ────────────────────────────────────────────────────────────────────────────────

const writeFailure = (
  ctx: PairContext,
  details: FailureDetails,
): Effect.Effect<PipelineResult, never, Vault> =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const maxAttempts = ctx.config.retry.maxAttempts;
    const isAbandoned = ctx.attempts >= maxAttempts;
    const fm = buildFailedFrontmatter(
      ctx.post,
      ctx.now,
      details.kind,
      details.message,
      details.httpCode,
      ctx.attempts,
      maxAttempts,
    );
    const file = yield* composeBookmarkFile(fm, "").pipe(Effect.orDie);
    yield* vault.writeBookmark(ctx.config.vault, ctx.filename, file).pipe(Effect.orDie);
    yield* Effect.logInfo(
      `${ctx.phase} — ${isAbandoned ? "abandoned" : "failed"}: ${details.logDetail} (attempt ${ctx.attempts}/${maxAttempts})`,
    );
    return { status: isAbandoned ? ("abandoned" as const) : ("failed" as const) };
  });

const writeSuccess = (
  ctx: PairContext,
  fetched: FetchResult,
  extracted: ExtractedContent,
): Effect.Effect<PipelineResult, never, MarkdownConverter | Vault> =>
  Effect.gen(function* () {
    const converter = yield* MarkdownConverter;
    const vault = yield* Vault;

    let screenshotName: string | undefined;
    if (fetched.screenshot !== undefined) {
      screenshotName = screenshotFilename(ctx.filename, ctx.config.screenshot.format);
      yield* vault
        .writeScreenshot(ctx.config.vault, screenshotName, fetched.screenshot)
        .pipe(Effect.orDie);
    }

    const body = yield* converter.convert(extracted.cleanHtml);
    const fm = buildAddedFrontmatter(
      ctx.post,
      fetched,
      extracted.metadata,
      ctx.now,
      screenshotName,
      ctx.attempts,
    );
    const file = yield* composeBookmarkFile(fm, body).pipe(Effect.orDie);
    yield* vault.writeBookmark(ctx.config.vault, ctx.filename, file).pipe(Effect.orDie);

    const wordCount = extracted.metadata.wordCount ?? 0;
    yield* Effect.logInfo(
      `${ctx.phase} — ok (${fetched.method}${screenshotName !== undefined ? "+screenshot" : ""}, ${wordCount} words)`,
    );
    return { status: "success" as const, method: fetched.method };
  });

// ────────────────────────────────────────────────────────────────────────────────
// Pipeline stages — each is small, typed, and fails with one specific tagged error.
// ────────────────────────────────────────────────────────────────────────────────

const initialFetch = (
  mode: ProcessMode,
  post: RemoteBookmark,
  config: PinmarkConfig,
): Effect.Effect<FetchResult, FetchError, Fetcher> =>
  Effect.gen(function* () {
    const fetcher = yield* Fetcher;
    return yield* mode === "http-first"
      ? fetcher.fetchHttp(post.href, config.fetch.userAgent, config.fetch.timeoutMs)
      : fetcher.fetchHeadless(
          post.href,
          config.fetch.userAgent,
          config.fetch.timeoutMs,
          buildScreenshotOpts(config),
        );
  });

const extractContent = (
  fetched: FetchResult,
  url: string,
): Effect.Effect<
  { fetched: FetchResult; extracted: ExtractedContent },
  ExtractionError,
  Extractor
> =>
  Effect.gen(function* () {
    const extractor = yield* Extractor;
    const extracted = yield* extractor.extract(fetched.html, url);
    return { fetched, extracted };
  });

const insufficientContent = (
  post: RemoteBookmark,
  config: PinmarkConfig,
  wordCount: number,
  kind: "below_threshold" | "escalation_failed",
): InsufficientContentError =>
  new InsufficientContentError({
    kind,
    wordCount,
    threshold: config.extraction.minWordCount,
    url: post.href,
    message:
      kind === "below_threshold"
        ? `Defuddle extracted ${wordCount} words, below threshold ${config.extraction.minWordCount}`
        : `Defuddle extracted ${wordCount} words, below threshold ${config.extraction.minWordCount} (headless escalation also insufficient)`,
  });

// For http-first mode: if extraction is below threshold, decide whether to
// escalate to headless and attempt it. Either succeeds with a usable pair or
// fails with InsufficientContentError (escalation errors get folded in).
const finalizeWithEscalation = (
  post: RemoteBookmark,
  config: PinmarkConfig,
  httpFetched: FetchResult,
  httpExtracted: ExtractedContent,
): Effect.Effect<
  { fetched: FetchResult; extracted: ExtractedContent },
  InsufficientContentError,
  Fetcher | Extractor
> =>
  Effect.gen(function* () {
    const wordCount = httpExtracted.metadata.wordCount ?? 0;
    if (wordCount >= config.extraction.minWordCount) {
      return { fetched: httpFetched, extracted: httpExtracted };
    }

    const empty = wordCount === 0;
    const inAllowlist = config.extraction.headlessAllowlist.includes(domainOf(post.href));
    const spaDetected = !empty && looksLikeSpa(httpFetched.html);
    const shouldEscalate = empty || spaDetected || inAllowlist;

    if (!shouldEscalate) {
      return yield* Effect.fail(insufficientContent(post, config, wordCount, "below_threshold"));
    }

    const fetcher = yield* Fetcher;
    return yield* pipe(
      fetcher.fetchHeadless(post.href, config.fetch.userAgent, config.fetch.timeoutMs),
      Effect.flatMap((headless) => extractContent(headless, post.href)),
      Effect.flatMap(({ fetched, extracted }) =>
        (extracted.metadata.wordCount ?? 0) >= config.extraction.minWordCount
          ? Effect.succeed({ fetched, extracted })
          : Effect.fail(insufficientContent(post, config, wordCount, "escalation_failed")),
      ),
      Effect.catchTags({
        FetchError: () =>
          Effect.fail(insufficientContent(post, config, wordCount, "escalation_failed")),
        ExtractionError: () =>
          Effect.fail(insufficientContent(post, config, wordCount, "escalation_failed")),
      }),
    );
  });

// ────────────────────────────────────────────────────────────────────────────────
// Transitions — the work each state requires to converge.
// ────────────────────────────────────────────────────────────────────────────────

// Tag a pipeline result as the appropriate Outcome based on phase.
const outcomeFromResult = (r: PipelineResult, phase: ActionPhase): Outcome =>
  r.status === "success"
    ? phase === "create"
      ? Outcome.Created({ method: r.method ?? "http" })
      : Outcome.Recovered({ method: r.method ?? "http" })
    : r.status === "abandoned"
      ? Outcome.Abandoned({ phase })
      : Outcome.Failed({ phase });

// Fetch + extract + write a bookmark file (the create/retry pipeline). Errors at
// any stage land in catchTags and become a failure stub.
const tryCreate = (
  remote: RemoteBookmark,
  config: PinmarkConfig,
  now: Date,
  attempts: number,
  phase: ActionPhase,
): Effect.Effect<Outcome, never, Fetcher | Extractor | MarkdownConverter | Vault> => {
  const ctx: PairContext = {
    post: remote,
    filename: filenameFor(remote),
    now,
    attempts,
    config,
    phase,
  };
  const mode = modeFor(remote.href, config);
  return pipe(
    initialFetch(mode, remote, config),
    Effect.flatMap((fetched) => extractContent(fetched, remote.href)),
    Effect.flatMap(({ fetched, extracted }) =>
      mode === "http-first"
        ? finalizeWithEscalation(remote, config, fetched, extracted)
        : Effect.succeed({ fetched, extracted }),
    ),
    Effect.flatMap(({ fetched, extracted }) => writeSuccess(ctx, fetched, extracted)),
    Effect.catchTags({
      FetchError: (err) => writeFailure(ctx, failureFromFetch(err)),
      ExtractionError: (err) => writeFailure(ctx, failureFromExtraction(err)),
      InsufficientContentError: (err) => writeFailure(ctx, failureFromInsufficientContent(err)),
    }),
    Effect.map((r) => outcomeFromResult(r, phase)),
  );
};

const captureScreenshot = (
  remote: RemoteBookmark,
  local: LocalBookmark,
  config: PinmarkConfig,
): Effect.Effect<Outcome, never, Fetcher | Vault> =>
  pipe(
    Effect.gen(function* () {
      const fetcher = yield* Fetcher;
      const vault = yield* Vault;

      const fetched = yield* fetcher.fetchHeadless(
        remote.href,
        config.fetch.userAgent,
        config.fetch.timeoutMs,
        buildScreenshotOpts(config),
      );

      if (fetched.screenshot === undefined) {
        yield* Effect.logInfo("backfill — failed: no screenshot returned");
        return Outcome.ScreenshotCaptureFailed();
      }

      const screenshotName = screenshotFilename(local.filename, config.screenshot.format);
      yield* vault
        .writeScreenshot(config.vault, screenshotName, fetched.screenshot)
        .pipe(Effect.orDie);

      const updatedFm: Frontmatter = {
        ...refreshPinboardFields(local.frontmatter, remote),
        screenshot: screenshotName,
      };
      const fileOut = yield* composeBookmarkFile(updatedFm, local.body).pipe(Effect.orDie);
      yield* vault.writeBookmark(config.vault, local.filename, fileOut).pipe(Effect.orDie);
      yield* Effect.logInfo("backfill — screenshot captured");
      return Outcome.ScreenshotCaptured();
    }),
    Effect.catchTag("FetchError", (err) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `backfill — failed: ${err.kind}${err.httpCode !== undefined ? ` ${err.httpCode}` : ""}`,
        );
        return Outcome.ScreenshotCaptureFailed();
      }),
    ),
  );

const refreshMetadata = (
  remote: RemoteBookmark,
  local: LocalBookmark,
  config: PinmarkConfig,
): Effect.Effect<Outcome, never, Vault> =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const newFm = refreshPinboardFields(local.frontmatter, remote);
    const fileOut = yield* composeBookmarkFile(newFm, local.body).pipe(Effect.orDie);
    yield* vault.writeBookmark(config.vault, local.filename, fileOut).pipe(Effect.orDie);
    yield* Effect.logInfo("update — metadata refreshed");
    return Outcome.MetadataRefreshed();
  });

const deleteEntry = (
  filename: string,
  config: PinmarkConfig,
): Effect.Effect<Outcome, never, Vault> =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    yield* vault.deleteBookmark(config.vault, filename).pipe(Effect.orDie);
    yield* Effect.logInfo("delete");
    return Outcome.Deleted();
  });

// ────────────────────────────────────────────────────────────────────────────────
// Reconcile — drive one Pair to its converged state.
// ────────────────────────────────────────────────────────────────────────────────

// Load + parse a vault file into a LocalBookmark, collapsing both I/O failure
// and file-missing into Option.none.
const loadLocal = (
  filename: string,
  config: PinmarkConfig,
): Effect.Effect<Option.Option<LocalBookmark>, never, Vault> =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const maybeContent = yield* vault.readBookmark(config.vault, filename).pipe(
      Effect.flatMap((opt) =>
        Option.isSome(opt) ? Effect.succeed(opt.value) : Effect.fail("missing" as const),
      ),
      Effect.option,
    );
    if (Option.isNone(maybeContent)) return Option.none<LocalBookmark>();
    const maybeParsed = yield* parseBookmarkFile(maybeContent.value).pipe(Effect.option);
    if (Option.isNone(maybeParsed)) return Option.none<LocalBookmark>();
    return Option.some({
      filename,
      frontmatter: maybeParsed.value.frontmatter,
      body: maybeParsed.value.body,
    });
  });

// For a Paired bookmark: load the local, sub-classify by its frontmatter, and
// pick the appropriate transition.
const reconcilePaired = (
  remote: RemoteBookmark,
  filename: string,
  config: PinmarkConfig,
  now: Date,
): Effect.Effect<Outcome, never, Fetcher | Extractor | MarkdownConverter | Vault> =>
  Effect.gen(function* () {
    const localOpt = yield* loadLocal(filename, config);
    if (Option.isNone(localOpt)) return Outcome.Skipped();
    const local = localOpt.value;

    const kind = classifyKind(
      local,
      remote,
      config.retry.maxAttempts,
      useScreenshotFor(remote.href, config),
    );

    return yield* Match.value(kind).pipe(
      Match.when("Failing", () =>
        tryCreate(remote, config, now, local.frontmatter.pinmark_fetch_attempts + 1, "retry"),
      ),
      Match.when("MissingScreenshot", () => captureScreenshot(remote, local, config)),
      Match.when("Drifted", () => refreshMetadata(remote, local, config)),
      Match.when("Healthy", () => Effect.succeed(Outcome.Stable())),
      Match.exhaustive,
    );
  });

// Reconcile a single Pair to its converged state. The pair's top-level state
// determines the verb: Untracked → create, Paired → sub-classify + dispatch,
// Orphaned → delete.
export const reconcile = (
  pair: Pair,
  config: PinmarkConfig,
  now: Date,
): Effect.Effect<Outcome, never, Fetcher | Extractor | MarkdownConverter | Vault> =>
  Match.value(classify(pair)).pipe(
    Match.tag("Untracked", ({ remote }) => tryCreate(remote, config, now, 1, "create")),
    Match.tag("Paired", ({ remote, localFilename }) =>
      reconcilePaired(remote, localFilename, config, now),
    ),
    Match.tag("Orphaned", ({ localFilename }) => deleteEntry(localFilename, config)),
    Match.exhaustive,
  );
