import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { explainScore } from "../src/lib/score";

/**
 * ============================================================================
 * The real-estate vertical: does the database agree with the portal?
 * ============================================================================
 *
 * `calls.lead_score` is a stored generated column, and `src/lib/score.ts`
 * rebuilds the same arithmetic so the call detail page can show its working.
 * Two implementations of one formula, in two languages, which is exactly the
 * arrangement that drifts — the migration's own header says so.
 *
 * These tests are the thing that stops it. They assert the SQL and the
 * TypeScript produce the same number for the same call, and that the number
 * changes when the vertical does.
 *
 * 79 is chosen deliberately: it sits one point under the 80 "hot" boundary, so
 * an off-by-one in either implementation moves the band as well as the score
 * and gets caught twice.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** A tenant with one agent on a chosen vertical, thrown away afterwards. */
async function scratchTenant(vertical: "travel" | "real_estate") {
  const db = admin();
  const suffix = crypto.randomBytes(6).toString("hex");

  const { data: tenant, error: tErr } = await db
    .from("tenants")
    .insert({
      name: `Scratch ${vertical}`,
      slug: `scratch-${vertical.replace("_", "-")}-${suffix}`,
      initials: "SC",
    })
    .select("id")
    .single();
  if (tErr) throw tErr;

  const { data: agent, error: aErr } = await db
    .from("voice_agents")
    .insert({
      tenant_id: tenant.id,
      name: `Scratch ${vertical} agent`,
      provider: "elevenlabs",
      provider_agent_id: `scratch_${suffix}`,
      vertical,
      status: "live",
    })
    .select("id")
    .single();
  if (aErr) throw aErr;

  return {
    tenantId: tenant.id as string,
    agentId: agent.id as string,
    async cleanup() {
      await db.from("tenants").delete().eq("id", tenant.id);
    },
  };
}

/** The same call, written directly, so only the vertical differs. */
const BOOKED_CALL = {
  outcome: "site_visit_booked" as const,
  duration_seconds: 200,
  analysis: {
    intent: "investment",
    property_type: "commercial",
    unit_size: "1200 sq ft",
    // timeline and budget deliberately absent: 3 of 5 fields, not 5.
  },
};

test.describe("real-estate scoring", () => {
  test("the generated column and explainScore agree", async () => {
    const scratch = await scratchTenant("real_estate");
    const db = admin();

    try {
      const { data: call, error } = await db
        .from("calls")
        .insert({
          tenant_id: scratch.tenantId,
          voice_agent_id: scratch.agentId,
          provider: "elevenlabs",
          provider_call_id: `conv_${crypto.randomBytes(6).toString("hex")}`,
          vertical: "real_estate",
          ...BOOKED_CALL,
        })
        .select("lead_score, vertical")
        .single();
      if (error) throw error;

      // 45 for the booking + 3 x 8 for the captured fields + min(15, 200/20).
      expect(call.vertical).toBe("real_estate");
      expect(call.lead_score).toBe(79);

      const explained = explainScore({
        outcome: BOOKED_CALL.outcome,
        analysis: BOOKED_CALL.analysis,
        duration_seconds: BOOKED_CALL.duration_seconds,
        vertical: "real_estate",
      });
      expect(explained.total).toBe(call.lead_score);
    } finally {
      await scratch.cleanup();
    }
  });

  test("the identical call scores differently on a travel agent", async () => {
    // Proves the branch actually branches. `site_visit_booked` has no arm in
    // the travel CASE, so it falls to 0, and none of the travel brief keys are
    // present — leaving only the talk time.
    const scratch = await scratchTenant("travel");
    const db = admin();

    try {
      const { data: call, error } = await db
        .from("calls")
        .insert({
          tenant_id: scratch.tenantId,
          voice_agent_id: scratch.agentId,
          provider: "elevenlabs",
          provider_call_id: `conv_${crypto.randomBytes(6).toString("hex")}`,
          vertical: "travel",
          ...BOOKED_CALL,
        })
        .select("lead_score")
        .single();
      if (error) throw error;

      expect(call.lead_score).toBe(10);
      expect(
        explainScore({
          outcome: BOOKED_CALL.outcome,
          analysis: BOOKED_CALL.analysis,
          duration_seconds: BOOKED_CALL.duration_seconds,
          vertical: "travel",
        }).total
      ).toBe(10);
    } finally {
      await scratch.cleanup();
    }
  });

  test("a full travel brief still scores exactly as it always did", async () => {
    // The travel branch of the migration is byte-for-byte the pre-vertical
    // formula. Any change here is a regression for every existing agency.
    const scratch = await scratchTenant("travel");
    const db = admin();

    try {
      const { data: call, error } = await db
        .from("calls")
        .insert({
          tenant_id: scratch.tenantId,
          voice_agent_id: scratch.agentId,
          provider: "elevenlabs",
          provider_call_id: `conv_${crypto.randomBytes(6).toString("hex")}`,
          vertical: "travel",
          outcome: "quote_requested",
          duration_seconds: 300,
          analysis: {
            destination: "Bali",
            dates: "June",
            party_size: "4",
            budget: "5 lakh",
            occasion: "honeymoon",
          },
        })
        .select("lead_score")
        .single();
      if (error) throw error;

      // 45 + 5 x 8 + 15, capped at 100.
      expect(call.lead_score).toBe(100);
    } finally {
      await scratch.cleanup();
    }
  });
});
