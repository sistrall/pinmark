import type { RemoteBookmark } from "../bookmark/types.js";
import { reconcile } from "./reconcile.js";
import {
  classify,
  classifyKind,
  expectedPath,
  from,
  isDrifted,
  isFailing,
  isMissingScreenshot,
  needsMove,
} from "./state.js";
import { sync } from "./sync.js";

// ────────────────────────────────────────────────────────────────────────────────
// Pair — the central entity
//
// The interface and the const namespace are defined in the same module so they
// merge into a single exported `Pair` symbol that callers use as both type and
// namespace:
//
//   import { Pair } from "./pair";
//   const pair: Pair = { hash, remote };           // type
//   const states = pairs.map(Pair.classify);       // operation
//   yield* Pair.reconcile(pair, config, now);      // entry point
//
// The thing we're syncing — a pair of (remote, local) keyed by URL hash. Either
// side can be absent: a Pair with only `remote` is one Pinboard has that we
// haven't captured yet; one with only `localFilename` is an orphan in the vault.
// The local side is referred to by filename only; the parsed LocalBookmark is
// loaded lazily inside `reconcile` to avoid reading every vault file upfront.
// ────────────────────────────────────────────────────────────────────────────────

export interface Pair {
  readonly hash: string;
  readonly remote?: RemoteBookmark;
  readonly localFilename?: string;
}

export const Pair = {
  // Builders
  from,

  // Pure queries
  classify,
  classifyKind,
  isFailing,
  isMissingScreenshot,
  isDrifted,
  expectedPath,
  needsMove,

  // Operations
  reconcile,
  sync,
} as const;

// Re-export the remaining type-level pieces. Outcome's value side (the
// constructor) is also exported so callers can build Outcome values in tests.
export type { ActionPhase, PairedKind, PairState, PipelineResult } from "./types.js";
export { Outcome } from "./types.js";
