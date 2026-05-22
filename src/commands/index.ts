import { Command } from "@effect/cli";
import { syncCommand } from "./sync.js";

export const pinmark = Command.make("pinmark").pipe(
  Command.withDescription("Mirror Pinboard bookmarks into an Obsidian vault"),
  Command.withSubcommands([syncCommand]),
);
