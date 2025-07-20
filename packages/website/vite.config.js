import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolve } from "node:path";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite({ autoCodeSplitting: true }),
    viteReact(),
    tailwindcss(),
    {
      name: "vite-plugin-md",
      transform(code, id) {
        if (id.endsWith(".md")) {
          return `export default ${JSON.stringify(code)};`;
        }
      },
    },
  ],
  build: {
    chunkSizeWarningLimit: 1000,
    // Allow multiple builds to be run in parallel
    emptyOutDir: false,
  },
  test: {
    globals: true,
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/_internal": {
        target: "http://localhost:4113",
      },
      "/slack": {
        target: "http://localhost:4113",
      },
      "/github": {
        target: "http://localhost:4113",
      },
      "/api": {
        target: "http://localhost:4113",
      },
      "/api/events": {
        target: "ws://localhost:4113",
        ws: true,
      },
    },
  },
});
