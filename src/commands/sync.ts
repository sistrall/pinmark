import { Command, Options } from "@effect/cli";
import { Effect, Match, Option } from "effect";
import type { PinmarkConfig } from "../config.js";
import { loadConfig, requireApiToken } from "../config.js";
import { type ConfigError, toConfigError } from "../errors.js";
import { type Outcome, Pair, type PairState } from "../pair/index.js";
import type { MarkdownConverter } from "../services/converter.js";
import type { Extractor } from "../services/extractor.js";
import type { Fetcher } from "../services/fetcher.js";
import { PinboardClient } from "../services/pinboard.js";
import { State } from "../services/state.js";
import { Vault } from "../services/vault.js";

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────

export interface SyncReport {
  readonly added: number;
  readonly metadataUpdated: number;
  readonly deleted: number;
  readonly retried: number;
  readonly recovered: number;
  readonly abandoned: number;
  readonly backfilled: number;
  readonly moved: number;
  readonly fetchOk: { http: number; headless: number };
  readonly fetchFailed: number;
}

export interface SyncOptions {
  readonly token: string;
  readonly config: PinmarkConfig;
  readonly dryRun: boolean;
}

// ────────────────────────────────────────────────────────────────────────────────
// Report aggregation — fold Outcomes from each Pair into the running SyncReport.
// ────────────────────────────────────────────────────────────────────────────────

const emptyReport = (): SyncReport => ({
  added: 0,
  metadataUpdated: 0,
  deleted: 0,
  retried: 0,
  recovered: 0,
  abandoned: 0,
  backfilled: 0,
  moved: 0,
  fetchOk: { http: 0, headless: 0 },
  fetchFailed: 0,
});

// Compute one outcome's contribution to the running SyncReport totals.
// Exhaustive Match: adding a new Outcome tag fails to compile until handled.
const reportIncrement = Match.type<Outcome>().pipe(
  Match.tag("Created", ({ method }) => ({
    added: 1,
    fetchOk: { http: method === "http" ? 1 : 0, headless: method === "headless" ? 1 : 0 },
  })),
  Match.tag("Recovered", ({ method }) => ({
    recovered: 1,
    retried: 1,
    fetchOk: { http: method === "http" ? 1 : 0, headless: method === "headless" ? 1 : 0 },
  })),
  Match.tag("Failed", ({ phase }) => ({
    fetchFailed: 1,
    ...(phase === "retry" ? { retried: 1 } : {}),
  })),
  Match.tag("Abandoned", ({ phase }) => ({
    abandoned: 1,
    ...(phase === "retry" ? { retried: 1 } : {}),
  })),
  Match.tag("MetadataRefreshed", () => ({ metadataUpdated: 1 })),
  Match.tag("ScreenshotCaptured", () => ({ backfilled: 1 })),
  Match.tag("ScreenshotCaptureFailed", () => ({})),
  Match.tag("Stable", () => ({})),
  Match.tag("Deleted", () => ({ deleted: 1 })),
  Match.tag("Skipped", () => ({})),
  Match.exhaustive,
);

const mergeReport = (acc: SyncReport, inc: Partial<SyncReport>): SyncReport => ({
  added: acc.added + (inc.added ?? 0),
  metadataUpdated: acc.metadataUpdated + (inc.metadataUpdated ?? 0),
  deleted: acc.deleted + (inc.deleted ?? 0),
  retried: acc.retried + (inc.retried ?? 0),
  recovered: acc.recovered + (inc.recovered ?? 0),
  abandoned: acc.abandoned + (inc.abandoned ?? 0),
  backfilled: acc.backfilled + (inc.backfilled ?? 0),
  moved: acc.moved + (inc.moved ?? 0),
  fetchOk: {
    http: acc.fetchOk.http + (inc.fetchOk?.http ?? 0),
    headless: acc.fetchOk.headless + (inc.fetchOk?.headless ?? 0),
  },
  fetchFailed: acc.fetchFailed + (inc.fetchFailed ?? 0),
});

// ────────────────────────────────────────────────────────────────────────────────
// Top-level sync — fetch from Pinboard, build pairs, hand them to Pair.sync,
// fold outcomes into a SyncReport.
// ────────────────────────────────────────────────────────────────────────────────

export const sync = (
  options: SyncOptions,
): Effect.Effect<
  SyncReport,
  ConfigError,
  PinboardClient | Fetcher | Extractor | MarkdownConverter | Vault | State
