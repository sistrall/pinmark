import { Data } from "effect";
import type { RemoteBookmark } from "../bookmark/types.js";

// ────────────────────────────────────────────────────────────────────────────────
// PairState — three top-level states a Pair can be in at sync time
//   Untracked — Pinboard has it, the vault does not.
//   Paired    — both sides exist (sub-classification happens lazily).
//   Orphaned  — vault has it, Pinboard does not.
// Constructed via PairState.Untracked({...}) etc.; never hand-written `_tag` literals.
// ────────────────────────────────────────────────────────────────────────────────

export type PairState = Data.TaggedEnum<{
  Untracked: { readonly remote: RemoteBookmark };
  Paired: { readonly remote: RemoteBookmark; readonly localFilename: string };
  Orphaned: { readonly localFilename: string };
}>;
export const PairState = Data.taggedEnum<PairState>();

// What kind of Paired bookmark is this? Decided by inspecting local frontmatter.
export type PairedKind = "Failing" | "MissingScreenshot" | "Drifted" | "Healthy";

// ────────────────────────────────────────────────────────────────────────────────
// Outcome — the state transition that happened to one Pair during sync.
// reconcile produces one Outcome per pair; SyncReport aggregates them.
// ────────────────────────────────────────────────────────────────────────────────

// "create" = first attempt for an Untracked pair.
// "retry"  = the pair was Failing and we're trying again.
// Carried in Failed/Abandoned so the aggregator can distinguish first-time vs
// retry failures when computing the `retried` counter.
export type ActionPhase = "create" | "retry";

// biome-ignore lint/complexity/noBannedTypes: Data.TaggedEnum requires `{}` for empty payloads
type Empty = {};
export type Outcome = Data.TaggedEnum<{
  Created: { readonly method: "http" | "headless" };
  Recovered: { readonly method: "http" | "headless" };
  Failed: { readonly phase: ActionPhase };
  Abandoned: { readonly phase: ActionPhase };
  MetadataRefreshed: Empty;
  ScreenshotCaptured: Empty;
  ScreenshotCaptureFailed: Empty;
  Stable: Empty;
  Deleted: Empty;
  Skipped: Empty;
}>;
export const Outcome = Data.taggedEnum<Outcome>();

// ────────────────────────────────────────────────────────────────────────────────
// Internal types used by reconcile's implementation. Exported so state.ts and
// reconcile.ts can share without inlining.
// ────────────────────────────────────────────────────────────────────────────────

// What the shared fetch pipeline produces, before the caller tags it as an
// outcome (Created vs Recovered vs Failed depend on the phase).
export interface PipelineResult {
  readonly status: "success" | "failed" | "abandoned";
  readonly method?: "http" | "headless";
}

export type ProcessMode = "http-first" | "screenshot-always";

// Re-export the two halves of a Pair so callers can `import { ... } from "../pair/types.js"`
// and get everything in one place.
export type { LocalBookmark, RemoteBookmark } from "../bookmark/types.js";
