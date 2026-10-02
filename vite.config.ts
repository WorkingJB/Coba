import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/web",
  build: { outDir: "../../web-dist", emptyOutDir: true },
});
