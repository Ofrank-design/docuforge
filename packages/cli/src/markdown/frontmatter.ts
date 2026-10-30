import yaml from "js-yaml";
import { z } from "zod";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface FrontMatterMeta {
  title?: string;
  description?: string;
  order?: number;
  sidebarLabel?: string;
  tags: string[];
  draft: boolean;
  /** Unknown fields, reduced to plain JSON data. Never evaluated. */
  extra: Record<string, JsonValue>;
}

export interface FrontMatterIssue {
  code: string;
  message: string;
}

export interface ParsedFrontMatter {
  meta: FrontMatterMeta;
  /** Markdown body with the front matter block removed. */
  body: string;
  hadFrontMatter: boolean;
  issues: FrontMatterIssue[];
}

/** Front matter blocks larger than this are not parsed. */
export const MAX_FRONT_MATTER_BYTES = 64 * 1024;
const MAX_ALIASES = 10;
const MAX_EXTRA_DEPTH = 8;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const KNOWN_FIELDS = new Set(["title", "description", "order", "sidebar_label", "tags", "draft"]);

const fieldSchemas = {
  title: z.string().trim().min(1, "must be a non-empty string"),
  description: z.string().trim(),
  order: z.number().finite("must be a finite number"),
  sidebar_label: z.string().trim().min(1, "must be a non-empty string"),
  tags: z.array(z.union([z.string(), z.number()]).transform((v) => String(v).trim())),
  draft: z.boolean(),
} as const;

function emptyMeta(): FrontMatterMeta {
  return { tags: [], draft: false, extra: {} };
}

const UNSUPPORTED_LANGUAGE =
  "only YAML and JSON front matter are supported (executable front matter is disabled)";

interface Split {
  /** The whole `---` … `---` block including both delimiter lines. */
  block: string;
  /** Text between the delimiters. */
  inner: string;
  /** Optional language tag after the opening `---` (`yaml`, `json`, `js`, …), lower-case. */
  language: string;
  /** Everything after the closing delimiter line. */
  rest: string;
}

/**
 * Split a leading front matter block off a document. The opening line is `---` optionally followed by a
 * language tag; the block ends at the next line that is exactly `---`. Anything else (`----`, `--- text`,
 * no closing line) is ordinary content (typically a horizontal rule), not front matter.
 */
function splitFrontMatter(source: string): Split | undefined {
  const open = /^---[ \t]*([A-Za-z0-9_+-]*)[ \t]*(\r?\n|$)/.exec(source);
  if (!open || open[2] === "") return undefined;
  const afterOpen = source.slice(open[0].length);
  const close = /^---[ \t]*(\r?\n|$)/m.exec(afterOpen);
  if (!close) return undefined;
  const closeAt = close.index;
  // `^` with /m also matches at index 0 of `afterOpen`, which is an empty block: that is fine.
  return {
    block: source.slice(0, open[0].length + closeAt + close[0].length),
    inner: afterOpen.slice(0, closeAt),
    language: (open[1] ?? "").toLowerCase(),
    rest: afterOpen.slice(closeAt + close[0].length),
  };
}

function toJson(value: unknown, depth: number): JsonValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "object": {
      if (depth >= MAX_EXTRA_DEPTH) return undefined;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
      if (Array.isArray(value)) {
        return value.map((v) => toJson(v, depth + 1) ?? null);
      }
      if (ArrayBuffer.isView(value)) return undefined;
      const out: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const key of Object.keys(value as object)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        const v = toJson((value as Record<string, unknown>)[key], depth + 1);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    default:
      return undefined; // functions, symbols, bigint, undefined
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function formatZod(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

/**
 * Parse and validate front matter. Never throws: malformed metadata produces
 * `issues`, and the document body is always preserved.
 */
export function parseFrontMatter(raw: string): ParsedFrontMatter {
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const issues: FrontMatterIssue[] = [];
  const meta = emptyMeta();

  const split = splitFrontMatter(source);
  if (!split) return { meta, body: source, hadFrontMatter: false, issues };
  const { block, inner, language } = split;
  const body = split.rest;

  // Cheap guards before handing the block to a parser.
  if (Buffer.byteLength(block, "utf8") > MAX_FRONT_MATTER_BYTES) {
    issues.push({
      code: "frontmatter.too-large",
      message: `Front matter is larger than ${MAX_FRONT_MATTER_BYTES} bytes and was not parsed.`,
    });
    return { meta, body, hadFrontMatter: true, issues };
  }
  const aliases = block.match(/(?:^|[\s[{,:])\*[A-Za-z0-9_-]+/g)?.length ?? 0;
  if (aliases > MAX_ALIASES) {
    issues.push({
      code: "frontmatter.too-many-aliases",
      message: `Front matter uses more than ${MAX_ALIASES} YAML aliases and was not parsed.`,
    });
    return { meta, body, hadFrontMatter: true, issues };
  }

  // Data only: YAML (js-yaml 4's safe default schema) or JSON. Nothing is ever evaluated.
  let data: unknown;
  try {
    if (language === "" || language === "yaml" || language === "yml") data = yaml.load(inner) ?? {};
    else if (language === "json") data = inner.trim() === "" ? {} : (JSON.parse(inner) as unknown);
    else throw new Error(UNSUPPORTED_LANGUAGE);
  } catch (err) {
    const first = (err as Error).message.split("\n")[0] ?? "unknown error";
    issues.push({
      code: "frontmatter.invalid-yaml",
      message: `Front matter could not be parsed (${first}); metadata was ignored and the document was kept.`,
    });
    // Preserve the document: drop only the unreadable metadata block.
    return { meta, body, hadFrontMatter: true, issues };
  }

  if (!isPlainObject(data)) {
    issues.push({
      code: "frontmatter.not-an-object",
      message: "Front matter must be a key/value mapping; metadata was ignored.",
    });
    return { meta, body, hadFrontMatter: true, issues };
  }

  const invalid = (field: string, detail: string, consequence = "the field was ignored"): void => {
    issues.push({ code: "frontmatter.invalid-field", message: `Invalid "${field}": ${detail}; ${consequence}.` });
  };

  for (const [field, schema] of Object.entries(fieldSchemas)) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const value = data[field];
    if (value === null || value === undefined) continue; // `title:` with no value
    const result = schema.safeParse(value);
    if (!result.success) {
      invalid(field, formatZod(result.error), field === "draft" ? "the document will be published" : undefined);
      continue;
    }
    switch (field) {
      case "title":
        meta.title = result.data as string;
        break;
      case "description":
        if ((result.data as string) !== "") meta.description = result.data as string;
        break;
      case "order":
        meta.order = result.data as number;
        break;
      case "sidebar_label":
        meta.sidebarLabel = result.data as string;
        break;
      case "tags": {
        const seen = new Set<string>();
        for (const t of result.data as string[]) {
          if (t !== "" && !seen.has(t)) {
            seen.add(t);
            meta.tags.push(t);
          }
        }
        break;
      }
      case "draft":
        meta.draft = result.data as boolean;
        break;
    }
  }

  for (const key of Object.keys(data)) {
    if (KNOWN_FIELDS.has(key) || FORBIDDEN_KEYS.has(key)) continue;
    const v = toJson(data[key], 0);
    if (v !== undefined) meta.extra[key] = v;
  }

  return { meta, body, hadFrontMatter: true, issues };
}