> =>
  Effect.gen(function* () {
    const pinboard = yield* PinboardClient;
    const vault = yield* Vault;
    const state = yield* State;

    yield* Effect.logInfo(`pinmark sync starting (dry-run=${options.dryRun})`);

    // Skip the whole pipeline if Pinboard hasn't changed since last sync.
    const stored = yield* state.load(options.config.vault).pipe(toConfigError);
    const lastUpdate = Option.match(stored, {
      onNone: () => undefined,
      onSome: (s) => s.lastPinboardUpdate,
    });
    // State written before layouts existed has no `layout`: those vaults are flat.
    const lastLayout = Option.match(stored, {
      onNone: () => undefined,
      onSome: (s) => s.layout ?? "",
    });
    const layoutChanged = lastLayout !== undefined && lastLayout !== options.config.layout;
    const update = yield* pinboard.lastUpdate(options.token).pipe(toConfigError);
    if (
      !layoutChanged &&
      lastUpdate !== undefined &&
      update.update_time.getTime() <= lastUpdate.getTime()
    ) {
      yield* Effect.logInfo("No Pinboard changes since last sync");
      return emptyReport();
    }
    if (layoutChanged) {
      yield* Effect.logInfo(
        `Layout changed from "${lastLayout}" to "${options.config.layout}"; moving notes`,
      );
    }

    // Gather both sides and pair them up.
    const posts = yield* pinboard.allPosts(options.token).pipe(toConfigError);
    yield* vault.ensureRoot(options.config.vault).pipe(toConfigError);
    const filenames = yield* vault.listBookmarkFilenames(options.config.vault).pipe(toConfigError);
    const pairs = Pair.from({ pinboard: posts, vault: filenames });

    // Plan log.
    const counts: Record<PairState["_tag"], number> = { Untracked: 0, Paired: 0, Orphaned: 0 };
    let toMove = 0;
    for (const p of pairs) {
      counts[Pair.classify(p)._tag] += 1;
      if (
        p.remote !== undefined &&
        p.localFilename !== undefined &&
        Pair.needsMove(p.localFilename, p.remote, options.config.layout)
      ) {
        toMove += 1;
      }
    }
    yield* Effect.logInfo(
      `plan: ${counts.Untracked} untracked, ${counts.Paired} paired (${toMove} to move), ${counts.Orphaned} orphaned`,
    );

    if (options.dryRun) {
      return {
        ...emptyReport(),
        added: counts.Untracked,
        metadataUpdated: counts.Paired,
        deleted: counts.Orphaned,
        moved: toMove,
      };
    }

    // Hand the list off to Pair.sync — it owns the concurrency, throttling,
    // and per-pair logging concerns.
    const outcomes = yield* Pair.sync(pairs, options.config);

    yield* state
      .save(options.config.vault, {
        lastPinboardUpdate: update.update_time,
        layout: options.config.layout,
        schemaVersion: 1,
      })
      .pipe(toConfigError);

    // Every paired note in the wrong folder is moved before anything else happens
    // to it, so the plan's count is the number of moves.
    return outcomes.reduce((acc, outcome) => mergeReport(acc, reportIncrement(outcome)), {
      ...emptyReport(),
      moved: toMove,
    });
  });

// ────────────────────────────────────────────────────────────────────────────────
// CLI binding
// ────────────────────────────────────────────────────────────────────────────────

const vaultOption = Options.text("vault").pipe(
  Options.withAlias("v"),
  Options.withDescription("Path to the vault directory (overrides config and env)"),
  Options.optional,
);

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Compute and print what would change without writing"),
);

export const syncCommand = Command.make(
  "sync",
  { vault: vaultOption, dryRun: dryRunOption },
  ({ vault, dryRun }) =>
    Effect.gen(function* () {
      const token = yield* requireApiToken();
      const overrides = Option.match(vault, {
        onNone: () => ({}),
        onSome: (v) => ({ vault: v }),
      });
      const config = yield* loadConfig(overrides);
      const report = yield* sync({ token, config, dryRun });
      yield* Effect.logInfo(
        `sync: ${report.added} new, ${report.metadataUpdated} metadata, ${report.deleted} deleted, ` +
          `${report.retried} retried (${report.recovered} recovered), ` +
          `${report.backfilled} backfilled, ${report.moved} moved; ` +
          `fetch: ${report.fetchOk.http + report.fetchOk.headless} ok (${report.fetchOk.http} http, ${report.fetchOk.headless} headless), ` +
          `${report.fetchFailed} failed, ${report.abandoned} abandoned`,
      );
    }),
);
