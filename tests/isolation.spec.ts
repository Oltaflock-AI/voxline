import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * ============================================================================
 * CROSS-TENANT ISOLATION — spec §8.
 *
 *   "Tenant isolation. RLS on every tenant table, with an automated
 *    cross-tenant access test running in CI. This is the single most important
 *    requirement in the project. A feature that ships without it is not
 *    shipped."
 *
 * Spec §9 lists it under "Never cut".
 * ============================================================================
 *
 * These tests go through the Supabase API as a real signed-in user, NOT
 * through the UI. That is deliberate: the UI could be hiding rows with a
 * filter while the API hands them over to anyone with a session token and
 * curl. What we need to prove is that the DATABASE refuses, so we ask the
 * database directly, exactly the way an attacker would.
 *
 * Seeded users (supabase/seed.sql):
 *   sofia@voxline.test  both tenants  337 calls
 *   marco@voxline.test  Blue Harbor    96 calls
 *   elena@voxline.test  Wanderlux     241 calls
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const BLUE_HARBOR = "11111111-1111-1111-1111-111111111111";
const WANDERLUX = "22222222-2222-2222-2222-222222222222";
const PASSWORD = "voxline-dev-only";

async function signIn(email: string) {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return supabase;
}

test.describe("cross-tenant isolation", () => {
  test("a single-tenant user sees only their own calls", async () => {
    const marco = await signIn("marco@voxline.test");

    const { data: all } = await marco.from("calls").select("tenant_id");
    expect(all).not.toBeNull();
    expect(all!.length).toBeGreaterThan(0); // guard: an empty result is not proof
    expect(all!.every((c) => c.tenant_id === BLUE_HARBOR)).toBe(true);
  });

  test("naming another tenant's id explicitly returns nothing", async () => {
    const marco = await signIn("marco@voxline.test");

    // The attack: ask for it directly. RLS should make it simply not exist,
    // with no error to distinguish "forbidden" from "empty".
    const { data, error } = await marco
      .from("calls")
      .select("id")
      .eq("tenant_id", WANDERLUX);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("leads, invoices and usage are scoped too", async () => {
    const elena = await signIn("elena@voxline.test");

    for (const table of ["leads", "invoices", "usage_periods"] as const) {
      const { data } = await elena.from(table).select("tenant_id");
      expect(
        data?.every((r) => r.tenant_id === WANDERLUX),
        `${table} leaked a row from another tenant`
      ).toBe(true);
    }
  });

  test("a user cannot move another tenant's lead", async () => {
    // This is what leads_update_tenant's `using` clause is for.
    const elena = await signIn("elena@voxline.test");
    const sofia = await signIn("sofia@voxline.test");

    const { data: bhLead } = await sofia
      .from("leads")
      .select("id, stage")
      .eq("tenant_id", BLUE_HARBOR)
      .limit(1)
      .single();

    const { data: updated } = await elena
      .from("leads")
      .update({ stage: "booked" })
      .eq("id", bhLead!.id)
      .select("id");

    // No rows matched the policy, so nothing was updated.
    expect(updated ?? []).toEqual([]);

    const { data: after } = await sofia
      .from("leads")
      .select("stage")
      .eq("id", bhLead!.id)
      .single();
    expect(after!.stage).toBe(bhLead!.stage);
  });

  test("a user cannot re-home their own lead into another tenant", async () => {
    // This is the one `using` alone would miss, and why leads_update_tenant
    // needs `with check` as well: the row is legitimately Elena's going in,
    // and illegitimate coming out.
    const elena = await signIn("elena@voxline.test");

    const { data: own } = await elena
      .from("leads")
      .select("id")
      .limit(1)
      .single();

    const { data: updated } = await elena
      .from("leads")
      .update({ tenant_id: BLUE_HARBOR })
      .eq("id", own!.id)
      .select("id");

    expect(updated ?? []).toEqual([]);
  });

  test("clients cannot write to read-only tables", async () => {
    const marco = await signIn("marco@voxline.test");

    // Calls come from the webhook on the service role. A client inserting one
    // could fabricate call history in their own portal.
    const { error } = await marco.from("calls").insert({
      tenant_id: BLUE_HARBOR,
      provider_call_id: `forged_${Date.now()}`,
      started_at: new Date().toISOString(),
      duration_seconds: 60,
    });
    expect(error).not.toBeNull();
  });

  test("the audit log is invisible to clients", async () => {
    const sofia = await signIn("sofia@voxline.test");
    const { data } = await sofia.from("audit_log").select("id");
    expect(data ?? []).toEqual([]);
  });
});
