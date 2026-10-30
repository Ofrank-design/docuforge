<p align="center"><img src="docs-assets/logo.png" alt="DocuForge" width="420"></p>

<p align="center"><b>From scattered Markdown files to a polished documentation website.</b><br>
No configuration, no boilerplate, no backend.</p>

![DocuForge turns a folder of Markdown into a searchable documentation site](docs-assets/showcase.jpg)

Point DocuForge at a folder of `.md` files and it builds a fast, searchable, accessible static site: navigation from your
folder structure, a table of contents, syntax highlighting, light/dark themes, a 404 page, and a sitemap. The output is
plain HTML you can host anywhere. Reading works without JavaScript; search and the theme toggle enhance it.

## Contents

[Quick start](#quick-start) · [Commands](#commands) · [Configuration](#configuration) · [Writing docs](#writing-docs) ·
[Search](#search) · [Branding and the tab icon](#branding-and-the-tab-icon) · [Theme customization](#theme-customization) ·
[Deployment](#deployment) · [Security](#security) · [Troubleshooting](#troubleshooting) · [Development](#development)

## Quick start

Requires Node.js 20 or newer.

```bash
npx docuforge init                       # creates docs/ with starter pages and tab icons, plus a config file
npx docuforge build                      # docs/ → dist/
npx docuforge preview                    # http://127.0.0.1:4173/
```

Already have Markdown? Skip `init`: `npx docuforge build --source ./my-docs --out ./site`. No config file is needed.

## Commands

### `docuforge build`

Builds the site. Exit code `0` on success.

| Flag | Meaning |
|---|---|
| `--source <dir>` | Markdown folder (default `./docs`) |
| `--out <dir>` | Output folder (default `./dist`) |
| `--config <file>` | Config file (default: `docuforge.config.{mjs,js,cjs,json}` in the current directory, if present) |
| `--base <path>` | Deployment base path, e.g. `/my-project/` (default `/`) |
| `--clean` | Empty the output folder first. Only folders DocuForge created are ever emptied. |
| `--include-drafts` | Publish pages marked `draft: true` |
| `--include-hidden` | Include hidden files and folders |
| `--strict-frontmatter` | Fail the build on invalid front matter |
| `--strict-links` | Fail the build on broken links, anchors and missing assets |
| `--watch` | Rebuild when the source, public files or config change (Ctrl+C to stop) |
| `--verbose` | Print the navigation tree and paths |
| `--help` | Show help |

Pages are rendered into a staging folder first. Your output folder is only replaced if the whole build succeeds, so a
failed build leaves the previous site untouched. Pages that no longer exist are removed on the next build (only files
DocuForge itself wrote are ever deleted). Two builds can't write the same output at once (a lock stops the second).

**Watch mode.** Saves are debounced into one rebuild, builds never overlap, and the output folder can't trigger itself
(even if it lives inside the source). A failing build (say, a broken link with `--strict-links`) is reported and watching
continues; the last good site stays in place. Edits to the config file are picked up too. Hidden files, `.git` and
`node_modules` are ignored.

### `docuforge preview`

Serves an **already built** site so you can check it exactly as a static host would show it. It needs only the output
folder, not the Markdown.

| Flag | Meaning |
|---|---|
| `--out <dir>` | Built folder (default `./dist`, or `output` from the config) |
| `--config <file>` | Config file |
| `--host <host>` | Address to listen on (default `127.0.0.1`; other values print a warning) |
| `--port <port>` | Port (default `4173`; `0` picks a free one) |

It serves the site under its base path, answers unknown URLs with your `404.html` and a real 404 status, never lists
directories, hides dotfiles, never follows symlinks out of the folder, and sends a strict Content-Security-Policy, so a
page that would break under a strict policy breaks in preview first.

### `docuforge init`

Creates `docuforge.config.mjs`, `docs/index.md`, `docs/getting-started/installation.md` and a starter tab-icon set in
`docs/public/`. It never overwrites anything that already exists. Take `--help` for details.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | The build ran but has errors (duplicate routes, strict-mode failures, rejected CSS…); nothing was written |
| `2` | Bad usage or invalid configuration (reported before anything is written) |
| `70` | Unexpected internal error (re-run with `--verbose`) |

## Configuration

Everything is optional. `docuforge.config.mjs` (or `docuforge.config.js`, `.cjs`, `docuforge.config.json`) is found automatically in the current directory. JSON is the safest choice if you don't need code; the JavaScript forms are executed when loaded.
Paths inside it are relative to the config file; command-line flags win over the file. Unknown or invalid options are
reported with the option name and a suggestion, before anything is built.

```js
// docuforge.config.mjs
export default {
  title: "Acme Docs",
  description: "Everything about Acme.",
  siteUrl: "https://docs.acme.com",   // enables canonical links, sitemap.xml, social images
  logo: "public/logo-mark.png",
};
```

| Option | Default | Notes |
|---|---|---|
| `title` | `Documentation` | Site title (header, page titles) |
| `description` | none | Default meta description |
| `source` | `./docs` | Markdown folder |
| `output` | `./dist` | May live inside `source`; it is never scanned |
| `basePath` | `/` | e.g. `/my-project/`. Used for every generated URL |
| `siteUrl` | none | `http(s)://` origin. Enables canonical URLs, `sitemap.xml`, `og:image` |
| `search` | `true` | `false` removes the search UI and index |
| `footer` | `Built with DocuForge` | Plain text (escaped), or `false` for none |
| `logo` | none | Image inside `source`, shown next to the title |
| `favicon` | auto | Image inside `source`; see [tab icon](#branding-and-the-tab-icon) |
| `socialImage` | auto | Open Graph/Twitter card image inside `source` (needs `siteUrl`) |
| `customCss` | none | Stylesheet inside `source`; sanitized, see [theme customization](#theme-customization) |
| `publicDir` | `public` | Folder (relative to `source`) copied to the site root; `false` disables |
| `rawHtml` | `sanitize` | `off` drops raw HTML from Markdown entirely |
| `svg` | `sanitize` | `skip` never copies SVG files |
| `toc` | `{ minLevel: 2, maxLevel: 3 }` | Heading levels shown in "On this page" |
| `syntaxHighlighting` | `true` | |
| `strictLinks` | `false` | Same as `--strict-links` |
| `strictFrontMatter` | `false` | Same as `--strict-frontmatter` |
| `includeDrafts` | `false` | |
| `includeHidden` | `false` | |
| `exclude` | `[]` | Globs relative to `source`, e.g. `["internal/**"]` |
| `navigation` | `{ sort: "order-then-title" }` | `sort` is `order-then-title`, `title` or `filename` |
| `limits` | 10 000 docs, 5 MiB per file, 25 MiB per asset | `maxDocuments`, `maxFileSizeBytes`, `maxAssetSizeBytes` |
| `concurrency` | `8` | Pages rendered in parallel |

## Writing docs

### Front matter

YAML between `---` lines at the top of a file. All fields are optional. Invalid values produce a warning (an error
with `--strict-frontmatter`) and the page is still built. Only YAML/JSON is accepted; executable front matter is refused.

| Field | Type | Effect |
|---|---|---|
| `title` | string | Page title. Otherwise the first heading, otherwise the file name |
| `description` | string | Meta description and search snippet. Otherwise the first paragraph |
| `order` | number | Position in the sidebar (lower first); unordered pages follow alphabetically |
| `sidebar_label` | string | Shorter label for the sidebar |
| `tags` | list of strings | Searchable |
| `draft` | boolean | `true` excludes the page (unless `--include-drafts`) |

### Markdown

GitHub-flavoured Markdown: tables, task lists, strikethrough, autolinks, footnotes, fenced code. Code blocks are
highlighted for JavaScript/TypeScript (JSX, TSX), Python, JSON, YAML, Bash/shell, HTML/XML, CSS, SQL, Java, Go, Rust, PHP
and Markdown, with a language label and a copy button. Headings get stable, unique ids (`environment-variables`,
`environment-variables-1`). Raw HTML is sanitized (see [Security](#security)).

### Navigation and routes

Folders become sidebar groups; the file tree is the structure. `guides/Auth Flow.md` is published at
`/guides/auth-flow/`. `index.md` represents its folder. A folder without an `index.md` gets a generated page listing its
children, and `guides.md` next to a `guides/` folder becomes that folder's landing page. A group is labelled by its
index page's `sidebar_label`, then its `title`, then the folder name. Two files that map to the same URL (`a.md` and
`a/index.md`, or `Guide.md` and `guide.md`) are a build error.

### Links and assets

Link between pages with ordinary relative paths: `[install](./getting-started/installation.md#requirements)`,
`../reference/api.md`, `/guides/auth.md` (from the source root), or `./guides/` for a folder. DocuForge rewrites them to
final URLs under your base path and warns about missing pages, missing headings, links to drafts, and anything that
points outside the source folder. External links open with `rel="noopener noreferrer"`.

Images and files you reference (`![diagram](./images/flow.svg)`) are copied to the same relative path. Allowed types:
png, jpg, gif, webp, avif, svg, ico, pdf, zip, txt, csv, json, mp4, webm. Hidden files, `.env*`, keys, certificates,
credentials and symlinks are never copied, and SVGs are sanitized. Files in `public/` are copied to the site root
as-is (`public/robots.txt` → `/robots.txt`).

## Search

A [Lunr](https://lunrjs.com) index is built with the site (`search-index.json`, roughly 5 KB gzipped for a small site)
and loaded only when someone opens search. Press <kbd>/</kbd> or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>, type, then
<kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd>; <kbd>Esc</kbd> closes. Results show the matching section and a highlighted
excerpt, and open the page at that heading.

- Indexes the visible text of published pages (not drafts, markup, or anything sanitized away), plus title, headings, tags
  and description. Ranking: title › headings › tags › description › body. Every typed word must match as a prefix.
- Unicode-aware, with accents folded (`café` finds `cafe`); identifiers split on punctuation (`ACME_REGION` is found by
  `region`). No stemming: `install` finds `installation`, but `jobs` does not find `job`.
- Languages written without spaces (Chinese, Japanese) are matched per whitespace-separated run, not per word.
- A missing or corrupt index shows "Search is unavailable" with a retry button; reading is unaffected.

## Branding and the tab icon

Put your icons in the `public/` folder (inside your `docs/` folder) and they are used automatically. No config needed:

| File in `public/` | Used for |
|---|---|
| `favicon.svg`, `favicon.png`, `favicon.ico` | The browser tab icon (all that exist are declared) |
| `apple-touch-icon.png` | iOS home-screen icon (use an opaque, square image, about 180×180) |
| `og-image.png` / `.jpg` / `.webp` | Social-card image (needs `siteUrl`) |

`docuforge init` drops a starter set in place; replace those files with yours. With no icon at all, a small letter icon
is generated from your title, so browsers never ask for a missing `/favicon.ico`. To use files from elsewhere, set
`favicon`, `socialImage` or `logo` to a path inside the source folder. The files are validated before anything is built:
a missing or unsupported file is a clear error, not a silent omission.

`logo` is shown beside the site title in the header. Use a mark that works on both light and dark backgrounds.
This repository's own brand files are in `docs-assets/`; regenerate the derived icon set with
`python3 scripts/brand-assets.py` (needs Pillow).

## Theme customization

- **Text and links:** `title`, `footer`, `logo`.
- **Colors:** point `customCss` at a stylesheet that overrides the design tokens. It is linked after the theme, so
  anything it sets wins.

```css
/* docs/theme.css */
:root { --df-accent: #b45309; --df-accent-soft: #fef3c7; }
:root[data-theme="dark"] { --df-accent: #fbbf24; --df-accent-soft: #3a2a05; }
@media (prefers-color-scheme: dark) {                 /* the same dark values, for visitors without JavaScript */
  :root:not([data-theme="light"]) { --df-accent: #fbbf24; --df-accent-soft: #3a2a05; }
}
```

Tokens: `--df-bg`, `--df-surface`, `--df-fg`, `--df-muted`, `--df-line`, `--df-accent`, `--df-accent-fg`, `--df-accent-soft`,
`--df-code-bg`, `--df-code-fg`, `--df-hl-keyword`, `--df-hl-string`, `--df-hl-comment`, `--df-hl-number`, `--df-hl-title`,
`--df-hl-attr`, `--df-hl-built`, `--df-hl-deletion`, `--df-mark-bg`, `--df-mark-fg`. The built-in palette passes WCAG AA
contrast; if you change colors, keep text at 4.5:1 or better.

For safety the stylesheet is cleaned: `@import`, every `url()` except inline images and `#fragments`, `expression()`,
`behavior` and `-moz-binding` are removed (with a warning that lists what was removed). If something is written in a way
that can't be cleaned reliably (for example with CSS escapes like `\75rl(`), the build fails rather than guess.


## Security

Markdown, front matter, file names and assets are treated as untrusted; the config file is trusted code (it is
`import`ed). Details and limits are in [SECURITY.md](SECURITY.md). In short:

- **Raw HTML** is sanitized with a GitHub-style allowlist. Scripts, event handlers, inline `style`/`class`, `<style>`,
  `<iframe>`, `<object>`, forms, `<meta>`/`<link>`/`<base>` and `javascript:`/`data:` links never reach the output.
  The contents of `style`, `noscript`, `iframe`, `textarea` and `template` are dropped, not shown as text. `rawHtml: "off"`
  removes raw HTML entirely.
- **Generated pages contain no inline scripts and no inline `style` attributes**, so `script-src 'self'; style-src 'self'`
  works. A test builds a hostile site and scans every published file.
- **Paths:** links and assets cannot leave the source folder; symlinks are never followed; every write is checked to
  stay inside the output folder. The published files contain no local paths and no source maps.
- **Nothing is executed from Markdown**, including front matter.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Source directory not found` | Run from the folder that contains `docs/`, or pass `--source`. `docuforge init` creates one. |
| Page loads but is unstyled / links go to the wrong place on a project site | Built without the base path. Use `--base /repo/`. |
| `Route /x/ is already produced by …` | Two files map to one URL (`a.md` and `a/index.md`, or names that differ only by case). Rename one. |
| Warning `link.broken-page` / `asset.missing` | The target doesn't exist. Links resolve relative to the file they're in. `--strict-links` turns these into errors. |
| My image isn't copied (`asset.type-not-allowed` / `asset.denied`) | Only the listed file types are copied; hidden and secret-looking files never are. |
| No `sitemap.xml` | Set `siteUrl` (sitemaps need absolute URLs). |
| The tab icon doesn't change | Put `favicon.ico`/`favicon.png` in `docs/public/` and rebuild. Browsers cache tab icons hard: reload with Ctrl+Shift+R. |
| `Another DocuForge build … is already writing` | A build is running, or a crash left a stale lock (it is taken over automatically once the process is gone). |
| `Port 4173 is already in use` | `docuforge preview --port 0`, or pick another port. |
| `The DocuForge theme has not been built` | Running from a source checkout: `npm run build` first. |
| Search says "unavailable" | `search-index.json` didn't load: check the base path and that the file was deployed. |


