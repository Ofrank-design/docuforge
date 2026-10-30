import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Only these grammars are loaded (no auto-detection). highlight.js aliases
 * cover js/jsx/mjs, ts/tsx, sh/zsh, html/xml/svg, md, yml, py, rs, golang.
 */
export const GRAMMARS = { bash, css, go, java, javascript, json, markdown, php, python, rust, shell, sql, typescript, xml, yaml };

/** Display names for the language label on code blocks (keys are lowercase fence names). */
const LABELS: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  jsx: "JSX", ts: "TypeScript", typescript: "TypeScript", tsx: "TSX",
  py: "Python", python: "Python", json: "JSON", yaml: "YAML", yml: "YAML",
  bash: "Bash", sh: "Shell", shell: "Shell", zsh: "Shell", console: "Console",
  html: "HTML", xml: "XML", svg: "SVG", css: "CSS", sql: "SQL", java: "Java",
  go: "Go", golang: "Go", rust: "Rust", rs: "Rust", php: "PHP",
  md: "Markdown", markdown: "Markdown", text: "Text", txt: "Text", plain: "Text", plaintext: "Text",
};

export function languageLabel(lang: string | undefined): string {
  if (!lang) return "Text";
  return LABELS[lang.toLowerCase()] ?? lang;
}
