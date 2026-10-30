// Must be set before plugins read the config: otherwise @vitejs/plugin-react emits the development JSX
// runtime (jsxDEV), which embeds absolute source paths and line numbers in the shipped bundle.
process.env["NODE_ENV"] = "production";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Builds the browser side of the theme:
 *   dist/site-<hash>.js   entry (React islands + small enhancements)
 *   dist/site-<hash>.css  Tailwind + design tokens
 *   dist/chunks/*.js      lazily loaded code (search engine + Lunr)
 * File names carry a content hash instead of a `?v=` query: a lazy chunk imports the entry by its
 * plain URL, and a differing query string would make the browser load (and run) the entry twice.
 * No source maps are emitted, so no local paths can leak into published files.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    target: "es2020",
    rollupOptions: {
      input: { site: "src/main.tsx" },
      output: {
        entryFileNames: "site-[hash].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (info) => {
          const names = info.names ?? [];
          if (names.some((n) => n.endsWith(".css"))) return "site-[hash].css";
          if (names.some((n) => n.endsWith(".woff2"))) return "fonts/[name]-[hash][extname]";
          return "media/[name]-[hash][extname]";
        },
      },
    },
  },
});
