import { createHash } from "node:crypto";

export const urlHash = (url: string): string => createHash("md5").update(url).digest("hex");

export const shortHash = (hash: string): string => hash.slice(0, 8);

export const slugify = (input: string, maxLength = 60): string => {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length === 0) return "untitled";
  return base.length > maxLength ? base.slice(0, maxLength).replace(/-+$/, "") : base;
};

export const bookmarkFilenameFromHash = (title: string, urlMd5: string): string =>
  `${slugify(title)}-${shortHash(urlMd5)}.md`;

export const bookmarkFilename = (title: string, url: string): string =>
  bookmarkFilenameFromHash(title, urlHash(url));

export const hashFromFilename = (filename: string): string | undefined => {
  const m = filename.match(/-([a-f0-9]{8})\.md$/);
  return m?.[1];
};

export const screenshotFilename = (bookmarkFilename: string, format: "png" | "jpeg"): string =>
  bookmarkFilename.replace(/\.md$/, format === "png" ? ".png" : ".jpg");

export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const matchesAnyDomainSuffix = (host: string, suffixes: readonly string[]): boolean =>
  suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
