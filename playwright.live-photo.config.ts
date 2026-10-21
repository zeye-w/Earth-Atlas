import {defineConfig} from "@playwright/test";
import base from "./playwright.config";

// The full Live Photo flow needs a browser with an H.264 WebCodecs encoder:
// Google Chrome or Safari, not the open-source Chromium build Playwright ships.
// Run with LIVE_PHOTO_CHANNEL=chrome (as .github/workflows/live-photo.yml does).
export default defineConfig({
  ...base,
  testDir: "tests/live-photo",
  testMatch: "*.spec.ts",
  timeout: 180_000,
  use: {
    ...base.use,
    channel: process.env.LIVE_PHOTO_CHANNEL || undefined,
    acceptDownloads: true,
    launchOptions: {...base.use?.launchOptions, executablePath: process.env.LIVE_PHOTO_CHANNEL ? undefined : base.use?.launchOptions?.executablePath},
  },
});
