import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Gate for /admin. Spec §6.7: "Protect by a role claim, platform admins
 * flagged in a `platform_admins` table."
 *
 * Two clients on purpose:
 *   - the user's own client establishes WHO is asking (verified JWT)
 *   - the service-role client answers WHETHER they are an admin
 *
 * The second is necessary because `platform_admins` has RLS on and no
 * policies, so nobody can read it as themselves — which is what we want. The
 * table is not a secret worth leaking the membership of.
 *
 * A non-admin gets a 404-ish redirect to the portal rather than a 403: an
 * admin console is a nicer target once you know it exists.
 */
export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) redirect("/app");

  return user;
}

/**
 * The same question as `requirePlatformAdmin`, asked without redirecting.
 *
 * For places that need to BRANCH on admin-ness rather than gate on it — the
 * "no agency yet" empty state, which is a dead end for a platform admin (they
 * are deliberately not a member of any tenant) but should not be for anyone
 * else.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data);
}
