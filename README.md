# pinmark

Mirror your [Pinboard](https://pinboard.in) bookmarks into an [Obsidian](https://obsidian.md) vault, enriched with extracted page content.

One-way sync: Pinboard is the source of truth. The vault is a derived, regenerable artifact suitable for hourly cron-driven updates from GitHub Actions.

## What it does

For each bookmark, `pinmark` writes a markdown file with:

- **Frontmatter** carrying the Pinboard data (URL, title, tags, note, timestamps) plus metadata extracted from the page (author, publication date, site name, language, reading time).
- **Body** containing the page's main article content, extracted via [Defuddle](https://github.com/kepano/defuddle) (the engine behind Obsidian's Web Clipper) and converted to markdown.

JavaScript-rendered pages are detected when Defuddle returns little to no content from a plain HTTP fetch — the URL is then re-fetched through a headless Chromium and re-extracted.

The frontmatter schema uses flat, properly-typed YAML so it works natively with [Obsidian Bases](https://help.obsidian.md/bases).

## Requirements

- Node.js 20 or newer
- A Pinboard API token (find yours at `https://pinboard.in/settings/password`)
- Chromium available on `$PATH` (or installed via `npx playwright install chromium`)

## Install

```sh
npm install -g pinmark
```

Or run on-demand:

```sh
npx pinmark sync
```

## Configure

Create a `.pinmark.config.json` in the vault repo root:

```json
{
  "vault": ".",
  "fetch": {
    "concurrency": 4,
    "perHostConcurrency": 1,
    "timeoutMs": 30000,
    "maxBodyBytes": 5000000,
    "userAgent": "pinmark/0.1 (+https://github.com/youruser/pinmark)"
  },
  "extraction": {
    "minWordCount": 100,
    "timeoutMs": 30000,
    "headlessAllowlist": ["twitter.com", "x.com", "medium.com"]
  },
  "retry": {
    "maxAttempts": 5,
    "initialDelayMs": 30000
  }
}
```

Only HTML and other `text/*` responses are extracted. Anything else (PDFs, images, video, archives) and any response larger than `fetch.maxBodyBytes` is recorded as `abandoned` straight away, with `pinmark_fetch_error_kind` set to `unsupported_content` or `too_large`, since retrying won't change the result. Extraction and markdown conversion run in worker threads and are killed after `extraction.timeoutMs`; that counts as a `timeout` failure and is retried like any other.

Configuration precedence (highest wins):

1. CLI flag (`--vault ./other-vault`)
2. Environment variable (`PINMARK_VAULT=./other-vault`)
3. Config file
4. Built-in default

`PINBOARD_API_TOKEN` is **environment-only**. It is intentionally not loadable from the config file so it cannot be committed by accident.

## Run

```sh
PINBOARD_API_TOKEN=user:NNNNNNNNNNNN npx pinmark sync
```

The command exits with non-zero status only on hard failures (config error, Pinboard 401, etc.). Per-bookmark fetch failures are recorded in the markdown file's frontmatter and retried on subsequent runs, with give-up after `retry.maxAttempts`.

A summary is printed at the end:

```
pinmark sync — 42 new, 3 metadata updated, 1 deleted
  fetch: 41 ok (38 http, 3 headless), 1 failed (1 timeout), 0 abandoned
```

## Deploy to GitHub Actions

See [`examples/github-actions-vault.yml`](examples/github-actions-vault.yml) for a reference hourly workflow.

The example:

- Schedules `pinmark sync` hourly via cron
- Queues overlapping runs (does not cancel in-progress)
- Caches Playwright's Chromium between runs
- Bounds the sync with `timeout` and commits whatever was synced even if the sync step fails
- Commits and pushes resulting changes directly to `main` with the `github-actions[bot]` identity

Required secret: `PINBOARD_API_TOKEN`.

## Vault layout

By default, the vault root is the current working directory — i.e. running `pinmark sync` inside the vault repo writes bookmark files alongside `.pinmark.config.json`. Override with `--vault <path>` / `PINMARK_VAULT` / config `vault` key.

```
./
  awesome-article-5d41402a.md
  another-thing-7c8b9e10.md
  ...
  .pinmark/
    state.json          # global state (last Pinboard sync timestamp)
  .pinmark.config.json
```

Markdown files are flat (no nested folders). Tag-based navigation uses Obsidian's tag pane / Bases over the frontmatter `tags` field — see [`docs/frontmatter.md`](docs/frontmatter.md) for the schema.

## Status

Early. The current `0.0.x` releases are pre-API-stable; the frontmatter schema may evolve. Once tagged `1.0.0`, the schema and CLI contract are stable.

## License

MIT
