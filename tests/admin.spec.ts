import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * ============================================================================
 * Internal admin console — spec §6.7.
 * ============================================================================
 *
 * Every page here runs on the service role and can see, edit or pause any
 * agency on the platform. That makes the guard the single most important thing
 * to test: a new route added under /admin inherits protection from the layout,
 * and this suite is what proves the inheritance actually holds rather than
 * being assumed.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "voxline-dev-only";

const ADMIN_ROUTES = [
  "/admin",
  "/admin/agencies",
  "/admin/agencies/new",
  "/admin/webhooks",
];

const admin = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("admin console access", () => {
  test("a signed-out visitor gets no admin page", async ({ page }) => {
    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      await expect(page, `${route} let a signed-out visitor in`).toHaveURL(
        /\/login/
      );
    }
  });

  test("an agency user is bounced off every admin route", async ({ page }) => {
    // Sofia is an owner of two agencies and still not platform staff.
    await login(page, "sofia@voxline.test");

    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      await expect(page, `${route} was reachable by a client`).not.toHaveURL(
        /\/admin/
      );
    }
  });

  test("a platform admin gets the queue", async ({ page }) => {
    await login(page, "admin@voxline.test");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
    // The stat tiles are the fastest regression signal: "Calls handled" read 0
    // for every agency because the count was destructured from `data`.
    await expect(page.getByText("Calls handled")).toBeVisible();
  });
});

test.describe("admin console works", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin@voxline.test");
  });

  test("agencies are listed and searchable", async ({ page }) => {
    await page.goto("/admin/agencies");
    await expect(page.getByRole("link", { name: "Blue Harbor Travel" })).toBeVisible();

    await page.goto("/admin/agencies?q=wanderlux");
    await expect(page.getByRole("link", { name: "Wanderlux Journeys" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Blue Harbor Travel" })
    ).toHaveCount(0);
  });

  test("an agency's detail page shows its agent and members", async ({ page }) => {
    const db = admin();
    const { data: tenant } = await db
      .from("tenants")
      .select("id")
      .eq("slug", "blueharbor")
      .single();

    await page.goto(`/admin/agencies/${tenant!.id}`);
    await expect(
      page.getByRole("heading", { name: "Blue Harbor Travel" })
    ).toBeVisible();
    // `exact` matters: "Connect a voice agent" now renders below the agent's
    // own card, always rather than only when the agency has none, so an agency
    // can be given a second line. A loose match hits both headings.
    await expect(
      page.getByRole("heading", { name: "Voice agent", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Connect a voice agent" })
    ).toBeVisible();
    await expect(page.getByText("sofia@voxline.test")).toBeVisible();
  });

  test("creating an agency rejects a bad URL name", async ({ page }) => {
    await page.goto("/admin/agencies/new");
    await page.fill("#ag-name", "Bad Slug Test");
    await page.fill("#ag-slug", "Not A Slug!");
    await page.getByRole("button", { name: "Create agency" }).click();

    await expect(page.locator(".auth-err")).toContainText("URL name");

    // Nothing was written on a rejected submit.
    const { count } = await admin()
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .eq("name", "Bad Slug Test");
    expect(count).toBe(0);
  });

  test("a duplicate URL name is refused", async ({ page }) => {
    await page.goto("/admin/agencies/new");
    await page.fill("#ag-name", "Clashing Agency");
    await page.fill("#ag-slug", "blueharbor");
    await page.getByRole("button", { name: "Create agency" }).click();

    await expect(page.locator(".auth-err")).toContainText("already taken");
  });

  test("webhook URLs are shown per agent", async ({ page }) => {
    await page.goto("/admin/webhooks");
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
    // Every Sarvam agent must have a reachable URL. A null webhook_token used
    // to produce an agent Sarvam could never deliver to, silently.
    await expect(page.getByText("/api/webhooks/sarvam/").first()).toBeVisible();
    await expect(page.getByText("No webhook token")).toHaveCount(0);
  });

  test("an agency with no agent offers to connect one", async ({ page }) => {
    // A throwaway tenant with no voice_agents row, so the empty state renders.
    const slug = `noagent-${Date.now().toString(36)}`;
    const { data: tenant } = await admin()
      .from("tenants")
      .insert({ name: "No Agent Yet", slug, initials: "NA" })
      .select("id")
      .single();

    await page.goto(`/admin/agencies/${tenant!.id}`);

    await expect(page.getByRole("heading", { name: "Connect a voice agent" })).toBeVisible();
    const picker = page.getByLabel("Provider");
    await expect(picker).toHaveValue("sarvam");
    // The disabled providers are listed and say so, rather than being hidden.
    await expect(picker.locator("option", { hasText: "Vapi — not yet" })).toHaveCount(1);
    await expect(picker.locator("option", { hasText: "Retell AI — not yet" })).toHaveCount(1);
  });

  test("a linked agent shows its verification status", async ({ page }) => {
    // Blue Harbor's seeded Sarvam agent was never linked through the console,
    // so it must read as unverified rather than pretend otherwise.
    await page.goto("/admin/agencies/11111111-1111-1111-1111-111111111111");
    await expect(page.getByText("Webhook not verified")).toBeVisible();
  });

  test("go-live gate: an unverified Sarvam agent cannot be silently resumed", async ({ page }) => {
    // Blue Harbor's seeded agent is `live` (seed.sql), never verified. Since
    // it is already live the button reads "Pause agent" and pausing needs no
    // gate, so the observable signal is the Verify webhook affordance from
    // the unverified path, not a disabled Resume button.
    await page.goto("/admin/agencies/11111111-1111-1111-1111-111111111111");
    await expect(page.getByRole("button", { name: "Pause agent" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Verify webhook" })).toBeVisible();
  });

  test("a paused, unverified Sarvam agent cannot be resumed", async ({ page }) => {
    // The seeded agent is already live, so it cannot exercise the disabled
    // Resume button — the state this gate exists for. Build that state: a
    // paused Sarvam agent with no webhook_verified_at, which is exactly what
    // every agent created before the linking columns existed looks like.
    const suffix = Date.now().toString(36);
    const { data: tenant } = await admin()
      .from("tenants")
      .insert({ name: "Paused Unverified", slug: `paused-${suffix}`, initials: "PU" })
      .select("id")
      .single();

    await admin().from("voice_agents").insert({
      tenant_id: tenant!.id,
      name: "Unverified Line",
      provider: "sarvam",
      provider_agent_id: `app-paused-${suffix}`,
      status: "paused",
    });

    await page.goto(`/admin/agencies/${tenant!.id}`);

    const resume = page.getByRole("button", { name: "Resume agent" });
    await expect(resume).toBeDisabled();
    await expect(resume).toHaveAttribute("title", "Verify the Sarvam webhook first");
  });
});
