# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers rather than opening a public issue, and include
a minimal Markdown/config sample that reproduces the problem. We aim to acknowledge reports within a few days.

## What DocuForge protects against

DocuForge treats **Markdown, front matter, file names and assets as untrusted input** and **the config file as trusted code**.

- Raw HTML in Markdown is sanitized with an allowlist; scripts, handlers, inline styles, frames, forms and
  dangerous URL schemes never reach the output. Generated pages contain no inline scripts or `style` attributes, so a
  strict `script-src 'self'; style-src 'self'` policy works (see `docuforge preview`, which enforces one).
- Front matter is parsed as data only (YAML/JSON). Executable front matter (`---js`) is refused.
- Paths cannot escape: link/asset resolution stays inside the source directory; symlinks are never followed;
  every write is checked to stay inside the output directory.
- SVG assets and the optional custom stylesheet are sanitized; secrets (`.env*`, keys, certificates, credentials)
  and hidden files are never copied.
- The preview server binds to `127.0.0.1` by default, serves only the built output, hides dotfiles, and sends
  `nosniff` and a strict Content-Security-Policy.

## What it does not protect against

- **The config file** (`docuforge.config.mjs/.js/.cjs`) is executed when loaded. Only run builds on repositories you trust,
  as with any build tool.
- A page can link to or embed **external** content (images, links) if its author writes it. External links get
  `rel="noopener noreferrer"`; external images are loaded by visitors' browsers.
- Content sanitization is allowlist-based but is not a substitute for a Content-Security-Policy on your host.
  Use the headers in `examples/deploy/`.
- `--host 0.0.0.0` exposes the preview server to your network. It is a local inspection tool, not a production server.
