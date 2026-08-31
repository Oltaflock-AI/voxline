import type { Database } from "@/lib/supabase/database.types";
import { StageSelect } from "./stage-select";

export type Lead = Database["public"]["Tables"]["leads"]["Row"];

/** One pipeline card. Spec §6.4: name, summary line, tags, and now a stage control. */
export function LeadCard({
  lead,
  tenantSlug,
}: {
  lead: Lead;
  tenantSlug: string;
}) {
  return (
    <div className="lead">
      <b>{lead.name}</b>
      {lead.summary && <p>{lead.summary}</p>}
      {lead.tags.length > 0 && (
        <div className="lead-tags">
          {lead.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
      <StageSelect
        leadId={lead.id}
        currentStage={lead.stage}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
