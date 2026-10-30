# Changelog

## 0.1.0

First release.

- `docuforge build`: Markdown → static site (GFM, highlighted code, unique heading ids, table of contents),
  navigation from the folder structure, link and asset resolution, atomic output with stale-file cleanup,
  `--watch`, `--strict-links`, `--strict-frontmatter`, base-path support.
- Search: build-time Lunr index, keyboard-driven dialog, highlighted excerpts, deep links to sections.
- Theme: React + Tailwind islands over static HTML; light/dark/system, responsive drawer, copy-code buttons.
- Site files: `404.html`, `sitemap.xml` (with `siteUrl`), `robots.txt`, tab icons (auto-detected from `public/`),
  logo, social image, sanitized custom CSS.
- `docuforge preview`: hardened local static server with a strict CSP.
- `docuforge init`: starter docs and a starter icon set.
- Cross-process build lock; reproducible output; no local paths or source maps in published files.
