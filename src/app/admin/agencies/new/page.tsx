import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { NewAgencyForm } from "@/components/admin/new-agency-form";

/**
 * Onboard an agency without opening a SQL client.
 *
 * Spec §6.7 asks for this and it was cut during the build, which left "add a
 * client" as three hand-written INSERTs against production — tenant,
 * membership, voice agent — with a hand-copied UUID between each. That is how
 * a call ends up in the wrong agency's portal.
 */
export default async function NewAgencyPage() {
  const { data: plans } = await createAdminClient()
    .from("plans")
    .select("id, name, included_minutes")
    .order("monthly_price_cents", { ascending: true });

  return (
    <>
      <div className="admin-head">
        <div>
          <Link className="admin-back" href="/admin/agencies">
            ← Agencies
          </Link>
          <h1>New agency</h1>
          <p>
            Creates the agency, links its first user, and optionally sets up the
            voice agent record.
          </p>
        </div>
      </div>

      <NewAgencyForm plans={plans ?? []} />
    </>
  );
}
