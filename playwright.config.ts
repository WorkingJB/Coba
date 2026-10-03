import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: { baseURL: "http://localhost:8080", trace: "retain-on-failure" },
  webServer: {
    command: "npm start",
    url: "http://localhost:8080/health/ready",
    reuseExistingServer: false,
    env: {
      APP_ORIGIN: "http://localhost:8080",
      PLAYTEST_ACCESS_KEY: "cloud-ci-playtest-key",
      NODE_ENV: "test",
    },
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
