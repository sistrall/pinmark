import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { RawExtraction } from "../content-worker.js";
import { makeContentPool, WorkerTimeoutError } from "./content-pool.js";

const ARTICLE = `<html><head><title>Test article</title></head><body><article>
<h1>Test article</h1>
${"<p>Some words that make up a reasonably long paragraph of real content.</p>".repeat(30)}
</article></body></html>`;

// What the sync used to choke on: a PDF body decoded as text. Parsing ~1 MB of it
// takes several seconds and grows superlinearly with size.
const pdfLikeText = (bytes: number): string =>
  new TextDecoder().decode(Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(bytes)]));

describe("content pool", () => {
  const pool = makeContentPool(2);
  afterAll(() => pool.close());

  it("extracts an article in a worker", async () => {
    const raw = (await pool.run(
      { op: "extract", html: ARTICLE, url: "https://example.org/a" },
      30_000,
    )) as RawExtraction;
    expect(raw.title).toBe("Test article");
    expect(raw.wordCount).toBeGreaterThan(100);
  }, 30_000);

  it("converts HTML to markdown in a worker", async () => {
    const md = await pool.run({ op: "convert", html: "<h2>Hi</h2><p><em>there</em></p>" }, 30_000);
    expect(md).toBe("## Hi\n\n_there_");
  }, 30_000);

  it("kills a job that exceeds its timeout without blocking the main thread", async () => {
    let ticks = 0;
    const heartbeat = setInterval(() => ticks++, 50);
    const started = Date.now();
    await expect(
      pool.run(
        { op: "extract", html: pdfLikeText(1_000_000), url: "https://example.org/x.pdf" },
        500,
      ),
    ).rejects.toBeInstanceOf(WorkerTimeoutError);
    clearInterval(heartbeat);
    expect(Date.now() - started).toBeLessThan(3_000);
    // The event loop stayed free while the worker was busy.
    expect(ticks).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("keeps working after a worker was killed", async () => {
    const md = await pool.run({ op: "convert", html: "<p>still alive</p>" }, 30_000);
    expect(md).toBe("still alive");
  }, 30_000);

  it("runs no more jobs at once than its size", async () => {
    const small = makeContentPool(1);
    try {
      const html = pdfLikeText(1_000_000);
      const results = await Promise.allSettled([
        small.run({ op: "extract", html, url: "https://example.org/1" }, 300),
        small.run({ op: "convert", html: "<p>queued</p>" }, 30_000),
      ]);
      expect(results[0]?.status).toBe("rejected");
      // The queued job waited for the slot and its timeout only covered its own run.
      expect(results[1]).toEqual({ status: "fulfilled", value: "queued" });
    } finally {
      await small.close();
    }
  }, 30_000);
});
