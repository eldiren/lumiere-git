import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // `assets/` (app icon, shared with electron-builder) is outside SvelteKit's default fs allowlist.
  server: { port: 5178, strictPort: true, fs: { allow: ["assets"] } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});
