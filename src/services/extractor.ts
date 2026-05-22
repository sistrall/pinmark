import type { DefuddleResponse } from "defuddle/full";
import { Defuddle } from "defuddle/node";
import { Effect } from "effect";
import { JSDOM, VirtualConsole } from "jsdom";
import { ExtractionError } from "../errors.js";

const SILENCED_CONSOLE_ERROR_PREFIXES = ["Defuddle: Error parsing schema.org data:"];

let consoleFilterInstalled = false;
const installConsoleFilter = (): void => {
  if (consoleFilterInstalled) return;
  consoleFilterInstalled = true;
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    const first = args[0];
    if (
      typeof first === "string" &&
      SILENCED_CONSOLE_ERROR_PREFIXES.some((p) => first.startsWith(p))
    ) {
      return;
    }
    original.apply(console, args);
  };
};

const makeSilentVirtualConsole = (): VirtualConsole => {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  return vc;
};

export interface ExtractedMetadata {
  readonly pageTitle?: string;
  readonly author?: string;
  readonly publishedAt?: Date;
  readonly siteName?: string;
  readonly excerpt?: string;
  readonly language?: string;
  readonly coverImage?: string;
  readonly readingTime?: number;
  readonly wordCount?: number;
}

export interface ExtractedContent {
  readonly cleanHtml: string;
  readonly metadata: ExtractedMetadata;
}

const presentString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parsedDate = (value: unknown): Date | undefined => {
  const str = presentString(value);
  if (!str) return undefined;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? ({} as Partial<Record<K, V>>) : ({ [key]: value } as Partial<Record<K, V>>);

const mapDefuddleResult = (result: DefuddleResponse): ExtractedContent => {
  const wordCount =
    typeof result.wordCount === "number" && result.wordCount > 0 ? result.wordCount : undefined;
  return {
    cleanHtml: typeof result.content === "string" ? result.content : "",
    metadata: {
      ...opt("pageTitle", presentString(result.title)),
      ...opt("author", presentString(result.author)),
      ...opt("publishedAt", parsedDate(result.published)),
      ...opt("siteName", presentString(result.site)),
      ...opt("excerpt", presentString(result.description)),
      ...opt("language", presentString(result.language)),
      ...opt("coverImage", presentString(result.image)),
      ...opt("wordCount", wordCount),
      ...opt(
        "readingTime",
        wordCount !== undefined ? Math.max(1, Math.ceil(wordCount / 200)) : undefined,
      ),
    },
  };
};

export class Extractor extends Effect.Service<Extractor>()("Extractor", {
  effect: Effect.gen(function* () {
    installConsoleFilter();

    const extract = (html: string, url: string): Effect.Effect<ExtractedContent, ExtractionError> =>
      Effect.tryPromise({
        try: async () => {
          const dom = new JSDOM(html, { url, virtualConsole: makeSilentVirtualConsole() });
          const result = await Defuddle(dom.window.document, url, {});
          return mapDefuddleResult(result);
        },
        catch: (cause) =>
          new ExtractionError({
            message: `Defuddle extraction failed: ${String(cause)}`,
            url,
            cause,
          }),
      });

    return { extract } as const;
  }),
  dependencies: [],
}) {}
