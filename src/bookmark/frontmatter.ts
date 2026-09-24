import type { Frontmatter } from "../schemas/frontmatter.js";
import type { PinboardPost } from "../schemas/pinboard.js";
import type { ExtractedMetadata } from "../services/extractor.js";
import type { FetchResult } from "../services/fetcher.js";
import { PINMARK_VERSION } from "../version.js";
import { domainOf } from "./filename.js";
import { cleanTitle } from "./title.js";

const baseFields = (
  post: PinboardPost,
): Pick<
  Frontmatter,
  "url" | "domain" | "pinboard_hash" | "title" | "tags" | "saved_at" | "shared" | "to_read"
> => ({
  url: post.href,
  domain: domainOf(post.href),
  pinboard_hash: post.hash,
  title: cleanTitle(post.description),
  tags: post.tags,
  saved_at: post.time,
  shared: post.shared,
  to_read: post.toread,
});

const noteFields = (post: PinboardPost): Pick<Frontmatter, "note"> | Record<string, never> =>
  post.extended.trim().length > 0 ? { note: post.extended } : {};

const extractedFields = (meta: ExtractedMetadata): Partial<Frontmatter> => ({
  ...(meta.pageTitle !== undefined ? { page_title: meta.pageTitle } : {}),
  ...(meta.author !== undefined ? { author: meta.author } : {}),
  ...(meta.publishedAt !== undefined ? { published_at: meta.publishedAt } : {}),
  ...(meta.siteName !== undefined ? { site_name: meta.siteName } : {}),
  ...(meta.excerpt !== undefined ? { excerpt: meta.excerpt } : {}),
  ...(meta.language !== undefined ? { language: meta.language } : {}),
  ...(meta.coverImage !== undefined ? { cover_image: meta.coverImage } : {}),
  ...(meta.readingTime !== undefined ? { reading_time: meta.readingTime } : {}),
  ...(meta.wordCount !== undefined ? { word_count: meta.wordCount } : {}),
});

export const buildAddedFrontmatter = (
  post: PinboardPost,
  fetched: FetchResult,
  meta: ExtractedMetadata,
  now: Date,
  screenshotName: string | undefined,
  attempts: number,
): Frontmatter => {
  const cleanedTitle = cleanTitle(post.description);
  const aliases =
    meta.pageTitle !== undefined && meta.pageTitle !== cleanedTitle ? [meta.pageTitle] : undefined;
  return {
    ...baseFields(post),
    ...(aliases !== undefined ? { aliases } : {}),
    ...noteFields(post),
    ...extractedFields(meta),
    ...(screenshotName !== undefined ? { screenshot: screenshotName } : {}),
    pinmark_fetch_status: "success",
    pinmark_fetch_method: fetched.method,
    pinmark_fetch_attempts: attempts,
    pinmark_fetched_at: now,
    pinmark_version: PINMARK_VERSION,
  };
};

export const buildFailedFrontmatter = (
  post: PinboardPost,
  now: Date,
  errorKind: Frontmatter["pinmark_fetch_error_kind"],
  errorMessage: string,
  httpCode: number | undefined,
  attempts: number,
  maxAttempts: number,
  permanent = false,
): Frontmatter => ({
  ...baseFields(post),
  ...noteFields(post),
  pinmark_fetch_status: permanent || attempts >= maxAttempts ? "abandoned" : "failed",
  pinmark_fetch_method: "http",
  pinmark_fetch_attempts: attempts,
  pinmark_fetched_at: now,
  pinmark_version: PINMARK_VERSION,
  ...(errorKind !== undefined ? { pinmark_fetch_error_kind: errorKind } : {}),
  pinmark_fetch_error_message: errorMessage,
  ...(httpCode !== undefined ? { pinmark_fetch_error_http_code: httpCode } : {}),
});

// Preserve all extraction-time fields (page_title, author, …, screenshot, pinmark_*)
// while refreshing only the Pinboard-sourced ones. `note` is dropped when the user
// cleared their Pinboard extended note.
export const refreshPinboardFields = (existing: Frontmatter, post: PinboardPost): Frontmatter => {
  const { note: _, ...withoutNote } = existing;
  return {
    ...withoutNote,
    title: cleanTitle(post.description),
    ...noteFields(post),
    tags: post.tags,
    saved_at: post.time,
    shared: post.shared,
    to_read: post.toread,
  };
};

const tagsEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((tag, i) => tag === b[i]);

export const pinboardFieldsDiffer = (existing: Frontmatter, post: PinboardPost): boolean =>
  existing.title !== cleanTitle(post.description) ||
  (existing.note ?? "") !== (post.extended.trim().length > 0 ? post.extended : "") ||
  !tagsEqual(existing.tags, post.tags) ||
  existing.saved_at.getTime() !== post.time.getTime() ||
  existing.shared !== post.shared ||
  existing.to_read !== post.toread;
