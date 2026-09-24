import { basenameOf, hashFromFilename, joinVaultPath, layoutDir } from "../bookmark/filename.js";
import { pinboardFieldsDiffer } from "../bookmark/frontmatter.js";
import type { LocalBookmark, RemoteBookmark } from "../bookmark/types.js";
import type { Pair } from "./index.js";
import { type PairedKind, PairState } from "./types.js";

// Build the unified pair list by joining the two sides on the short URL hash.
// `pinboard` is the remote bookmarks; `vault` is the vault filenames. Hashes
// appearing on only one side yield single-sided pairs.
export const from = (input: {
  readonly pinboard: Iterable<RemoteBookmark>;
  readonly vault: Iterable<string>;
}): Pair[] => {
  const remoteByHash = new Map<string, RemoteBookmark>();
  for (const r of input.pinboard) remoteByHash.set(r.hash.slice(0, 8), r);

  const localByHash = new Map<string, string>();
  for (const filename of input.vault) {
    const h = hashFromFilename(filename);
    if (h !== undefined) localByHash.set(h, filename);
  }

  const allHashes = new Set<string>([...remoteByHash.keys(), ...localByHash.keys()]);
  const pairs: Pair[] = [];
  for (const hash of allHashes) {
    const remote = remoteByHash.get(hash);
    const localFilename = localByHash.get(hash);
    pairs.push({
      hash,
      ...(remote !== undefined ? { remote } : {}),
      ...(localFilename !== undefined ? { localFilename } : {}),
    });
  }
  return pairs;
};

// Classify a Pair into its top-level state. Throws only on the "neither side"
// case, which is impossible if the Pair was built via `list`.
export const classify = (p: Pair): PairState => {
  if (p.remote !== undefined && p.localFilename !== undefined) {
    return PairState.Paired({ remote: p.remote, localFilename: p.localFilename });
  }
  if (p.remote !== undefined) {
    return PairState.Untracked({ remote: p.remote });
  }
  if (p.localFilename !== undefined) {
    return PairState.Orphaned({ localFilename: p.localFilename });
  }
  throw new Error(`Pair ${p.hash} has neither remote nor local — should be unreachable`);
};

// ────────────────────────────────────────────────────────────────────────────────
// Paired sub-classification — answer "what kind of paired bookmark is this?"
// ────────────────────────────────────────────────────────────────────────────────

export const isFailing = (local: LocalBookmark, maxAttempts: number): boolean =>
  local.frontmatter.pinmark_fetch_status === "failed" &&
  local.frontmatter.pinmark_fetch_attempts < maxAttempts;

export const isMissingScreenshot = (local: LocalBookmark, useScreenshot: boolean): boolean =>
  local.frontmatter.pinmark_fetch_status === "success" &&
  useScreenshot &&
  local.frontmatter.screenshot === undefined;

export const isDrifted = (local: LocalBookmark, remote: RemoteBookmark): boolean =>
  pinboardFieldsDiffer(local.frontmatter, remote);

export const classifyKind = (
  local: LocalBookmark,
  remote: RemoteBookmark,
  maxAttempts: number,
  useScreenshot: boolean,
): PairedKind => {
  if (isFailing(local, maxAttempts)) return "Failing";
  if (isMissingScreenshot(local, useScreenshot)) return "MissingScreenshot";
  if (isDrifted(local, remote)) return "Drifted";
  return "Healthy";
};

// ────────────────────────────────────────────────────────────────────────────────
// Layout — where a paired note should live. The filename is kept as is (it may
// predate a Pinboard title change); only the folder follows the layout.
// ────────────────────────────────────────────────────────────────────────────────

export const expectedPath = (localPath: string, remote: RemoteBookmark, layout: string): string =>
  joinVaultPath(layoutDir(layout, remote.time), basenameOf(localPath));

export const needsMove = (localPath: string, remote: RemoteBookmark, layout: string): boolean =>
  expectedPath(localPath, remote, layout) !== localPath;
