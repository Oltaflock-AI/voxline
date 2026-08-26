import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES RLS.
 * Only for webhook handlers (/api/webhooks/retell, /api/webhooks/stripe) and
 * admin-console server code. The "server-only" import makes any client-bundle
 * leak a build error.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
