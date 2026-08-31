import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// The isolation tests talk to Supabase directly, so they need the same env the
// app uses. Playwright does not read .env.local on its own.
dotenv.config({ path: ".env.local" });

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // A test that only passes when it runs alone is a test that will flake in
  // CI. Fail the build rather than letting one through.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Reuses a dev server if one is already up, so running these locally does
  // not fight the server you already have open.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
