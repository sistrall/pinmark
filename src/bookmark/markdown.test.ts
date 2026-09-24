import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Frontmatter } from "../schemas/frontmatter.js";
import { composeBookmarkFile, parseBookmarkFile } from "./markdown.js";

const sampleFrontmatter: Frontmatter = {
  url: "https://example.com/article",
  domain: "example.com",
  pinboard_hash: "5d41402abc4b2a76b9719d911017c592",
  title: "Example Article",
  tags: ["programming", "rust"],
  saved_at: new Date("2026-05-20T14:32:00.000Z"),
  shared: false,
  to_read: false,
  pinmark_fetch_status: "success",
  pinmark_fetch_method: "http",
  pinmark_fetch_attempts: 1,
  pinmark_fetched_at: new Date("2026-05-20T14:35:12.000Z"),
  pinmark_version: "0.0.0",
};

describe("composeBookmarkFile / parseBookmarkFile", () => {
  it("emits frontmatter delimiters and body", async () => {
    const out = await Effect.runPromise(composeBookmarkFile(sampleFrontmatter, "Hello body."));
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toMatch(/\n---\n(?!-)/);
    expect(out).toContain("Hello body.");
  });

  it("round-trips a complete frontmatter", async () => {
    const composed = await Effect.runPromise(
      composeBookmarkFile(sampleFrontmatter, "Body content here."),
    );
    const parsed = await Effect.runPromise(parseBookmarkFile(composed));
    expect(parsed.frontmatter.url).toBe(sampleFrontmatter.url);
    expect(parsed.frontmatter.title).toBe(sampleFrontmatter.title);
    expect(parsed.frontmatter.tags).toEqual(["programming", "rust"]);
    expect(parsed.frontmatter.shared).toBe(false);
    expect(parsed.frontmatter.saved_at.getTime()).toBe(sampleFrontmatter.saved_at.getTime());
    expect(parsed.body).toBe("Body content here.");
  });

  it("preserves optional fields when present", async () => {
    const fm: Frontmatter = {
      ...sampleFrontmatter,
      note: "My note",
      author: "Jane Doe",
      site_name: "Example",
      word_count: 1234,
      reading_time: 7,
    };
    const composed = await Effect.runPromise(composeBookmarkFile(fm, ""));
    const parsed = await Effect.runPromise(parseBookmarkFile(composed));
    expect(parsed.frontmatter.note).toBe("My note");
    expect(parsed.frontmatter.author).toBe("Jane Doe");
    expect(parsed.frontmatter.word_count).toBe(1234);
    expect(parsed.frontmatter.reading_time).toBe(7);
  });

  it("rejects content without a frontmatter block", async () => {
    const result = await Effect.runPromiseExit(parseBookmarkFile("plain markdown\n"));
    expect(result._tag).toBe("Failure");
  });

  // gray-matter caches by content and returns cache hits without the
  // non-enumerable `matter` field, so a second identical note used to crash.
  it("parses the same content twice", async () => {
    const composed = await Effect.runPromise(composeBookmarkFile(sampleFrontmatter, "Same."));
    const first = await Effect.runPromise(parseBookmarkFile(composed));
    const second = await Effect.runPromise(parseBookmarkFile(composed));
    expect(second).toEqual(first);
  });
});
