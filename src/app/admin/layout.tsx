import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { logout } from "@/app/login/actions";
import { AdminNav } from "@/components/admin/admin-nav";

export const metadata = { title: "Admin · Voxline" };

/**
 * Shell for the internal console — spec §6.7, "plain and functional is fine".
 *
 * Plain, not bare. The console is where an agency gets created, where a live
 * phone line gets paused, and where a client's pricing documents are read, so
 * the one thing it states everywhere is which of those it is about to do. The
 * banner is not decoration: every page under here runs on the service role and
 * sees every tenant, and the person using it should never be in doubt.
 *
 * Guarding in the layout covers every child route, so a new page added under
 * /admin is protected by existing rather than by remembering. The actions
 * re-check anyway — a layout guard protects pages, not POSTs.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdmin();

  return (
    <div className="admin-shell">
      <header className="admin-bar">
        <Link href="/admin" className="admin-brand">
          <span className="admin-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
            </svg>
          </span>
          <span>
            <b>Voxline admin</b>
            <span className="admin-scope">Every agency · internal</span>
          </span>
        </Link>

        <AdminNav />

        <form action={logout}>
          <button className="btn-ghost sm" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <main className="admin-main">{children}</main>
    </div>
  );
}
