import { env } from "node:process";
import { defineConfig } from "@playwright/test";

const appUrl = "http://127.0.0.1:4173/DoongDoong/";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(env.CI),
  retries: env.CI ? 2 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "list",
  use: {
    baseURL: appUrl,
    browserName: "chromium",
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // The placeholder configuration exercises the real signed-out login path
    // without coupling this public PWA smoke test to a live Supabase project.
    command: "VITE_SUPABASE_URL=https://example.invalid VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.invalid npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    url: appUrl,
    reuseExistingServer: !env.CI,
    timeout: 120_000,
  },
});
