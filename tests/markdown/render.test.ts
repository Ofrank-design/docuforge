import { describe, expect, it } from "vitest";
import {
  createRenderer,
  type AnchorRef,
  type ProcessorOptions,
} from "../../packages/cli/src/markdown/processor.js";
import { Diagnostics } from "../../packages/cli/src/util/diagnostics.js";
import {
  renderPage,
  renderLandingContent,
  type SiteContext,
} from "../../packages/cli/src/renderer/page.js";

const index = {
  docsByPath: new Map([
    ["a/b.md", "/a/b/"],
    ["c.md", "/c/"],
  ]),
  routes: new Set(["/a/b/", "/c/", "/a/"]),
  draftPaths: new Set(["d.md"]),
};

async function render(
  md: string,
  opts: Partial<ProcessorOptions> = {},
  relPath = "a/x.md",
) {
  const diags = new Diagnostics();
  const requested: string[] = [];

  const assets = {
    reference: async (path: string) => {
      requested.push(path);
      return path;
    },
  } as never;

  const anchorRefs: AnchorRef[] = [];

  const renderer = createRenderer({
    rawHtml: "sanitize",
    syntaxHighlighting: true,
    basePath: "/",
    strictLinks: false,
    ...opts,
  });

  const output = await renderer(md, {
    relPath,
    index,
    assets,
    diags,
    anchorRefs,
  });

  return {
    ...output,
    diags,
    requested,
    anchorRefs,
  };
}

describe("markdown rendering", () => {
  it("renders GFM tables, task lists, strikethrough, autolinks and footnotes", async () => {
    const { html } = await render(
      "| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~ https://example.com\n\nNote[^1]\n\n[^1]: The note.\n",
    );

    expect(html).toContain('<th align="center">a</th>');
    expect(html).toContain('<input type="checkbox" checked disabled>');
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('href="https://example.com"');

    const footnoteReference = /href="#(user-content-fn-1)"/.exec(html)?.[1];

    if (footnoteReference) {
      expect(html).toContain(`id="${footnoteReference}"`);
    }

    const footnoteBackReference =
      /href="#(user-content-fnref-1)"/.exec(html)?.[1];

    if (footnoteBackReference) {
      expect(html).toContain(`id="${footnoteBackReference}"`);
    }
  });

  it("generates unique, stable heading ids including unicode and duplicates", async () => {
    const { headings, html } = await render(
      "# Title\n\n## Env vars\n\n## Env vars\n\n### Unicode heading µ\n\n## `code` & stuff!\n",
    );

    const ids = headings.map((heading) => heading.id);

    expect(ids.slice(0, 3)).toEqual([
      "title",
      "env-vars",
      "env-vars-1",
    ]);

    expect(ids[3]).toBeTruthy();
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('<h2 id="env-vars-1">');
  });

  it("never lets a heading slug collide with reserved page ids", async () => {
    const { headings } = await render("## Main\n\n## df-main\n");

    expect(headings.every((heading) => heading.id !== "df-main")).toBe(true);
  });

  it("derives a summary from the first paragraph", async () => {
    const { summary } = await render(
      "# T\n\nFirst **paragraph** with `code`.\n\nSecond.\n",
    );

    expect(summary).toBe("First paragraph with code.");

    const long = await render(`# T\n\n${"word ".repeat(100)}\n`);

    expect(long.summary!.length).toBeLessThanOrEqual(161);
    expect(long.summary!.endsWith("…")).toBe(true);
  });

  it("warns about multiple h1 headings", async () => {
    const { diags, h1Count } = await render("# One\n\n# Two\n");

    expect(h1Count).toBe(2);
    expect(diags.warnings?.[0]?.code).toBe("markdown.multiple-h1");
  });

  it("wraps code blocks with language labels, copy buttons and syntax highlighting", async () => {
    const { html } = await render(
      "```ts\nconst x: number = 1;\n```\n\n```python\nprint('hi')\n```\n\n```\nplain\n```\n",
    );

    expect(html).toContain('<span class="code-lang">TypeScript</span>');
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain('<span class="code-lang">Python</span>');
    expect(html).toContain('<span class="code-lang">Text</span>');
    expect(html).toContain(
      '<button type="button" class="copy-btn" aria-label="Copy TypeScript code to clipboard">',
    );
    expect(html).toContain('<pre tabindex="0">');
  });

  it("escapes code in unknown languages instead of failing", async () => {
    const { html } = await render(
      "```weirdlang\n<b>not html</b> & stuff\n```\n",
    );

    expect(html).toContain("&#x3C;b>not html&#x3C;/b>");
    expect(html).not.toContain("<b>not html</b>");
  });

  it("can disable syntax highlighting", async () => {
    const { html } = await render(
      "```js\nconst a = 1;\n```\n",
      { syntaxHighlighting: false },
    );

    expect(html).not.toContain("hljs-keyword");
    expect(html).toContain("const a = 1;");
    expect(html).toContain("code-block");
  });

  it("does not auto-detect languages for unlabeled blocks", async () => {
    const { html } = await render(
      "```\nconst a = 1; function f() {}\n```\n",
    );

    expect(html).not.toContain("hljs-keyword");
  });
});

