import { Effect } from "effect";
import TurndownService from "turndown";

export class MarkdownConverter extends Effect.Service<MarkdownConverter>()("MarkdownConverter", {
  effect: Effect.gen(function* () {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "_",
    });

    const convert = (html: string): Effect.Effect<string, never> =>
      Effect.sync(() => td.turndown(html));

    return { convert } as const;
  }),
  dependencies: [],
}) {}
