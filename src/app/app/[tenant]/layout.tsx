import { createClient } from "@/lib/supabase/server";
import { requireTenant, requireUser } from "@/lib/tenant";
import { Logo, WaveLoader } from "@/components/logo";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarNav, MobileTabs, TopbarTab } from "@/components/sidebar-nav";
import { UserChip } from "@/components/user-chip";
import { ToastProvider } from "@/components/toast";

/**
 * The portal shell. A SERVER COMPONENT: it does the database work, then hands
 * finished data down to the few Client Components that need interactivity.
 *
 * Everything under /app/[tenant] renders inside this, and the layout does not
 * re-run on navigation between tabs — so these counts are fetched once per
 * tenant, not once per page view.
 *
 * `params` is a Promise in Next.js 16.
 */
export default async function TenantLayout(props: LayoutProps<"/app/[tenant]">) {
  const { tenant: slug } = await props.params;

  await requireUser();
  const { tenant, tenants } = await requireTenant(slug);

  const supabase = await createClient();

  // head:true returns no rows, just the count — we only want the number.
  // Explicit .eq() on tenant_id even though RLS already scopes these:
  // AGENTS.md ground rule, "RLS is the enforcement layer; queries still
  // filter explicitly." Belt and braces, and it keeps the intent readable.
  const [{ count: callCount }, { count: leadCount }, { data: agent }] =
    await Promise.all([
      supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id),
      supabase
        .from("voice_agents")
        .select("status")
        .eq("tenant_id", tenant.id)
        .limit(1)
        .maybeSingle(),
    ]);

  const agentLive = agent?.status === "live";

  return (
    <ToastProvider>
    <div className="shell">
      <aside className="side">
        <div className="side-top">
          <Logo href={`/app/${tenant.slug}`} size="sm" />
          <TenantSwitcher tenants={tenants} current={tenant} />
        </div>

        <SidebarNav
          tenantSlug={tenant.slug}
          callCount={callCount ?? 0}
          leadCount={leadCount ?? 0}
        />

        <div className="side-foot">
          <UserChip role={tenant.role} />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <h1>{tenant.name}</h1>
            <span className="sep">/</span>
            <TopbarTab />
          </div>

          <div className="topbar-right">
            <div className="status-pill">
              {agentLive && <WaveLoader />}{" "}
              <span>{agentLive ? "Agent live" : "Agent paused"}</span>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <MobileTabs
          tenantSlug={tenant.slug}
          callCount={callCount ?? 0}
          leadCount={leadCount ?? 0}
        />

        <div className="content">{props.children}</div>
      </div>
    </div>
    </ToastProvider>
  );
}
