import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Anon key only — RLS enforces tenant isolation.
 * Never import the admin client into anything that ships to the browser.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
