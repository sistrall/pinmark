// Worker-thread entry that does the CPU-heavy, synchronous part of a sync:
// parsing HTML with JSDOM, extracting the article with Defuddle, and converting
// it to markdown with Turndown. Running it off the main thread means a
// pathological page can be killed on a timer instead of freezing the process.
//
// Constraints: this file is loaded directly by Node in dev and tests (type
// stripping), so it must use erasable TypeScript only and import packages, not
// relative modules.
import { parentPort } from "node:worker_threads";
import { Defuddle } from "defuddle/node";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";

export type ContentJob =
  | { readonly op: "extract"; readonly html: string; readonly url: string }
  | { readonly op: "convert"; readonly html: string };

// The subset of Defuddle's response the main thread maps into metadata. Picked
// explicitly so the reply is always structured-cloneable.
export interface RawExtraction {
  readonly content: unknown;
  readonly title: unknown;
  readonly author: unknown;
  readonly published: unknown;
  readonly site: unknown;
  readonly description: unknown;
  readonly language: unknown;
  readonly image: unknown;
  readonly wordCount: unknown;
}

export type ContentReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

const SILENCED_CONSOLE_ERROR_PREFIXES = ["Defuddle: Error parsing schema.org data:"];

const originalConsoleError = console.error;
console.error = (...args: unknown[]): void => {
  const first = args[0];
  if (
    typeof first === "string" &&
    SILENCED_CONSOLE_ERROR_PREFIXES.some((p) => first.startsWith(p))
  ) {
    return;
  }
  originalConsoleError.apply(console, args);
};

const makeSilentVirtualConsole = (): VirtualConsole => {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  return vc;
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});

const extract = async (html: string, url: string): Promise<RawExtraction> => {
  const dom = new JSDOM(html, { url, virtualConsole: makeSilentVirtualConsole() });
  try {
    const r = await Defuddle(dom.window.document, url, {});
    return {
      content: r.content,
      title: r.title,
      author: r.author,
      published: r.published,
      site: r.site,
      description: r.description,
      language: r.language,
      image: r.image,
      wordCount: r.wordCount,
    };
  } finally {
    dom.window.close();
  }
};

const run = (job: ContentJob): Promise<unknown> | unknown =>
  job.op === "extract" ? extract(job.html, job.url) : turndown.turndown(job.html);

parentPort?.on("message", async (msg: { readonly id: number; readonly job: ContentJob }) => {
  let reply: ContentReply;
  try {
    reply = { id: msg.id, ok: true, value: await run(msg.job) };
  } catch (cause) {
    reply = { id: msg.id, ok: false, error: String(cause) };
  }
  parentPort?.postMessage(reply);
});
