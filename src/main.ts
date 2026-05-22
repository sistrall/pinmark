#!/usr/bin/env node
import { Command } from "@effect/cli";
import { FetchHttpClient } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Logger } from "effect";
import { pinmark } from "./commands/index.js";
import { MarkdownConverter } from "./services/converter.js";
import { Extractor } from "./services/extractor.js";
import { Fetcher } from "./services/fetcher.js";
import { PinboardClient } from "./services/pinboard.js";
import { State } from "./services/state.js";
import { Vault } from "./services/vault.js";
import { PINMARK_VERSION } from "./version.js";

const ServicesLayer = Layer.mergeAll(
  PinboardClient.Default,
  Fetcher.Default,
  Extractor.Default,
  MarkdownConverter.Default,
  Vault.Default,
  State.Default,
);

const BaseLayer = Layer.mergeAll(NodeContext.layer, FetchHttpClient.layer);

const AppLayer = Layer.mergeAll(ServicesLayer.pipe(Layer.provideMerge(BaseLayer)), Logger.pretty);

const cli = Command.run(pinmark, {
  name: "pinmark",
  version: PINMARK_VERSION,
});

cli(process.argv).pipe(Effect.provide(AppLayer), Effect.scoped, NodeRuntime.runMain);
