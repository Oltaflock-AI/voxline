import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import http from "node:http";

/**
 * ============================================================================
 * Call ingestion and aggregation — regression tests for bugs found in review.
 * ============================================================================
 *
 * These use the service-role client directly rather than the UI, because what
 * is being tested is data correctness under conditions the UI cannot create:
 * retried webhooks, concurrent deliveries, and volumes above PostgREST's
 * 1000-row response cap.
 *
 * Every test works on its own throwaway tenant so it cannot interfere with the
 * seeded demo agencies or with tests running in parallel.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WEBHOOK_SECRET = process.env.RETELL_WEBHOOK_SECRET!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const admin = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

/**
 * A real, if silent, WAV: 44-byte canonical header plus one sample. The
 * recording tests need bytes that survive a round trip through fetch, Supabase
 * storage and back, and a hand-built header proves the pipeline without
 * carrying a binary fixture in the repo.
 */
function tinyWav() {
  const data = Buffer.from([0x00, 0x00]);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(8000, 24); // sample rate
  header.writeUInt32LE(16000, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Serve that WAV over real HTTP, because that is what the provider does. A
 * `https://example.invalid/...` URL cannot distinguish "we downloaded the
 * audio" from "we wrote a path and never fetched anything" — which is exactly
 * how the missing-recording bug survived until 2026-08-29.
 */
async function serveAudio() {
  const wav = tinyWav();
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
    res.end(wav);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/recording.wav`,
    bytes: wav.length,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A tenant + voice agent that exists only for one test. */
async function makeScratchTenant(
  label: string,
  provider: "retell" | "sarvam" = "retell"
) {
  const db = admin();
  const suffix = crypto.randomBytes(6).toString("hex");
  const slug = `scratch-${label}-${suffix}`;

  const { data: tenant, error: tErr } = await db
    .from("tenants")
    .insert({ name: `Scratch ${label}`, slug, initials: "SC" })
    .select("id")
    .single();
  if (tErr) throw tErr;

  const retellAgentId = `scratch_agent_${suffix}`;
  const webhookToken = crypto.randomBytes(32).toString("hex");
  const { data: agent, error: aErr } = await db
    .from("voice_agents")
    .insert({
      tenant_id: tenant.id,
      provider,
      provider_agent_id: retellAgentId,
      webhook_token: webhookToken,
      name: `Scratch agent ${label}`,
      status: "live",
    })
    .select("id")
    .single();
  if (aErr) throw aErr;

  return {
    tenantId: tenant.id as string,
    agentId: agent.id as string,
    retellAgentId,
    webhookToken,
    async cleanup() {
      // calls/leads/voice_agents all cascade from tenants.
      await db.from("tenants").delete().eq("id", tenant.id);
    },
  };
}

function signedRequest(payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("hex");
  return fetch(`${APP_URL}/api/webhooks/retell`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-retell-signature": signature },
    body,
  });
}

test.describe("Retell ingestion", () => {
  test("rejects a bad signature", async () => {
    const res = await fetch(`${APP_URL}/api/webhooks/retell`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-retell-signature": "0".repeat(64) },
      body: JSON.stringify({ event: "call_ended", call: { call_id: "x", agent_id: "y" } }),
    });
    expect(res.status).toBe(401);
  });

  test("concurrent duplicate deliveries produce one call, one lead, and bill once", async () => {
    // Retell retries on timeout, and call_ended/call_analyzed describe the same
    // call. Before the fix: the call row was idempotent but add_call_minutes()
    // was not, so a retry silently double-billed; and lead creation was a
    // check-then-insert race that could produce two cards for one caller.
    const scratch = await makeScratchTenant("concurrency");
    const db = admin();
    const callId = `race_${crypto.randomBytes(4).toString("hex")}`;

    const payload = {
      event: "call_ended",
      call: {
        call_id: callId,
        agent_id: scratch.retellAgentId,
        from_number: "+1 (305) 555-0100",
        start_timestamp: Date.now() - 60_000,
        duration_ms: 300_000, // exactly 5 minutes
        call_analysis: {
          custom_analysis_data: {
            caller_name: "Race Tester",
            outcome: "inquiry_captured",
            destination: "Peru",
            dates: "March",
          },
        },
      },
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => signedRequest(payload))
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const { count: callRows } = await db
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("provider_call_id", callId);
    expect(callRows, "one call row despite 8 deliveries").toBe(1);

    const { data: call } = await db
      .from("calls")
      .select("id")
      .eq("provider_call_id", callId)
      .single();

    const { count: leadRows } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("call_id", call!.id);
    expect(leadRows, "one lead despite 8 deliveries").toBe(1);

    const { data: usage } = await db
      .from("usage_periods")
      .select("minutes_used")
      .eq("tenant_id", scratch.tenantId)
      .single();
    expect(Number(usage!.minutes_used), "5 minutes billed exactly once").toBe(5);

    await scratch.cleanup();
  });

  test("a sparse follow-up event does not blank fields the first one set", async () => {
    // call_analyzed often omits duration, recording and phone number. Writing
    // the whole object unconditionally wiped what call_ended had stored.
    const scratch = await makeScratchTenant("merge");
    const db = admin();
    const audio = await serveAudio();
    const callId = `merge_${crypto.randomBytes(4).toString("hex")}`;

    await signedRequest({
      event: "call_ended",
      call: {
        call_id: callId,
        agent_id: scratch.retellAgentId,
        from_number: "+1 (305) 555-0222",
        start_timestamp: Date.now() - 60_000,
        duration_ms: 272_000,
        recording_url: audio.url,
        transcript_object: [
          { role: "agent", content: "Where are you dreaming of going?", words: [{ start: 0 }] },
          { role: "user", content: "Iceland, in February.", words: [{ start: 5 }] },
        ],
        call_analysis: { custom_analysis_data: { outcome: "inquiry_captured" } },
      },
    });

    // Analysis only — no duration, recording, phone or timestamp.
    await signedRequest({
      event: "call_analyzed",
      call: {
        call_id: callId,
        agent_id: scratch.retellAgentId,
        call_analysis: {
          custom_analysis_data: {
            outcome: "quote_requested",
            destination: "Iceland",
            dates: "February",
          },
        },
      },
    });

    const { data: call } = await db
      .from("calls")
      .select("duration_seconds, caller_phone, recording_path, transcript, outcome, analysis")
      .eq("provider_call_id", callId)
      .single();

    expect(call!.duration_seconds, "duration survives").toBe(272);
    expect(call!.caller_phone, "phone survives").toBe("+1 (305) 555-0222");
    expect(call!.recording_path, "recording survives").not.toBeNull();
    expect((call!.transcript as unknown[]).length, "transcript survives").toBe(2);
    // ...while the fields the second event *does* carry are updated.
    expect(call!.outcome, "outcome updated by the analyzed event").toBe("quote_requested");
    expect(
      (call!.analysis as { destination?: string }).destination,
      "analysis updated"
    ).toBe("Iceland");

    // Deleting the tenant does not delete its objects — storage lives outside
    // the cascade, so an uncleaned recording outlives every row that referenced
    // it and just accumulates in the bucket.
    if (call!.recording_path) {
      await db.storage.from("recordings").remove([call!.recording_path]);
    }
    await audio.close();
    await scratch.cleanup();
  });

  test("a recording is downloaded into the bucket, not just pointed at", async () => {
    // The bug: ingestion set recording_path from the payload alone and nothing
    // ever fetched the audio, so the portal showed a play control and asking
    // for a signed URL returned "Object not found". Asserting on the path is
    // what let that through — the object has to be asserted on too.
    const scratch = await makeScratchTenant("rec");
    const db = admin();
    const audio = await serveAudio();
    const callId = `rec_${crypto.randomBytes(4).toString("hex")}`;

    await signedRequest({
      event: "call_ended",
      call: {
        call_id: callId,
        agent_id: scratch.retellAgentId,
        from_number: "+1 (305) 555-0333",
        start_timestamp: Date.now() - 60_000,
        duration_ms: 60_000,
        recording_url: audio.url,
        call_analysis: { custom_analysis_data: { outcome: "inquiry_captured" } },
      },
    });

    expect(audio.hits(), "the provider URL was actually fetched").toBeGreaterThan(0);

    const { data: call } = await db
      .from("calls")
      .select("recording_path")
      .eq("provider_call_id", callId)
      .single();

    const path = call!.recording_path!;
    expect(path, "path is tenant-scoped, per the storage policy").toBe(
      `${scratch.tenantId}/retell_${callId}.wav`
    );

    // The object exists...
    const { data: dl, error: dlErr } = await db.storage
      .from("recordings")
      .download(path);
    expect(dlErr, "recording downloads from the bucket").toBeNull();
    expect(dl!.size, "bytes survived the round trip").toBe(audio.bytes);

    // ...and the portal's play control can actually sign it.
    const { data: signed, error: signErr } = await db.storage
      .from("recordings")
      .createSignedUrl(path, 300);
    expect(signErr, "a signed URL can be issued").toBeNull();
    expect(signed!.signedUrl).toContain(callId);

    await db.storage.from("recordings").remove([path]);
    await audio.close();
    await scratch.cleanup();
  });

  test("a recording the provider will not serve leaves the call intact", async () => {
    // A media endpoint that is down must not fail the webhook: the provider
    // would retry the whole delivery, re-running lead creation and minute
    // billing for the sake of an asset that is secondary to the call record.
    const scratch = await makeScratchTenant("recfail");
    const db = admin();
    const callId = `recfail_${crypto.randomBytes(4).toString("hex")}`;

    const res = await signedRequest({
      event: "call_ended",
      call: {
        call_id: callId,
        agent_id: scratch.retellAgentId,
        from_number: "+1 (305) 555-0444",
        start_timestamp: Date.now() - 60_000,
        duration_ms: 120_000,
        // Nothing listens here; the fetch fails.
        recording_url: "http://127.0.0.1:1/nope.wav",
        call_analysis: { custom_analysis_data: { outcome: "inquiry_captured" } },
      },
    });

    expect(res.status, "webhook still succeeds").toBe(200);

    const { data: call } = await db
      .from("calls")
      .select("id, duration_seconds, outcome, recording_path")
      .eq("provider_call_id", callId)
      .single();

    expect(call!.duration_seconds, "the call itself is stored").toBe(120);
    expect(call!.outcome).toBe("inquiry_captured");
    // Null, not a dangling path — the UI then correctly says there is no
    // recording rather than offering a control that errors.
    expect(call!.recording_path, "no dangling path when audio is unavailable").toBeNull();

    const { count } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("call_id", call!.id);
    expect(count, "the lead is still created").toBe(1);

    await scratch.cleanup();
  });
});


test.describe("Sarvam ingestion", () => {
  /**
   * Sarvam does not sign its webhooks — no HMAC, no secret header, nothing
   * documented. The URL token is therefore the whole credential, so these two
   * tests are the entire authentication story for this provider.
   */
  function sarvamRequest(token: string, payload: unknown) {
    return fetch(`${APP_URL}/api/webhooks/sarvam/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  test("rejects an unrecognised webhook token", async () => {
    const res = await sarvamRequest("0".repeat(64), {
      app_id: "whatever",
      attempt_id: "x",
    });
    expect(res.status).toBe(401);
  });

  test("rejects a body whose app_id disagrees with the token", async () => {
    // The token proves which agent is calling. A mismatched app_id means
    // either a misconfigured webhook or a forged body, and guessing which
    // would risk writing a call into the wrong tenant's portal.
    const scratch = await makeScratchTenant("sarvam-mismatch", "sarvam");
    const res = await sarvamRequest(scratch.webhookToken, {
      app_id: "some_other_agent",
      attempt_id: "x",
    });
    expect(res.status).toBe(401);
    await scratch.cleanup();
  });

  test("ingests a completed call: transcript, trip brief, lead and minutes", async () => {
    const scratch = await makeScratchTenant("sarvam-ok", "sarvam");
    const db = admin();
    const attemptId = `sv_${crypto.randomBytes(4).toString("hex")}`;

    // Shape taken verbatim from Sarvam's documented payload.
    const payload = {
      app_id: scratch.retellAgentId,
      attempt_id: attemptId,
      connectivity_status: "connected",
      completion_status: "completed",
      user_phone_number: "+919876543210",
      duration: 254.5,
      executed_at: new Date().toISOString(),
      final_agent_variables: {
        caller_name: "Ananya Iyer",
        outcome: "inquiry_captured",
        destination: "Kerala backwaters",
        dates: "Late November",
        party_size: "4 travellers",
        budget: "~Rs 1,80,000",
      },
      interaction_transcript: [
        { role: "agent", en_text: "Where are you dreaming of going?" },
        { role: "user", en_text: "Kerala, in November." },
      ],
    };

    // Twice, to prove idempotency on a provider that may retry.
    await sarvamRequest(scratch.webhookToken, payload);
    await sarvamRequest(scratch.webhookToken, payload);

    const { data: calls } = await db
      .from("calls")
      .select("id, provider, duration_seconds, caller_name, outcome, transcript, analysis")
      .eq("provider_call_id", attemptId);

    expect(calls!.length, "one row despite two deliveries").toBe(1);
    const call = calls![0];
    expect(call.provider).toBe("sarvam");
    expect(call.duration_seconds, "seconds, rounded from a float").toBe(255);
    expect(call.caller_name).toBe("Ananya Iyer");
    expect(call.outcome).toBe("inquiry_captured");
    expect((call.transcript as unknown[]).length).toBe(2);
    expect((call.analysis as { destination?: string }).destination).toBe(
      "Kerala backwaters"
    );

    const { count: leads } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("call_id", call.id);
    expect(leads, "one lead despite two deliveries").toBe(1);

    const { data: usage } = await db
      .from("usage_periods")
      .select("minutes_used")
      .eq("tenant_id", scratch.tenantId)
      .single();
    expect(Number(usage!.minutes_used), "254.5s billed once = 4.25 min").toBe(4.25);

    await scratch.cleanup();
  });

  test("an unanswered call is not a lead", async () => {
    // connectivity_status "failed" means nobody and nothing picked up — not a
    // voicemail, and certainly not a trip inquiry.
    const scratch = await makeScratchTenant("sarvam-noanswer", "sarvam");
    const db = admin();
    const attemptId = `sv_na_${crypto.randomBytes(4).toString("hex")}`;

    await sarvamRequest(scratch.webhookToken, {
      app_id: scratch.retellAgentId,
      attempt_id: attemptId,
      connectivity_status: "failed",
      completion_status: "failed",
      failure_reason: "TelephonyProvider: No Answer",
      user_phone_number: "+919876543211",
      duration: null,
      final_agent_variables: null,
      interaction_transcript: null,
    });

    const { data: call } = await db
      .from("calls")
      .select("id, outcome")
      .eq("provider_call_id", attemptId)
      .single();
    expect(call!.outcome).toBe("not_a_fit");

    const { count: leads } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("call_id", call!.id);
    expect(leads, "no lead for a call that never connected").toBe(0);

    await scratch.cleanup();
  });
});

test.describe("aggregation above the PostgREST row cap", () => {
  test("the Calls tab reports correct totals past 1000 calls", async ({ page }) => {
    // END-TO-END on purpose. An RPC-only test would still pass if someone
    // reverted the page to selecting raw rows and counting them in JS, which
    // is exactly the bug. This drives the real screen and reads the real chip.
    const scratch = await makeScratchTenant("ui-volume");
    const db = admin();
    const TOTAL = 1150;
    const password = "voxline-dev-only";
    const email = `volume-${crypto.randomBytes(5).toString("hex")}@voxline.test`;

    // A user of its own, so this cannot disturb the seeded demo accounts or
    // the switcher test running in parallel.
    const { data: created, error: userErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userErr) throw userErr;
    const userId = created.user!.id;

    await db.from("profiles").insert({
      id: userId,
      display_name: "Volume Tester",
      avatar_initials: "VT",
    });
    await db.from("memberships").insert({
      user_id: userId,
      tenant_id: scratch.tenantId,
      role: "owner",
    });

    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenant_id: scratch.tenantId,
      voice_agent_id: scratch.agentId,
      provider_call_id: `uivol_${scratch.tenantId}_${i}`,
      caller_name: `Volume ${i}`,
      started_at: new Date(Date.now() - (i % 5) * 86_400_000).toISOString(),
      duration_seconds: 120,
      outcome: i % 4 === 0 ? ("voicemail" as const) : ("inquiry_captured" as const),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("calls").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    const { data: tenantRow } = await db
      .from("tenants")
      .select("slug")
      .eq("id", scratch.tenantId)
      .single();

    await page.goto("/login");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/app/**");
    await page.goto(`/app/${tenantRow!.slug}/calls`);

    // The "All" chip and the sidebar count describe the same thing, and used
    // to disagree — 1000 vs the real total — which is how the bug surfaced.
    const allChip = page.locator(".f-chip", { hasText: "All" });
    await expect(allChip).toContainText(String(TOTAL));

    const voicemailChip = page.locator(".f-chip", { hasText: "Voicemail" });
    await expect(voicemailChip).toContainText(String(Math.ceil(TOTAL / 4)));

    await db.auth.admin.deleteUser(userId);
    await scratch.cleanup();
  });

  test("counts stay correct past 1000 calls", async () => {
    // THE BUG THIS GUARDS. Both the Overview and the Calls filter chips used to
    // select raw rows and tally them in JavaScript. PostgREST caps responses at
    // max_rows (1000) silently, so a tenant with 1,369 calls saw chips summing
    // to 1000 while the sidebar said 1369 — and because rows came back
    // oldest-first, the Overview's volume chart showed 0 calls for today.
    //
    // Spec §8 targets "thousands of calls", so this is a supported volume.
    const scratch = await makeScratchTenant("volume");
    const db = admin();
    const TOTAL = 1200;

    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenant_id: scratch.tenantId,
      voice_agent_id: scratch.agentId,
      provider_call_id: `vol_${scratch.tenantId}_${i}`,
      caller_name: `Volume ${i}`,
      started_at: new Date(Date.now() - (i % 5) * 86_400_000).toISOString(),
      duration_seconds: 120,
      outcome: i % 4 === 0 ? ("voicemail" as const) : ("inquiry_captured" as const),
    }));

    // Chunked to stay under request size limits.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("calls").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    const { data: counts, error } = await db.rpc("call_outcome_counts", {
      p_tenant_id: scratch.tenantId,
    });
    if (error) throw error;

    const total = (counts as { outcome: string; n: number }[]).reduce(
      (a, r) => a + Number(r.n),
      0
    );
    expect(total, "aggregate total is not truncated at 1000").toBe(TOTAL);

    const voicemail = (counts as { outcome: string; n: number }[]).find(
      (r) => r.outcome === "voicemail"
    );
    expect(Number(voicemail!.n), "per-outcome counts are exact").toBe(
      Math.ceil(TOTAL / 4)
    );

    // And the daily rollup covers the same rows without truncating.
    const { data: daily } = await db.rpc("call_stats_daily", {
      p_tenant_id: scratch.tenantId,
      p_from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      p_to: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const dailyTotal = (daily as { n: number }[]).reduce((a, r) => a + Number(r.n), 0);
    expect(dailyTotal, "daily rollup sees every row").toBe(TOTAL);

    await scratch.cleanup();
  });
});
