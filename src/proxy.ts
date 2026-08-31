import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every matched request. Two jobs:
 *
 *   1. Refresh the Supabase session. Access tokens are short-lived; without a
 *      refresh here a user gets silently logged out mid-session. This is the
 *      one place it can happen, because Server Components cannot write cookies.
 *   2. Gate protected routes before any page renders.
 *
 * NOTE ON THE FILENAME — Next.js 16 renamed `middleware.ts` to `proxy.ts` and
 * the exported function from `middleware` to `proxy`. Most tutorials (and the
 * Supabase docs) still say middleware. Same thing, new name. See
 * node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md.
 * The proxy runtime is always nodejs and cannot be set to edge.
 */
export async function proxy(request: NextRequest) {
  // This response object is what we hand back. It has to be recreated whenever
  // Supabase sets cookies, so the refreshed tokens actually reach the browser.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to the request first so anything downstream in this same
          // pass sees the new session...
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          // ...then onto the response, so the browser stores them.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser(), never getSession(). getSession() reads the cookie and trusts it;
  // getUser() verifies the JWT against the auth server. In a security gate,
  // trusting a cookie the client could have edited is the whole vulnerability.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith("/app") || pathname.startsWith("/admin");

  if (!user && isProtected) {
    const loginUrl = new URL("/login", request.url);
    // Remember where they were headed so login can bounce them back.
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  // Returning `response` (and not a fresh NextResponse) is what preserves the
  // refreshed auth cookies. Getting this wrong produces a login loop.
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, image files, and the webhook routes.
     * Without this exclusion the auth check would run against CSS and JS
     * requests too, which is both slow and a good way to accidentally 302 your
     * own stylesheets.
     *
     * api/webhooks is excluded deliberately. Those routes authenticate by
     * signature, never by session, so the getUser() call below was a pointless
     * round-trip to the auth server on the hottest path in the product — on
     * every single call Retell reports, twice per call. It also coupled call
     * ingestion to auth being up, for no benefit.
     */
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
