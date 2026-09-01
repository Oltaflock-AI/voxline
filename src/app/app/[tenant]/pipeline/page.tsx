import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/tenant";
import { STAGES } from "@/lib/stages";
import { LeadCard } from "@/components/pipeline/lead-card";
import { WaveLoader } from "@/components/logo";

/**
 * Trip pipeline — spec §6.4.
 *
 * Phase 1 is "read and move". The board below is the read half. The move half
 * is a Server Action in ./actions.ts — see the TODO there.
 *
 * Spec §6.4 also says drag and drop may be cut for time and replaced with a
 * stage dropdown on the card, but that "Do not ship frozen cards" — a board
 * you cannot move anything on is not an acceptable Phase 1.
 */
export default async function PipelinePage(
  props: PageProps<"/app/[tenant]/pipeline">
) {
  const { tenant: slug } = await props.params;
  const { tenant } = await requireTenant(slug);

  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenant.id)
    // Matches the leads(tenant_id, stage, position) index from spec §5, so
    // Postgres reads this straight off the index without a sort step.
    .order("stage", { ascending: true })
    .order("position", { ascending: true });

  const all = leads ?? [];

  return (
    <section className="panel on">
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h3 className="panel-title">Trip pipeline</h3>
          <span className="card-sub">
            Voxline adds a card here for every qualifying call.
          </span>
        </div>
      </div>

      <div className="kanban">
        {STAGES.map((stage) => {
          const cards = all.filter((l) => l.stage === stage.key);
          return (
            <div className="col" key={stage.key}>
              <div className="col-head">
                <span className="dot" style={{ background: stage.color }} />
                <b>{stage.title}</b>
                <span className="c">{cards.length}</span>
              </div>

              {cards.length > 0 ? (
                cards.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} tenantSlug={tenant.slug} />
                ))
              ) : (
                /* Spec §7.9: every list has an empty state with a real
                   sentence, never a blank panel. */
                <div className="col-empty">
                  <WaveLoader height={14} />
                  Nothing at this stage
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
