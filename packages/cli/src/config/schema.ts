import { z } from "zod";

export const SORT_MODES = ["order-then-title", "title", "filename"] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const DEFAULT_MAX_DOCUMENTS = 10_000;
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MiB
export const DEFAULT_MAX_ASSET_SIZE = 25 * 1024 * 1024; // 25 MiB

/**
 * The user-facing configuration schema. `.strict()` means unknown options are
 * reported instead of silently ignored.
 */
export const ConfigSchema = z
  .object({
    title: z.string().trim().min(1).default("Documentation"),
    description: z.string().trim().optional(),
    source: z.string().min(1).default("./docs"),
    output: z.string().min(1).default("./dist"),
    basePath: z.string().default("/"),
    search: z.boolean().default(true),
    syntaxHighlighting: z.boolean().default(true),
    strictLinks: z.boolean().default(false),
    strictFrontMatter: z.boolean().default(false),
    includeHidden: z.boolean().default(false),
    includeDrafts: z.boolean().default(false),
    /** Canonical site origin, e.g. https://docs.example.com (used for canonical/Open Graph URLs). */
    siteUrl: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://")
      .optional(),
    /** `sanitize`: allowlist-sanitize raw HTML in Markdown. `off`: drop raw HTML entirely. */
    rawHtml: z.enum(["sanitize", "off"]).default("sanitize"),
    /** Heading levels listed in the table of contents. */
    toc: z
      .object({
        minLevel: z.number().int().min(1).max(6).default(2),
        maxLevel: z.number().int().min(1).max(6).default(3),
      })
      .strict()
      .refine((t) => t.minLevel <= t.maxLevel, "minLevel must not be greater than maxLevel")
      .default({ minLevel: 2, maxLevel: 3 }),
    /** Directory (relative to source) whose non-Markdown files are copied to the site root. `false` disables. */
    publicDir: z.union([z.string().min(1), z.literal(false)]).default("public"),
    /** `sanitize`: copy SVGs after stripping scripts/handlers. `skip`: never copy SVGs. */
    svg: z.enum(["sanitize", "skip"]).default("sanitize"),
    /** Logo image, as a path inside the source directory (e.g. `public/logo.svg`). */
    logo: z.string().min(1).optional(),
    /** Favicon image, as a path inside the source directory. A letter icon is generated when omitted. */
    favicon: z.string().min(1).optional(),
    /** Social-card image (Open Graph / Twitter), as a path inside the source directory. Needs `siteUrl`. */
    socialImage: z.string().min(1).optional(),
    /** Extra stylesheet, as a path inside the source directory. Sanitized: no @import, no external url(). */
    customCss: z.string().min(1).optional(),
    /** Footer text (plain text, escaped). `false` removes the footer. */
    footer: z.union([z.string().trim().min(1), z.literal(false)]).default("Built with DocuForge"),
    exclude: z.array(z.string().min(1)).default([]),
    navigation: z
      .object({
        sort: z.enum(SORT_MODES).default("order-then-title"),
      })
      .strict()
      .default({ sort: "order-then-title" }),
    limits: z
      .object({
        maxDocuments: z.number().int().positive().default(DEFAULT_MAX_DOCUMENTS),
        maxFileSizeBytes: z.number().int().positive().default(DEFAULT_MAX_FILE_SIZE),
        maxAssetSizeBytes: z.number().int().positive().default(DEFAULT_MAX_ASSET_SIZE),
      })
      .strict()
      .default({
        maxDocuments: DEFAULT_MAX_DOCUMENTS,
        maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE,
        maxAssetSizeBytes: DEFAULT_MAX_ASSET_SIZE,
      }),
    concurrency: z.number().int().min(1).max(64).default(8),
  })
  .strict();

export type DocuForgeConfig = z.infer<typeof ConfigSchema>;
/** Shape accepted from a config file (everything optional). */
export type UserConfig = z.input<typeof ConfigSchema>;
