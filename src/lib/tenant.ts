import { cache } from "react";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type Tenant = Database["public"]["Tables"]["tenants"]["Row"];
export type Plan = Database["public"]["Tables"]["plans"]["Row"];
export type MembershipRole = Database["public"]["Enums"]["membership_role"];

export type TenantSummary = Pick<
  Tenant,
  "id" | "name" | "slug" | "initials" | "status"
> & {
  role: MembershipRole;
  planName: Plan["name"] | null;
};

/**
 * `cache()` deduplicates within a single request.
 *
 * Rendering /app/[tenant]/calls calls requireTenant() twice — once in the
 * layout for the sidebar and switcher, once in the page — and getUser() runs
 * in the layout, the page and UserChip. Each of those was a separate
 * round-trip: getUser() hits the auth server to verify the JWT, and
 * getUserTenants() is a join across memberships/tenants/plans.
 *
 * Wrapped in cache(), the first call does the work and the rest of the render
 * reuses the result. It is per-request, so there is no staleness risk between
 * users or between navigations.
 */

/**
 * The signed-in user, or a redirect to login.
 *
 * getUser() and not getSession(): getSession() trusts whatever is in the
 * cookie, getUser() verifies the token with the auth server.
 */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
});

/**
 * Every tenant the signed-in user can reach. Drives the switcher.
 *
 * The explicit `.eq("user_id", ...)` is redundant with RLS on `memberships`,
 * and that is the point — AGENTS.md ground rule: "RLS is the enforcement
 * layer; queries still filter explicitly." If a policy is ever dropped by
 * accident, this query still returns the right rows.
 */
export const getUserTenants = cache(async (): Promise<TenantSummary[]> => {
  const supabase = await createClient();
  const user = await requireUser();

  const { data, error } = await supabase
    .from("memberships")
    .select(
      `role,
       tenants!inner (
         id, name, slug, initials, status,
         plans ( name )
       )`
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((m) => ({
    id: m.tenants.id,
    name: m.tenants.name,
    slug: m.tenants.slug,
    initials: m.tenants.initials,
    status: m.tenants.status,
    role: m.role,
    planName: m.tenants.plans?.name ?? null,
  }));
});

/**
 * Resolve the tenant for a `/app/[tenant]` route.
 *
 * A slug the user has no membership for 404s rather than 403s. Telling a
 * stranger "this exists but isn't yours" is itself a leak — it confirms the
 * agency is a Voxline customer.
 */
export const requireTenant = cache(async (slug: string) => {
  const tenants = await getUserTenants();
  const tenant = tenants.find((t) => t.slug === slug);
  if (!tenant) notFound();
  return { tenant, tenants };
});

/** Where to send someone who lands on bare `/app`. */
export async function defaultTenantSlug(): Promise<string | null> {
  const tenants = await getUserTenants();
  return tenants[0]?.slug ?? null;
}
