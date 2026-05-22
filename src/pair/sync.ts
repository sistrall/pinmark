import { Effect, pipe } from "effect";
import { domainOf } from "../bookmark/filename.js";
import type { PinmarkConfig } from "../config.js";
import type { MarkdownConverter } from "../services/converter.js";
import type { Extractor } from "../services/extractor.js";
import type { Fetcher } from "../services/fetcher.js";
import type { Vault } from "../services/vault.js";
import type { Pair } from "./index.js";
import { reconcile } from "./reconcile.js";
import type { Outcome } from "./types.js";

// Reconcile every pair in the list. The orchestration concerns — concurrency,
// per-host throttling, structured log annotations — live here so callers just
// hand over the list of pairs and the config.
//
// Returns the Outcome of each pair, in the same order. Aggregation into a
// SyncReport is the caller's responsibility.
export const sync = (
  pairs: ReadonlyArray<Pair>,
  config: PinmarkConfig,
  now: Date = new Date(),
): Effect.Effect<ReadonlyArray<Outcome>, never, Fetcher | Extractor | MarkdownConverter | Vault> =>
  Effect.gen(function* () {
    // Per-host semaphores so concurrent fetches to the same domain cap at
    // config.fetch.perHostConcurrency. Cross-domain work parallelizes freely.
    const allHosts = new Set<string>();
    for (const p of pairs) {
      if (p.remote !== undefined) allHosts.add(domainOf(p.remote.href));
    }
    const hostSemaphores = new Map<string, Effect.Semaphore>();
    for (const host of allHosts) {
      hostSemaphores.set(host, yield* Effect.makeSemaphore(config.fetch.perHostConcurrency));
    }
    const withHostPermit = <A, E, R>(
      url: string,
      eff: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> => {
      const sem = hostSemaphores.get(domainOf(url));
      return sem === undefined ? eff : sem.withPermits(1)(eff);
    };

    // Each pair gets one reconcile call wrapped with log annotations so every
    // log line inside carries its url or filename without inlining it in the
    // message.
    return yield* Effect.forEach(
      pairs,
      (pair) => {
        const annotations =
          pair.remote !== undefined
            ? { url: pair.remote.href }
            : { filename: pair.localFilename ?? "" };
        const work = pipe(
          Effect.gen(function* () {
            yield* Effect.logInfo("start");
            return yield* reconcile(pair, config, now);
          }),
          Effect.annotateLogs(annotations),
        );
        return pair.remote !== undefined ? withHostPermit(pair.remote.href, work) : work;
      },
      { concurrency: config.fetch.concurrency },
    );
  });
