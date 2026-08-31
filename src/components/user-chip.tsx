import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import type { MembershipRole } from "@/lib/tenant";

/**
 * Sign-out control in the sidebar foot.
 *
 * Note there is no "use client" here and no onClick. Sign-out is a Server
 * Action posted by a plain <form>, so this whole component stays on the server
 * and ships no JavaScript — and it still works with JS disabled.
 */
export async function UserChip({ role }: { role: MembershipRole }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_initials")
    .eq("id", user!.id)
    .maybeSingle();

  const name = profile?.display_name ?? user?.email ?? "Signed in";
  const initials =
    profile?.avatar_initials ??
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");

  return (
    <form action={logout}>
      <button className="user-chip" type="submit">
        <span className="avatar">{initials}</span>
        <span className="who">
          <b>{name}</b>
          <span>{role === "owner" ? "Owner" : "Member"} · sign out</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ color: "var(--faint)" }}
        >
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      </button>
    </form>
  );
}
