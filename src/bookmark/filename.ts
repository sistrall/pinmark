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

// Folder for a bookmark under a `layout` pattern such as "{yyyy}/{mm}". Dates are
// taken in UTC so the folder doesn't depend on the machine running the sync. An
// empty layout means flat: every note in the vault root.
export const layoutDir = (layout: string, savedAt: Date): string =>
  layout
    .replaceAll("{yyyy}", String(savedAt.getUTCFullYear()))
    .replaceAll("{mm}", String(savedAt.getUTCMonth() + 1).padStart(2, "0"))
    .replaceAll("{dd}", String(savedAt.getUTCDate()).padStart(2, "0"));

// Vault-relative paths always use "/" so they compare equal across platforms.
export const joinVaultPath = (dir: string, filename: string): string =>
  dir === "" ? filename : `${dir}/${filename}`;

export const dirnameOf = (vaultPath: string): string => {
  const i = vaultPath.lastIndexOf("/");
  return i === -1 ? "" : vaultPath.slice(0, i);
};

export const basenameOf = (vaultPath: string): string =>
  vaultPath.slice(vaultPath.lastIndexOf("/") + 1);

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
