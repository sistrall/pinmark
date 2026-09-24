import { describe, expect, it } from "vitest";
import {
  basenameOf,
  bookmarkFilename,
  bookmarkFilenameFromHash,
  dirnameOf,
  hashFromFilename,
  joinVaultPath,
  layoutDir,
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

describe("layoutDir", () => {
  const saved = new Date("2024-03-07T10:00:00Z");

  it("fills year, month and day tokens, zero-padded", () => {
    expect(layoutDir("{yyyy}/{mm}", saved)).toBe("2024/03");
    expect(layoutDir("{yyyy}/{mm}/{dd}", saved)).toBe("2024/03/07");
    expect(layoutDir("archive/{yyyy}", saved)).toBe("archive/2024");
  });

  it("is empty for a flat layout", () => {
    expect(layoutDir("", saved)).toBe("");
  });

  it("uses UTC, not the local timezone", () => {
    expect(layoutDir("{yyyy}/{mm}/{dd}", new Date("2023-12-31T23:30:00Z"))).toBe("2023/12/31");
  });
});

describe("vault paths", () => {
  it("joins, splits and extracts the hash from nested paths", () => {
    expect(joinVaultPath("", "a-12345678.md")).toBe("a-12345678.md");
    expect(joinVaultPath("2024/03", "a-12345678.md")).toBe("2024/03/a-12345678.md");
    expect(dirnameOf("2024/03/a-12345678.md")).toBe("2024/03");
    expect(dirnameOf("a-12345678.md")).toBe("");
    expect(basenameOf("2024/03/a-12345678.md")).toBe("a-12345678.md");
    expect(hashFromFilename("2024/03/a-12345678.md")).toBe("12345678");
  });
});
