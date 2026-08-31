"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

/**
 * A Server Action: defined on the server, called from a Client Component as if
 * it were a local function. Next.js turns it into a POST behind the scenes.
 *
 * The password never touches client JavaScript state — the browser posts the
 * form body straight here.
 */
export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) {
    return { error: "Enter both your email and password to continue." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately vague. "No account with that email" tells an attacker which
    // addresses are registered, which is a free user-enumeration oracle.
    return { error: "That email and password combination didn't work." };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(next));
}

/**
 * Only ever redirect to a path on this site.
 *
 * An open redirect turns our own login page into a phishing hop: a link to
 * voxline.io/login?next=... that lands the victim somewhere else entirely,
 * with our domain in the address bar for the part they actually look at.
 *
 * Rejecting "//" is not enough. Browsers normalise a backslash to a forward
 * slash in the authority position, so `/\evil.com` is treated as
 * `//evil.com` — protocol-relative, i.e. off-site — while passing a naive
 * `startsWith("/") && !startsWith("//")` check. Both slashes are rejected here.
 */
function safeNext(next: string): string {
  if (!next.startsWith("/")) return "/app";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/app";
  // Control characters can be used to smuggle a second header or confuse a
  // parser; a legitimate in-app path never contains them.
  if (/[\x00-\x1f]/.test(next)) return "/app";
  return next;
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
