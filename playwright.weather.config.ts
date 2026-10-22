import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/weather-browser",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    baseURL: "http://localhost:5182",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "npx vite preview --port 5182 --strictPort",
    url: "http://localhost:5182",
    reuseExistingServer: true,
  },
});
