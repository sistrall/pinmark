import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Vault } from "./vault.js";

let root: string;

const touch = (rel: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, rel);
};

const run = <A, E>(f: (vault: Vault) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    Effect.flatMap(Vault, f).pipe(Effect.provide(Vault.Default), Effect.provide(NodeContext.layer)),
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pinmark-vault-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("listBookmarkFilenames", () => {
  it("lists notes in subfolders as /-separated paths, skipping dot-folders", async () => {
    touch("flat-aaaaaaaa.md");
    touch("2024/03/nested-bbbbbbbb.md");
    touch("2024/03/nested-bbbbbbbb.jpg");
    touch(".obsidian/workspace.md");
    touch(".pinmark/notes.md");
    touch("node_modules/pkg/README.md");
    const found = await run((v) => v.listBookmarkFilenames(root));
    expect(found.sort()).toEqual(["2024/03/nested-bbbbbbbb.md", "flat-aaaaaaaa.md"]);
  });
});

describe("moveFile", () => {
  it("moves into a new folder and removes every folder it emptied", async () => {
    touch("2024/03/note-aaaaaaaa.md");
    await run((v) => v.moveFile(root, "2024/03/note-aaaaaaaa.md", "2025/01/note-aaaaaaaa.md"));
    expect(readdirSync(join(root, "2025/01"))).toEqual(["note-aaaaaaaa.md"]);
    expect(readdirSync(root)).toEqual(["2025"]);
  });

  it("stops removing at the first folder that still has something in it", async () => {
    touch("2024/03/note-aaaaaaaa.md");
    touch("2024/04/other-bbbbbbbb.md");
    await run((v) => v.moveFile(root, "2024/03/note-aaaaaaaa.md", "note-aaaaaaaa.md"));
    expect(readdirSync(join(root, "2024"))).toEqual(["04"]);
  });

  it("keeps a source folder that still has files, and never removes the root", async () => {
    touch("2024/03/a-aaaaaaaa.md");
    touch("2024/03/b-bbbbbbbb.md");
    touch("c-cccccccc.md");
    await run((v) => v.moveFile(root, "2024/03/a-aaaaaaaa.md", "a-aaaaaaaa.md"));
    await run((v) => v.moveFile(root, "c-cccccccc.md", "2024/03/c-cccccccc.md"));
    expect(readdirSync(join(root, "2024/03")).sort()).toEqual(["b-bbbbbbbb.md", "c-cccccccc.md"]);
    expect(readdirSync(root).sort()).toEqual(["2024", "a-aaaaaaaa.md"]);
  });

  it("is a no-op when the source is already gone", async () => {
    await run((v) => v.moveFile(root, "missing-aaaaaaaa.md", "2024/01/missing-aaaaaaaa.md"));
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("writeBookmark", () => {
  it("creates the note's folder", async () => {
    await run((v) => v.writeBookmark(root, "2024/03/new-aaaaaaaa.md", "x"));
    expect(readdirSync(join(root, "2024/03"))).toEqual(["new-aaaaaaaa.md"]);
  });
});
