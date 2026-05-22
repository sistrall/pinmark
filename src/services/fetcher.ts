import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Duration, Effect } from "effect";
import { type Browser, chromium } from "playwright-core";
import { FetchError } from "../errors.js";

export interface ScreenshotOptions {
  readonly viewportWidth: number;
  readonly format: "png" | "jpeg";
  readonly jpegQuality?: number;
}

export interface FetchResult {
  readonly html: string;
  readonly method: "http" | "headless";
  readonly finalUrl: string;
  readonly screenshot?: Buffer;
}

// Best-effort settle budget after the initial `commit`. Each wait stage is upper-bounded
// and SWALLOWED on timeout — we always proceed with whatever we have. This avoids hanging
// on render-blocking resources or persistent background activity (analytics, websockets,
// hot-reload pings) that keep load/networkidle from ever firing.
const SETTLE_DOMCONTENTLOADED_MS = 10_000;
const SETTLE_LOAD_MS = 5_000;
const SETTLE_NETWORKIDLE_MS = 3_000;
// Safety multiplier for the overall fetchHeadless deadline. The internal page.goto +
// settle waits + screenshot all have their own bounds, but a stuck browser/page/context
// op can still hang — this cap ensures no single bookmark can wedge the sync forever.
const HEADLESS_SAFETY_BUDGET_MULTIPLIER = 3;

// CSS that hides common cookie/consent banners and unlocks body scroll. Injected via
// page.addInitScript so it lands before banner JS executes — the banner element gets
// added to the DOM but never paints.
const COOKIE_BANNER_CSS = `
/* Well-known banner libraries (precise IDs/classes) */
#onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter,
#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay,
.qc-cmp2-container, .qc-cmp2-ui, #qc-cmp2-main,
#hs-eu-cookie-confirmation,
.truste-banner, #truste-consent-track, .truste_box_overlay,
.cc-window, .cc-banner, .cc-overlay,
.cmp-banner, #cmpwrapper, #cmpbox,
.iubenda-cs-container, .iubenda-cs-overlay,
.didomi-popup-container, .didomi-popup-backdrop, #didomi-host,
.osano-cm-window, .osano-cm-dialog,
.eu-cookie-compliance-popup,
#sp_message_container_1, .sp_veil,
/* Compound class/id patterns — narrow enough to avoid "cookie recipe" false positives */
[id*="cookie-banner" i], [class*="cookie-banner" i],
[id*="cookie-consent" i], [class*="cookie-consent" i],
[id*="cookie-notice" i], [class*="cookie-notice" i],
[id*="cookie-bar" i], [class*="cookie-bar" i],
[id*="cookie-policy-banner" i], [class*="cookie-policy-banner" i],
[id*="gdpr-consent" i], [class*="gdpr-consent" i],
[id*="gdpr-banner" i], [class*="gdpr-banner" i],
[id*="privacy-banner" i], [class*="privacy-banner" i],
[id*="consent-banner" i], [class*="consent-banner" i],
[aria-label*="cookie consent" i], [aria-label*="cookie banner" i],
[aria-label*="privacy notice" i] {
  display: none !important;
  visibility: hidden !important;
}
/* Some banner scripts lock scroll until consent is given — undo that */
html, body {
  overflow: auto !important;
  overflow-x: hidden !important;
  position: static !important;
}
body {
  padding-right: 0 !important;
}
`.trim();

const mapPlaywrightError = (url: string, cause: unknown): FetchError => {
  const err = cause as { name?: string; message?: string };
  const message = err.message ?? String(cause);
  const isTimeout = err.name === "TimeoutError" || /timeout/i.test(message);
  return new FetchError({
    kind: isTimeout ? "timeout" : "http_error",
    message,
    url,
  });
};

