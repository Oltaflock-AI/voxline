import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// The isolation tests talk to Supabase directly, so they need the same env the
// app uses. Playwright does not read any .env file on its own.
//
// ORDER MATTERS, and it mirrors Next's own precedence: .env.development.local
// is read BEFORE .env.local, and dotenv does not overwrite a variable that is
// already set, so the first file to define a key wins.
//
// Loading only .env.local was wrong. `vercel env pull` overwrites that file
// with the DEPLOYED configuration, which points at the production database, so
// the whole suite silently ran against production. Twenty-seven tests failed
// looking for seed data that production correctly does not have, and the two
// that would have been alarming — the cross-tenant isolation checks — were
// failing for the same boring reason rather than a real security regression.
dotenv.config({ path: ".env.development.local" });
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
