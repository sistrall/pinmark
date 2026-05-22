import { describe, expect, it } from "vitest";
import {
  bookmarkFilename,
  bookmarkFilenameFromHash,
  hashFromFilename,
  slugify,
  urlHash,
} from "./filename.js";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses non-alphanumerics", () => {
    expect(slugify("Hello,  World! / Foo")).toBe("hello-world-foo");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--Foo--Bar--")).toBe("foo-bar");
  });

  it("falls back to 'untitled' when empty", () => {
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });

  it("truncates to maxLength without trailing hyphen", () => {
    const result = slugify("foo bar baz qux quux corge grault", 12);
    expect(result.length).toBeLessThanOrEqual(12);
    expect(result.endsWith("-")).toBe(false);
  });
});

describe("urlHash", () => {
  it("matches Pinboard's URL md5 algorithm", () => {
    expect(urlHash("https://www.example.com/")).toMatch(/^[a-f0-9]{32}$/);
  });

  it("is deterministic", () => {
    const url = "https://example.com/foo";
    expect(urlHash(url)).toBe(urlHash(url));
  });
});

describe("bookmarkFilename / bookmarkFilenameFromHash", () => {
  it("composes slug + 8-char hash + .md", () => {
    const fn = bookmarkFilename("Hello World", "https://example.com/foo");
    expect(fn).toMatch(/^hello-world-[a-f0-9]{8}\.md$/);
  });

  it("accepts a precomputed hash", () => {
    const fn = bookmarkFilenameFromHash("Hello", "5d41402abc4b2a76b9719d911017c592");
    expect(fn).toBe("hello-5d41402a.md");
  });
});

describe("hashFromFilename", () => {
  it("extracts the 8-char short hash", () => {
    expect(hashFromFilename("my-article-5d41402a.md")).toBe("5d41402a");
  });

  it("returns undefined for non-matching names", () => {
    expect(hashFromFilename("README.md")).toBeUndefined();
    expect(hashFromFilename("foo-bar.md")).toBeUndefined();
  });
});
