"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Queue", exact: true },
  { href: "/admin/agencies", label: "Agencies", exact: false },
  { href: "/admin/webhooks", label: "Webhooks", exact: false },
];

/**
 * Console navigation.
 *
 * A Client Component only because the active tab depends on the current path,
 * which a Server Component in a layout cannot see — layouts do not re-render
 * on navigation, so reading the path there would leave the highlight stuck on
 * whichever page was loaded first.
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Admin sections">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`admin-tab${active ? " on" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