export class Fetcher extends Effect.Service<Fetcher>()("Fetcher", {
  effect: Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    let browserPromise: Promise<Browser> | null = null;
    const getBrowser = (): Promise<Browser> => {
      if (!browserPromise) browserPromise = chromium.launch({ headless: true });
      return browserPromise;
    };

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        if (browserPromise === null) return;
        try {
          const b = await browserPromise;
          await b.close();
        } catch {
          // Browser may already be closed/crashed; ignore.
        }
      }),
    );

    const fetchHttp = (
      url: string,
      userAgent: string,
      timeoutMs: number,
    ): Effect.Effect<FetchResult, FetchError> =>
      Effect.gen(function* () {
        const req = HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("User-Agent", userAgent),
        );
        const res = yield* http.execute(req).pipe(
          Effect.timeoutFail({
            duration: Duration.millis(timeoutMs),
            onTimeout: () =>
              new FetchError({
                kind: "timeout",
                message: `HTTP fetch exceeded ${timeoutMs}ms`,
                url,
              }),
          }),
          Effect.mapError((cause) =>
            cause instanceof FetchError
              ? cause
              : new FetchError({
                  kind: "http_error",
                  message: `Request failed: ${String(cause)}`,
                  url,
                }),
          ),
        );
        if (res.status >= 400) {
          return yield* Effect.fail(
            new FetchError({
              kind: "http_error",
              httpCode: res.status,
              message: `HTTP ${res.status}`,
              url,
            }),
          );
        }
        const body = yield* res.text.pipe(
          Effect.timeoutFail({
            duration: Duration.millis(timeoutMs),
            onTimeout: () =>
              new FetchError({
                kind: "timeout",
                message: `Reading response body exceeded ${timeoutMs}ms`,
                url,
              }),
          }),
          Effect.mapError((cause) =>
            cause instanceof FetchError
              ? cause
              : new FetchError({
                  kind: "http_error",
                  message: `Failed to read response body: ${String(cause)}`,
                  url,
                }),
          ),
        );
        return { html: body, method: "http" as const, finalUrl: url };
      });

    const fetchHeadless = (
      url: string,
      userAgent: string,
      timeoutMs: number,
      screenshot?: ScreenshotOptions,
    ): Effect.Effect<FetchResult, FetchError> =>
      Effect.tryPromise({
        try: async () => {
          const browser = await getBrowser();
          const context = await browser.newContext({
            userAgent,
            viewport: screenshot ? { width: screenshot.viewportWidth, height: 800 } : null,
          });
          const page = await context.newPage();
          await page.addInitScript((css: string) => {
            const inject = (): void => {
              if (document.getElementById("__pinmark_banner_hide__")) return;
              const style = document.createElement("style");
              style.id = "__pinmark_banner_hide__";
              style.textContent = css;
              (document.head ?? document.documentElement).appendChild(style);
            };
            try {
              inject();
            } catch {
              // documentElement not ready yet
            }
            document.addEventListener("DOMContentLoaded", inject);
          }, COOKIE_BANNER_CSS);
          try {
            await page.goto(url, {
              waitUntil: "commit",
              timeout: timeoutMs,
            });
            await page
              .waitForLoadState("domcontentloaded", {
                timeout: SETTLE_DOMCONTENTLOADED_MS,
              })
              .catch(() => undefined);
            await page.waitForLoadState("load", { timeout: SETTLE_LOAD_MS }).catch(() => undefined);
            await page
              .waitForLoadState("networkidle", {
                timeout: SETTLE_NETWORKIDLE_MS,
              })
              .catch(() => undefined);
            const html = await page.content();
            let shotBuf: Buffer | undefined;
            if (screenshot) {
              shotBuf = await page.screenshot({
                fullPage: true,
                type: screenshot.format,
                timeout: timeoutMs,
                ...(screenshot.format === "jpeg" ? { quality: screenshot.jpegQuality ?? 75 } : {}),
              });
            }
            return {
              html,
              method: "headless" as const,
              finalUrl: page.url(),
              ...(shotBuf !== undefined ? { screenshot: shotBuf } : {}),
            };
          } finally {
            await context.close();
          }
        },
        catch: (cause) => mapPlaywrightError(url, cause),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(timeoutMs * HEADLESS_SAFETY_BUDGET_MULTIPLIER),
          onTimeout: () =>
            new FetchError({
              kind: "timeout",
              message: `Headless fetch exceeded ${timeoutMs * HEADLESS_SAFETY_BUDGET_MULTIPLIER}ms safety budget`,
              url,
            }),
        }),
        Effect.tapError((err) =>
          /Executable doesn't exist|playwright install/i.test(err.message)
            ? Effect.dieMessage(
                "Playwright Chromium is not installed. Run:\n" +
                  "  ./node_modules/.bin/playwright-core install chromium\n" +
                  "(or `npx playwright install chromium` in environments with the full `playwright` package).",
              )
            : Effect.void,
        ),
      );

    return { fetchHttp, fetchHeadless } as const;
  }),
  dependencies: [],
}) {}
