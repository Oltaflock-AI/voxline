import type { Database } from "@/lib/supabase/database.types";

export type LeadStage = Database["public"]["Enums"]["lead_stage"];

/**
 * Pipeline stages, in board order. Colours from the prototype's STAGES array.
 * Leaf module (types only) so both server and client can import it — see the
 * note at the top of lib/outcomes.ts for why that matters.
 */
export const STAGES: { key: LeadStage; title: string; color: string }[] = [
  { key: "new_inquiry", title: "New inquiry", color: "var(--warning)" },
  { key: "quoted", title: "Quoted", color: "var(--accent)" },
  { key: "booked", title: "Booked", color: "var(--positive)" },
  { key: "traveling", title: "Traveling", color: "var(--muted)" },
];

export const STAGE_TITLES: Record<LeadStage, string> = {
  new_inquiry: "New inquiry",
  quoted: "Quoted",
  booked: "Booked",
  traveling: "Traveling",
};
