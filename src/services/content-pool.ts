import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { Effect } from "effect";
import type { ContentJob, ContentReply } from "./content-worker.js";

// Next to this module in both layouts: src/services/content-worker.ts when running
// from source (dev, tests), dist/content-worker.mjs once bundled.
const WORKER_URL = new URL(
  import.meta.url.endsWith(".ts") ? "./content-worker.ts" : "./content-worker.mjs",
  import.meta.url,
);

// Deeply nested DOMs make Turndown recurse hard; give workers more stack than the
// default so they don't throw where the old `--stack-size` workaround was needed.
// The heap cap turns a runaway page into a failed job instead of a dead process.
const WORKER_RESOURCE_LIMITS = { stackSizeMb: 32, maxOldGenerationSizeMb: 2048 };

export class WorkerTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Content processing exceeded ${timeoutMs}ms`);
    this.name = "WorkerTimeoutError";
  }
}

// A fixed-size pool of content workers. Each job gets a worker to itself; a job
// that times out, crashes, or is aborted takes its worker down with it and the
// pool starts a fresh one on demand. The timeout covers execution only, not the
// wait for a free worker.
export const makeContentPool = (size: number) => {
  const all = new Set<Worker>();
  const idle: Worker[] = [];
  const waiters: Array<() => void> = [];
  let nextId = 0;
  let closed = false;

  const spawn = (): Worker => {
    const w = new Worker(WORKER_URL, { resourceLimits: WORKER_RESOURCE_LIMITS });
    all.add(w);
    w.once("exit", () => all.delete(w));
    return w;
  };

  const acquire = async (): Promise<Worker> => {
    for (;;) {
      if (closed) throw new Error("Content pool is closed");
      const w = idle.pop();
      if (w !== undefined) return w;
      if (all.size < size) return spawn();
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  const release = (w: Worker, reusable: boolean): void => {
    if (reusable && !closed) {
      // Idle workers must not keep the process alive on their own.
      w.unref();
      idle.push(w);
    } else {
      all.delete(w);
      void w.terminate();
    }
    waiters.shift()?.();
  };

  const run = async (
    job: ContentJob,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const w = await acquire();
    w.ref();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const settle = (reusable: boolean, fn: () => void): void => {
        clearTimeout(timer);
        w.off("message", onMessage);
        w.off("error", onError);
        w.off("exit", onExit);
        signal?.removeEventListener("abort", onAbort);
        release(w, reusable);
        fn();
      };
      const onMessage = (reply: ContentReply): void => {
        if (reply.id !== id) return;
        settle(true, () => (reply.ok ? resolve(reply.value) : reject(new Error(reply.error))));
      };
      const onError = (err: Error): void => settle(false, () => reject(err));
      const onExit = (code: number): void =>
        settle(false, () => reject(new Error(`Content worker exited with code ${code}`)));
      const onAbort = (): void => settle(false, () => reject(new Error("Content job aborted")));
      const timer = setTimeout(
        () => settle(false, () => reject(new WorkerTimeoutError(timeoutMs))),
        timeoutMs,
      );
      w.on("message", onMessage);
      w.on("error", onError);
      w.on("exit", onExit);
      signal?.addEventListener("abort", onAbort, { once: true });
      w.postMessage({ id, job });
    });
  };

  const close = async (): Promise<void> => {
    closed = true;
    idle.length = 0;
    for (const resolve of waiters.splice(0)) resolve();
    await Promise.all([...all].map((w) => w.terminate()));
  };

  return { run, close };
};

export class ContentPool extends Effect.Service<ContentPool>()("ContentPool", {
  scoped: Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => makeContentPool(Math.max(1, Math.min(4, availableParallelism())))),
      (p) => Effect.promise(() => p.close()),
    );
    const run = (job: ContentJob, timeoutMs: number): Effect.Effect<unknown, Error> =>
      Effect.tryPromise({
        try: (signal) => pool.run(job, timeoutMs, signal),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
    return { run } as const;
  }),
  dependencies: [],
}) {}