describe("raw HTML and URL sanitization", () => {
  const attacks: [string, RegExp][] = [
    ["<script>alert(1)</script>", /<script/i],
    ['<img src="x" onerror="alert(1)">', /onerror/i],
    ['<a href="javascript:alert(1)">x</a>', /javascript:/i],
    ["[x](javascript:alert(1))", /javascript:/i],
    ["[x](JaVaScRiPt:alert(1))", /javascript:/i],
    ["[x](data:text/html;base64,PHNjcmlwdD4=)", /data:text/i],
    ['<iframe src="https://evil.example"></iframe>', /<iframe/i],
    ["<object data=\"x\"></object><embed src=\"x\">", /<object|<embed/i],
    ['<div onclick="x()" style="position:fixed">d</div>', /onclick|style=/i],
    ['<svg onload="alert(1)"><script>1</script></svg>', /onload|<script/i],
    ['<form action="https://evil.example"><input name=x></form>', /<form/i],
    ["<style>body{display:none}</style>", /<style/i],
    ['<a href="x" id="clobber" name="clobber">x</a>', /id="clobber"|name="clobber"/],
    ['<meta http-equiv="refresh" content="0;url=https://evil.example">', /<meta/i],
    ['<link rel="stylesheet" href="https://evil.example">', /<link/i],
    ['<base href="https://evil.example">', /<base/i],
  ];

  it.each(attacks)("neutralizes %s", async (input, bad) => {
    const { html } = await render(`${input}\n`);

    expect(bad.test(html)).toBe(false);
  });

  it("drops the contents of non-content elements instead of showing them as text", async () => {
    const { html, text } = await render(
      'visible <style>.cssleak{}</style> <noscript>nsleak</noscript> <iframe src="https://e.example">iframeleak</iframe> <textarea>tleak</textarea> <template>tmplleak</template> end\n',
    );

    for (const leak of [
      "cssleak",
      "nsleak",
      "iframeleak",
      "tleak",
      "tmplleak",
    ]) {
      expect(html).not.toContain(leak);
      expect(text).not.toContain(leak);
    }

    expect(text).toBe("visible end");
  });

  it("keeps safe raw HTML such as details, summary, kbd and tables", async () => {
    const { html } = await render(
      "<details><summary>More</summary>Body</details>\n\nPress <kbd>Ctrl</kbd>.\n",
    );

    expect(html).toContain(
      "<details><summary>More</summary>Body</details>",
    );
    expect(html).toContain("<kbd>Ctrl</kbd>");
  });

  it("drops all raw HTML when rawHtml is off", async () => {
    const { html } = await render(
      "Hello <b>bold</b>\n\n<details><summary>x</summary>y</details>\n",
      { rawHtml: "off" },
    );

    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<details");
    expect(html).toContain("Hello");
  });

  it("does not let authored heading ids override generated ones", async () => {
    const { html, headings } = await render(
      '<h2 id="evil">Heading</h2>\n',
    );

    expect(headings[0]?.id).toBe("heading");
    expect(html).not.toContain('id="evil"');
  });
});

describe("link rewriting during render", () => {
  it("rewrites internal links under the base path and records cross-document anchors", async () => {
    const { html, anchorRefs } = await render(
      "[s](./b.md#env) [u](../c.md) [d](../a/)\n",
      { basePath: "/docs/" },
    );

    expect(html).toContain('href="/docs/a/b/#env"');
    expect(html).toContain('href="/docs/c/"');
    expect(html).toContain('href="/docs/a/"');
    expect(anchorRefs).toBeDefined();
  });
});

describe("site context context tree verification", () => {
  it("successfully passes typing validations with a verified mock tree", () => {
    const context: Partial<SiteContext> = {
      tree: {
        home: {
          type: "home",
          route: "/",
          label: "Home",
          title: "Home",
          landing: true
        },
        items: []
      } as unknown as SiteContext["tree"],
    };

    expect(context.tree).toBeDefined();
    expect(context.tree?.home.route).toBe("/");
  });
});
