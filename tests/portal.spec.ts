import { test, expect } from "@playwright/test";

/**
 * Critical-path end-to-end tests — spec §8:
 * "Playwright end-to-end tests on the critical paths: login to dashboard,
 *  expand a call, move a pipeline stage, cross-tenant denial."
 *
 * Cross-tenant denial lives in isolation.spec.ts, where it can go through the
 * API rather than the UI.
 */

const EMAIL = "sofia@voxline.test";
const PASSWORD = "voxline-dev-only";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("login lands on the dashboard with real figures", async ({ page }) => {
  await login(page);

  await expect(page.getByRole("heading", { name: "Blue Harbor Travel" })).toBeVisible();

  // 96 calls is the seeded 7-day volume. Asserting the number and not just
  // "a number is present" is what catches a broken date window or a KPI that
  // silently counts every call ever.
  await expect(page.getByText("Calls handled")).toBeVisible();
  await expect(page.getByText("96", { exact: true }).first()).toBeVisible();
});

test("protected routes bounce a signed-out visitor to login", async ({ page }) => {
  await page.goto("/app/blueharbor");
  await expect(page).toHaveURL(/\/login\?next=/);
});

/**
 * CallList is a Client Component, so a click that lands before React has
 * hydrated is silently dropped — Playwright sees the click succeed and never
 * retries, because the element was there. That made these tests flake roughly
 * one run in ten.
 *
 * `expect(...).toPass()` retries the whole click-then-assert block, so an
 * early click is simply tried again rather than failing the build.
 */
async function openCallRow(page: import("@playwright/test").Page, nth = 0) {
  await expect(async () => {
    await page.locator(".call-head").nth(nth).click();
    await expect(page.locator(".call.open")).toHaveCount(1);
  }).toPass({ timeout: 15_000 });
}

test("a call expands to its transcript and trip brief", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /^Calls/ }).click();

  await openCallRow(page);

  await expect(page.locator(".call.open .turn").first()).toBeVisible();
});

test("only one call is open at a time", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /^Calls/ }).click();

  await openCallRow(page, 0);
  await page.locator(".call-head").nth(1).click();

  // Spec §6.3. Easy to regress the moment open state moves into the row.
  await expect(page.locator(".call.open")).toHaveCount(1);
});

test("the tenant switcher changes the data on screen", async ({ page }) => {
  await login(page);

  await page.locator(".switcher-btn").click();
  await page.getByRole("menuitem", { name: /Wanderlux/ }).click();

  await expect(page.getByRole("heading", { name: "Wanderlux Journeys" })).toBeVisible();
  await expect(page.getByText("241", { exact: true }).first()).toBeVisible();
});

test("the pipeline shows all four stages", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /Trip Pipeline/ }).click();

  // Each stage name also now appears inside every card's stage dropdown, so
  // a plain text search matches several elements. .col-head b is specifically
  // the column heading, not an <option> inside a <select>.
  for (const stage of ["New inquiry", "Quoted", "Booked", "Traveling"]) {
    await expect(page.locator(".col-head b", { hasText: stage })).toBeVisible();
  }
});

test("agent setup is read-only and says so", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /Agent Setup/ }).click();

  await expect(page.getByText("Configuration is concierge-managed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a change" })).toBeVisible();
});

test("both themes render", async ({ page }) => {
  await login(page);

  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  await page.getByLabel("Toggle theme").click();
  await expect(html).not.toHaveAttribute("data-theme", before ?? "dark");
});

/**
 * TODO(adnan): add a test here once the pipeline stage control lands.
 * Spec §8 names "move a pipeline stage" as a critical path. Shape:
 *   1. go to the pipeline
 *   2. change the stage control on the first card in "New inquiry"
 *   3. assert the card is now under "Quoted"
 *   4. reload and assert it is STILL under "Quoted" — otherwise you have
 *      tested React state, not persistence, which is the whole point.
 */
