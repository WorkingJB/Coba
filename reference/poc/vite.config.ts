import { defineConfig } from "vite";

// Plain Vite. The game client is DOM + the shared TS engine in src/.
// No framework — step 2 is about validating the loop with a human, fast.
export default defineConfig({
  server: { open: true },
});
