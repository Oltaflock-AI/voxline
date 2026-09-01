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

/**
 * Service-role client, for cleanup only.
 *
 * `agent_requests` deliberately has no client-facing DELETE policy — stage is
 * Oltaflock's to control, and an agency able to delete its own request would
 * drop itself out of the queue. That means a test cannot tidy up after itself
 * with the signed-in client it used to create the row: the delete is refused
 * silently and the row is left behind, which is exactly what happened until
 * these rows started appearing in the admin queue.
 */
function serviceClient() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

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

  /**
   * Agent requests carry an agency's commercial detail — pricing documents,
   * what they tell callers, their escalation number. They are the newest
   * tenant-scoped table, so they get the same treatment as the rest.
   */
  test("agent requests and their files are scoped to the tenant", async () => {
    const marco = await signIn("marco@voxline.test"); // Blue Harbor only
    const elena = await signIn("elena@voxline.test"); // Wanderlux only

    const { data: created, error: insertError } = await marco
      .from("agent_requests")
      .select("id")
      .limit(0);
    expect(insertError).toBeNull();
    expect(created).toEqual([]);

    // Marco files a request for his own agency — allowed.
    const { data: mine, error: ownError } = await marco
      .from("agent_requests")
      .insert({
        tenant_id: BLUE_HARBOR,
        user_id: (await marco.auth.getUser()).data.user!.id,
        kind: "new_agent",
        payload: { greeting: "Blue Harbor commercial detail" },
      })
      .select("id")
      .single();
    expect(ownError).toBeNull();

    // Elena, in the other agency, must not see it at all.
    const { data: elenaSees } = await elena
      .from("agent_requests")
      .select("id")
      .eq("id", mine!.id);
    expect(elenaSees ?? []).toEqual([]);

    // Nor may she attach a file to it.
    const { error: fileError } = await elena.from("agent_request_files").insert({
      request_id: mine!.id,
      tenant_id: BLUE_HARBOR,
      storage_path: `${BLUE_HARBOR}/${mine!.id}/stolen.pdf`,
      filename: "stolen.pdf",
      size_bytes: 10,
      mime_type: "application/pdf",
    });
    expect(fileError).not.toBeNull();

    await serviceClient().from("agent_requests").delete().eq("id", mine!.id);
  });

  test("a client cannot file a request for another agency", async () => {
    const marco = await signIn("marco@voxline.test");
    const { error } = await marco.from("agent_requests").insert({
      tenant_id: WANDERLUX,
      user_id: (await marco.auth.getUser()).data.user!.id,
      kind: "new_agent",
      payload: {},
    });
    expect(error).not.toBeNull();
  });

  test("a client cannot advance their own request's stage", async () => {
    // `stage` is Oltaflock's to write. An agency that could set its own
    // request to "completed" would quietly drop itself out of the queue.
    const marco = await signIn("marco@voxline.test");
    const userId = (await marco.auth.getUser()).data.user!.id;

    const { data: mine } = await marco
      .from("agent_requests")
      .insert({
        tenant_id: BLUE_HARBOR,
        user_id: userId,
        kind: "new_agent",
        payload: {},
      })
      .select("id, stage")
      .single();
    expect(mine!.stage).toBe("submitted");

    // No update policy exists, so this changes nothing rather than erroring.
    await marco
      .from("agent_requests")
      .update({ stage: "completed" })
      .eq("id", mine!.id);

    const { data: after } = await marco
      .from("agent_requests")
      .select("stage")
      .eq("id", mine!.id)
      .single();
    expect(after!.stage, "stage is unchanged by the client").toBe("submitted");

    await serviceClient().from("agent_requests").delete().eq("id", mine!.id);
  });

  test("a client cannot delete their own request out of the queue", async () => {
    // Withdrawing a request is Oltaflock's call, made by setting the stage to
    // cancelled — which keeps the record. A client DELETE would erase the
    // request from the admin queue with nothing left to say it existed.
    const marco = await signIn("marco@voxline.test");
    const userId = (await marco.auth.getUser()).data.user!.id;

    const { data: mine } = await marco
      .from("agent_requests")
      .insert({
        tenant_id: BLUE_HARBOR,
        user_id: userId,
        kind: "new_agent",
        payload: {},
      })
      .select("id")
      .single();

    await marco.from("agent_requests").delete().eq("id", mine!.id);

    const { data: after } = await marco
      .from("agent_requests")
      .select("id")
      .eq("id", mine!.id);
    expect(after ?? [], "the request survives a client delete").toHaveLength(1);

    await serviceClient().from("agent_requests").delete().eq("id", mine!.id);
  });

  test("uploaded documents are unreadable across tenants", async () => {
    const marco = await signIn("marco@voxline.test");
    const elena = await signIn("elena@voxline.test");
    const key = `${BLUE_HARBOR}/${crypto.randomUUID()}/pricing.txt`;

    const { error: uploadError } = await marco.storage
      .from("agent-documents")
      .upload(key, new Blob(["confidential pricing"], { type: "text/plain" }), {
        contentType: "text/plain",
      });
    expect(uploadError, "an agency can upload into its own folder").toBeNull();

    // Elena cannot download it...
    const { data: stolen } = await elena.storage
      .from("agent-documents")
      .download(key);
    expect(stolen).toBeNull();

    // ...nor mint a signed link to hand to anyone else.
    const { data: signed } = await elena.storage
      .from("agent-documents")
      .createSignedUrl(key, 60);
    expect(signed).toBeNull();

    // ...nor write into Blue Harbor's folder herself.
    const { error: intrusion } = await elena.storage
      .from("agent-documents")
      .upload(`${BLUE_HARBOR}/${crypto.randomUUID()}/planted.txt`, new Blob(["x"]), {
        contentType: "text/plain",
      });
    expect(intrusion).not.toBeNull();

    await marco.storage.from("agent-documents").remove([key]);
  });
});
