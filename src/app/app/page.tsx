import { redirect } from "next/navigation";
import { requireUser, defaultTenantSlug } from "@/lib/tenant";
import { isPlatformAdmin } from "@/lib/admin";
import { logout } from "@/app/login/actions";

/**
 * Bare /app has no tenant in the URL, so it picks one and redirects.
 * Spec §6.1: one tenant goes straight to its dashboard, several go to the last
 * used one. "Last used" needs somewhere to persist it (profiles), so for now
 * it is the first membership.
 */
export default async function AppIndex() {
  const user = await requireUser();
  const slug = await defaultTenantSlug();

  if (slug) redirect(`/app/${slug}`);

  // A platform admin has no membership by design, so this is the page they
  // land on if they ever type /app — send them where they actually belong
  // rather than telling staff to "ask your Voxline contact".
  if (await isPlatformAdmin(user.id)) redirect("/admin");

  return (
    <main className="content">
      <div className="empty">
        <h3 className="serif">No agency yet</h3>
        <p>
          Your account isn&rsquo;t linked to an agency. Ask your Voxline contact
          to add you, and this will fill in.
        </p>
        {/*
          Without this the page is a dead end: no sidebar renders here, so there
          was no way out except editing the URL.
        */}
        <form action={logout} style={{ marginTop: 16 }}>
          <button className="btn-ghost sm" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
