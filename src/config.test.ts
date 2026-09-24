import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Layout } from "./config.js";

const accepts = (s: string): boolean => Schema.is(Layout)(s);

describe("layout", () => {
  it.each([
    "",
    "{yyyy}",
    "{yyyy}/{mm}",
    "{yyyy}/{mm}/{dd}",
    "notes/{yyyy}",
    "y{yyyy}-m{mm}",
  ])("accepts %j", (s) => expect(accepts(s)).toBe(true));

  it.each([
    "/{yyyy}",
    "{yyyy}/",
    "{yyyy}//{mm}",
    "../{yyyy}",
    "..",
    "{yy}",
    "{yyyy} {mm}",
    "a\\b",
  ])("rejects %j", (s) => expect(accepts(s)).toBe(false));
});
