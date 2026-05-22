#!/usr/bin/env tsx
// Emits a JSON Schema for PinmarkConfig so editors can autocomplete + validate
// `.pinmark.config.json` files. Run via `npm run schema`. The output is strict
// (`additionalProperties: false`) on purpose: typos in config keys should surface
// as IDE errors. Side effect of strictness: editors flag the meta `$schema`
// property at the top of config files as "not allowed". That's a known and
// accepted tradeoff — silencing it would require either relaxing strictness or
// hand-tweaking the generated schema. We've chosen the IDE friction over either.
import { mkdirSync, writeFileSync } from "node:fs";
import { JSONSchema } from "effect";
import { PinmarkConfig } from "../src/config.js";

const schema = JSONSchema.make(PinmarkConfig);

mkdirSync("schema", { recursive: true });
const target = "schema/config.schema.json";
writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`Wrote ${target}`);
