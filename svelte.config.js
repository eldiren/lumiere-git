import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
    }),
    // The app is loaded from file:// in production.
    paths: { relative: true },
    router: { type: "hash" },
    alias: { $shared: "electron/shared" },
  },
};
