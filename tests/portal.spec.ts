import { test, expect } from "@playwright/test";

/**
 * Critical-path end-to-end tests — spec §8:
 * "Playwright end-to-end tests on the critical paths: login to dashboard,
 *  open a call record, move a pipeline stage, cross-tenant denial."
 *
 * Cross-tenant denial lives in isolation.spec.ts, where it can go through the
 * API rather than the UI.
 */

const EMAIL = "sofia@voxline.test";
const PASSWORD = "voxline-dev-only";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function readKpi(
  page: import("@playwright/test").Page,
  label: string
) {
  const card = page.locator(".kpi", { hasText: label });
  await expect(card).toBeVisible();
  await expect(card.locator(".kpi-val b")).toHaveText(/^\d+$/);
  return Number(await card.locator(".kpi-val b").textContent());
}

test("login lands on the dashboard with real figures", async ({ page }) => {
  await login(page);

  await expect(page.getByRole("heading", { name: "Blue Harbor Travel" })).toBeVisible();

  // This is a rolling seven-day total, so a fixed seed value becomes stale as
  // the calendar advances and local development retains genuine inbound calls.
  expect(await readKpi(page, "Calls handled")).toBeGreaterThan(0);
});

test("protected routes bounce a signed-out visitor to login", async ({ page }) => {
  await page.goto("/app/blueharbor");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a call opens a dedicated page with its transcript and trip brief", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /^Calls/ }).click();

  await page.locator(".call-head").first().click();

  await expect(page).toHaveURL(/\/app\/blueharbor\/calls\/[0-9a-f-]+$/);
  await expect(page.locator(".call-detail")).toBeVisible();
  await expect(page.locator(".transcript-card .turn").first()).toBeVisible();
  await expect(page.locator(".call-detail-brief")).toBeVisible();
  await page.getByRole("link", { name: "Back to calls" }).click();
  await expect(page).toHaveURL(/\/app\/blueharbor\/calls$/);
});

test("recent calls open the same dedicated detail view", async ({ page }) => {
  await login(page);
  await page.locator(".call-head").first().click();

  await expect(page).toHaveURL(/\/app\/blueharbor\/calls\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
});

test("a call id cannot be viewed through the wrong tenant route", async ({ page }) => {
  await login(page);

  // This seeded call belongs to Blue Harbor. Sofia belongs to both agencies,
  // so a 404 here proves the page scopes by call AND tenant rather than merely
  // relying on the user's broad membership set.
  await page.goto(
    "/app/wanderlux/calls/44444444-0000-0000-0000-000000000001"
  );
  // Voxline's own branded 404 (src/app/not-found.tsx), not Next's generic
  // default text — deliberately vague about *why*, so this also doubles as
  // proof the page never confirms whether Blue Harbor is even a customer.
  await expect(page.getByText("We couldn’t find that page")).toBeVisible();
});

test("the tenant switcher changes the data on screen", async ({ page }) => {
  await login(page);
  const blueHarborCalls = await readKpi(page, "Calls handled");

  await page.locator(".switcher-btn").click();
  await page.getByRole("menuitem", { name: /Wanderlux/ }).click();

  await expect(page.getByRole("heading", { name: "Wanderlux Journeys" })).toBeVisible();
  expect(await readKpi(page, "Calls handled")).not.toBe(blueHarborCalls);
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

  await expect(
    page.getByText("The Voxline team makes your changes.")
  ).toBeVisible();
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
