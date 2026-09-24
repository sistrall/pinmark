import { Schema } from "effect";

export const FetchStatus = Schema.Literal("success", "failed", "abandoned");
export type FetchStatus = typeof FetchStatus.Type;

export const FetchMethod = Schema.Literal("http", "headless");
export type FetchMethod = typeof FetchMethod.Type;

export const FetchErrorKind = Schema.Literal(
  "http_error",
  "timeout",
  "dns",
  "tls",
  "no_content",
  "paywall",
  "captcha",
  "redirect_loop",
  "unsupported_content",
  "too_large",
);
export type FetchErrorKind = typeof FetchErrorKind.Type;

export const Frontmatter = Schema.Struct({
  url: Schema.String,
  domain: Schema.String,
  pinboard_hash: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),

  title: Schema.String,
  note: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  saved_at: Schema.Date,
  shared: Schema.Boolean,
  to_read: Schema.Boolean,

  page_title: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  published_at: Schema.optional(Schema.Date),
  site_name: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
  cover_image: Schema.optional(Schema.String),
  reading_time: Schema.optional(Schema.Number),
  word_count: Schema.optional(Schema.Number),
  screenshot: Schema.optional(Schema.String),

  pinmark_fetch_status: FetchStatus,
  pinmark_fetch_method: FetchMethod,
  pinmark_fetch_attempts: Schema.Number,
  pinmark_fetched_at: Schema.Date,
  pinmark_version: Schema.String,

  pinmark_fetch_error_kind: Schema.optional(FetchErrorKind),
  pinmark_fetch_error_message: Schema.optional(Schema.String),
  pinmark_fetch_error_http_code: Schema.optional(Schema.Number),
});
export type Frontmatter = typeof Frontmatter.Type;
