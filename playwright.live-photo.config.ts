import {defineConfig} from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "tests/live-photo",
  testMatch: "*.spec.ts",
  use: {...base.use, baseURL: "http://localhost:5175", viewport: {width: 1100, height: 760}, launchOptions: {...base.use?.launchOptions, args: process.platform === "win32" ? ["--use-angle=d3d11"] : base.use?.launchOptions?.args}},
  webServer: [
    {command: "npm run dev -- --host 127.0.0.1 --port 5175 --strictPort", url: "http://localhost:5175", reuseExistingServer: !process.env.CI, timeout: 60_000},
    {command: "npm start --prefix tools/live-photo", url: "http://127.0.0.1:4174/api/live-photo/health", reuseExistingServer: !process.env.CI, timeout: 60_000},
  ],
});
