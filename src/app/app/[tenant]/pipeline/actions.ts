"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LeadStage } from "@/lib/stages";

export type MoveLeadState = { error: string | null };

/**
 * Move a lead to a different pipeline stage, persisting `stage` and
 * `position` (spec §6.4).
 */
export async function moveLead(
  leadId: string,
  stage: LeadStage,
  tenantSlug: string
): Promise<MoveLeadState> {
  const supabase = await createClient();

  // Look up which agency this lead actually belongs to, from the row itself
  // — not from anything passed in. A user can belong to more than one agency
  // (Sofia does), and RLS alone only proves "one of your agencies," not
  // "this specific one." Without this, the count below silently included
  // every agency the caller can see, not just this lead's own board.
  const { data: lead } = await supabase
    .from("leads")
    .select("tenant_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) {
    return { error: "Could not move that lead." };
  }

  // Put the card at the end of its new column: count how many leads are
  // already there, and use that count as the new position (0-indexed, so
  // "3 already there" means the new one lands at position 3, i.e. 4th).
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", lead.tenant_id)
    .eq("stage", stage);

  const { error } = await supabase
    .from("leads")
    .update({ stage, position: count ?? 0 })
    .eq("id", leadId);

  if (error) {
    return { error: "Could not move that lead." };
  }

  revalidatePath(`/app/${tenantSlug}/pipeline`);
  return { error: null };
}
