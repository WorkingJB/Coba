import { defineConfig } from "vite";
import { resolve } from "path";

// Plain Vite. The game client is DOM + the shared TS engine in src/.
// No framework — step 2 is about validating the loop with a human, fast.
//
// Multi-page build: `main` is the game SPA (index.html, served on app.coba.games),
// `marketing` is the coming-soon page (marketing.html, served on www.coba.games).
// The server picks which one to send per Host header (server/index.ts).
export default defineConfig({
  server: { open: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        marketing: resolve(__dirname, "marketing.html"),
      },
    },
  },
});
