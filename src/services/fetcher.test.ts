import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { FetchHttpClient } from "@effect/platform";
import { Effect, Either } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Fetcher, isExtractableContentType } from "./fetcher.js";

const MAX = 1_000;

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case "/page":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<p>hello</p>");
        return;
      case "/no-type":
        res.end("<p>untyped</p>");
        return;
      case "/doc.pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF-1.4 ...");
        return;
      case "/big-declared":
        res.writeHead(200, { "content-type": "text/html", "content-length": String(MAX * 10) });
        res.end("x".repeat(MAX * 10));
        return;
      case "/big-chunked":
        // No Content-Length: only the streaming cap can catch this.
        res.writeHead(200, { "content-type": "text/html" });
        for (let i = 0; i < 20; i++) res.write("y".repeat(MAX / 2));
        res.end();
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const fetchHttp = (path: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fetcher = yield* Fetcher;
      return yield* Effect.either(fetcher.fetchHttp(`${base}${path}`, "pinmark-test", 5_000, MAX));
    }).pipe(Effect.provide(Fetcher.Default), Effect.provide(FetchHttpClient.layer), Effect.scoped),
  );

describe("fetchHttp", () => {
  it("returns HTML bodies", async () => {
    const r = await fetchHttp("/page");
    expect(Either.getOrThrow(r).html).toBe("<p>hello</p>");
  });

  it("allows responses without a content type", async () => {
    const r = await fetchHttp("/no-type");
    expect(Either.getOrThrow(r).html).toBe("<p>untyped</p>");
  });

  it("rejects non-HTML content types", async () => {
    const r = await fetchHttp("/doc.pdf");
    expect(Either.isLeft(r) && r.left.kind).toBe("unsupported_content");
  });

  it("rejects a declared Content-Length over the cap", async () => {
    const r = await fetchHttp("/big-declared");
    expect(Either.isLeft(r) && r.left.kind).toBe("too_large");
  });

  it("cuts off a streamed body once it passes the cap", async () => {
    const r = await fetchHttp("/big-chunked");
    expect(Either.isLeft(r) && r.left.kind).toBe("too_large");
  });
});

describe("isExtractableContentType", () => {
  it.each([
    ["text/html", true],
    ["text/html; charset=utf-8", true],
    ["TEXT/HTML", true],
    ["application/xhtml+xml", true],
    ["text/plain", true],
    [undefined, true],
    ["", true],
    ["application/pdf", false],
    ["image/png", false],
    ["application/octet-stream", false],
    ["video/mp4", false],
    ["text/htmlx-evil/extra", false],
  ])("%s → %s", (type, expected) => {
    expect(isExtractableContentType(type)).toBe(expected);
  });
});
