import { describe, expect, it } from "vitest";
import { cleanTitle } from "./title.js";

describe("cleanTitle", () => {
  it("trims surrounding whitespace", () => {
    expect(cleanTitle("  Hello  ")).toBe("Hello");
  });

  it("collapses internal whitespace", () => {
    expect(cleanTitle("Hello   World\t\nthere")).toBe("Hello World there");
  });

  it("is a no-op for already-clean titles", () => {
    expect(cleanTitle("Hello World")).toBe("Hello World");
  });
});
