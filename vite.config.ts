import path from "path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

/**
 * Jazz embeds the app in a sandboxed iframe (origin "null").
 * ES module scripts and `crossorigin` stylesheets require CORS;
 * the S3 bucket does not send ACAO, so those loads fail. Emit a
 * classic deferred IIFE and drop CORS attributes.
 */
function jazzClassicAssets() {
  return {
    name: "jazz-classic-assets",
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string) {
        return html
          .replace(
            /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
            '<script defer src="$1"></script>',
          )
          .replace(
            /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
            '<link rel="stylesheet" href="$1">',
          )
          .replace(/<link rel="modulepreload"[^>]*>/g, "");
      },
    },
  };
}

export default defineConfig({
  base: "./",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), jazzClassicAssets()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  build: {
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
