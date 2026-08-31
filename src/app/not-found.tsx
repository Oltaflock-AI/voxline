import Link from "next/link";
import { Logo, WaveLoader } from "@/components/logo";

/**
 * Branded 404.
 *
 * This is not a rare page. requireTenant() calls notFound() whenever someone
 * reaches an agency they are not a member of — spec §6.1's isolation rule
 * routes through here — so a mistyped slug, a stale bookmark from a tenant
 * someone was removed from, or a shared link all land on it. Next's default is
 * unstyled black with no way back, which reads as "the product is broken"
 * rather than "that page isn't yours".
 *
 * Deliberately vague about why. Distinguishing "no such agency" from "not
 * yours" would confirm to a stranger that a given agency is a Voxline
 * customer, which is the leak notFound() exists to avoid.
 */
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 28,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Logo href="/app" />
        </div>

        <div className="empty" style={{ marginTop: 28, border: "none" }}>
          <span className="ring">
            <WaveLoader height={16} />
          </span>
          <b>We couldn&rsquo;t find that page</b>
          <p>
            The link may be out of date, or it may belong to an agency your
            account doesn&rsquo;t have access to.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 9,
            justifyContent: "center",
            marginTop: 20,
          }}
        >
          <Link className="btn sm" href="/app">
            Back to your portal
          </Link>
          <a className="btn-ghost sm" href="mailto:support@voxline.io">
            Email support
          </a>
        </div>
      </div>
    </main>
  );
}
